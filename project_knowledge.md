# Project knowledge

Context for contributors and coding agents. User-facing docs are in [README.md](README.md).

## Shape of the app

- Next.js 15 App Router app at the repo root. One page (`app/studio/[[...slug]]`, plus `app/zh/...` for Chinese) renders `components/StandaloneShell.js`, which hosts every studio.
- Studios live in the `packages/studio` workspace (`studio` package, plain JS/JSX, Tailwind classes). They import generation functions from `packages/studio/src/generation.js`.
- No database and no server-side state. Visitor settings, provider keys and history live in the browser (`localStorage`).

## Provider layer (`packages/studio/src/providers/`)

- `directProviders.js`: registry of providers (id, label, kind cloud/local, key URL).
- `keys.js`: per-visitor settings in `localStorage` key `oga_providers_v1` (`keys`, `urls`, `options`, `order`). Also clears the legacy `muapi_*` storage keys and cookie once.
- `catalog/routes/*.json`: catalog endpoint slug → ordered provider routes. Edited by hand, one file per model family group. `catalog/routes.generated.js` and `catalog/schemas.generated.js` are build artifacts of `scripts/build-catalog-index.mjs` (committed so the app builds without running scripts).
- `mapper.js`: pure function `mapInput(payload, route, schema)`; shared by the server and `scripts/validate-routes.mjs`.
- `client.js` (browser): `runEndpoint(endpoint, payload)` picks a route, calls `/api/generate`, polls `/api/jobs`; `uploadMedia(file)` gets a signed URL from `/api/uploads` and PUTs the file to provider storage.
- `server/` (Node only, imported by `app/api/*` as `studio/providers/server`): adapters for fal (queue), WaveSpeed (v3), Google Gemini, OpenAI Images, OpenRouter (chat completions with image output).
- `local/`: ComfyUI and sd-server connectors that run in the browser against the visitor's own machine.

## Conventions

- Catalog models without any route are filtered out in `models.js` (`withRoutes`). `ALL_MODEL_LISTS` keeps the unfiltered lists for the validator.
- Studio components still receive an `apiKey` prop. It is a non-secret marker (`'byok'` once any provider is configured), used for gating buttons and scoping `localStorage` keys. Real keys are read per provider inside `client.js`.
- After editing route files: `node scripts/sync-provider-schemas.mjs` then `node scripts/validate-routes.mjs --verbose` (0 errors expected).
