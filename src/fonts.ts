import type { FontProvider, MeasuredFont, TextDraw } from '@gum-jsx/core'
import { zlibSync } from 'fflate'
import { PdfWriter, text_string } from './writer'

type UsedFont = {
  name: string; id: number; font: MeasuredFont
  glyphs: Map<number, { cid: number; text: string; advance: number }>
}
const hex = (value: number) => value.toString(16).padStart(4, '0')
const unicode = (text: string) => text_string(text).slice(5, -1) // UTF-16BE without BOM.

// One subset per resolved face, shared by every size, placement, and page.
// Glyphs are collected while writing content; reserved font objects are filled last.
class PdfFonts {
  private used = new Map<string, UsedFont>()
  private writer: PdfWriter
  private fonts: FontProvider | undefined
  private number: (value: number) => string

  constructor(writer: PdfWriter, fonts: FontProvider | undefined,
    number: (value: number) => string) {
    this.writer = writer
    this.fonts = fonts
    this.number = number
  }

  resources(): string {
    return this.used.size ? `/Font << ${[...this.used.values()]
      .map(font => `/${font.name} ${font.id} 0 R`).join(' ')} >>` : ''
  }

  text(draw: TextDraw): string {
    if (!this.fonts) throw new TypeError('PDF live text requires the fonts used for layout; pass { fonts } to render_pdf')
    const key = JSON.stringify([draw.font_family, draw.font_weight ?? 400, draw.font_style ?? 'normal'])
    let used = this.used.get(key)
    if (!used) {
      const font = this.fonts.resolve(draw.font_family, draw.font_weight ?? 400, draw.font_style ?? 'normal')
      if (!font.subset) throw new TypeError(`PDF font ${draw.font_family} does not support embedding; use text_mode: 'path'`)
      used = { name: `T${this.used.size}`, id: this.writer.reserve(), font, glyphs: new Map() }
      this.used.set(key, used)
    }
    const skew = draw.font_oblique ? Math.tan(Math.PI / 15) : 0
    // Core and math supply final glyph positions. Direct draw_text callers can
    // use the provider's shaping API, with the same em coordinates and slant.
    const glyphs = draw.glyphs ?? used.font.shape(draw.text).glyphs?.map(glyph => ({
      ...glyph, x: glyph.x - skew * glyph.y,
    }))
    if (!glyphs) throw new TypeError(`PDF font ${draw.font_family} does not supply positioned glyphs`)
    let mapped = ''
    const codes = glyphs.map(glyph => {
      let entry = used.glyphs.get(glyph.id)
      if (!entry) {
        if (glyph.id === 0 || used.glyphs.size >= 65535) throw new RangeError('PDF text requires a nonzero glyph ID and at most 65535 used glyphs per font')
        entry = { cid: used.glyphs.size + 1, text: glyph.text, advance: glyph.advance }
        used.glyphs.set(glyph.id, entry)
      }
      mapped += entry.text
      return hex(entry.cid)
    })
    if (!glyphs.length) return ''
    const { number } = this, size = draw.font_size
    const origin = draw.origin.x + (draw.text_anchor === 'start' ? 0
      : (draw.advance - used.font.shape(draw.text).advance * size) / 2)
    const commands = [`BT\n/${used.name} ${number(size)} Tf\n`]
    for (let start = 0; start < glyphs.length;) {
      const first = glyphs[start]
      commands.push(`1 0 ${number(skew)} -1 ${number(origin + first.x * size)} ${number(draw.origin.y + first.y * size)} Tm\n`)
      let encoded = codes[start], end = start + 1
      const parts: string[] = []
      while (end < glyphs.length && glyphs[end].y === first.y) {
        const previous = glyphs[end - 1], next = glyphs[end]
        const adjustment = number((previous.x + previous.advance - next.x) * 1000)
        if (adjustment !== '0') { parts.push(`<${encoded}>`, adjustment); encoded = '' }
        encoded += codes[end++]
      }
      parts.push(`<${encoded}>`)
      commands.push(`[${parts.join(' ')}] TJ\n`)
      start = end
    }
    commands.push('ET\n')
    const content = commands.join('')
    // A glyph can represent different source strings, or shaping can reorder
    // glyphs. Keep their logical text when a font-wide Unicode map is insufficient.
    return mapped === draw.text ? content
      : `/Span << /ActualText ${text_string(draw.text)} >> BDC\n${content}EMC\n`
  }

  finish(): void {
    const { writer, number } = this
    const numbers = (values: readonly number[]) => values.map(number).join(' ')
    for (const used of this.used.values()) {
      const subset = used.font.subset!([0, ...used.glyphs.keys()])
      const tag = used.id.toString(26).padStart(6, '0').split('')
        .map(digit => String.fromCharCode(65 + parseInt(digit, 26))).join('')
      const name = `${tag}+${subset.name}`.replace(/[^A-Za-z0-9_.+-]/g, '_')
      const cff = subset.format === 'cff'
      const program = writer.stream(zlibSync(subset.data), `/Filter /FlateDecode`
        + (cff ? ' /Subtype /CIDFontType0C' : ` /Length1 ${subset.data.length}`))
      const { x, y, width, height } = subset.bounds
      const flags = 4 | (subset.fixed_pitch ? 1 : 0) | (subset.italic_angle ? 64 : 0)
      const descriptor = writer.add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${flags}`
        + ` /FontBBox [${numbers([x, -y - height, x + width, -y].map(value => value * 1000))}]`
        + ` /Ascent ${number(subset.ascent * 1000)} /Descent ${number(-subset.descent * 1000)}`
        + ` /CapHeight ${number(subset.cap_height * 1000)} /ItalicAngle ${number(subset.italic_angle)} /StemV 80`
        + ` /${cff ? 'FontFile3' : 'FontFile2'} ${program} 0 R >>`)
      const glyphs = [...used.glyphs.values()]
      const descendant = writer.add(`<< /Type /Font /Subtype /${cff ? 'CIDFontType0' : 'CIDFontType2'} /BaseFont /${name}`
        + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>'
        + ` /FontDescriptor ${descriptor} 0 R /W [1 [${numbers(glyphs.map(glyph => glyph.advance * 1000))}]]`
        + (cff ? '' : ' /CIDToGIDMap /Identity') + ' >>')
      const mappings = glyphs.filter(glyph => glyph.text).map(glyph => `<${hex(glyph.cid)}> <${unicode(glyph.text)}>`)
      const blocks: string[] = []
      for (let start = 0; start < mappings.length; start += 100) {
        const entries = mappings.slice(start, start + 100)
        blocks.push(`${entries.length} beginbfchar\n${entries.join('\n')}\nendbfchar`)
      }
      const cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
        + '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
        + `/CMapName /${used.name}-Unicode def\n/CMapType 2 def\n`
        + '1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n'
        + blocks.join('\n') + '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
      const mapping = writer.stream(zlibSync(new TextEncoder().encode(cmap)), '/Filter /FlateDecode')
      writer.set(used.id, `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H`
        + ` /DescendantFonts [${descendant} 0 R] /ToUnicode ${mapping} 0 R >>`)
    }
  }
}

export { PdfFonts }
