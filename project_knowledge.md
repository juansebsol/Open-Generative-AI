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

- Vector studio (`components/VectorStudio.jsx`): its catalog is `vectorModels.js` (routed by `catalog/routes/vector.json`), results live in `vectorLibrary.js`, and `vector/` holds the pure helpers (SVG sanitiser, sprite builder, icon-set planner, optimiser, zip/ico/pdf writers, output classifier) plus the browser export kit.

## Conventions

- Every catalog entry in `models.js` must have at least one route; `scripts/validate-routes.mjs` reports any that don't (as "unrouted"), and `withRoutes` in `models.js` keeps such entries out of the studios as a safety net.
- Keys are never passed to studio components; `client.js` reads them per provider when a request is made. The shell tracks a `hasProvider` boolean (shows the setup banner; Layers Studio uses it to gate its tool buttons).
- After editing route files: `node scripts/sync-provider-schemas.mjs` then `node scripts/validate-routes.mjs --verbose` (0 errors expected).
