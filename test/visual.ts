// Optional integration check: qpdf + Poppler validate and render the actual PDF.
// Artifacts stay in out/visual for inspection; no external tools are needed by
// the library or its regular unit tests.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  draw_rect, draw_ellipse, draw_path, make_fragment, make_size, make_rect, make_clip,
  place_fragment, render_svg, LayoutPass, Text, Span, PngImage, px,
} from '@gum-jsx/core'
import { encode } from 'fast-png'
import type { Drawing, Fragment, Paint, PathCommand, Transform } from '@gum-jsx/core'
import { createMathFonts, mathToElement } from '@gum-jsx/math'
import { rasterize_pixels, rasterize_svg } from '@gum-jsx/png'
import { render_pdf } from '../src/index'

for (const tool of ['qpdf', 'pdftoppm', 'pdfinfo']) {
  if (!Bun.which(tool)) throw new Error(`Visual PDF checks require ${tool} on PATH`)
}
const output = fileURLToPath(new URL('../out/visual/', import.meta.url))
await mkdir(output, { recursive: true })
const paint: Paint = { fill: '#1e88e5', stroke: '#172554', stroke_width: 3 }
const scene = (draw: readonly Drawing[], children: Fragment['children'] = []) =>
  make_fragment({ size: make_size(240, 160), draw, children })
const rect = (x: number, y: number, width: number, height: number, style: Partial<Paint> = {}) =>
  draw_rect(make_rect(x, y, width, height), { ...paint, ...style })
const shape = make_fragment({ size: make_size(60, 40), draw: [
  draw_rect(make_rect(2, 2, 56, 36), { ...paint, stroke_dasharray: [3, 2, 1] }, { x: 8, y: 12 }),
  draw_path([{ kind: 'M', x: 0, y: 10 }, { kind: 'Q', x1: 30, y1: 60, x: 60, y: 10 }],
    { ...paint, fill: 'none', stroke: 'red' }),
] })
const angle = Math.PI / 8
const rotation: Transform = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]
const clipped = make_fragment({ size: make_size(85, 70),
  clip: make_clip(make_rect(0, 0, 85, 70), { tl: [20, 10], tr: [2, 2], br: [20, 25], bl: [0, 0] }),
  draw: [rect(-20, -20, 130, 130, { fill: '#dceaf2', stroke: 'none' })],
  children: [place_fragment(shape, [-5, 8], [1.5, 0.2, 0.4, 1.5, 2, 3])],
})
let deep = shape
for (let i = 0; i < 30; i++) deep = make_fragment({ size: shape.size,
  children: [place_fragment(deep, [0.2, 0.1], [1.002, 0, 0, 0.998, 0, 0])] })

