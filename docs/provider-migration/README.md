# Removing muapi.ai: provider-agnostic migration plan

Status: implemented on branch `feat/byok-provider-layer` (2026-10-21), with these decisions:

- **D1 / web-only:** the Electron desktop app and the plain-JS `src/` interface were removed instead of merged. The app is a Next.js web app, self-hosted with npm + pm2 (`ecosystem.config.js`) or deployed to Vercel. Docker was removed.
- **D2 / keys:** public bring-your-own-key. Keys are stored per provider in the visitor's browser and sent per request to `/api/generate`, `/api/jobs` and `/api/uploads`; nothing is stored server-side.
- **D3 / providers:** fal.ai, WaveSpeed, OpenRouter, Google Gemini, OpenAI, plus browser-direct ComfyUI and sd.cpp `sd-server`. Wan2GP and the bundled sd.cpp download were dropped with the desktop app.
- **D4 / catalog:** rather than regenerating the catalog, the existing `models.js` entries are kept and mapped to provider endpoints through `packages/studio/src/providers/catalog/routes/*.json`, validated against snapshotted provider schemas. Models with no route are hidden.
- **D5 / hosted features:** Workflows, Agents, Design Agent, Clipping, Vibe Motion, Apps and MCP/CLI were removed (not flagged). §6 still describes how to rebuild them.

The README describes the result. The sections below are the original plan and are kept for reference.

Detailed evidence lives in the appendices:

- [Appendix A: every muapi coupling in the app, with file:line refs](appendix-a-app-muapi-inventory.md)
- [Appendix B: what the Workflow / Agents / Design-Agent submodules need from a backend](appendix-b-submodule-backends.md)
- [Appendix C: provider research, coverage matrix and per-family routing, with sources](appendix-c-provider-research.md)

---

## 1. How deep the muapi dependency goes

muapi isn't just "the API we call". It is five things at once, and each needs its own replacement:

| # | Role muapi plays today | Where | Replacement |
|---|---|---|---|
| 1 | **Inference gateway**: one key and one `POST /api/v1/{model}` then `GET /predictions/{id}/result` contract for ~590 models | `packages/studio/src/muapi.js` (1045 lines), `src/lib/muapi.js` (520 lines), `utils/generationLifecycle.js` | Provider adapter layer + router (§3) |
| 2 | **Model catalog**: ids are muapi route slugs; schemas "synced from muapi schema_data.json" | `models.js` (35k lines, 587 models), 15 `*Models.js`/`*Parameters.js` family files, `modelFamilies.js`, `videoToolCapabilities.js`, `imageInputContracts.js`, `videoWorkflows.js` | Provider-neutral catalog with per-provider routes, generated from provider schemas (§4) |
| 3 | **File storage and CDN**: uploads, outputs, ~342 `cdn.muapi.ai` and ~196 CloudFront asset URLs | `upload_file`, `get_upload_url` + S3 presign, `upload-binary` proxy, thumbnails and logos across studios | Provider upload adapters + local/S3-compatible storage + re-hosting outputs and assets in `/public` |
| 4 | **Hosted product backends**: workflow engine, agents, creative/design agent, app interest registry, history, balance | `/workflow/*` (~17 endpoints), `/agents/*` (~15), `/api/v1/creative-agent/*` (~16), `/app/*` | Must be **built**. The submodules' `server/` folders are thin FastAPI proxies to muapi with no LLM, DB or engine (Appendix B) |
| 5 | **Server-side state by `request_id`**: video extend/continuation, Seedance `@character:<id>`, motion-graphics-edit | 7 `requiresRequestId` models, `CONTINUATION_TARGETS`, `videoWorkflows.js` | Re-implement as "pass the previous output URL" or drop per model |

**Total surface:**
- 60 files reference muapi.
- 13 hard-coded `https://api.muapi.ai` locations, with no env var.
- 9 Next API routes plus a middleware rewrite.
- 2 duplicate client libraries.
- 2 duplicate UIs: the Next/React studios and the vanilla `src/` studios used by Electron.

---

## 2. Decisions to make before coding

