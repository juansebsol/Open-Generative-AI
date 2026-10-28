# Project knowledge

Context for contributors and coding agents. User-facing docs are in [README.md](README.md).

## Shape of the app

- Next.js 15 App Router app at the repo root. One page (`app/studio/[[...slug]]`, plus `app/zh/...` for Chinese) renders `components/StandaloneShell.js`, which hosts every studio.
- Studios live in the `packages/studio` workspace (`studio` package, plain JS/JSX, Tailwind classes). They import generation functions from `packages/studio/src/generation.js`.
- No database and no server-side state. Visitor settings, provider keys and history live in the browser (`localStorage`).

## Provider layer (`packages/studio/src/providers/`)

- `directProviders.js`: registry of providers (id, label, kind cloud/local, key URL).
- `keys.js`: per-visitor settings in `localStorage` key `oga_providers_v1` (`keys`, `urls`, `options`, `order`).
- `catalog/routes/*.json`: catalog endpoint slug → ordered provider routes. Edited by hand, one file per model family group. `catalog/routes.generated.js` and `catalog/schemas.generated.js` are build artifacts of `scripts/build-catalog-index.mjs` (committed so the app builds without running scripts).
- `mapper.js`: pure function `mapInput(payload, route, schema)`; shared by the server and `scripts/validate-routes.mjs`.
- `client.js` (browser): `runEndpoint(endpoint, payload)` picks a route, calls `/api/generate`, polls `/api/jobs`; `uploadMedia(file)` gets a signed URL from `/api/uploads` and PUTs the file to provider storage.
- `server/` (Node only, imported by `app/api/*` as `studio/providers/server`): adapters for fal (queue), WaveSpeed (v3), Google Gemini, OpenAI Images, OpenRouter (chat completions with image output).
- `local/`: ComfyUI and sd-server connectors that run in the browser against the visitor's own machine.
- `mediaStore.js` + `public/oga-media-sw.js`: every output and upload is copied into IndexedDB (`oga-media`) and referenced as `/oga-media/<id>.<ext>`. `runEndpoint` resolves those back to a provider URL (stored link if < 6 days old, else a fresh upload) before calling `/api/generate`. Unreferenced files are deleted a day after creation (`removeUnusedMedia`, run by the shell).

- Vector pages (`components/VectorStudio.jsx`, one component for the `vector-logo`, `vector-icons` and `vector-vectorize` tabs, like the 3D pages): the catalog is `vectorModels.js` (routed by `catalog/routes/vector.json`), results live in `vectorLibrary.js`, and `vector/` holds the pure helpers (SVG sanitiser, sprite builder, icon-set planner, optimiser, zip/ico/pdf writers, output classifier) plus the browser export kit.
- Benchmarks helper (`components/BenchmarksHelper.jsx`, mounted once by the shell; a numbered leaderboard card fixed top right under the header, where no studio's prompt bar or the toast stack sits): shows the Benchmarks picks for the page that is open. `benchmarksHelper.js` is the pure part: the tab-id-to-category table (`helperCategoryFor`; 3D pages keep only rows whose `studio` is that page, Icon Set reuses the vector category with `studio` rewritten to itself), `helperRows` (picks merged per model plus the next `MORE_COUNT` scored models), the per-visitor open state in localStorage key `oga_benchmarks_helper_v1` (open by default), and the studio-mode channel: a studio with several modes calls `announceStudioMode(tabId, mode)` (Image `text`/`edit`, Video `t2v`/`i2v`/`v2v`, Audio `speech`/`music`), which stores the last mode per tab and dispatches `oga:studio-mode`. "Use" dispatches the same `oga:open-studio` `{ tabId, modelId }` event the Benchmarks page uses, with the current tab; "See all" dispatches `{ tabId: 'benchmarks', categoryId }` (and links to `?category=`), which the Benchmarks page reads. Quotes come from `components/benchmarks/shared.jsx` (`useCategoryQuotes`, shared with the page: one `/api/price` batch per provider, 429 retried, nothing asked while the bubble is closed). Pages with no mapping (no picker, or no scored models, like Vectorize) render nothing. The `vector` category ranks `vectorTextModels` on Rapidata's SVG board; chat models are priced on a `SVG_PROMPT_CHARACTERS` prompt.
- Code-written SVG (`vectorModels.js` entries with `kind: 'chat'`): chat models write the markup themselves. `catalog/chatRoutes.js` routes each `svg-*` slug to the vendor's chat model id directly (Google, OpenAI) or through OpenRouter, so the picker, key check and price chip treat them like any other model; `vector/svgChat.js` is the pure part (system prompt with the palette as hex, reply parser `extractSvg`, token estimate); `providers/server/svgChat.js` calls `chatCompletion`, sanitises the reply and prices the usage (`chatUsageCost`; OpenRouter reports `usage.cost`) behind `app/api/vector/svg`; the browser calls it through `runSvgChat` in `client.js`, one call per candidate or icon, and the same call with `refine: { svg, instruction }` makes a new library entry with `parentId`. Rates live in `catalog/prices.js` under `chat`, keyed by slug, refreshed from OpenRouter's list like the image rates.

## Conventions

- Every catalog entry in `models.js` must have at least one route; `scripts/validate-routes.mjs` reports any that don't (as "unrouted"), and `withRoutes` in `models.js` keeps such entries out of the studios as a safety net.
- Keys are never passed to studio components; `client.js` reads them per provider when a request is made. The shell tracks a `hasProvider` boolean (shows the setup banner; Layers Studio uses it to gate its tool buttons).
- After editing route files: `node scripts/sync-provider-schemas.mjs` then `node scripts/validate-routes.mjs --verbose` (0 errors expected).
