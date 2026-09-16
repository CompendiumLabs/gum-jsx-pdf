// PDF numbers cannot use exponent notation. Retain JavaScript's precision while
// expanding very small/large values, including coordinates from transformed text.
function number(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('PDF numbers must be finite')
  const source = String(value)
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

function numbers(values: readonly number[]): string { return values.map(number).join(' ') }

// Metadata is a UTF-16BE PDF text string, independent of file byte encoding.
function text_string(value: string): string {
  let hex = 'feff'
  for (let i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex}>`
}

class PdfWriter {
  private readonly objects: (string | undefined)[] = []
  private readonly encoder = new TextEncoder()

  reserve(): number { this.objects.push(undefined); return this.objects.length }
  set(id: number, body: string): void {
    if (id < 1 || id > this.objects.length || this.objects[id - 1] !== undefined) {
      throw new Error('Invalid or already written PDF object')
    }
    this.objects[id - 1] = body
  }
  add(body: string): number { const id = this.reserve(); this.set(id, body); return id }
  stream(content: string, entries = ''): number {
    return this.add(`<< ${entries} /Length ${this.encoder.encode(content).length} >>\nstream\n${content}\nendstream`)
  }
  finish(root: number, info?: number): Uint8Array {
    const chunks: Uint8Array[] = [], offsets = [0]
    let length = 0
    const append = (value: string) => {
      const bytes = this.encoder.encode(value)
      chunks.push(bytes); length += bytes.length
    }
    append('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
    this.objects.forEach((body, i) => {
      if (body === undefined) throw new Error(`Unwritten PDF object ${i + 1}`)
      offsets.push(length)
      append(`${i + 1} 0 obj\n${body}\nendobj\n`)
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

export { PdfWriter, number, numbers, text_string }