| Decision | Recommendation | Why |
|---|---|---|
| **D1. One UI or two?** | **One.** Make Electron load the React studio (Next static export or a Vite build of `packages/studio`), and delete the vanilla `src/components/*Studio.js` + `src/lib/muapi.js`. | Otherwise every change below has to be done twice. The vanilla UI is already a reduced copy. |
| **D2. Where do API keys live?** | Desktop: Electron main process, encrypted with `safeStorage`; renderer calls `window.providers.invoke()` over IPC. Web or self-host: server env vars (single-user) **or** per-request header to our own allow-listed proxy. **No cookie.** | Kling needs JWT signing and BFL/Replicate block CORS, so a server hop is needed anyway. It also fixes the localhost cookie leak from the security review. |
| **D3. Which providers ship in v1?** | fal.ai + WaveSpeed + OpenRouter + Google Gemini + OpenAI, plus the existing local engines (sd.cpp, Wan2GP) and a ComfyUI adapter (§5). | Together they cover about 95% of still-valid catalog rows. |
| **D4. Catalog strategy** | Generate from provider schemas plus a small curated overrides file. Stop hand-maintaining 35k lines. | fal publishes public OpenAPI per endpoint, WaveSpeed/Replicate/Runware/Eachlabs/Segmind publish JSON Schema. |
| **D5. Hosted features (Workflow, Agents, Design Agent, Clipping, VibeMotion, Apps)** | v1: hide behind feature flags. v2: rebuild Workflow + Agents in-app. Design Agent last or dropped. | These are product backends, not API calls. Size estimates are in §6. |
| **D6. Unofficial or dead models** | Remove: Sora (OpenAI shut the API down 2026-09-24), Midjourney (no official API), Suno (no official API), "Spicy" permissive SKUs, Veo via the Gemini API (shut down 2026-10-22), Nano Banana v1, gpt-image-1/1.5 (retiring). | ToS and legal risk, plus dead endpoints. Replacements are listed in §5.3. |
| **D7. Credits/balance UI** | Optional per-provider "balance" where the provider exposes it (fal, OpenRouter, WaveSpeed). Otherwise hide it. | There is no single wallet any more. |

---

## 3. Target architecture

```
packages/
  providers/                       ← NEW: provider-neutral core (no React)
    src/
      types.ts                     ModelDef, Route, JobHandle, JobResult, Capability
      registry.ts                  load catalog + overrides; resolve(modelId) → routes[]
      router.ts                    pick route by user priority + configured keys; optional fallback
      jobs.ts                      submit/poll/resume, persisted job handles (replaces muapi_pending_jobs)
      storage.ts                   upload(file) and rehost(outputUrl); local fs (Electron) | IndexedDB | S3/R2
      adapters/
        fal.ts                     queue API, SSE status, fal storage upload, OpenAPI schemas
        wavespeed.ts               v3 submit + /predictions/{id}/result (near-identical to muapi)
        openrouter.ts              chat (LLM), /images, /videos (async + HMAC webhook)
        google.ts                  Gemini API: Nano Banana, Gemini Omni video, Lyria, TTS
        openai.ts                  gpt-image-2/2.5 (sync, base64), TTS
        replicate.ts               predictions + files API (phase 2)
        comfyui.ts                 /prompt, /ws, /upload/image, /view, /object_info
        local.ts                   wraps existing window.localAI (sd.cpp, Wan2GP)
        byteplus.ts, kling.ts, minimax.ts, dashscope.ts, bfl.ts, xai.ts, runway.ts,
        elevenlabs.ts, sync.ts, topaz.ts, bria.ts   (phase 3, direct first-party)
      llm.ts                       Vercel AI SDK v7 wrapper (OpenRouter/OpenAI/Anthropic/Google/Ollama/LM Studio)
    catalog/
      generated/<provider>.json    output of scripts/sync-catalog.mjs (committed, not fetched at runtime)
      overrides.json               display names, families, widgets, grouping, defaults, hidden params
      families.json                collapses SKU explosions (e.g. 146 Seedance rows → ~8 models + params)
```

### 3.1 Provider adapter interface

```ts
interface ProviderAdapter {
  id: 'fal' | 'wavespeed' | 'openrouter' | 'google' | 'openai' | 'comfyui' | 'local' | ...;
  displayName: string;
  keyUrl?: string;                         // "get a key" link for the settings UI
  auth: 'header' | 'bearer' | 'jwt' | 'none';
  capabilities: Capability[];              // t2i, i2i, t2v, i2v, v2v, lipsync, tts, music, sfx, upscale, bg-remove, expand, llm
  upload(file: Blob, opts?): Promise<string>;                       // returns a URL the provider accepts
  submit(endpoint: string, input: object): Promise<JobHandle>;      // {provider, id, statusUrl?, responseUrl?}
  poll(handle: JobHandle): Promise<JobStatus>;                      // {state: queued|running|succeeded|failed, progress?, outputs?: Output[], error?}
  cancel?(handle: JobHandle): Promise<void>;
  getBalance?(): Promise<{ amount: number; currency: string }>;
  fetchSchemas?(): Promise<RawSchema[]>;                            // used by scripts/sync-catalog.mjs only
}
type Output = { type: 'image' | 'video' | 'audio' | 'text' | 'mesh'; url: string; mime?: string };
```