const text = new LayoutPass().layout(new Text({ font_size: px(24), children: [
  'AV office Ω ', new Span({ font_weight: 700, color: 'rebeccapurple', children: 'Bold' }),
] }))
const fonts = createMathFonts()
const math_pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })
const formula = (source: string) => math_pass.layout(mathToElement(source, { font_size: px(23) }))
const image_pixels = new Uint8Array(64 * 32 * 4)
for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
  image_pixels.set([x * 4, y * 8, 255 - x * 4, x < 16 ? 0 : x < 32 ? 128 : 255], (y * 64 + x) * 4)
}
const image_data = `data:image/png;base64,${Buffer.from(encode({ width: 64, height: 32, data: image_pixels })).toString('base64')}`
const image_pass = new LayoutPass()
const png = image_pass.layout(new PngImage({ data: image_data, width: px(100), height: px(80) }))
const translucent_png = image_pass.layout(new PngImage({ data: image_data, width: px(90), opacity: 0.5 }))
const fixtures: Record<string, Fragment> = {
  images: scene([rect(0, 0, 240, 160, { fill: '#e5df9a', stroke: 'none' })], [
    place_fragment(png, [5, 0]), place_fragment(translucent_png, [130, 5]),
    place_fragment(png, [110, 80], [-1, 0, 0, 1, 0, 0]),
    place_fragment(make_fragment({ size: make_size(80, 60), clip: make_clip(make_rect(0, 0, 80, 60), [12, 12]),
      children: [place_fragment(translucent_png, [-5, 5], rotation)] }), [135, 85]),
  ]),
  geometry: scene([
    rect(10, 10, 60, 45),
    draw_rect(make_rect(90, 10, 80, 50), { ...paint, fill: '#b8e0c4' },
      { tl: [15, 10], tr: [0, 5], br: [20, 20], bl: [5, 15] }),
    draw_ellipse([200, 35], [24, 15], { ...paint, fill: 'gold' }),
    draw_path([{ kind: 'M', x: 10, y: 120 }, { kind: 'Q', x1: 50, y1: 50, x: 90, y: 120 },
      { kind: 'C', x1: 140, y1: 160, x2: 170, y2: 50, x: 225, y: 120 }],
    { ...paint, fill: 'none', stroke_linecap: 'round', stroke_dasharray: [7, 3, 2] }),
  ]),
  transforms: scene([], [place_fragment(shape, [15, 15], [2, 0, 0, 0.65, 0, 0]),
    place_fragment(shape, [130, 25], rotation), place_fragment(shape, [220, 90], [-1.6, 0.2, 0.3, 1.2, 0, 0]),
    place_fragment(deep, [0, 95])]),
  clips: scene([], [place_fragment(clipped, [15, 20], rotation), place_fragment(clipped, [130, 15]),
    place_fragment(shape, [160, 110]),
    place_fragment(make_fragment({ size: clipped.size, clip: make_clip(make_rect(10, 0, 65, 65)),
      children: [place_fragment(clipped, [-10, 15], rotation)] }), [20, 85])]),
  opacity: scene([
    rect(0, 0, 240, 160, { fill: '#e5df9a', stroke: 'none' }),
    rect(20, 20, 60, 45, { fill: 'red', stroke: 'blue', stroke_width: 14, opacity: 0.5 }),
    rect(110, 20, 60, 45, { fill: 'rgba(255,0,0,.4)', stroke: 'rgba(0,0,255,.6)', stroke_width: 14, opacity: 0.5 }),
    rect(20, 95, 60, 40, { fill: 'rgba(255,0,0,.4)', stroke: 'rgba(0,0,255,.6)', stroke_width: 14 }),
    rect(110, 95, 60, 40, { fill: 'none', stroke: '#0000ff80', stroke_width: 14, opacity: 0.5 }),
    rect(190, 95, 30, 40, { fill: '#ff000080', stroke: 'none', opacity: 0.5 }),
  ]),
  text: scene([], [place_fragment(text, [10, 10]), place_fragment(text, [20, 60], rotation),
    place_fragment(text, [10, 120], [1, 0, 0.2, 0.6, 0, 0])]),
  math: scene([], [
    place_fragment(formula(String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`), [10, 10]),
    place_fragment(formula(String.raw`\left[\begin{matrix}a & b\\c & d\end{matrix}\right]`), [15, 90]),
    place_fragment(formula(String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}`), [110, 90]),
  ]),
  degenerate: scene((['round', 'square'] as const).flatMap((cap, row) =>
    Array.from({ length: 4 }, (_, col) => {
      const x = 30 + col * 60, y = 40 + row * 60
      const segment: PathCommand = col === 0 ? { kind: 'Z' }
        : col === 1 ? { kind: 'L', x, y }
        : col === 2 ? { kind: 'Q', x1: x, y1: y, x, y }
        : { kind: 'C', x1: x, y1: y, x2: x, y2: y, x, y }
      return draw_path([{ kind: 'M', x, y }, segment, { kind: 'M', x, y }, segment],
        { ...paint, fill: 'red', stroke: 'rgba(0,0,255,.5)', stroke_width: 16, stroke_linecap: cap, opacity: 0.5 })
    }))),
  strokes: scene(['butt', 'round', 'square'].flatMap((cap, index) => [
    draw_path([{ kind: 'M', x: 20, y: 25 + index * 50 }, { kind: 'L', x: 70, y: 25 + index * 50 }],
      { ...paint, fill: 'none', stroke_width: 12, stroke_linecap: cap as Paint['stroke_linecap'] }),
    draw_path([{ kind: 'M', x: 100, y: 25 + index * 50 }, { kind: 'L', x: 100, y: 25 + index * 50 }],
      { ...paint, fill: 'none', stroke_width: 12, stroke_linecap: cap as Paint['stroke_linecap'] }),
    draw_path([{ kind: 'M', x: 140, y: 35 + index * 50 }, { kind: 'L', x: 165, y: 10 + index * 50 },
      { kind: 'L', x: 190, y: 35 + index * 50 }],
    { ...paint, fill: 'none', stroke_width: 10, stroke_linejoin: (['miter', 'round', 'bevel'] as const)[index] }),
  ])),
}

