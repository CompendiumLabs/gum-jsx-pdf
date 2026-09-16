import { expect, test } from 'bun:test'
import { parse_color } from '../src/color'

test('CSS names, hex, RGB and HSL resolve to numeric sRGB and alpha', () => {
  const cases: [string, readonly number[] | null][] = [
    ['none', null], ['transparent', [0, 0, 0, 0]], [' ReBeccAPurPle ', [0.4, 0.2, 0.6, 1]],
    ['#369', [0.2, 0.4, 0.6, 1]], ['#369c', [0.2, 0.4, 0.6, 0.8]],
    ['#336699cc', [0.2, 0.4, 0.6, 0.8]], ['rgb(51, 102, 153)', [0.2, 0.4, 0.6, 1]],
    ['rgba(20%, 40%, 60%, 80%)', [0.2, 0.4, 0.6, 0.8]],
    ['rgb(51 40% 153 / .8)', [0.2, 0.4, 0.6, 0.8]],
    ['rgb(300 -2 0 / 150%)', [1, 0, 0, 1]],
    ['hsl(120, 100%, 50%)', [0, 1, 0, 1]], ['hsla(-120, 100%, 50%, .5)', [0, 0, 1, 0.5]],
    ['hsl(.5turn 100% 50% / 25%)', [0, 1, 1, 0.25]],
    ['hsl(200grad 100% 50%)', [0, 1, 1, 1]],
    [`hsl(${Math.PI}rad 100% 50%)`, [0, 1, 1, 1]],
  ]
  for (const [source, expected] of cases) {
    const actual = parse_color(source)
    if (expected === null) expect(actual).toBeNull()
    else expected.forEach((value, index) => expect(actual![index]).toBeCloseTo(value, 12))
  }
})

test('unsupported colors fail instead of silently changing paint', () => {
  for (const source of ['bogus', 'currentColor', 'var(--ink)', 'url(#gradient)', 'color(display-p3 1 0 0)',
    '#12', '#gggggg', 'rgb(1, 2)', 'rgb(1, 2, 3, 4, 5)', 'rgb(1 2 3 /)',
    'rgb(1 2 3 / 1 / 1)', 'rgb(1, 2%, 3)', 'rgb(1, 2, 3 / .5)',
    'rgb(Infinity 0 0)', 'rgb(1e999 0 0)', 'rgb(0x10 0 0)', 'hsl(0 1 1)', 'constructor']) {
    expect(() => parse_color(source)).toThrow('Unsupported PDF color')
  }
})
