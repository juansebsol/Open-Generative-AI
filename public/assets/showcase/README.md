# Showcase outputs

The studio empty states show a wall of sample outputs listed in `manifest.json`.
Each item has `src`, `prompt` (shown on hover, loaded on click), `ratio`
(`3:4`, `1:1`, `4:5`, `4:3` or `16:9`) and `kind` (`image` or `video`).

The bundled `sample-*.jpg` files are stock placeholders, not model outputs.
Replace them with real results from the catalog's models and update the
prompts to the ones that produced them. Video studios use items of kind
`video` (a poster frame works); when none exist they fall back to the images.
