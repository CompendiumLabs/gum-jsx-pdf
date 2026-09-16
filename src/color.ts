type Color = readonly [red: number, green: number, blue: number, alpha: number]

// CSS named sRGB colors: https://www.w3.org/TR/css-color-4/#named-colors
const named: Readonly<Record<string, string>> = Object.fromEntries(`
aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff
beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff
blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00
chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c
cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9
darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f
darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f
darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3
deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff
firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc
ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000
greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c
indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5
lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff
lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1
lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899
lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6
magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3
mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc
mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5
navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23
orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98
paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f
pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399
red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072
sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0
skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa
springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8
tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff
whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32
`.trim().split(/\s+/).map(entry => entry.split(':')))

const numeric = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?$/i
const clamp = (value: number) => Math.min(1, Math.max(0, value))

function parse_color(source: string): Color | null {
  const color = source.trim().toLowerCase()
  const fail = (): never => { throw new TypeError(`Unsupported PDF color: ${source}`) }
  if (color === 'none') return null
  if (color === 'transparent') return [0, 0, 0, 0]
  const hex = color.startsWith('#') ? color.slice(1)
    : Object.hasOwn(named, color) ? named[color] : undefined
  if (hex !== undefined) {
    if (!/^(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(hex)) return fail()
    const expanded = hex.length <= 4 ? [...hex].map(char => char + char).join('') : hex
    return [parseInt(expanded.slice(0, 2), 16) / 255, parseInt(expanded.slice(2, 4), 16) / 255,
      parseInt(expanded.slice(4, 6), 16) / 255, expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1]
  }
  const match = /^(rgba?|hsla?)\((.*)\)$/.exec(color)
  if (!match) return fail()
  const name = match[1]!, body = match[2]!
  const legacy = body.includes(',')
  let components: string[], alpha: string | undefined
  if (legacy) {
    components = body.split(',').map(part => part.trim())
    if (components.length === 4) alpha = components.pop()
  } else {
    const parts = body.split('/')
    if (parts.length > 2) return fail()
    components = parts[0]!.trim().split(/\s+/)
    alpha = parts[1]?.trim()
  }
  if (components.length !== 3) return fail()
  function value(token: string): number {
    if (!numeric.test(token) || !Number.isFinite(Number(token))) return fail()
    return Number(token)
  }
  function channel(token: string, scale: number): number {
    return clamp(token.endsWith('%') ? value(token.slice(0, -1)) / 100 : value(token) / scale)
  }
  const a = alpha === undefined ? 1 : channel(alpha, 1)
  if (name.startsWith('rgb')) {
    if (legacy && components.some(token => token.endsWith('%')) && !components.every(token => token.endsWith('%'))) return fail()
    return [channel(components[0]!, 255), channel(components[1]!, 255), channel(components[2]!, 255), a]
  }
  const [hue, saturation, lightness] = components as [string, string, string]
  if (!saturation.endsWith('%') || !lightness.endsWith('%')) return fail()
  const unit = /(deg|grad|rad|turn)$/.exec(hue)?.[0]
  const degrees = value(unit ? hue.slice(0, -unit.length) : hue)
    * (unit === 'turn' ? 360 : unit === 'rad' ? 180 / Math.PI : unit === 'grad' ? 0.9 : 1)
  if (!Number.isFinite(degrees)) return fail()
  const h = ((degrees % 360) + 360) % 360 / 30
  const s = channel(saturation, 1), l = channel(lightness, 1), amplitude = s * Math.min(l, 1 - l)
  const component = (n: number) => {
    const k = (n + h) % 12
    return l - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [component(0), component(8), component(4), a]
}

export { parse_color }
export type { Color }
