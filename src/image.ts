import { decode, convertIndexedToRgb } from 'fast-png'
import { zlibSync } from 'fflate'
import type { PdfWriter } from './writer'

// PNG alpha is a separate grayscale soft mask in PDF. Keep original dimensions
// and sample precision, and compress both streams without resampling pixels.
function embed_png(writer: PdfWriter, source: string): number {
  if (!source.startsWith('data:image/png;base64,')) throw new TypeError('PDF images require a base64 PNG data URL')
  const bytes = Uint8Array.from(atob(source.slice(22)), char => char.charCodeAt(0))
  const png = decode(bytes, { checkCrc: true })
  const { width, height, transparency } = png
  const indexed = png.palette !== undefined
  const samples = indexed ? convertIndexedToRgb(png) : png.data
  const channels = indexed ? png.palette![0]!.length : png.channels
  const depth = indexed ? 8 : png.depth
  const bits = depth === 16 ? 16 : 8, stride = bits / 8
  const colors = channels <= 2 ? 1 : 3
  const has_alpha = channels === 2 || channels === 4
  const pixels = width * height
  const color = new Uint8Array(pixels * colors * stride)
  const mask = new Uint8Array(pixels * stride)
  const max = 2 ** depth - 1
  let transparent = false
  const row_bytes = Math.ceil(width * depth / 8)
  function sample(pixel: number, channel: number): number {
    if (depth >= 8) return samples[pixel * channels + channel]!
    const x = pixel % width, y = Math.floor(pixel / width), bit = x * depth
    return (samples[y * row_bytes + (bit >> 3)]! >> (8 - depth - bit % 8)) & max
  }
  function write(target: Uint8Array, index: number, value: number): void {
    if (bits === 16) { target[index * 2] = value >> 8; target[index * 2 + 1] = value & 255 }
    else target[index] = Math.round(value * 255 / max)
  }
  for (let pixel = 0; pixel < pixels; pixel++) {
    let keyed = transparency !== undefined && transparency.length === colors
    for (let channel = 0; channel < colors; channel++) {
      const value = sample(pixel, channel)
      write(color, pixel * colors + channel, value)
      keyed = keyed && value === transparency![channel]
    }
    const alpha = keyed ? 0 : has_alpha ? sample(pixel, colors) : max
    write(mask, pixel, alpha)
    transparent ||= alpha !== max
  }
  const entries = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height}`
    + ` /BitsPerComponent ${bits} /Filter /FlateDecode`
  const mask_id = transparent ? writer.stream(zlibSync(mask), `${entries} /ColorSpace /DeviceGray`) : undefined
  return writer.stream(zlibSync(color), `${entries} /ColorSpace /${colors === 1 ? 'DeviceGray' : 'DeviceRGB'}`
    + (mask_id === undefined ? '' : ` /SMask ${mask_id} 0 R`))
}

export { embed_png }
