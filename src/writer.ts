import { DEFAULT_OUTPUT_PRECISION, output_number_formatter } from '@gum-jsx/core'
import type { OutputPrecision } from '@gum-jsx/core'

// PDF numbers cannot use exponent notation, including after significant-digit rounding.
function expand_exponent(source: string): string {
  if (!/[eE]/.test(source)) return source
  const [mantissa, exponent] = source.split('e') as [string, string]
  const sign = mantissa.startsWith('-') ? '-' : ''
  const unsigned = sign ? mantissa.slice(1) : mantissa
  const [whole, fraction = ''] = unsigned.split('.') as [string, string?]
  const digits = whole + fraction, position = whole.length + Number(exponent)
  return sign + (position <= 0 ? '0.' + '0'.repeat(-position) + digits
    : position >= digits.length ? digits + '0'.repeat(position - digits.length)
    : digits.slice(0, position) + '.' + digits.slice(position))
}

function number(value: number, precision: OutputPrecision = 'full'): string {
  return expand_exponent(output_number_formatter(precision)(value))
}

function numbers(values: readonly number[], precision: OutputPrecision = 'full'): string {
  return values.map(value => number(value, precision)).join(' ')
}

function pdf_number_formatter(precision: OutputPrecision = DEFAULT_OUTPUT_PRECISION) {
  // Validate once so even an empty PDF rejects invalid options.
  const format_number = output_number_formatter(precision)
  const format = (value: number) => expand_exponent(format_number(value))
  return { number: format, numbers: (values: readonly number[]) => values.map(format).join(' ') }
}

// Metadata is a UTF-16BE PDF text string, independent of file byte encoding.
function text_string(value: string): string {
  let hex = 'feff'
  for (let i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex}>`
}

class PdfWriter {
  private readonly objects: (string | Uint8Array | undefined)[] = []
  private readonly encoder = new TextEncoder()

  reserve(): number { this.objects.push(undefined); return this.objects.length }
  set(id: number, body: string | Uint8Array): void {
    if (id < 1 || id > this.objects.length || this.objects[id - 1] !== undefined) {
      throw new Error('Invalid or already written PDF object')
    }
    this.objects[id - 1] = body
  }
  add(body: string | Uint8Array): number { const id = this.reserve(); this.set(id, body); return id }
  stream(content: string | Uint8Array, entries = ''): number {
    const bytes = typeof content === 'string' ? this.encoder.encode(content) : content
    const prefix = this.encoder.encode(`<< ${entries} /Length ${bytes.length} >>\nstream\n`)
    const suffix = this.encoder.encode('\nendstream')
    const body = new Uint8Array(prefix.length + bytes.length + suffix.length)
    body.set(prefix); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length)
    return this.add(body)
  }
  finish(root: number, info?: number): Uint8Array {
    const chunks: Uint8Array[] = [], offsets = [0]
    let length = 0
    const append = (value: string | Uint8Array) => {
      const bytes = typeof value === 'string' ? this.encoder.encode(value) : value
      chunks.push(bytes); length += bytes.length
    }
    append('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
    this.objects.forEach((body, i) => {
      if (body === undefined) throw new Error(`Unwritten PDF object ${i + 1}`)
      offsets.push(length)
      append(`${i + 1} 0 obj\n`); append(body); append('\nendobj\n')
    })
    const xref = length
    append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
    for (const offset of offsets.slice(1)) {
      if (offset > 9_999_999_999) throw new RangeError('PDF exceeds classic cross-reference size')
      append(`${String(offset).padStart(10, '0')} 00000 n \n`)
    }
    append(`trailer\n<< /Size ${offsets.length} /Root ${root} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\n`)
    append(`startxref\n${xref}\n%%EOF\n`)
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
    return result
  }
}

export { PdfWriter, number, numbers, pdf_number_formatter, text_string }