function run(args: string[]): string {
  const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
  assert.equal(result.exitCode, 0, `${args.join(' ')}\n${result.stderr.toString()}`)
  assert.equal(result.stderr.length, 0, `${args[0]} reported: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

for (const [name, fragment] of Object.entries(fixtures)) {
  const base = `${output}${name}`
  const pdf = render_pdf(fragment, { title: `Gum PDF — ${name}`, background: 'white' })
  await Bun.write(`${base}.pdf`, pdf)
  run(['qpdf', '--check', `${base}.pdf`])
  assert.match(run(['pdfinfo', `${base}.pdf`]), /Page size:\s+180 x 120 pts/)
  run(['pdftoppm', '-r', '192', '-singlefile', `${base}.pdf`, base])
  const ppm = Buffer.from(await Bun.file(`${base}.ppm`).arrayBuffer())
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\n/.exec(ppm.subarray(0, 80).toString('ascii'))!
  assert.ok(header, 'Expected binary RGB PPM')
  const rgb = ppm.subarray(header[0].length)
  if (name === 'strokes') {
    for (const y of [75, 125]) {
      const index = (y * 2 * 480 + 200) * 3
      assert.deepEqual([...rgb.subarray(index, index + 3)], [23, 37, 84], 'Zero-length cap must be visible')
    }
  }
  if (name === 'opacity') {
    // A blue stroke inside the red fill must be blue at 50% group opacity,
    // with no extra red contribution from painting fill/stroke independently.
    const index = (30 * 2 * 480 + 22 * 2) * 3
    const expected = [114, 111, 204]
    expected.forEach((value, channel) => assert.ok(Math.abs(rgb[index + channel]! - value) <= 1))
  }
  if (name === 'degenerate') {
    for (const y of [40, 100]) for (const x of [30, 90, 150, 210]) {
      const index = (y * 2 * 480 + x * 2) * 3
      // Overlapping zero-length subpaths comprise one stroke, with alpha .25.
      assert.ok(Math.abs(rgb[index]! - 191) <= 1, `Missing or double-painted cap at ${x},${y}: ${rgb[index]}`)
      assert.ok(rgb[index + 2]! >= 253)
    }
  }
  const svg = render_svg(fragment, { background: 'white' })
  await Bun.write(`${base}.svg`, svg)
  await Bun.write(`${base}-svg.png`, rasterize_svg(svg, { ratio: 2 }))
  const reference = rasterize_pixels(svg, { ratio: 2 })
  assert.equal(Number(header[1]), reference.width)
  assert.equal(Number(header[2]), reference.height)
  assert.equal(rgb.length, reference.width * reference.height * 3)
  let total_error = 0, differing = 0
  for (let pixel = 0; pixel < reference.width * reference.height; pixel++) {
    let max = 0
    for (let channel = 0; channel < 3; channel++) {
      const error = Math.abs(rgb[pixel * 3 + channel]! - reference.data[pixel * 4 + channel]!)
      total_error += error; max = Math.max(max, error)
    }
    if (max > 32) differing++
  }
  const mean = total_error / rgb.length, fraction = differing / (rgb.length / 3)
  console.log(`${name}: mean channel error ${mean.toFixed(3)}/255; ${(fraction * 100).toFixed(2)}% pixels differ by >32`)
  // Different rasterizers antialias edges differently; large interior differences
  // still fail, including incorrect opacity, transforms, clipping, or glyph holes.
  assert.ok(mean < 2, `${name}: excessive mean error ${mean}`)
  assert.ok(fraction < 0.025, `${name}: excessive differing pixels ${fraction}`)
}
// Compare every page to its standalone PDF, including resources first introduced
// on later pages and reused again after other images/transparency groups.
const deck = [...Object.entries(fixtures).reverse(), ['images', fixtures.images!] as const,
  ['opacity', fixtures.opacity!] as const]
const deck_path = `${output}deck.pdf`
await Bun.write(deck_path, render_pdf(deck.map(([, fragment]) => fragment), { background: 'white' }))
run(['qpdf', '--check', deck_path])
assert.match(run(['pdfinfo', deck_path]), new RegExp(`Pages:\\s+${deck.length}\\b`))
for (const [index, [name]] of deck.entries()) {
  const page = String(index + 1), base = `${output}deck-${page}`
  run(['pdftoppm', '-r', '192', '-f', page, '-l', page, '-singlefile', deck_path, base])
  assert.deepEqual(await Bun.file(`${base}.ppm`).arrayBuffer(), await Bun.file(`${output}${name}.ppm`).arrayBuffer(),
    `Deck page ${page} must match standalone ${name}`)
}
console.log(`Validated ${Object.keys(fixtures).length} PDFs and a ${deck.length}-page deck; comparison artifacts: ${output}`)