Synchronous providers (OpenAI images, Gemini) implement `submit` as "run and resolve" and return a handle that is already complete.

### 3.2 Catalog entry (replaces the muapi-shaped `models.js` entries)

```jsonc
{
  "id": "seedance-2.5",                       // our own stable id, not a provider slug
  "name": "Seedance 2.5",
  "family": "seedance",
  "capabilities": ["t2v", "i2v"],
  "inputs": { /* normalized JSON Schema subset the existing ModelParameterControls can render */ },
  "routes": [
    { "provider": "fal",       "endpoint": "fal-ai/bytedance/seedance/v2.5/...", "map": "seedance-fal" },
    { "provider": "wavespeed", "endpoint": "bytedance/seedance-v2.5-...",        "map": "seedance-ws"  },
    { "provider": "byteplus",  "endpoint": "dreamina-seedance-2-5-260628",       "map": "seedance-ark" }
  ]
}
```

`map` names an input/output mapper in `packages/providers/src/mappers/`. These translate the UI's field conventions (`image_url`, `images_list`, `last_image`, `video_url`, `audio_url`, `aspect_ratio` "16:9", `resolution` "720p", integer `duration`, `seed: -1`) into each provider's names.

### 3.3 Request path

- **Web (Next):** studio → `providers.generate(modelId, inputs)` → `POST /api/providers/[provider]/...`
  - The server route attaches the key from env or the request header.
  - It uses a per-provider host and path allow-list, `redirect: 'manual'`, and size limits.
- **Electron:** studio → `window.providers.invoke('generate', …)` over IPC → main process.
  - The key comes from `safeStorage`; the main process calls the provider.
  - It re-hosts outputs to `userData/outputs`.
- **Outputs are always re-hosted** because provider URLs expire: Replicate after 1 h, BFL after 10 min, DashScope after 24 h, and OpenAI/Gemini return base64 only. Electron writes to local files; web writes to IndexedDB blobs, or S3/R2 when configured.

---

## 4. Complete change list (every file and area)

Legend: **R** = rewrite, **M** = modify, **D** = delete, **N** = new.

### 4.1 Core client layer

| Change | File(s) | Notes |
|---|---|---|
| N | `packages/providers/**` | New core package (§3). Add it to root `package.json` workspaces. |
| R | `packages/studio/src/muapi.js` → `packages/studio/src/generation.js` | Keep the exported function names (`generateImage`, `generateI2I`, `generateVideo`, `generateI2V`, `processV2V`, `processRecast`, `processMotionControl`, `processLipSync`, `generateAudio`, `uploadFile`, `decomposeLayers`, `upscaleImage`, `removeBackground`, `expandImage`, `generateMarketingStudioAd`) as thin wrappers over `providers.generate()` so the studios change minimally. |
| M | `packages/studio/src/index.js:20` and the 17 studio import sites | Change `export * from './muapi'` to the new module. |
| D | Unused muapi-only exports | `getHistory`, `deleteMedia`, `estimateV2VCost`, `calculateDynamicCost`, `handleProxyRequest`, `handleServerSideProxy`, `getNodeSchemas`, `runSingleNode`, `deleteNodeRun`, `getNodeStatus`, `PROXY_WF_BASE`, `registerAppInterest`, `getAppInterests`, `getUserBalance`. |
| R | `packages/studio/src/utils/generationLifecycle.js` | Hard-codes `/api/v1/predictions/{id}/result`, `x-api-key`, the muapi status vocabulary and `cost.refunded`. Move this into `jobs.ts`, with each adapter mapping its own statuses. |
| M | `packages/studio/src/utils/formatError.js:29-34` | Remove the muapi credit/wallet wording; add per-provider error normalization (402 = insufficient funds, 401 = bad key, 429 = rate limit, content policy). |
| M | `muapi.js:23-27` `muapi:auth-required` event | Rename to `provider:auth-required` with `{provider}` and add a listener that opens the key settings. Nothing listens for it today. |
| D | `src/lib/muapi.js` (vanilla `MuapiClient`) | Remove once D1 is done; otherwise port it to `packages/providers`. |
| M | `src/lib/pendingJobs.js`, `src/lib/uploadHistory.js` | Store `JobHandle`s (`{provider, id, …}`) instead of muapi request ids; rename the storage keys. |
| M | `packages/studio/src/utils/downloadImage.js` | Works on re-hosted local/blob URLs; rename the `muapi-` filename prefix. |

### 4.2 Model catalog

