import type { PathCommand, PixelRect, Point, RectRadii } from '@gum-jsx/core'
import { numbers } from './writer'

const K = 4 * (Math.SQRT2 - 1) / 3
type NumberList = (values: readonly number[]) => string
const op = (values: readonly number[], operator: string, format: NumberList) => `${format(values)} ${operator}\n`

function path_commands(commands: readonly PathCommand[], format: NumberList = numbers): string {
  const parts: string[] = []
  let x = 0, y = 0, start_x = 0, start_y = 0
  for (const command of commands) {
    switch (command.kind) {
      case 'M':
        start_x = command.x; start_y = command.y
        parts.push(op([command.x, command.y], 'm', format)); break
      case 'L': parts.push(op([command.x, command.y], 'l', format)); break
      case 'Q':
        parts.push(op([x + 2 / 3 * (command.x1 - x), y + 2 / 3 * (command.y1 - y),
          command.x + 2 / 3 * (command.x1 - command.x),
          command.y + 2 / 3 * (command.y1 - command.y), command.x, command.y], 'c', format))
        break
      case 'C':
        parts.push(op([command.x1, command.y1, command.x2, command.y2, command.x, command.y], 'c', format))
        break
      case 'Z': parts.push('h\n'); x = start_x; y = start_y; continue
      default: throw new TypeError('Unknown PDF path command')
    }
    x = command.x; y = command.y
  }
  return parts.join('')
}

function rect_path(rect: PixelRect, radius?: RectRadii, format: NumberList = numbers): string {
  const { x, y, width, height } = rect
  if (!radius) return op([x, y, width, height], 're', format)
  const square = (r: Point): Point => r.x === 0 || r.y === 0 ? { x: 0, y: 0 } : r
  const corners = 'x' in radius ? { tl: radius, tr: radius, br: radius, bl: radius } : radius
  const tl = square(corners.tl), tr = square(corners.tr), br = square(corners.br), bl = square(corners.bl)
  const right = x + width, bottom = y + height
  return op([x + tl.x, y], 'm', format) + op([right - tr.x, y], 'l', format)
    + op([right - (1 - K) * tr.x, y, right, y + (1 - K) * tr.y, right, y + tr.y], 'c', format)
    + op([right, bottom - br.y], 'l', format)
    + op([right, bottom - (1 - K) * br.y, right - (1 - K) * br.x, bottom, right - br.x, bottom], 'c', format)
    + op([x + bl.x, bottom], 'l', format)
    + op([x + (1 - K) * bl.x, bottom, x, bottom - (1 - K) * bl.y, x, bottom - bl.y], 'c', format)
    + op([x, y + tl.y], 'l', format)
    + op([x, y + (1 - K) * tl.y, x + (1 - K) * tl.x, y, x + tl.x, y], 'c', format) + 'h\n'
}

function ellipse_path(center: Point, radius: Point, format: NumberList = numbers): string {
  const { x, y } = center, rx = radius.x, ry = radius.y
  return op([x + rx, y], 'm', format)
    + op([x + rx, y + K * ry, x + K * rx, y + ry, x, y + ry], 'c', format)
    + op([x - K * rx, y + ry, x - rx, y + K * ry, x - rx, y], 'c', format)
    + op([x - rx, y - K * ry, x - K * rx, y - ry, x, y - ry], 'c', format)
    + op([x + K * rx, y - ry, x + rx, y - K * ry, x + rx, y], 'c', format) + 'h\n'
}

// PDF does not paint square caps on zero-length subpaths. SVG does, so these
// caps need explicit geometry. A lone moveto has no segment and paints nothing.
function square_caps(commands: readonly PathCommand[], width: number, format: NumberList = numbers): string {
  let x = 0, y = 0, point = true, segment = false
  const parts: string[] = []
  const flush = () => {
    if (point && segment) parts.push(rect_path({ x: x - width / 2, y: y - width / 2, width, height: width }, undefined, format))
  }
  for (const command of commands) {
    if (command.kind === 'M') {
      flush(); x = command.x; y = command.y; point = true; segment = false
      continue
    }
    segment = true
    if (command.kind === 'Z') continue
    if (command.x !== x || command.y !== y) point = false
    if ((command.kind === 'Q' || command.kind === 'C') && (command.x1 !== x || command.y1 !== y)) point = false
    if (command.kind === 'C' && (command.x2 !== x || command.y2 !== y)) point = false
  }
  flush()
  return parts.join('')
}

export { path_commands, rect_path, ellipse_path, square_caps }
