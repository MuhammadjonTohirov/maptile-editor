# Self-hosted map fonts

MapLibre needs a glyphs (font) source to render every text label — place names,
road names, and editor point/line labels. This directory holds the font files
Martin turns into glyph ranges and serves at `/fonts/{fontstack}/{range}`
(proxied same-origin through Nginx, exactly like the base and editor tiles).

## Contents

- `NotoSans-Regular.ttf` — served as the fontstack **`Noto Sans Regular`**. Noto
  Sans covers Latin **and** Cyrillic, so it renders Uzbekistan's mixed
  Latin/Cyrillic OSM place names from a single file. `frontend/styles/editor.json`
  references it in every `text-font`.
- `LICENSE.txt` — SIL Open Font License 1.1, which permits redistribution.

## Provenance

Static hinted instance from the Noto project
(`google/fonts` · `ofl/notosans`). Redistributable under the OFL; keep
`LICENSE.txt` alongside the font.

## Adding a weight

Drop another static `.ttf` here (e.g. `NotoSans-Bold.ttf`), restart Martin, and
confirm the new fontstack name in Martin's `/catalog` before referencing it in a
`text-font`. Martin names each fontstack from the font's internal name table.
