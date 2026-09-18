import { expect, test } from 'bun:test'
import {
  draw_rect, draw_path, make_fragment, make_size, make_rect, make_clip, place_fragment,
  LayoutPass, Text, PngImage, px, draw_image, draw_text,
} from '@gum-jsx/core'
import { encode } from 'fast-png'
import { unzlibSync } from 'fflate'
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

test('entry point bundles for browsers without native or external runtime dependencies', async () => {
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

const png_url = (image: Parameters<typeof encode>[0], interlace: 'null' | 'Adam7' = 'null') =>
  `data:image/png;base64,${Buffer.from(encode(image, { interlace })).toString('base64')}`

function image_streams(bytes: Uint8Array) {
  const source = Buffer.from(bytes).toString('latin1')
  return [...source.matchAll(/<< ([^\n]*\/Subtype \/Image[^\n]*) \/Length (\d+) >>\nstream\n/g)].map(match => {
    const start = match.index! + match[0].length
    return { entries: match[1]!, pixels: [...unzlibSync(bytes.subarray(start, start + Number(match[2])))] }
  })
}

test('PNG embeds original RGB samples and a reusable alpha mask with opacity and correct orientation', () => {
  const data = png_url({ width: 2, height: 2, channels: 4,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255]) })
  const node = new LayoutPass().layout(new PngImage({ data, width: px(20), height: px(10), opacity: 0.5 }))
  const root = make_fragment({ size: make_size(50, 20), children: [place_fragment(node), place_fragment(node, [25, 0])] })
  const bytes = render_pdf(root), pdf = decode(bytes), streams = image_streams(bytes)
  expect(streams).toHaveLength(2)
  expect(streams[0]!.pixels).toEqual([255, 128, 0, 255])
  expect(streams[1]!.pixels).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
  expect(streams[1]!.entries).toContain('/Width 2 /Height 2 /BitsPerComponent 8')
  expect(streams[1]!.entries).toContain('/SMask')
  expect(pdf).toContain('10 0 0 -10 5 10 cm')
  expect(pdf).toContain('/ca 0.5 /CA 0.5')
  expect(pdf.match(/\/I0 Do/g)).toHaveLength(2)
  check_structure(bytes)
})

test('PNG palette, packed grayscale, tRNS, 16-bit and Adam7 samples survive PDF export', () => {
  const fixtures: { image: Parameters<typeof encode>[0]; color: number[]; mask?: number[]; interlace?: 'Adam7'; encoded?: string }[] = [
    { image: { width: 2, height: 1, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0]) },
      color: [255, 0, 0, 0, 255, 0], interlace: 'Adam7' },
    { image: { width: 3, height: 2, channels: 1, depth: 1, data: new Uint8Array([0xa0, 0x40]),
      palette: [[255, 0, 0, 0], [0, 0, 255, 255]] },
      color: [0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 0, 0], mask: [255, 0, 255, 0, 255, 0] },
    { image: { width: 3, height: 2, channels: 1, depth: 1, data: new Uint8Array([0xa0, 0x40]),
      transparency: new Uint16Array([0]) }, color: [255, 0, 255, 0, 255, 0], mask: [255, 0, 255, 0, 255, 0],
      // fast-png's encoder does not write non-palette tRNS chunks.
      encoded: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAQAAAAC1D1u3AAAAAnRSTlMAAHaTzTgAAAAMSURBVHicY1jA4AAAAiQA4XPrO/IAAAAASUVORK5CYII=' },
    { image: { width: 2, height: 1, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0]),
      transparency: new Uint16Array([255, 0, 0]) }, color: [255, 0, 0, 0, 255, 0], mask: [0, 255],
      encoded: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAABnRSTlMA/wAAAACkwsAdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC' },
    { image: { width: 2, height: 1, channels: 2, depth: 16, data: new Uint16Array([0x1234, 0xffff, 0xabcd, 0x8000]) },
      color: [0x12, 0x34, 0xab, 0xcd], mask: [255, 255, 128, 0] },
  ]
  for (const { image, color, mask, interlace, encoded } of fixtures) {
    const data = encoded ? `data:image/png;base64,${encoded}` : png_url(image, interlace)
    const node = new LayoutPass().layout(new PngImage({ data }))
    const bytes = render_pdf(node), streams = image_streams(bytes)
    expect(streams).toHaveLength(mask ? 2 : 1)
    expect(streams.at(-1)!.pixels).toEqual(color)
    if (mask) expect(streams[0]!.pixels).toEqual(mask)
    check_structure(bytes)
  }
})

test('browser bundle exports embedded PNGs synchronously', async () => {
  const build = await Bun.build({ entrypoints: [new URL('../src/index.ts', import.meta.url).pathname], target: 'browser' })
  expect(build.success).toBe(true)
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(await build.outputs[0]!.text()).toString('base64')}`)
  const data = png_url({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 128]) })
  const node = new LayoutPass().layout(new PngImage({ data }))
  expect(bundled.render_pdf(node)).toEqual(render_pdf(node))
})

test('malformed PNG content fails at PDF export; invisible images need no decoding', () => {
  const data = png_url({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) })
  const bytes = Buffer.from(data.slice(22), 'base64')
  bytes[29] = bytes[29]! ^ 1 // Corrupt the IHDR checksum without changing the dimensions.
  const node = new LayoutPass().layout(new PngImage({ data: `data:image/png;base64,${bytes.toString('base64')}` }))
  expect(() => render_pdf(node)).toThrow()
  const invisible = make_fragment({ size: make_size(10, 10), draw: [
    draw_image(make_rect(0, 0, 5, 5), 'data:image/png;base64,invalid', 0),
    draw_image(make_rect(0, 0, 0, 5), 'data:image/png;base64,invalid'),
  ] })
  expect(image_streams(render_pdf(invisible))).toHaveLength(0)
})

test('live color font text names its family instead of vanishing from the page', () => {
  const font = { family: 'Noto Color Emoji', size: 16 }, bounds = make_rect(0, 0, 20, 19)
  const emoji = (opacity: number) => make_fragment({ size: make_size(20, 20), draw: [
    draw_text('\u{1f600}', { x: 0, y: 15 }, 20, font, { fill: 'black', opacity }, bounds),
  ] })
  expect(() => render_pdf(emoji(1))).toThrow('cannot draw live text in Noto Color Emoji')
  check_structure(render_pdf(emoji(0)))
})
