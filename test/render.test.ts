import { expect, test } from 'bun:test'
import {
  draw_rect, draw_path, make_fragment, make_size, make_rect, make_clip, place_fragment,
  LayoutPass, Text, px,
} from '@gum-jsx/core'
import { render_pdf } from '../src/index'
import { number, PdfWriter } from '../src/writer'
import { path_commands, square_caps } from '../src/path'

const paint = { fill: '#369', stroke: 'none', stroke_width: 0 }
const leaf = make_fragment({ size: make_size(20, 10), draw: [draw_rect(make_rect(0, 0, 20, 10), paint)] })
const decode = (data: Uint8Array) => new TextDecoder().decode(data)

function check_structure(data: Uint8Array): void {
  // A Latin-1 view preserves byte positions even for UTF-8 bytes in the header.
  const bytes = Buffer.from(data), source = bytes.toString('latin1')
  const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(source)
  expect(startxref).not.toBeNull()
  const offset = Number(startxref![1])
  const entries = source.slice(offset).split('\n')
  expect(entries[0]).toBe('xref')
  const count = Number(entries[1]!.split(' ')[1])
  expect(entries[2]).toBe('0000000000 65535 f ')
  for (let id = 1; id < count; id++) {
    const entry = entries[id + 2]!
    expect(entry).toMatch(/^\d{10} 00000 n $/)
    expect(source.slice(Number(entry.slice(0, 10)))).toStartWith(`${id} 0 obj\n`)
  }
  for (const match of source.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const end = match.index! + match[0].length + Number(match[1])
    expect(source.slice(end)).toStartWith('\nendstream')
  }
}

test('valid deterministic PDF, physical sizing and Unicode metadata', () => {
  const options = { title: 'Gum (α) \\ 🌱', background: 'white' }
  const bytes = render_pdf(leaf, options)
  expect(bytes).toBeInstanceOf(Uint8Array)
  expect(bytes).toEqual(render_pdf(leaf, options))
  const pdf = decode(bytes)
  expect(pdf).toStartWith('%PDF-1.4\n')
  expect(pdf).toContain('/MediaBox [0 0 15 7.5]')
  expect(pdf).toContain('0.75 0 0 -0.75 0 7.5 cm')
  expect(pdf).toContain('/Title <feff00470075006d0020002803b100290020005c0020d83cdf31>')
  expect(decode(render_pdf(leaf, { points_per_pixel: 1 }))).toContain('/MediaBox [0 0 20 10]')
  check_structure(bytes)
})

test('writer counts stream lengths and cross-reference positions in bytes', () => {
  const writer = new PdfWriter()
  const stream = writer.stream('α🌱\n')
  const root = writer.add(`<< /Test ${stream} 0 R >>`)
  check_structure(writer.finish(root))
})

test('PDF numbers preserve small values without exponent notation', () => {
  for (const value of [0, -0, 0.1234567890123456, 1e-7, -2.3e-12, 1e21, -1.23e25, Number.MIN_VALUE]) {
    const serialized = number(value)
    expect(serialized).not.toMatch(/[eE]/)
    expect(Number(serialized)).toBe(value === 0 ? 0 : value)
  }
  for (const value of [Infinity, -Infinity, NaN]) expect(() => number(value)).toThrow()
})

test('quadratics convert exactly and closepath restores the current point', () => {
  expect(path_commands([
    { kind: 'M', x: 0, y: 0 }, { kind: 'Q', x1: 3, y1: 6, x: 6, y: 0 },
    { kind: 'Z' }, { kind: 'Q', x1: 3, y1: 3, x: 6, y: 0 },
  ])).toBe('0 0 m\n2 4 4 4 6 0 c\nh\n2 2 4 2 6 0 c\n')
})

test('square cap geometry distinguishes point subpaths from loops and lone moves', () => {
  expect(square_caps([
    { kind: 'M', x: 10, y: 20 }, { kind: 'Z' },
    { kind: 'M', x: 30, y: 40 }, { kind: 'L', x: 30, y: 40 },
    { kind: 'M', x: 50, y: 60 }, { kind: 'Q', x1: 70, y1: 80, x: 50, y: 60 },
    { kind: 'M', x: 90, y: 100 },
  ], 4)).toBe('8 18 4 4 re\n28 38 4 4 re\n')
})

test('entry point bundles for browsers without any runtime dependencies', async () => {
  const build = await Bun.build({ entrypoints: [new URL('../src/index.ts', import.meta.url).pathname], target: 'browser' })
  expect(build.success).toBe(true)
  expect(build.outputs).toHaveLength(1)
  const source = await build.outputs[0]!.text()
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  expect(bundled.render_pdf(leaf)).toEqual(render_pdf(leaf))
})