| Change | File(s) | Notes |
|---|---|---|
| N | `scripts/sync-catalog.mjs` | Pulls fal OpenAPI (`api.fal.ai/v1/models?expand=openapi-3.0`), WaveSpeed `/api/v3/models`, and others into `catalog/generated/*.json`, normalized to our input schema. Run it manually and commit the output, since unauthenticated calls hit 429s. |
| N | `catalog/overrides.json`, `catalog/families.json` | Curated names, grouping, widget hints and defaults; collapse the SKU explosions. |
| R | `packages/studio/src/models.js` (35k lines, 587 models) | Becomes a loader over the generated catalog plus overrides. Keep the helper functions (`getModelById`, `getAspectRatiosForModel`, `getDurationsForModel`, `getResolutionsFor*`, `getMaxImagesFor*`, `getQualityField*`, `getEffectsFor*`) with the same signatures so the studios don't change. |
| R | Family registries: `seedanceModels.js` (+`seedanceParameters.js`), `klingModels.js`, `minimaxModels.js`, `veoModels.js`, `soraModels.js`, `viduModels.js`, `pixverseModels.js`, `ltxModels.js`, `xaiModels.js`, `alibabaModels.js`, `happyHorseModels.js`, `groupedVideoModels.js`, `groupedVideoParameters.js`, `groupedVideoRegistry.js`, `nativeVideoParameters.js`, `videoModelParameters.js` | These choose a **muapi endpoint** from resolution/speed/profile. Change them to choose a catalog id plus params, and let the route mapper turn params into provider endpoints. Delete `soraModels.js`/`soraParameters.js` (Sora is dead). |
| M | `modelFamilies.js:390-410` | Remove the endpoint-based family union and the `provider: model.provider \|\| "muapi"` default. |
| M | `modelCapabilities.js`, `imageInputContracts.js:24-60`, `videoToolCapabilities.js:230-447,505-524,681-753`, `videoWorkflows.js:119,131,171,370`, `imageSizing.js`, `videoMediaInputs.js`, `videoModelCopy.js` | They are keyed by muapi ids and muapi field names. Re-key them to catalog ids and take field names from the mappers. |
| R/D | 7 `requiresRequestId` models + `CONTINUATION_TARGETS` + Seedance `@character:<request_id>` + `modelParameters.js:12` (`request_id`, `api_key`) | Extend/continue becomes "use the previous output video URL" where the provider supports it (Veo extend on Vertex/WaveSpeed, Seedance extend via fal/WaveSpeed); otherwise remove. |
| R/D | 33 muapi-native `ai-*` tools | Upscale → Topaz/SeedVR2/ESRGAN via fal. Background removal → BRIA/BiRefNet via fal. Expand → BRIA expand or Flux fill. Face swap / dress change → fal models or ComfyUI. Watermark, captions and passthrough → local ffmpeg/canvas. Drop HeyGen-translate unless a direct HeyGen adapter is added. |
| D | `models_dump.json`, `scripts/test_minimax_provider.js` | muapi-specific artifacts. |
| M | Catalog media: 87 `cdn.muapi.ai` + 143 CloudFront + 4 aiquickdraw URLs in `models.js` | Download into `public/catalog/` or use provider-hosted examples from the schema. |
| M | Branded copy and provenance comments: `models.js:3,10,96,114,134,863,5888,5915,10033,10114,15163,15196,16225,16475,32838,33342,33519,34001`; `seedanceModels.js:153-155` | Remove the muapi mentions. |

### 4.3 Studios

