# Map label glyphs

SDF glyph ranges for MapLibre, rendered from **Noto Sans Regular** (SIL Open Font
License 1.1 — see `OFL.txt`, which redistribution requires) with
`pnpm glyphs:build`.

They are committed rather than generated at build time, and served from this
origin rather than fetched from a public font server, for the same reason the
interface fonts come through `@fontsource`: reading the atlas should not tell a
third party that you did.

The directory name is the fontstack MapLibre requests and must stay identical to
`MAP_LABEL_FONT` in `app/composables/map/useBasemapStyle.ts`. Six of the 256
possible ranges are shipped; `scripts/build-glyphs.ts` says which and why.