test('placement transforms accumulate in order without growing the PDF stack', () => {
  let node = make_fragment({ size: leaf.size,
    children: [place_fragment(leaf, [4, 5], [2, 0, 0, 3, 6, 7])] })
  for (let i = 0; i < 100; i++) node = make_fragment({ size: leaf.size, children: [place_fragment(node, [1, 2])] })
  const pdf = decode(render_pdf(node))
  expect(pdf).toContain('2 0 0 3 110 212 cm')
  expect(pdf.match(/^q$/gm)?.length).toBe(2)
  expect(pdf.match(/^Q$/gm)?.length).toBe(2)
})

test('clip scopes surround descendants and do not leak into siblings', () => {
  const clipped = make_fragment({ size: leaf.size, clip: make_clip(make_rect(1, 2, 8, 4)), children: [place_fragment(leaf, [3, 4])] })
  const root = make_fragment({ size: make_size(80, 40), children: [place_fragment(clipped, [10, 20]), place_fragment(leaf, [40, 0])] })
  const pdf = decode(render_pdf(root))
  expect(pdf).toContain('1 0 0 1 10 20 cm\n1 2 8 4 re\nW n\nq\n1 0 0 1 3 4 cm')
  expect(pdf).toContain('Q\nQ\nq\n1 0 0 1 40 0 cm')
})

test('invisible geometry, zero-width strokes and singular transforms paint nothing', () => {
  const invisible = make_fragment({ size: leaf.size, draw: [
    draw_rect(make_rect(0, 0, 0, 5), { ...paint, stroke: 'red', stroke_width: 10 }),
    draw_rect(make_rect(0, 0, 5, 5), { ...paint, fill: 'none', stroke: 'red' }),
    draw_rect(make_rect(0, 0, 5, 5), { ...paint, opacity: 0 }),
  ], children: [place_fragment(leaf, [0, 0], [0, 0, 0, 1, 0, 0]),
    place_fragment(make_fragment({ size: leaf.size, clip: make_clip(make_rect(0, 0, 0, 10)), children: [place_fragment(leaf)] }))] })
  const pdf = decode(render_pdf(invisible))
  expect(pdf).not.toMatch(/\n(?:f|S)\n/)
})

test('element opacity uses a reusable form while color alpha stays inside', () => {
  const transparent = make_fragment({ size: leaf.size, draw: [
    draw_rect(make_rect(2, 2, 16, 6), { fill: 'rgba(255,0,0,.4)', stroke: 'blue', stroke_width: 2, opacity: 0.5 }),
  ] })
  const root = make_fragment({ size: make_size(80, 40), children: [place_fragment(transparent), place_fragment(transparent, [25, 0])] })
  const pdf = decode(render_pdf(root))
  expect(pdf.match(/\/Subtype \/Form/g)?.length).toBe(1)
  expect(pdf.match(/\/F0 Do/g)?.length).toBe(2)
  expect(pdf).toContain('/ca 0.4 /CA 1')
  expect(pdf).toContain('/ca 0.5 /CA 0.5')
  check_structure(render_pdf(root))
})

test('dash defaults and nonzero winding glyph holes survive serialization', () => {
  const shape = make_fragment({ size: leaf.size, draw: [draw_path([
    { kind: 'M', x: 0, y: 0 }, { kind: 'L', x: 10, y: 0 },
  ], { ...paint, fill: 'none', stroke: 'red', stroke_width: 2, stroke_dasharray: [0, 0] })] })
  expect(decode(render_pdf(shape))).toContain('[] 0 d')
  const pass = new LayoutPass(), text = pass.layout(new Text({ text: 'AV office Ω', font_size: px(24) }))
  const before = { ...pass.stats }
  const pdf = decode(render_pdf(text))
  expect(pdf).toContain(' c\n')
  expect(pdf).toContain('\nf\n')
  expect(pdf).not.toContain('/Font')
  expect(pass.stats).toEqual(before)
})

test('invalid page dimensions, scale and unsupported paints fail clearly', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    expect(() => render_pdf(leaf, { points_per_pixel: value })).toThrow('positive and finite')
  }
  expect(() => render_pdf(make_fragment({ size: make_size(0, 10) }))).toThrow('page width')
  expect(() => render_pdf(make_fragment({ size: make_size(20000, 10) }))).toThrow('14400 points')
  expect(() => render_pdf(leaf, { background: 'var(--background)' })).toThrow('Unsupported PDF color')
})
