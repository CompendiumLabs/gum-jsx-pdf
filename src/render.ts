import type { Drawing, Fragment, PixelRect, Transform } from '@gum-jsx/core'
import { parse_color } from './color'
import type { Color } from './color'
import { ellipse_path, path_commands, rect_path, square_caps } from './path'
import { PdfWriter, number, numbers, text_string } from './writer'

type PdfOptions = Readonly<{
  title?: string
  background?: string
  /** Physical scale; defaults to 72 / 96 points per layout pixel. */
  points_per_pixel?: number
}>

const IDENTITY: Transform = [1, 0, 0, 1, 0, 0]
const is_identity = (matrix: Transform) => matrix.every((value, i) => value === IDENTITY[i])
const matrix_command = (matrix: Transform) => is_identity(matrix) ? '' : `${numbers(matrix)} cm\n`

// Keep affine transforms in PDF, including their effect on strokes and dashes.
// Accumulating placement-only nodes avoids a graphics-state stack per wrapper.
function multiply(left: Transform, right: Transform): Transform {
  const [a, b, c, d, e, f] = left, [g, h, i, j, k, l] = right
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f]
}

// A transparency form clips to its BBox. Use a control hull and conservative
// stroke padding, independent of optional caller-provided ink bounds.
function drawing_bounds(draw: Drawing): PixelRect {
  let x: number, y: number, width: number, height: number
  if (draw.kind === 'rect') ({ x, y, width, height } = draw.rect)
  else if (draw.kind === 'ellipse') {
    x = draw.center.x - draw.radius.x; y = draw.center.y - draw.radius.y
    width = 2 * draw.radius.x; height = 2 * draw.radius.y
  } else {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    const add = (px: number, py: number) => {
      left = Math.min(left, px); top = Math.min(top, py)
      right = Math.max(right, px); bottom = Math.max(bottom, py)
    }
    for (const command of draw.commands) {
      if (command.kind === 'Z') continue
      add(command.x, command.y)
      if (command.kind === 'Q' || command.kind === 'C') add(command.x1, command.y1)
      if (command.kind === 'C') add(command.x2, command.y2)
    }
    x = left; y = top; width = right - left; height = bottom - top
  }
  const pad = draw.stroke_width / 2 * Math.max(Math.SQRT2, draw.stroke_miterlimit ?? 4)
  return { x: x - pad, y: y - pad, width: width + pad * 2, height: height + pad * 2 }
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`)
  return value
}

/** Serialize a completed fragment to a single vector PDF page, without layout or fonts. */
function render_pdf(fragment: Fragment, options: PdfOptions = {}): Uint8Array {
  const scale = positive(options.points_per_pixel ?? 72 / 96, 'points_per_pixel')
  const { width, height } = fragment.size
  const page_width = positive(width * scale, 'page width'), page_height = positive(height * scale, 'page height')
  if (page_width > 14_400 || page_height > 14_400) {
    throw new RangeError('PDF 1.4 page dimensions must not exceed 14400 points')
  }
  const writer = new PdfWriter(), catalog = writer.reserve(), pages = writer.reserve()
  const states = new Map<string, { name: string; id: number }>()
  const forms: { name: string; id: number }[] = []
  const colors = new Map<string, Color | null>()
  const drawings = new WeakMap<Drawing, string>()
  function color(source: string): Color | null {
    if (!colors.has(source)) colors.set(source, parse_color(source))
    return colors.get(source)!
  }
  function alpha(fill: number, stroke: number): string {
    const key = `${number(fill)} ${number(stroke)}`
    let state = states.get(key)
    if (!state) {
      state = { name: `A${states.size}`, id: writer.add(`<< /Type /ExtGState /ca ${number(fill)} /CA ${number(stroke)} >>`) }
      states.set(key, state)
    }
    return `/${state.name} gs\n`
  }
  const state_resources = () => `/ExtGState << ${[...states.values()].map(({ name, id }) => `/${name} ${id} 0 R`).join(' ')} >>`
  const resources = () => `${state_resources()} /XObject << ${forms.map(({ name, id }) => `/${name} ${id} 0 R`).join(' ')} >>`
  function transparency_form(content: string, draw: Drawing): string {
    const { x, y, width, height } = drawing_bounds(draw)
    const name = `F${forms.length}`
    const id = writer.stream(content, `/Type /XObject /Subtype /Form /FormType 1`
      + ` /BBox [${numbers([x, y, x + width, y + height])}]`
      + ' /Group << /S /Transparency /CS /DeviceRGB /I true >>'
      + ` /Resources << ${resources()} >>`)
    forms.push({ name, id })
    return `/${name} Do\n`
  }

  function render_drawing(draw: Drawing): string {
    const cached = drawings.get(draw)
    if (cached !== undefined) return cached
    const opacity = draw.opacity ?? 1
    if (opacity === 0) return ''
    let path: string
    switch (draw.kind) {
      case 'rect':
        if (draw.rect.width === 0 || draw.rect.height === 0) return ''
        path = rect_path(draw.rect, draw.radius); break
      case 'ellipse':
        if (draw.radius.x === 0 || draw.radius.y === 0) return ''
        path = ellipse_path(draw.center, draw.radius); break
      case 'path':
        if (!draw.commands.some(command => command.kind !== 'M')) return ''
        path = path_commands(draw.commands); break
      default: throw new TypeError('Unknown PDF drawing kind')
    }
    const fill_color = color(draw.fill), stroke_color = color(draw.stroke)
    const fill = fill_color && fill_color[3] > 0 ? fill_color : null
    const stroke = stroke_color && stroke_color[3] > 0 && draw.stroke_width > 0 ? stroke_color : null
    if (!fill && !stroke) return ''
    const grouped = opacity !== 1 && fill !== null && stroke !== null
    const fill_alpha = (fill?.[3] ?? 1) * (grouped ? 1 : opacity)
    const stroke_alpha = (stroke?.[3] ?? 1) * (grouped ? 1 : opacity)
    let content = fill_alpha !== 1 || stroke_alpha !== 1 ? alpha(fill_alpha, stroke_alpha) : ''
    if (fill) content += `${numbers(fill.slice(0, 3))} rg\n`
    if (stroke) {
      const caps = { butt: 0, round: 1, square: 2 }, joins = { miter: 0, round: 1, bevel: 2 }
      const dash = draw.stroke_dasharray?.some(value => value > 0) ? draw.stroke_dasharray : []
      content += `${numbers(stroke.slice(0, 3))} RG\n${number(draw.stroke_width)} w\n`
        + `${caps[draw.stroke_linecap ?? 'butt']} J\n${joins[draw.stroke_linejoin ?? 'miter']} j\n`
        + `${number(draw.stroke_miterlimit ?? 4)} M\n[${numbers(dash)}] 0 d\n`
    }
    // Separate paint operations preserve SVG's fill-then-stroke compositing,
    // including translucent stroke colors over an already painted fill.
    if (fill) content += path + 'f\n'
    if (stroke) {
      const caps = draw.kind === 'path' && draw.stroke_linecap === 'square'
        ? square_caps(draw.commands, draw.stroke_width) : ''
      if (caps) {
        const stroke_content = alpha(1, 1) + path + 'S\n' + `${numbers(stroke.slice(0, 3))} rg\n` + caps + 'f\n'
        // Combine cap geometry with the stroke before applying its alpha, so
        // coincident subpaths and intersections do not become darker.
        content += 'q\n' + (stroke_alpha === 1 ? stroke_content
          : alpha(stroke_alpha, stroke_alpha) + transparency_form(stroke_content, draw)) + 'Q\n'
      } else content += path + 'S\n'
    }
    if (grouped) {
      const form = transparency_form(content, draw)
      content = alpha(opacity, opacity) + form
    }
    drawings.set(draw, content)
    return content
  }

  const content: string[] = ['q\n', `${numbers([scale, 0, 0, -scale, 0, page_height])} cm\n`,
    rect_path({ x: 0, y: 0, width, height }), 'W n\n']
  if (options.background !== undefined) {
    const background: Drawing = { kind: 'rect', rect: { x: 0, y: 0, width, height },
      fill: options.background, stroke: 'none', stroke_width: 0 }
    content.push('q\n', render_drawing(background), 'Q\n')
  }

  function visit(node: Fragment, transform: Transform): void {
    if (node.clip && (node.clip.width === 0 || node.clip.height === 0)) return
    if (node.clip) {
      content.push('q\n', matrix_command(transform), rect_path(node.clip, node.clip.radius), 'W n\n')
      transform = IDENTITY
    }
    for (const draw of node.draw) {
      const drawing = render_drawing(draw)
      if (drawing) content.push('q\n', matrix_command(transform), drawing, 'Q\n')
    }
    for (const child of node.children) {
      const [a, b, c, d, e, f] = child.transform ?? IDENTITY
      // SVG paints nothing for singular placements, even with a visible stroke.
      if (a * d - b * c === 0) continue
      visit(child.fragment, multiply(transform, [a, b, c, d, e + child.offset.x, f + child.offset.y]))
    }
    if (node.clip) content.push('Q\n')
  }
  visit(fragment, IDENTITY)
  content.push('Q\n')
  const stream = writer.stream(content.join(''))
  const page = writer.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${numbers([page_width, page_height])}]`
    + ` /Resources << ${resources()} >> /Contents ${stream} 0 R`
    + ' /Group << /S /Transparency /CS /DeviceRGB /I true >> >>')
  writer.set(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`)
  writer.set(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`)
  const info = options.title === undefined ? undefined : writer.add(`<< /Title ${text_string(options.title)} >>`)
  return writer.finish(catalog, info)
}

export { render_pdf }
export type { PdfOptions }