| Studio | Today | Change |
|---|---|---|
| **Image** (`ImageStudio.jsx`) | `uploadFile`, `generateImage`, `generateI2I`; 25 cdn.muapi.ai provider logos (L630-654); `'muapi'` provider fallback (L735-747, 1695); `muapi-` download prefix (L1498, 1536) | Use the provider client; local logos in `public/providers/`; add a provider badge and a "route via" selector on the model card. |
| **Video** (`VideoStudio.jsx`) | `generateVideo`, `generateI2V`, `processV2V`; extend via `request_id` (L1090, 2156, 2277, 2383-2404, 2902); 25 logos (L407-431); `'muapi'` fallback (L527-541, 2956) | Same as Image, plus rewrite extend as previous-output-URL. |
| **Audio** | `generateAudio` passthrough; Suno ×9, MiniMax, ElevenLabs, Lyria, Fish, Gemini TTS, MMAudio | Replace Suno with ElevenLabs Music, Lyria 3.5, or MiniMax music via fal. The other models route via fal/Google/ElevenLabs. |
| **Lip Sync** | `processLipSync`, 15 models | Route via fal (Sync, VEED, LatentSync, InfiniteTalk, OmniHuman), WaveSpeed, or direct sync.so. |
| **Cinema** | Hard-coded `nano-banana-pro(-edit)` (L718, 751) | Look up a catalog id; route via Google Gemini or fal. |
| **Marketing** | `generateMarketingStudioAd` muapi endpoint switch (`muapi.js:200-210`); CloudFront avatars and videos (L96-111) | Use a catalog model (Seedance omni-reference via fal/WaveSpeed); re-host the media. |
| **Recast** | `processRecast`: Kling 3.0 motion control, Runway Act-Two, Wan 2.2 Animate | Route via fal (Kling, Wan) and WaveSpeed or direct Runway (Act-Two is not on fal). |
| **Motion Control** | Seedance motion control ×4; per-model clamps and a hidden prompt prefix in `muapi.js:295-340` | Move the clamps and prompt into catalog overrides; route via fal/WaveSpeed. |
| **Layers** (`LayersStudio.jsx`, 4104 lines) | `decomposeLayers` (Seedream 5 layer), Topaz/SeedVR2/ai upscalers, `ai-background-remover`, `ai-image-extension`, hard-coded price (L4009), 8 samples | Find routes for layer decomposition (BytePlus/fal Seedream layer, if available), upscale (fal Topaz/SeedVR2), background removal (fal BRIA/BiRefNet) and expand (fal BRIA/Flux fill). Remove the hard-coded price. |
| **DrawModal** | Hard-coded `nano-banana-pro-edit` / `nano-banana-2-edit` (L15, 1037, 1691-1738) | Catalog lookup. |
| **AI Influencer** | `nano-banana-pro`; 128 `${CDN}` option images (L14) | Catalog lookup; re-host the 128 images into `public/influencer/`. |
| **Clipping** | `ai-clipping` (muapi pipeline, not in the catalog) | v1: flag off. v2: rebuild with transcription (OpenAI/Groq Whisper) + LLM highlight picking (OpenRouter) + ffmpeg cuts. |
| **Vibe Motion** | `motion-graphics`, `motion-graphics-edit` (muapi pipeline) | v1: flag off. v2: LLM generates Remotion/Lottie code and renders locally. |
| **Apps** | interest registry (`/app/interest(s)`), 68 cdn.muapi.ai thumbnails | Remove the registry; keep it as a static link directory with local thumbnails, or drop it. |
| **MCP/CLI** | Docs for muapi-cli, MCP and skills | Delete, or rewrite later as our own MCP server over `packages/providers`. |
| **Workflow** | Hosted workflow engine + `workflow-builder` submodule | §6.1 |
| **Agent** (+ `app/agents/**`) | Hosted agents + `ai-agent` submodule; server pages read the `muapi_key` cookie | §6.2 |
| **Design Agent** | Hosted creative-agent + `design-agent` submodule; LLM hard-coded `gpt-5-mini` | §6.3 |
| **All studios** | CloudFront empty-state images (4 per studio in 9 studios + DrawModal) | Re-host to `public/`. |

### 4.4 Keys, auth and settings UX

| Change | File(s) |
|---|---|
| R: per-provider key store (Electron `safeStorage` via IPC; web: server env or localStorage → request header) | `packages/studio/src/persistKey.js`, `components/StandaloneShell.js:578-625` |
| D: `muapi_key` cookie, `window.__MUAPI_KEY__`, axios `x-api-key` interceptors | `StandaloneShell.js:584,592,599,604-625`, `app/agents/[agent_id]/AgentChatClient.js:40-48`, `AgentCreateClient.js`, `AgentEditClient.js` |
| R: "Providers" settings panel listing each provider's key field, "get key" link, test button, enabled toggle and route priority | `components/ApiKeyModal.js`, `StandaloneShell.js:1166-1210`, vanilla `AuthModal.js` / `SettingsModal.js` (or delete them per D1) |
| M: remove the app-wide gate that blocks everything until a muapi key exists (`StandaloneShell.js:678`); allow local-only use | `StandaloneShell.js` |
| M: optional per-provider balance pill (fal, OpenRouter, WaveSpeed) | `StandaloneShell.js:347,450-457,475,627-632,799-804` |
| D: white-label artifacts (`wl_workflow_token`, `localStorage.token`, session-token comments) | `persistKey.js`, `AgentStudio.jsx:177-181`, `DesignAgentStudio.jsx:33-35`, `WorkflowStudio.jsx:154,275` |
| M: rename storage keys `muapi_history`, `muapi_pending_jobs`, `muapi_uploads` (with a one-time migration) | `src/lib/*`, studios |

