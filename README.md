# @gum-jsx/pdf

[Gum](https://github.com/CompendiumLabs/gum-jsx) — installation, quickstart, and user documentation.

PDF export for completed Gum fragments, with native text, vector drawings, and
embedded PNG images. Layout and text shaping come from `@gum-jsx/core` (and
optionally `@gum-jsx/math`). Live text embeds subsets of the fonts used for layout.

## Usage

```ts
import { Fonts, Text, px, layout_element } from '@gum-jsx/core'
import { render_pdf } from '@gum-jsx/pdf'

const fonts = new Fonts()
const { fragment } = layout_element(
  new Text({ children: 'Hello, PDF!', font_size: px(32) }),
  { fonts, text_mode: 'live' },
)
const bytes = render_pdf(fragment, { fonts, title: 'Hello', background: 'white' })
await Bun.write('hello.pdf', bytes)
```

`render_pdf(fragmentOrPages, options?): Uint8Array` is synchronous and works in Bun or
the browser. Numeric serialization uses core's shared formatter; PNG decoding and compression use
`fast-png` and `fflate`, with no native bindings or filesystem access. In a browser,
the returned bytes can be used in a `Blob` with type `application/pdf`. Await
`fonts.load()` before browser layout and pass the same provider to `render_pdf`.

Known limitation: `fast-png` 8.0.0 rejects RGB PNGs with only one or two pixels
and a `tRNS` transparency key. PDF export throws for these images; convert them
to RGBA before embedding. Ordinary RGBA PNGs, including transparent 1×1 images,
are unaffected. The package uses the unmodified decoder.

| Option | Default | Meaning |
| --- | --- | --- |
| `title` | omitted | Unicode PDF document title. |
| `background` | omitted | Page background color; otherwise unpainted. |
| `points_per_pixel` | `0.75` | Physical scale: 96 layout pixels per inch, 72 PDF points per inch. Use `1` to treat each layout pixel as one point. |
| `precision` | `10` | Decimal places in numeric output; use 0–100 or `'full'` for unrounded values. |
| `fonts` | omitted | Font provider used for layout; required for live text. |

Pass a fragment for one page, or a nonempty array of fragments for a multipage
document. Pages follow array order, and each page matches its own `fragment.size`,
clipping any overflow to that viewport. Options apply to the whole document;
images, font subsets, and drawing resources are reused across pages. Use one font
provider for all pages so each face has a consistent glyph vocabulary.

```ts
const pages = ['First slide', 'Second slide'].map(children =>
  layout_element(new Text({ children, font_size: px(32) }), { fonts, text_mode: 'live' }).fragment,
)
await Bun.write('slides.pdf', render_pdf(pages, { fonts, title: 'Slides' }))
```

Both page dimensions and the scale must be positive and finite. PDF 1.4 page
dimensions are limited to 14,400 points per side; larger dimensions are rejected.

Supported drawing features:

- PNG images, including grayscale, RGB, indexed color, interlacing, and alpha.
  Image samples are compressed losslessly at their original dimensions; 16-bit
  samples retain their precision. Transparency uses a grayscale soft mask, and
  repeated images share one embedded resource. PNG color profiles and gamma
  metadata are not applied; samples use PDF DeviceRGB or DeviceGray.
- Rectangles, ellipses, individually rounded corners, and paths (`M`, `L`, `Q`,
  `C`, `Z`). Quadratics convert exactly to cubics; elliptical arcs use the usual
  cubic approximation.
- Affine placement transforms, including rotation, reflection, skew, and
  nonuniform scaling. Consecutive placements are combined without flattening
  stroke geometry or pushing a graphics state for every layout wrapper.
- Nested rectangular and rounded clipping, nonzero winding fills, strokes,
  line caps, joins, miter limits, and dash patterns.
- Color alpha and drawing opacity. When necessary, isolated transparency groups
  apply opacity to the combined fill and stroke, matching SVG compositing.
- All CSS named colors, `transparent`, `none`, 3/4/6/8-digit hex, and numeric
  `rgb()`/`rgba()`/`hsl()`/`hsla()` colors with comma or space/slash syntax.
  Percentages and hue units (`deg`, `rad`, `grad`, `turn`) are supported.

Unsupported color expressions (including `var()`, `currentColor`, paint URLs,
wide-gamut colors, and CSS calculations) throw a descriptive error. Resolve them
to one of the supported color formats before export.

Live text is selectable and searchable. The exporter retains shaped glyph positions,
embeds one TrueType or CFF subset per used face across the document, and writes
Unicode mappings for copying. Font size and synthesized oblique do not create extra
subsets. Math glyphs use the same mechanism; decorations stay vector paths, and
copying a formula does not reconstruct its TeX source.

Fragments laid out with `text_mode: 'path'` retain outlined, unselectable text and
need no font provider. Custom providers can support native text with positioned
`GlyphShape.glyphs` and `MeasuredFont.subset`. Unsupported color fonts such as emoji
leave blank space at their measured positions.

Debug overlays are exported as ordinary vector paths through the shared
`prepare_render` step. Fragment labels are not exported. The exporter writes
deterministic PDF 1.4 files with uncompressed page content and compressed font,
Unicode-map, and image streams. It does not automatically split content across
pages or produce tagged/accessibility or archival PDF variants.

## Development

From the workspace root:

```sh
bun --filter @gum-jsx/pdf test
bun --filter @gum-jsx/pdf typecheck
```

The tests require only workspace development dependencies.
