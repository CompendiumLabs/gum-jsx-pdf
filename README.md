# @gum-jsx/pdf

PDF export for completed Gum fragments, preserving vector drawings and embedded PNG images. Layout, text
shaping, and glyph outlines are supplied by `@gum-jsx/core` (and optionally
`@gum-jsx/math`); the exporter does not load fonts or perform layout.

```ts
import { LayoutPass, Text, px } from '@gum-jsx/core'
import { render_pdf } from '@gum-jsx/pdf'

const fragment = new LayoutPass().layout(
  new Text({ text: 'Hello, PDF!', font_size: px(32) }),
)
const bytes = render_pdf(fragment, { title: 'Hello', background: 'white' })
await Bun.write('hello.pdf', bytes)
```

`render_pdf(fragment, options?): Uint8Array` is synchronous and works in Bun or
the browser. Only type imports refer to core; PNG decoding and compression use
`fast-png` and `fflate`, with no native bindings or filesystem access. In a browser,
the returned bytes can be used in a `Blob` with type `application/pdf`.

The workspace applies `patches/fast-png@8.0.0.patch` during `bun install` to fix
the decoder's transparency-key validation for tiny RGB images: a `tRNS` key has
one value per color channel, independent of the image's pixel count.

| Option | Default | Meaning |
| --- | --- | --- |
| `title` | omitted | Unicode PDF document title. |
| `background` | omitted | Page background color; otherwise unpainted. |
| `points_per_pixel` | `0.75` | Physical scale: 96 layout pixels per inch, 72 PDF points per inch. Use `1` to treat each layout pixel as one point. |

The single page matches `fragment.size`, clipping any overflow to that viewport.
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

Text remains vector outlines: appearance is preserved, but text is not searchable
or selectable. Fragment labels and debug overlays are not exported. This first
version writes deterministic PDF 1.4 files with uncompressed vector content and
compressed image streams; it does not paginate or produce tagged/accessibility
or archival PDF variants.

Development, from the workspace root:

```sh
bun install
bun --filter @gum-jsx/pdf test
bun --filter @gum-jsx/pdf typecheck
bun --filter @gum-jsx/pdf test:visual
```

The regular tests require only workspace development dependencies. The optional
visual checks additionally require `qpdf`, `pdfinfo`, and `pdftoppm` on `PATH`.
They validate actual PDFs and compare their rasterized pixels with SVG output,
leaving PDF, SVG, PNG, and PPM artifacts in `out/visual/`. Small edge differences
are expected between rasterizers. The PNG package and math package are used only
for development checks.