### 4.5 Server, proxy, Electron and build

| Change | File(s) |
|---|---|
| D: muapi proxy routes | `app/api/api/v1/[[...path]]`, `app/api/workflow/[[...path]]`, `app/api/agents/[[...path]]`, `app/api/app/[[...path]]`, `app/api/v1/creative-agent/[[...path]]`, `app/api/v1/get_upload_url` |
| D or R: S3 upload proxies (only needed for our own S3/R2 storage) | `app/api/upload-binary`, `app/api/v1/upload-binary`, `src/lib/uploadProxyTarget.js` |
| N: `app/api/providers/[provider]/[[...path]]/route.js`, a generic allow-listed proxy that attaches keys server-side, uses `redirect: 'manual'`, limits body size and requires a local auth token when bound beyond localhost | new |
| M: `middleware.js:27-43` (remove the `/api/v1` rewrite) and `:19` CSP `connect-src` (`'self'` only if everything is proxied; otherwise list provider hosts such as `*.fal.run`, `*.fal.media`, `openrouter.ai`, `generativelanguage.googleapis.com`). Tighten `script-src` (drop `unsafe-eval`). | `middleware.js` |
| M: remove the `/api` → api.muapi.ai dev proxy | `vite.config.mjs:6-12` |
| N: `electron/lib/providers.js` (main-process provider client, `safeStorage` keys, output re-hosting to `userData/outputs`) and `preload.js` `window.providers` bridge | `electron/` |
| M: `electron/main.js:56` restrict `openExternal` to http(s) and add a `will-navigate` guard (from the security review) | `electron/main.js` |
| M: bind dev/prod to 127.0.0.1 by default; Docker `127.0.0.1:3001:3000` | `package.json` scripts, `docker-compose.yml` |
| M: env template listing every provider key (`FAL_KEY`, `WAVESPEED_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, `COMFYUI_URL`, …) | new `.env.example` |
| M: remove the submodules from `package.json` workspaces/deps, `packages/studio/package.json:50-52`, `next.config.mjs:3`, `Dockerfile:7-9,16`, `.gitmodules`, or vendor forked copies if rebuilding (§6) | build config |
| M: dependency upgrades from the security review (next, axios, sharp, postcss; Electron 33 → a supported major) | `package.json`, lockfile |

### 4.6 Branding and docs

| Change | File(s) |
|---|---|
| R: README (badge L3, White Label L22-47, API examples L49-68, hosted version L71-79, plus L168, 320, 436, 468, 497, 540-572, 595, 609, 621) | `README.md` |
| R | `project_knowledge.md` |
| M: i18n `apiKeyModal`, `vadooPromo`, apps strings | `messages/en\|zh/common.json`, `packages/studio/src/messages/en\|zh/appsStudio.json`, `src/lib/i18n.js:94-106,318-330` |
| D: Vadoo promo banner | `StandaloneShell.js:351-353,707-725` |
| M: comments, logs and package metadata | `packages/studio/package.json:4`, `lib/locales.js:4`, `middleware.js:13-16,45-47`, `[Muapi]` log prefixes, `usedIn="muapiapp"` |

---

## 5. Providers to add

### 5.1 Tier 1 (v1)

| Provider | Role | Why | Integration notes |
|---|---|---|---|
| **fal.ai** | Primary media provider | ~1,500 endpoints; best schemas (public OpenAPI per endpoint); official `@fal-ai/client` + `@fal-ai/server-proxy`; queue + SSE + signed webhooks; covers Seedance, Kling, Wan, Flux, Hailuo, Vidu, PixVerse, LTX, Qwen, Nano Banana, GPT Image, Grok, Topaz, lipsync, BRIA, MMAudio | Lacks Runway, Midjourney and Suno; its Veo and Sora are deprecated. Upload via fal storage. |
| **WaveSpeedAI** | Secondary media provider | ~1,100 models; fills fal's gaps (Veo 3.1, Runway, InfiniteTalk, most Seedance/Wan SKUs); its API is almost identical to muapi's, so it is the cheapest port | Needs a server proxy (no CORS). Schemas need a key. |
| **OpenRouter** | LLMs (agents, prompt enhancement, workflow architect) + a one-key media tier | 468 LLMs; images via `/images` or chat modalities; 30 video models (Seedance, Veo 3.1, Kling, Hailuo, Wan 3.0, Grok, Runway, FLUX 3, HappyHorse); CORS `*` + OAuth PKCE, so the browser can work without a server | No Vidu, PixVerse, Luma, LTX, lipsync, upscale or background removal. |
| **Google Gemini API** | Direct: Nano Banana 2.1/Pro, Gemini Omni video, Lyria 3.5, Gemini TTS | Cheapest and canonical for Google models | Veo leaves the Gemini API 2026-10-22; use Vertex AI or an aggregator for Veo. |
| **OpenAI** | Direct: gpt-image-2 / 2.5, TTS; LLM | Canonical | Synchronous, base64 output, so re-host. No video (Sora shut down). |
| **Local: sd.cpp + Wan2GP** (existing) | Offline | Already built | Wrap the existing `window.localAI` as a `local` adapter so it shares the same router. |
| **ComfyUI** (local or Comfy Cloud) | Open-weight models, custom workflows | `/object_info` gives node schemas, so forms can be generated | Also a natural backend for a rebuilt Workflow studio. |

### 5.2 Tier 2 and 3 (later)

- **Redundancy aggregators:** Replicate (outputs expire after 1 h), Runware (cheap; public JSON Schema), Eachlabs or Segmind (public schemas, CORS `*`).
- **Direct first-party adapters (for price and new models first):**
  - BytePlus ModelArk: Seedance, Seedream, OmniHuman. Excludes the US and blocks real faces.
  - Kling: JWT auth.
  - MiniMax.
  - Alibaba DashScope: Wan 3.0, HappyHorse, Qwen-Image.
  - BFL: FLUX.2/3, FLUX 3 Video. Result URLs expire after 10 min.
  - xAI: Grok Imagine.
  - Runway: Gen-4.5, Aleph, Act-Two, Veo 3.1.
  - Luma, Vidu, PixVerse, LTX.
  - ElevenLabs: TTS, music, SFX.
  - Fish Audio.
  - sync.so: lipsync.
  - Topaz.
  - BRIA: background removal, erase, expand, upscale.
  - Ideogram, Recraft, Stability.
- **LLM directs:** Anthropic, Groq, plus Ollama and LM Studio for local LLMs, all through the Vercel AI SDK.

### 5.3 Remove or replace

| Family (rows) | Status | Replacement |
|---|---|---|
| Sora (6) | API shut down 2026-09-24 | Veo 3.1 / Gemini Omni / Seedance 2.5 / Kling v3 |
| Midjourney (3) | No official API; ToS bans automation | Drop |
| Suno (9) | No official API (partner program only) | ElevenLabs Music, Lyria 3.5, MiniMax music via fal |
| "Spicy" Seedance/Wan SKUs | Permissive variants with no official equivalent | Drop, or aggregator-only behind a flag |
| Veo via Gemini API | Shuts down 2026-10-22 | Vertex AI, Runway API, WaveSpeed, OpenRouter |
| Nano Banana v1, gpt-image-1/1.5, gpt-4o image, Imagen 4 (Gemini API), `ltx-2-*` | Retired or retiring | Nano Banana 2.1, gpt-image-2/2.5, LTX 2.5 |
| ~146 Seedance SKU rows | muapi-specific explosion (VIP/Intl/per-resolution) | ~8 models + resolution/duration params |

### 5.4 Per-family routing (v1)

| Family | Primary | Fallback |
|---|---|---|
| Seedance / Seedream / OmniHuman | fal | WaveSpeed → BytePlus (direct) |
| Kling (incl. motion control, avatar, "O3" = `kling-v3-omni`) | fal | WaveSpeed → Kling direct |
| Wan 2.x/3.0, HappyHorse, Qwen-Image | WaveSpeed | fal → DashScope; local Wan2GP/ComfyUI for open weights |
| Flux (1, Kontext, 2, 3) | fal | BFL direct; local ComfyUI |
| MiniMax / Hailuo / H3, speech | fal | WaveSpeed → MiniMax direct |
| Nano Banana, Gemini Omni, Lyria, Gemini TTS | Google direct | fal / OpenRouter |
| GPT Image 2/2.5 | OpenAI direct | fal / OpenRouter |
| Veo 3.1 | WaveSpeed | OpenRouter → Vertex AI / Runway |
| Vidu, PixVerse, LTX | fal | WaveSpeed |
| Grok Imagine | fal | xAI direct / OpenRouter |
| Runway (Gen-4.5, Aleph, Act-Two) | WaveSpeed | Runway direct |
| Lipsync (Sync, LatentSync, VEED, Creatify, InfiniteTalk) | fal | WaveSpeed → sync.so |
| Topaz, SeedVR2, ESRGAN, BRIA, BiRefNet (utilities) | fal | Topaz / BRIA direct |
| ElevenLabs, Fish, MMAudio | fal | ElevenLabs / Fish direct |
| HiDream, Hunyuan, Z-Image, SDXL, Chroma, open weights | fal | Runware; local sd.cpp / ComfyUI |
| LLM (agents, prompt enhance, architect) | OpenRouter | OpenAI / Anthropic / Google / Ollama |

---

## 6. Hosted features: rebuild options

The bundled `server/` folders in the three submodules are **not** replacements. Each is a FastAPI service that forwards to `api.muapi.ai` with no database, LLM, engine or planner (Appendix B). A rebuild means writing these backends.

**Shared foundation** (build once inside this repo):
- LLM client with tool calling (Vercel AI SDK).
- The provider router from §3.
- One model registry that produces workflow node schemas, agent tools and design-agent skills.
- Storage: SQLite (Electron via better-sqlite3; self-host via Next server) plus a local or S3-compatible file store that returns presigned `{url, fields}`.
- A background job runner, since runs take minutes and serverless request limits are too short.
- ffmpeg.

| Feature | v1 | Rebuild | Size |
|---|---|---|---|
| **6.1 Workflow** (Vibe-Workflow `workflow-builder`) | Flag off | Fork the frontend package (it hard-codes `cdn.muapi.ai` upload URLs). Implement ~12 endpoints in-app: workflow CRUD, run DAG, node run, status, uploads, cost table. Resolve `{{ nodeId.outputs[0].value }}` templating. Node schemas come from our catalog. Later: video-combiner (ffmpeg), the LLM "architect". Drop community/publish. | L |
| **6.2 Agents** (Open-Poe-AI `agents`) | Flag off | Fork the package. Agent CRUD + conversations in SQLite; chat = AI SDK tool loop with tools = catalog capabilities; keep the submit/poll UI contract via a jobs table. Drop likes/featured. | M–L |
| **6.3 Design Agent** (`design-agent`) | Flag off / drop | Planner, plan approval, canvas ops and skills are all closed server logic, so this would be a from-scratch design. Phase it: sessions/assets → chat tool loop → plans/canvas ops. | L–XL |
| **Clipping** | Flag off | Whisper transcription + LLM highlight picking + ffmpeg | M |
| **Vibe Motion** | Flag off | LLM → Remotion/Lottie code → local render | M–L |

---

## 7. Phased delivery

| Phase | Scope | Size | Done when |
|---|---|---|---|
| **0. Prep** | D1 (single UI), dependency upgrades, Electron hardening, 127.0.0.1 binding | M | Electron runs the React studio; `npm audit` shows no critical vulnerabilities |
| **1. Provider core** | `packages/providers`, fal + WaveSpeed + OpenAI + Google + local adapters, router, jobs, storage, server proxy, Electron IPC | L | Image and Video studios generate through fal with no muapi call (verify in the network tab) |
| **2. Catalog** | `sync-catalog.mjs`, overrides, collapsed families, mappers, re-hosted media; delete dead/unofficial models | L | Every remaining catalog model has at least one route; the studio helper functions pass existing tests |
| **3. Studios** | Audio, LipSync, Cinema, Marketing, Recast, Motion, Layers, Draw, Influencer on the new client; Clipping/VibeMotion/Workflow/Agents/Design/Apps/MCP behind flags | M–L | `grep -ri muapi` in app code returns nothing |
| **4. Keys UX** | Providers settings panel, per-provider keys, balance, remove the cookie/gate | M | App starts with zero keys (local only); adding a fal key enables fal models |
| **5. Cleanup** | Delete muapi routes, middleware rewrite, Vite proxy, submodules, branding, README, i18n | S–M | CSP has no muapi hosts; README describes BYO providers |
| **6. Rebuilds** | Workflow → Agents → (Design Agent) on the shared foundation | L–XL | Feature flags on |

Phases 1–5 make the app fully independent of muapi. Phase 6 brings back the hosted-product features.

---

## 8. Risks and open questions

- **Model parity is not 1:1.** Some muapi SKUs are its own pipelines (`ai-*`, Clipping, motion graphics, Seedream layer split). Expect a handful of features to disappear or degrade until rebuilt.
- **Pricing changes.** muapi bundled a single wallet; users now need accounts with 2–3 providers. OpenRouter is the closest "one key" option, but it has narrower media coverage.
- **Unverified items:** exact Kling and Vidu endpoint paths and prices (their docs render client-side); Seedance 2.5 availability in the US; Gemini and Groq CORS behaviour; Wan2GP MCP mode. See Appendix C.
- **Fast churn:** the provider research found retirements in the last 60 days (Sora, Veo on Gemini, Nano Banana v1, gpt-image-1). The generated catalog plus `sync-catalog.mjs` is what keeps this maintainable.
