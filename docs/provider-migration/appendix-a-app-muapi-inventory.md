# muapi.ai coupling inventory: open-generative-ai (app's own code)

Repo: `/Users/sebsol/00_Dev-Projects/05_OpenSource-collabs/03_open-generative-ai/open-generative-ai` (branch `main`, clean).
Scope: the app's own code. Submodules `packages/Vibe-Workflow`, `packages/Open-Poe-AI`, `packages/Open-AI-Design-Agent` are excluded, and they are **empty directories in this clone** (not checked out), so the consumers of some proxy routes (presigned upload, creative-agent, `/api/v1/*` rewrite) can't be seen here. All paths below are relative to the repo root.

Three clients/runtimes:
1. **Next.js app** (`app/`, `components/`, `middleware.js`) mounts React studios from the `studio` workspace (`packages/studio/src`). API client: `packages/studio/src/muapi.js`.
2. **Vanilla Vite/Electron renderer** (`index.html` → `src/main.js`, `src/components/*.js`). API client: `src/lib/muapi.js` (class `MuapiClient`). It shares the model catalog (`src/lib/models.js` re-exports `studio/src/models.js`) and `generationLifecycle.js`.
3. **Electron main/preload** (`electron/`) has no muapi code. It only exposes local engines (sd.cpp, Wan2GP) through `window.localAI`. That is an existing pattern for a second, non-muapi provider.

There are no env vars for the base URL. `https://api.muapi.ai` is hard-coded in 13 code locations (see E). The only env var on the path is `UPLOAD_PROXY_ALLOWED_HOSTS` (`src/lib/uploadProxyTarget.js:8`).

---

## A. muapi HTTP API contract (as used)

**Base URL resolution**
- `packages/studio/src/muapi.js:16-18`: `BASE_URL = '/api'` in an http(s) browser, otherwise `'https://api.muapi.ai'` (SSR or file://). Every path below is `${BASE_URL}${path}`, so in the browser it becomes `/api/api/v1/...`, `/api/workflow/...`, `/api/agents/...` or `/api/app/...` and is handled by the Next proxy routes (E).
- `src/lib/muapi.js:7`: `baseUrl = ''` under Vite DEV (vite proxy `/api` → api.muapi.ai), otherwise `'https://api.muapi.ai'`. A packaged Electron build therefore calls muapi **directly from file://**, which relies on muapi's CORS.
- `PROXY_WF_BASE = '/api/workflow'` (`muapi.js:19`) is declared but unused.

**Auth:** header `x-api-key: <key>` on every call. The Next routes also accept `Authorization: Bearer <token>` (app, creative-agent, get_upload_url, upload-binary) and convert it to `x-api-key` upstream. A 401/403 dispatches the window event `muapi:auth-required` (`muapi.js:23-27`). Nothing in this repo listens for it; it's a hook for the hosted/white-label shell.

### A1. Generation (generic queue)

| Op | Method & path | Body | Response / handling | Ref |
|---|---|---|---|---|
| Submit | `POST /api/v1/{endpoint}` (endpoint = `model.endpoint \|\| model.id`) | flat JSON of model inputs (see A4) | `{request_id \| id, ...}`. With no id, the submit response is returned as the final result (sync endpoints) | `muapi.js:64-83`; vanilla `src/lib/muapi.js:34,139,206,276,399,461` |
| Poll | `GET /api/v1/predictions/{request_id}/result` | none | `{status, outputs[], url?, output?{url, video, images, coordinates, timings, clips}, error?, message?, cost?{refunded, amount_credits}}` | `utils/generationLifecycle.js:31-81` |
| Polling semantics | interval 2000 ms. Success statuses `completed\|succeeded\|success`. Failure statuses `failed\|error\|cancelled\|canceled` throw `Generation failed: <error\|error.message\|message>` carrying `.requestId` and `.generationResult`. Any other status keeps polling. Network or JSON-parse errors are retried. HTTP 5xx is retried; other non-OK statuses call `onAuthRequired` and throw. Timeout message is `Generation timed out… Request ID` | | | `generationLifecycle.js:1-2,40-80` |
| maxAttempts (×2 s) | image/i2i 60 (~2 min); video/i2v/v2v/recast/motion/lipsync/audio/marketing/clipping/motion-graphics 900 (~30 min); layers 300; upscale/remove-bg/expand 90; agent chat 150; workflow run 900 | | | `muapi.js:105,135,146,175,197,209,232,292,339,352,366,1000,1009,1019,1032,1038,1044` |
| Output normalisation | `url = outputs[0] \|\| url \|\| output.url`; `request_id = submit.request_id\|\|submit.id\|\|result.request_id\|\|result.id` | | | `muapi.js:55-62,81`; vanilla repeats it inline at `src/lib/muapi.js:107,182,...` |
| Refund notice | `cost.refunded===true` appends `Refunded N credits` | | | `generationLifecycle.js:20-29`, used only by `src/components/ImageStudio.js:15,1293` |
| Error formatting | parses `{detail}` / `{error.message}` / `{message}` from the error text. A 402 or `INSUFFICIENT_CREDITS` becomes "Insufficient credits. Please top up your wallet." 401/403 become an auth message; 429 a rate-limit message | | | `packages/studio/src/utils/formatError.js:4-43` |

### A2. Files, account, misc

| Op | Method & path | Request | Response | Used by | Ref |
|---|---|---|---|---|---|
| Upload (direct) | `POST /api/v1/upload_file` | multipart `file`, `x-api-key`; XHR with progress capped at 99% until done, 300 s timeout | `{url \| file_url \| data.url}`, error `{detail}` | every studio upload | `muapi.js:369-423`; vanilla `src/lib/muapi.js:357-388` |
| Presigned upload URL | `GET /app/get_file_upload_url?...` (aliases `/api/app/get_upload_file` and `/api/v1/get_upload_url`) | query string (submodule-defined) | `{url, fields}` (S3 POST policy). `/api/app` **rewrites** `url` to `/api/upload-binary` and injects `fields['x-proxy-target-url']=<S3 url>`. The `/api/v1/get_upload_url` route does **not** rewrite | submodules only (no caller in app code) | `app/api/app/[[...path]]/route.js:29-64`, `app/api/v1/get_upload_url/route.js:25-49` |
| Upload binary proxy | `POST /api/upload-binary` and `POST /api/v1/upload-binary` | multipart S3 fields + file + `x-proxy-target-url`; requires an api key header | 204 or S3 error passthrough. Target must be an AWS S3 host or in `UPLOAD_PROXY_ALLOWED_HOSTS`; html/svg/js/exe types blocked | submodules | `app/api/upload-binary/route.js`, `app/api/v1/upload-binary/route.js`, `src/lib/uploadProxyTarget.js:91-169` |
| Balance | `GET /api/v1/account/balance` | none | `{balance, email}`. Returns 403 for white-label end users | shell header pill, DesignAgent, agents pages | `muapi.js:425-438`; `app/agents/*/page.js` (server-side direct) |
| History | `GET /api/v1/history?cursor&limit=50` | none | paginated list scoped to key or white-label token | **unused in app** (exported for the hosted shell) | `muapi.js:958-973` |
| Delete media | `DELETE /api/v1/predictions/{id}/media` | none | json | **unused in app** | `muapi.js:980-991` |
| V2V cost estimate | `POST /api/v1/models/{endpoint}/estimate-cost` (**no auth header**) | `buildVideoToolPayload(model, params)` | `{cost:number≥0, currency:'XXX'}` (validated) | **unused in app** | `muapi.js:235-273` |
| Dynamic cost | `POST /api/v1/app/calculate_dynamic_cost` | `{task_name, payload}` | json | **unused in app** | `muapi.js:910-924` |
| App interest | `POST /app/interest` / `GET /app/interests` | `{app_name}` | array of names | AppsStudio | `muapi.js:926-954` |
| Server proxy helpers | `handleProxyRequest` / `handleServerSideProxy` (generic forwarder, sets `x-api-key`) | | `{status, contentType, data}` | **unused in app** | `muapi.js:844-908` |
| MCP endpoint | `https://api.muapi.ai/mcp` (Bearer) | | | docs text only | `McpCliStudio.jsx:30-31`, `src/components/McpCliStudio.js:59` |

### A3. Hosted product APIs (no generic equivalent)

| Area | Method & path | Body / response | Ref |
|---|---|---|---|
| Workflows: list | `GET /workflow/get-template-workflows`, `/workflow/get-workflow-defs`, `/workflow/get-published-workflows` | arrays | `muapi.js:440-480` |
| Workflow CRUD | `POST /workflow/create` `{workflow_id:null,name,edges,data:{nodes}}` → `{workflow_id}`; `POST /workflow/update-name/{id}` `{name}`; `DELETE /workflow/delete-workflow-def/{id}`; `GET /workflow/get-workflow-def/{id}` | | `muapi.js:648-693,767-779`; `WorkflowStudio.jsx:266-276` |
| Workflow schema | `GET /workflow/{id}/api-inputs` (→ `input_data` JSON schema), `/workflow/{id}/node-schemas`, `/workflow/{id}/api-node-schemas` | | `muapi.js:695-707,753-765,781-793` |
| Workflow run | `POST /workflow/{id}/api-execute` `{inputs:{textN:{prompt}, imageN:{image_url}, videoN:{video_url}}}` → `{run_id\|id}`; poll `GET /workflow/run/{run_id}/api-outputs` until `status` is completed, succeeded or success (5xx retried) | output url: `url \|\| output.url \|\| outputs[0].url` | `muapi.js:709-751`; `WorkflowStudio.jsx:421-436` |
| Node ops (unused) | `POST /workflow/{id}/node/{nodeId}/run`, `DELETE /workflow/node-run/{id}`, `GET /workflow/run/{id}/status` | | `muapi.js:795-838` |
| Agents: list | `GET /agents/templates/agents`, `/agents/user/agents`, `/agents/featured/agents`, `/agents/user/conversations` | array, `{agents}` or `{items}` | `muapi.js:483-543` |
| Agent detail/history | `GET /agents/by-slug/{slug}`, `/agents/by-slug/{slug}/{conversationId}`; fallback `GET /agents/{id}`, `/agents/{id}/{conv}` (server pages) | | `muapi.js:547-574`; `app/agents/[agent_id]/page.js:20-54` |
| Agent chat | `POST /agents/by-slug/{slug}/chat` `{message, conversation_id, attachments, stream:false}` → `{request_id,status}`; poll `/api/v1/predictions/{id}/result` until `is_complete` → `{conversation_id, messages[], is_complete, suggestions}`. A 400 throws `detail.error` | | `muapi.js:578-627`; `AgentStudio.jsx:270-302` |
| Agent create | `POST /agents` `{name, description, system_prompt, welcome_message, skill_ids:[]}` → `{agent_id}` | | `muapi.js:632-646`; `AgentStudio.jsx:313-319` |
| Creative (design) agent | `/api/v1/creative-agent/*` GET/POST/PATCH/DELETE | consumer is the design-agent submodule | `app/api/v1/creative-agent/[[...path]]/route.js` |

### A4. Request body conventions (shared by all muapi model routes)
- Flat JSON. `prompt`; `aspect_ratio` as a `"W:H"` string (sometimes `"adaptive"`/`"auto"`); `resolution` as `"480p"/"720p"/"1080p"/"4K"/"auto"`; `duration` in integer seconds; `quality`; `mode`; `seed`, omitted when `-1` (`muapi.js:104,351`); `num_images`; `output_format`; `negative_prompt`.
- Media as **URLs**: `image_url` (single), `images_list` (array), `last_image`/`end_image_url`/`last_image_url`/`last_frame_url` (end frame), `video_url`/`videos_list`/`video_files`/`video_urls`/`reference_videos`, `audio_url`/`audios_list`/`audio_files`. Field choice is per model via `imageField`/`lastImageField`/`videoField`/`audioField` (C).
- Quirks: `generateImage` sends `image_url: null` explicitly for pure t2i and `strength: 0.6` when an image is given (`muapi.js:96-103`; vanilla `src/lib/muapi.js:57-62`). `includeRequiredArrayDefaults` sends `[]` for required array fields (`muapi.js:35-42`). Width/height or aspect is resolved by `imageSizing.js:119` `buildImageSizePayload`.
- **Server-side state by `request_id`**: continuation/extend models take the `request_id` of a prior muapi prediction (`requiresRequestId`: seedance-v2.0-extend, seedance-2-extend, seedance-2-vip-extend(-1080p), veo3.1-extend-video, veo3.1-4k-video, grok-imagine-extend; also grok-imagine-image-2-edit). Seedance prompts reference `@character:<request_id>` / `@omni-character:<char_id>` (`models.js:6322,18098,18297,...`). `motion-graphics-edit` takes `request_id`. These need a provider-native equivalent (pass the source video URL) or must be dropped.

---

## B. Per-studio coupling

Legend for "Abstraction": **G** = fits `generate(model, inputs) → media URL`. **G+** = generic but needs multi-output, special inputs or post-processing. **H** = needs a muapi-hosted product feature.

The "muapi CloudFront" column means `d3adwkbyhxyrtq.cloudfront.net` (muapi's legacy web-asset CDN: `/webassets/videomodels/*`, `/web-app/*`, `/ai-images/<user>/...`). Ownership is inferred from the paths, not confirmed. Every Next studio except Apps/McpCli/Workflow/Agent/DesignAgent also shows 4 decorative empty-state images from it: `sdxl-image.avif`, `chroma-image.avif`, `neta-lumina.avif`, `perfect-pony-xl.avif`.

### B1. Next/React studios (`packages/studio/src/components/`)

| Studio | muapi.js funcs → endpoints | Hard-coded model IDs / special endpoints | Hosted assets | Abstraction |
|---|---|---|---|---|
| **ImageStudio.jsx** | `uploadFile` (L219,1166), `generateI2I` (L1406), `generateImage` (L1424) | catalog-driven (t2i/i2i); provider tab fallback `'muapi'/'Muapi'` (L735-736,747,1695) | `PROVIDER_LOGOS` 25× cdn.muapi.ai/models/*.png incl. `muapi.png` (L630-654); CloudFront deco L1576-1597; downloads named `muapi-{id}.jpg` (L1498,1536) | **G** |
| **VideoStudio.jsx** | `uploadFile` (L1598,1873), `processV2V` (L2200), `generateI2V` (L2238), `generateVideo` (L2288) | catalog + family registries (Seedance/Veo/Kling/grouped); **continuation via `params.request_id = requestSource.requestId`** (L2156,2277,2383-2404; Veo source picker L1090,2902); `genId = res.request_id` (L2203,2241,2291) | `PROVIDER_LOGOS` 25× cdn.muapi.ai (L407-431); provider fallback `'muapi'` (L527-528,541,2956); CloudFront deco L2633-2654 | **G**, but extend/continuation is **H** (muapi request_id state) unless reworked to pass a video URL |
| **AudioStudio.jsx** | `uploadFile` (L105,653,660), `generateAudio` (L711) passes all params through | catalog (suno-*, minimax speech/voice-clone, elevenlabs, gemini tts, lyria, fish, mmaudio) | – | **G** (Suno persona/voice-clone IDs are provider-side state) |
| **LipSyncStudio.jsx** | `uploadFile` (L661,688,719), `processLipSync` (L846) → `{audio_url,image_url\|video_url,prompt?,resolution,seed}` | catalog (15 models) | CloudFront deco L1044-1065 | **G** |
| **CinemaStudio.jsx** | `uploadFile` (L592), `generateImage` (L717) | `"nano-banana-pro"` / `"nano-banana-pro-edit"` (L718,751); passes `images_list` to generateImage | CloudFront deco L1050-1071 | **G** |
| **MarketingStudio.jsx** | `uploadFile` (L413,420), `generateMarketingStudioAd` (L435) | special: endpoint `sd-2-vip-omni-reference-1080p` when 1080p, else `seedance-2-vip-omni-reference` (`muapi.js:200-210`); body `{prompt,aspect_ratio,duration,images_list,video_files}` | 8 avatar presets with muapi UUID ids + CloudFront `web-app/*.webp` (L96-103); 6 template videos `web-app/*.mp4` (L106-111); deco L570-591 | **G+** (one Seedance omni-reference call; needs a provider that offers it) |
| **ClippingStudio.jsx** | `uploadFile` (L354,432), `runClipping` (L512) → endpoint **`ai-clipping`** `{video_url,num_highlights,aspect_ratio,return_coordinates_only}` | `ai-clipping` (not in catalog); parses `outputs[]` + `output.coordinates\|coordinates\|output.timings\|timings\|output.clips` (L515-522); fakes coordinates if empty (L528-535) | CloudFront deco L596-617 | **H** (muapi pipeline: highlight detection, cut and reframe) |
| **VibeMotionStudio.jsx** | `runMotionGraphics` (L172) → **`motion-graphics`** `{prompt,aspect_ratio,duration_seconds}`; `runMotionGraphicsEdit` (L164) → **`motion-graphics-edit`** `{request_id,edit_prompt,...}` | not in catalog; result `output.video\|url\|outputs[0]` (L180); edit relies on server-side `requestId` (L181-257) | CloudFront deco L474-495 | **H** (LLM→render pipeline; edit needs muapi state) |
| **RecastStudio.jsx** | `uploadFile` (L687,721), `processRecast` (L811) → `{[videoField]:video_url,[imageField]:image_url,prompt?,aspect_ratio,character_orientation}` | recast models map to muapi endpoints `kling-v3.0-pro-motion-control`, `runway-act-two-i2v`, `wan2.2-animate`; special-case `kling-v3.0-pro-recast` (L807,1133) | CloudFront deco L968-989 | **G** |
| **MotionControlStudio.jsx** | `uploadFile` (L740,773), `processMotionControl` (L835) | default `seedance-2.5-motion-control` (L570,872); model-specific clamps in `muapi.js:295-340` (durations 4-15/4-30, image caps 9/30, quality, high_bitrate) and **hidden injected prompt prefix** (`muapi.js:298-300`) | CloudFront deco L1009-1018 | **G+** |
| **LayersStudio.jsx** | `uploadFile` (L285), `decomposeLayers` (L752,844) → endpoint **`bytedance-seedream-5.0-pro-layer`** `{image_url,prompt,resolution,output_format}` returns multiple images (`images\|output.images\|outputs\|[url]`); `upscaleImage` (L902) → `topaz-image-upscale`{upscale_factor} / `seedvr2-image-upscale`{resolution} / `ai-image-upscaler`→`ai-image-upscale`; `removeBackground` (L961) → **`ai-background-remover`**; `expandImage` (L1017) → **`ai-image-extension`**; `generateI2I` with `"nano-banana-pro-edit"` for enhancer/edit-text/other tools (L1195-1216) | `UPSCALE_MODELS` "from schema_data.json" (L18-34); **hard-coded price** `0.02`/`1.0` (L4009); `<bbox>` prompt syntax for regional edit (L740-746) | 8× cdn.muapi.ai/assets (sample image L39,1156,2230; 5 sample layers L42-46) | **G+** (multi-image output); `ai-*` are muapi-native tools that need substitutes (e.g. fal bria/rembg, outpaint) |
| **DrawModal.jsx** | `uploadFile` (L1018; canvas blob), `generateI2I` (L1028) | `nano-banana-pro-edit` / `nano-banana-2-edit` (L15,1037,1691-1738) | CloudFront deco L1140 | **G** |
| **AiInfluencerStudio.jsx** | `generateImage` (L418) unless the host passes `onGenerate` (L343,415) | `INFLUENCER_MODEL = "nano-banana-pro"` (L17) | `const CDN = "https://cdn.muapi.ai/influencer"` (L14), **128** `${CDN}/…webp` option images | **G** (assets must be rehosted) |
| **AppsStudio.jsx** | `getAppInterests` (L143) → `GET /app/interests`; `registerAppInterest` (L154) → `POST /app/interest` | 5 template apps (SamurAIGPT repos + vercel demos) L16-67; 63 "coming soon" dummy apps L69+ | 68× cdn.muapi.ai/apps|data thumbnails | **H** (interest registry); otherwise static marketing |
| **McpCliStudio.jsx** | none | `muapi-cli`, `muapi auth login`, `muapi-mcp-server` → `https://api.muapi.ai/mcp`, `SamurAIGPT/muapi-skills` (L17-54). **Not mounted** in StandaloneShell (exported only) | – | static docs; rewrite or remove |
| **WorkflowStudio.jsx** (+ **WorkflowUI.jsx**) | `getTemplateWorkflows`/`getUserWorkflows`/`getPublishedWorkflows` (L396-400), `getWorkflowInputs`/`getAllNodeSchemas`/`getWorkflowData` (L211-213), `createWorkflow` (L273), `deleteWorkflow` (L300), `updateWorkflowName` (L316), `executeWorkflow` (L432) | sessionStorage `wl_workflow_token` hand-off (L275-276), `fromWorkflowBuilder` flag; WorkflowUI renders `WorkflowBuilder` from **workflow-builder** submodule with `costType="dollars"` (WorkflowUI.jsx:4,25-35) | – | **H** (hosted workflow engine: defs, templates, publishing, node schemas, executor) |
| **AgentStudio.jsx** | `getTemplateAgents`/`getUserAgents`/`getUserConversations` (L341-347), `getAgentBySlug`/`getAgentConversation` (L248,252), `sendAgentChatMessage`+`pollAgentChatResult` (L280-284), `createAgent` (L313) | routing comments reference muapi.ai + `docs/whitelabel_plan.md` (missing) (L177-181) | – | **H** (hosted agents, skills, conversations). A replacement could be an OpenRouter/OpenAI chat + local persistence |
| **DesignAgentStudio.jsx** | `getUserBalance` (L47) → `{email,balance}` | renders `CreativeCanvas` from **design-agent** submodule (L4,63-74); writes `localStorage.token = apiKey` (L27) and `sessionStorage.fromDesignAgent`; `creditConversionRate={200}` (L66) | – | **H** (submodule talks to `/api/v1/creative-agent/*`) |
| MobileGenerationActions, ModelParameterControls, VideoModelControls, prompt/* | none | – | – | n/a |

Supporting studio files:
- `packages/studio/src/index.js:20`: `export * from './muapi'` (the whole muapi client is public package API, also consumed by the hosted muapi.ai shell per README:559).
- `packages/studio/package.json:4`: "studio components for Muapi". Deps on `workflow-builder`, `ai-agent`, `design-agent` file: submodules (L50-52).
- `packages/studio/src/persistKey.js:1-15`: localStorage keys scoped by a hash of the "white-label session token or BYOK API key". The concept is provider-neutral; only the comments are muapi-specific. Base keys are `hg_*_studio_persistent` (e.g. `ImageStudio.jsx:982`, `VideoStudio.jsx:786`).
- Host-integration props (`historyItems`, `onGenerate`, …) exist for the hosted shell to inject server history (`AudioStudio.jsx:538,579`, `CinemaStudio.jsx:538,689`, `LipSyncStudio.jsx:490`, `AiInfluencerStudio.jsx:343`). The standalone app uses localStorage only, which is why `getHistory`/`deleteMedia` go unused.

### B2. Vanilla Vite/Electron studios (`src/components/`, client `src/lib/muapi.js`)

| File | Calls | Other coupling | Abstraction |
|---|---|---|---|
| `ImageStudio.js` | `muapi.uploadFile` (L118), `muapi.generateI2I` (L1254), `muapi.generateImage` (L1267), `muapi.pollForResult` resume (L1081) | `localStorage.muapi_key` (L1068,1223), `muapi_history` (L1009,1054), `muapi-*.jpg` downloads (L1035,1102), refund notice (L15,1293); local sd.cpp path via `localAI` | **G** |
| `VideoStudio.js` | `uploadFile` (L193,207,329), `processV2V` (L1329), `generateI2V` (L1365), `generateVideo` (L1408), `pollForResult` (L1146) | `muapi_key` (L321,1133,1266); comments "Cloud (Muapi)" (L42,75,192,1256); Wan2GP local branch | **G** |
| `LipSyncStudio.js` | `uploadFile` (L176,244), `processLipSync` (L707), `pollForResult` (L602) | `muapi_key` (L172,240,591,671) | **G** |
| `CinemaStudio.js` | `generateImage` (L560) | `muapi_key` (L541) | **G** |
| `UploadPicker.js` | default `muapi.uploadFile` (L20) | `muapi_key` gate (L327); comments L17-19 | **G** |
| `AuthModal.js` | – | input `#muapi-key-input` (L31,52), link `https://muapi.ai/access-keys` (L42), stores `muapi_key` (L74) | UX |
| `SettingsModal.js` | – | `t('settings.muapiKeyLabel')` (L55), reads/writes `muapi_key` (L59,106) | UX |
| `McpCliStudio.js` | – | muapi-cli/mcp/skills docs (L34-88,135) | docs |
| `AgentStudio.js`, `WorkflowStudio.js` | – | "web only" placeholders | none |
| `src/lib/muapi.js` | `MuapiClient`: `getKey` (L10-14, `window.__MUAPI_KEY__ \|\| localStorage.muapi_key`), `generateImage` L28, `pollForResult` L124, `generateVideo` L134, `generateI2I` L202, `generateI2V` L272, `uploadFile` L357, `processV2V` L395, `processLipSync` L457, unused `getDimensionsFromAR` L506 | duplicated submit/poll/normalise logic; `[Muapi]` console logs throughout | replace with a shared provider client |
| `src/lib/pendingJobs.js:1` | `muapi_pending_jobs` localStorage (resume by muapi `requestId`) | | rename; store provider + job handle |
| `src/lib/uploadHistory.js:1` | `muapi_uploads` localStorage (keeps hosted URLs, which expire or are owned by the provider) | | rename |
| `src/lib/i18n.js` | muapi strings L94-106 (en), L318-330 (zh) | | branding |
| `src/lib/models.js:5` | re-exports `studio/src/models.js` (shared catalog) | | |
| `electron/main.js`, `electron/preload.js` | **no muapi code**. The window open handler sends external links to the browser (L56-59); `window.localAI` exposes sd.cpp and Wan2GP (preload L3-44) | Packaged renderer is file://, so cloud calls go direct to `https://api.muapi.ai` (needs CORS). A new provider probably needs an IPC/main-process proxy so keys stay out of the renderer and CORS is avoided | |

---

## C. Model catalog coupling

**Source-of-truth claims**
- `packages/studio/src/models.js:3` says "Synced from the canonical Muapi schema_data.json catalog."
- `models.js:10,96,114,134` say "Verified against https://api.muapi.ai/openapi.json on 2026-09-09" (Seedance 2.5, Wan, Happy Horse, Kling).
- `models.js:5888,5915`: Hailuo duration is "MuAPI fixes…"; source link is muapi.ai/zh/playground.
- `seedanceModels.js:153-155`: "MuAPI's family tables specify 720p…" with links to muapi.ai/seedance-2.5 and /seedance-2.
- `LayersStudio.jsx:18`: "Upscale Models Definition from schema_data.json".
- `models_dump.json` (root, 70 KB) is an older catalog dump (`provider:"muapi"`, MUAPI APP example prompt, 2 CloudFront URLs).
- `scripts/test_minimax_provider.js:10-150` is a live smoke test against `api.muapi.ai` (env `MUAPI_KEY`).

**Size** (counted by importing `models.js`): **587 models**. Exports: `t2iModels` 84 (L230), `t2vModels` 111 (L4458), `i2iModels` 88 (L10294), `i2vModels` 184 (L14805), `v2vModels` 75 (L27523), `lipsyncModels` 15 (L31467), `recastModels` 3 (L31695), `motionControlModels` 4 (L31746), `audioModels` 23 (L31842). The file is 35,146 lines.

**Model-level fields** (key: count). These are muapi conventions:
- `id` 587. The id is the muapi route slug; muapi's naming scheme is embedded in ids such as `kling-v3.0-pro-image-to-video`, `seedance-2-vip-…-1080p`, `sd-2-vip-*`.
- `endpoint` 505. This is the muapi path segment after `/api/v1/`. It differs from `id` for 49 models, e.g. `flux-dev→flux-dev-image`, `hidream-i1-fast→hidream_i1_fast_image`, `gpt-image-2→gpt-image-2-text-to-image`, `seedance-2-vip-*→sd-2-vip-*`, `ai-video-effects|motion-controls|vfx→generate_wan_ai_effects`, `mmaudio-v2-*→mmaudio-v2/video-to-video`, `latent-sync→latentsync-video`, recast→`kling-v3.0-pro-motion-control|runway-act-two-i2v|wan2.2-animate`. 82 models (mostly t2i/t2v) have no endpoint, so the id is used as the endpoint.
- `inputs` 557. muapi schema format per input: `{type:"string"|"int"|"integer"|"number"|"boolean"|"array", title, name, description, default, enum, minValue, maxValue, step, items, maxItems, examples, field:"image"|"audio"|"video"|…, isEdit, configurable}`.
- `provider`/`provider_name` 542/541. 33 models use `provider:"muapi"` with `provider_name` "Muapi", "MuapiApp" or "Fal" (`models.js:543-544,6132-6133,10303-10498,10919,11387,11528,12073,12189,14941,15062,15145,15910,16365`). These are the muapi-native `ai-*` tools: ai-anime-generator, ovi-*, ai-image-upscaler, ai-image-face-swap, ai-dress-change, ai-background-remover, ai-image-extension, ai-product-shot, ai-skin-enhancer, ai-color-photo, ai-product-photography, ai-ghibli-style, ai-object-eraser, image-effects, seedvr2-image-upscale, image-passthrough, "Api Node", add-image-watermark, ai-video-effects, motion-controls, vfx, video-effects, video-watermark-remover, ai-video-face-swap, ai-dance-effects, ai-video-upscaler(-pro), heygen-video-translate, remix-video, add-video-watermark, ai-captions, video-background-remover. 45 models have no provider. `modelFamilies.js:409-410` defaults to `"muapi"/"Muapi"`.
- Media-field routing: `imageField` 320, `lastImageField` 51, `videoField` 80, `audioField` 15, `maxImages` 66, `maxAudios` 12. Value distribution:
  - i2i: images_list 49, image_url 34, model_image_url 1, person_image_url 1.
  - i2v: images_list 97, image_url 82, image_urls 2, reference_images 2, first_frame_url 1; last fields last_image 27, images_list 7, end_image_url 3, last_image_url 1, last_frame_url 1.
  - v2v: video_url 74, video_urls 1; images_list 23, image_url 9; audios_list 12, audio_url 3.
- UI and behaviour flags: `hasPrompt` 353, `promptRequired` 235, `imageOptional` 55, `required` 59, `fixedParameters` 41 (e.g. `{resolution:"1080p"}` where resolution is encoded in the endpoint, `models.js:4824,4972`), `requiresRequestId` 7, `operation` 28, `category` 15, `family` 390, `aspectRatioMode` 24, `cost` 2 (`models.js:10348,10360`, hard-coded USD).
- Thumbnails/examples: `image_url` 38 and `example_url` 37 at model level (preview media).

**Input naming conventions** (top input keys): `prompt`, `aspect_ratio` (enum of "W:H" strings, plus "adaptive"/"auto"), `duration` (int seconds), `resolution` ("480p/720p/1080p/4K"), `high_bitrate`, `seed` (-1 = random), `generate_audio`, `images_list`, `image_url`, `videos_list`, `video_files`, `audios_list`, `audio_files`, `last_image`, `request_id`, `num_images`, `output_format`, `quality`, `mode`, `name`, `omni_reference_task_type`, `width`/`height` (`isEdit`). These differ from fal (`image_urls`, `image_size`, `num_inference_steps`), Replicate (`input.image`), OpenAI (`size`, `n`) and so on, so a per-provider input mapper is required.

**Helper modules that encode muapi route semantics**
- `seedanceModels.js` (310 lines): variant registry builds endpoint names from facets like `seedance-2-${prefix}${stem}${-fast}${-resolution}` (L89-95). `getSeedanceEndpointResolution` (L156-165). `seedanceTools` maps extend and watermark-remover tool ids (L169-176).
- `klingModels.js:26-56`, `veoModels.js`, `minimaxModels.js` (L27 "endpoints are selected by resolution"), `alibabaModels.js`, `happyHorseModels.js`, `ltxModels.js`, `pixverseModels.js`, `soraModels.js`, `viduModels.js`, `xaiModels.js`, `groupedVideoModels.js`, `groupedVideoRegistry.js` all register muapi route ids as variants of a family (resolution/speed/profile is chosen by picking a different muapi endpoint).
- `*Parameters.js` (+ `nativeVideoParameters.js`, `videoModelParameters.js`, `groupedVideoParameters.js`) are UI parameter derivation over the muapi input schema format. They're generic once the schema format is kept.
- `modelFamilies.js` (880 lines): groups models into families. **Unions families by shared `endpoint`** (~L390-397) and defaults the provider to muapi (L409-410).
- `modelCapabilities.js`: `MEDIA_CONFIG`, `getMediaCapability`, `buildReferenceParams` (emits `image_url`/`last_image`/`images_list`/`video_url`/`videos_list`/`audio_url`/`audios_list`, L103-140), `mapReferenceParams` (L164-219), `recordGenerationSource` (request_id, L221-226).
- `imageInputContracts.js`: per-model contracts keyed `"t2i:flux-pulid"`, `"i2i:ai-dress-change"` (aux `garment_image_url`), `ai-product-shot` (`scene_description`), `ai-object-eraser`/`gpt4o-edit` (`mask_image_url`) (L24-60). These use muapi ids and field names.
- `modelParameters.js:3-15` `COMMON_INPUT_KEYS` includes `api_key` and `request_id`.
- `videoToolCapabilities.js` (753 lines): `VIDEO_TOOL_OVERRIDES` keyed by muapi ids (L230-447), payload defaults, `buildVideoToolPayload` (L660, default field `video_url`), `CONTINUATION_TARGETS` (L505-524) and `getCompatibleContinuationSources` (needs a muapi `requestId` per history entry, L681-753), HeyGen language list (L1-180).
- `videoWorkflows.js` (959 lines): `requiresRequestId` gating (L119,131,171,370) and workflow media slots mapped to muapi fields.
- `imageSizing.js`: `buildImageSizePayload` emits width/height or aspect_ratio based on the model's inputs. Generic.

**Hosted asset counts**
- **cdn.muapi.ai literal URLs: 214** across 6 code files (+1 in a middleware comment):
  - `models.js` 87: 28 `example_url`, 28 `image_url` (thumbnails), 31 in `inputs.*.examples`. The first is at L3646 (`…/outputs/generated/example.safetensors`); thumbnails start at L4166.
  - `AppsStudio.jsx` 68.
  - `ImageStudio.jsx` 25 and `VideoStudio.jsx` 25 (duplicate provider-logo maps).
  - `LayersStudio.jsx` 8.
  - `AiInfluencerStudio.jsx` 1 constant plus **128 templated `${CDN}/…` refs**.
  - That makes **about 342 cdn.muapi.ai asset refs** in total.
- **d3adwkbyhxyrtq.cloudfront.net** (probably muapi's legacy CDN): **194**. `models.js` 143 (9 example_url, 10 image_url, 124 examples); `MarketingStudio.jsx` 18; 4 each in Image/Video/Clipping/Recast/Cinema/VibeMotion/LipSync/MotionControl; DrawModal 1; models_dump.json 2.
- `static.aiquickdraw.com` 4 (models.js examples L13234,13931,14685,14763; one of them is the same file id as the Layers sample).
- Branded example prompts in models.js mention "MUAPI APP", "muapi", "MuAPI", "Muapiapp" at L863, 15163, 15196, 16225, 16475, 32838, 33519. Voice-id help text links muapi.ai/playground at L33342 and 34001. Descriptions say "through the Muapi API" at L10033 and 10114.

---

## D. Auth / key UX coupling

| Item | Location |
|---|---|
| localStorage key `muapi_key` | `components/StandaloneShell.js:269,579-599`; `app/agents/[agent_id]/AgentChatClient.js:8,31`; `app/agents/create/AgentCreateClient.js:8,16`; `app/agents/edit/[id]/AgentEditClient.js:8,16`; vanilla `src/lib/muapi.js:11`, `AuthModal.js:74`, `SettingsModal.js:59,106`, `ImageStudio.js:1068,1223`, `VideoStudio.js:321,1133,1266`, `LipSyncStudio.js:172,240,591,671`, `CinemaStudio.js:541`, `UploadPicker.js:327` |
| Cookie `muapi_key` (non-HttpOnly, 1 year, SameSite=Lax) | set/cleared in `StandaloneShell.js:584,592,599`; read server-side in `app/agents/[agent_id]/page.js:73`, `[conversation_id]/page.js:94`, `create/page.js:22`, `edit/[id]/page.js:23`; read client-side via regex `muapi_key=` in the 3 Agent*Client.js files (L33/L18); `app/agents/layout.js:4` comment |
| Global override `window.__MUAPI_KEY__` | `src/lib/muapi.js:11` |
| Other keys: `localStorage.token = apiKey` | `DesignAgentStudio.jsx:27`; `sessionStorage.wl_workflow_token` at `WorkflowStudio.jsx:275-276` (white-label hand-off); `fromWorkflowBuilder`/`fromDesignAgent` flags at `WorkflowUI.jsx:20`, `DesignAgentStudio.jsx:26`, `StandaloneShell.js:570-575` |
| Axios interceptor injects `x-api-key` into relative URLs and `/api/app\|workflow\|agents\|api\|v1` (for submodule libs) | `StandaloneShell.js:604-625`; duplicated in `AgentChatClient.js:40-50`, `AgentCreateClient.js:25-33`, `AgentEditClient.js:25-33` |
| ApiKeyModal (Next): single key; links `https://muapi.ai/access-keys` ×2 with "Muapi.ai" link text | `components/ApiKeyModal.js:48,79`; copy `messages/en|zh/common.json` `apiKeyModal` (en L57-68: "Enter your [Muapi.ai] API key…", "Need a key? Get one free →") |
| Shell gate | `StandaloneShell.js:678-679` renders ApiKeyModal when no key (blocks the whole app) |
| Settings modal: shows `apiKey.slice(0,8)` and "Change Key" | `StandaloneShell.js:1166-1210`; copy `common.json` `settingsModal` L40-46 |
| Balance display: `$` + `balance`, polled every 30 s, refreshed after errors | `StandaloneShell.js:347,450-457,475,627-632,799-804` |
| Balance passed as user identity to the agents library | `AgentChatClient.js:59-71`, `AgentCreateClient.js:42-54`, `AgentEditClient.js:42-54` (`useUser` → `{username: email-prefix, balance}`), `AgentChatClient.js:79` `usedIn="muapiapp"`; DesignAgent `creditConversionRate={200}` |
| Vanilla AuthModal/SettingsModal copy | `src/lib/i18n.js:94-106` (en: "Muapi API Key", "never sent anywhere except api.muapi.ai", "Muapi API Key Required", "Create or copy a Muapi access key →") and `:318-330` (zh) |
| White-label / session-token mentions | `muapi.js:956-957`; `persistKey.js:1-9`; `DesignAgentStudio.jsx:33-35` (`/api/whitelabel/balance`, BYOK-only balance); `AgentStudio.jsx:177-181`; `WorkflowStudio.jsx:154,275`; README:22-45 |
| Auth error UX | `formatError.js:29-34` ("top up your wallet", "account session or API key"); `muapi:auth-required` event (`muapi.js:26`) |
| Layers copy "Please enter your API Key…" | `packages/studio/src/messages/en/layersStudio.json:140,146,149,170` (generic wording) |

Needed for multi-provider: a provider registry with per-provider keys (`fal_key`, `openai_key`, `openrouter_key`, `replicate_token`, `google_key`). The shell gate should require at least one configured provider. Balance becomes optional per provider (fal and Replicate have no simple balance API; OpenRouter has `/credits`).

---

## E. Server / proxy coupling

| Item | Behaviour | Ref |
|---|---|---|
| `middleware.js` | `isMuApi` for `/api/workflow`, `/api/app`, `/api/v1` (L27-30). `/api/v1/*` (except creative-agent, get_upload_url, upload-binary) is **rewritten** to `https://api.muapi.ai` + path (L33-42). CSP `connect-src 'self' https://muapi.ai https://*.muapi.ai` (L13-19; img/media allow any https). Locale header comment cites "main muapi client" (L45-47). Matcher `/api/:path*` (L54-59) | `middleware.js` |
| `app/api/api/v1/[[...path]]/route.js` | GET/POST → `https://api.muapi.ai/api/v1/*`. **This is the path the studio client actually uses** (`/api` + `/api/v1/...`). The comment says it exists for the AiAgent library (L20-21). Forwards `x-api-key` only, strips cookies; always `response.json()`, so any non-JSON response breaks | L3,20-65 |
| `app/api/workflow/[[...path]]/route.js` | GET/POST/DELETE/PUT → `/workflow/*`; logs workflow ids and bodies (L40-41,66-77) | L3 |
| `app/api/agents/[[...path]]/route.js` | GET/POST/DELETE/PUT → `/agents/*` | L3,21-27 |
| `app/api/app/[[...path]]/route.js` | GET/POST/DELETE/PUT → `/app/*`; Bearer→x-api-key; `get_upload_file` alias; **S3 URL rewrite to `/api/upload-binary`** (L52-64) | L3 |
| `app/api/v1/creative-agent/[[...path]]/route.js` | GET/POST/PATCH/DELETE → `/api/v1/creative-agent/*` (design-agent) | L3 |
| `app/api/v1/get_upload_url/route.js` | GET → `/app/get_file_upload_url` (no rewrite) | L3,32 |
| `app/api/upload-binary/route.js`, `app/api/v1/upload-binary/route.js` | generic S3 POST proxy (requires a key header, validates the target); provider-neutral except it assumes an S3 presigned POST | `src/lib/uploadProxyTarget.js` |
| Server components calling muapi directly (`BASE_URL='https://api.muapi.ai'`) | `/agents/by-slug/{id}`, `/agents/{id}`, `/agents/by-slug/{id}/{conv}`, `/api/v1/account/balance` | `app/agents/[agent_id]/page.js:18-68`, `[conversation_id]/page.js:17-89`, `create/page.js:4-18`, `edit/[id]/page.js:4-18` |
| Routes rendering StandaloneShell | `app/studio/[[...slug]]/page.js`, `app/zh/studio/[[...slug]]/page.js`, `app/workflow/[id]/page.js`, `app/workflow/[id]/[tab]/page.js`; `app/page.js`, `app/assistant/page.js` and `app/zh/*` redirect to `/studio` | |
| `vite.config.mjs:6-12` | dev proxy `/api` → `https://api.muapi.ai` (changeOrigin, secure:false) | |
| `next.config.mjs:3` | `transpilePackages: ['studio','ai-agent','workflow-builder','design-agent']` | |
| Dockerfile / docker-compose.yml | no muapi config or env; Dockerfile copies the submodule package.json files (L7-9) and runs `build:packages` (L16), so the build fails without the submodules | `Dockerfile:7-16`, `docker-compose.yml` |
| Root `package.json` | workspaces include 3 submodule packages (L8-13); deps `ai-agent`, `workflow-builder` file: links (L111,117); `setup` script inits submodules (L26); description "Open-source alternative to HF AI" | |

**Submodule touchpoints (where the app imports them)**
- `packages/studio/src/components/WorkflowUI.jsx:4` imports `WorkflowBuilder` from `workflow-builder`; `WorkflowStudio.jsx:17` loads it with `next/dynamic`.
- `packages/studio/src/components/DesignAgentStudio.jsx:4` imports `CreativeCanvas` from `design-agent`; `StandaloneShell.js:8-11` loads it dynamically.
- `app/agents/[agent_id]/AgentChatClient.js:3-4` imports `AiAgent` and the css from `ai-agent`; `app/agents/create/AgentCreateClient.js:3-4` imports `CreateAgentPage`; `app/agents/edit/[id]/AgentEditClient.js:3-4` imports `EditAgentPage`.
- Proxy routes that exist only for submodules: `/api/api/v1/*` (AiAgent; the studio uses it too), `/api/v1/*` middleware rewrite, `/api/app/get_file_upload_url` + `/api/upload-binary`, `/api/v1/get_upload_url` + `/api/v1/upload-binary`, `/api/v1/creative-agent/*`, `/api/agents/*`, `/api/workflow/*`.
- Config: `package.json` workspaces/deps, `packages/studio/package.json:50-52`, `next.config.mjs:3`, `Dockerfile:7-9`.

---

## F. Branding / docs

| Item | Location |
|---|---|
| README "Powered by MuAPI" badge | `README.md:3` |
| README "Turn This Into Your Own Product — White Label & Resell" (MuAPI White Label, $49/mo, pricing table) | `README.md:22-47` |
| README API examples "through Muapi" | `README.md:49-55` (L51,55) |
| README Related Projects: muapi.ai alternatives, muapi-skills | `README.md:62,68` |
| README "Try it Online" hosted version on muapi.ai | `README.md:71-79` (L73) |
| README intro "Powered by Muapi.ai" | `README.md:168` |
| README features "never sent to any server except Muapi"; "callable via the Muapi API" | `README.md:320,436` |
| README Quick Start prerequisite (Muapi access key), first-run key prompt | `README.md:468,497` |
| README architecture `muapi.js` / BYOK; studio package consumed by hosted muapi.ai | `README.md:540-559` |
| README "🔌 API Integration" (submit/poll, x-api-key, vite proxy, upload_file) | `README.md:561-572` |
| README tech stack / comparison / credits | `README.md:595,609,621` |
| `project_knowledge.md` (vanilla architecture: muapi.js engine, x-api-key, vite proxy, `muapi_history`) | L10,26-30,50-66,85-93 |
| Missing referenced docs | `docs/whitelabel_plan.md` (AgentStudio.jsx:181), `docs/localization.md` (lib/locales.js:4, middleware.js:47); `docs/` holds only assets |
| Next i18n `messages/en|zh/common.json` | `shell.vadooPromo` (L37), `apiKeyModal.*` (L57-68), `settingsModal.*` (L40-46) |
| Vadoo promo banner (unrelated third-party ad, links `https://vadoo.tv`, dismiss stored in `vadoo_banner_dismissed`) | `StandaloneShell.js:351-353,707-725` |
| Studio i18n `appsStudio.json` (en/zh) | "muapi handles the AI infrastructure" (L6), "add your muapi key" (L12), "Muapi Ecosystem — More templates coming soon" (L29) |
| `mcpCliStudio.json` (en/zh) | generic wording; the code blocks in McpCliStudio.jsx are all muapi-cli/mcp/skills |
| Vanilla i18n | `src/lib/i18n.js:94-106,318-330` |
| AppsStudio template apps (SamurAIGPT repos, Vercel demos) + 63 placeholder apps | `AppsStudio.jsx:16-67,69-…` |
| Package description "studio components for Muapi" | `packages/studio/package.json:4` |
| `lib/locales.js:4` comment "main muapi client" | |
| `[Muapi]` console logs | `src/lib/muapi.js` throughout; "MuAPI Proxy error" `muapi.js:873` |
| Download filename prefix `muapi-` | `ImageStudio.jsx:1498,1536`; `src/components/ImageStudio.js:1035,1102` |
| Root `models_dump.json` and `scripts/test_minimax_provider.js` (muapi-specific dev artifacts) | |

---

## G. Removal checklist (ordered)

### Phase 1: provider abstraction (core)
- [ ] Define a `Provider` interface in `packages/studio/src/providers/`: `submit(model, inputs) → handle`, `poll(handle) → {status, outputs[], error}`, `generate()` (submit+poll), `uploadFile(file, onProgress) → url`, optional `getBalance()`, `estimateCost()`, `capabilities`. Implementations: fal (queue API + fal storage upload), Replicate (predictions + file upload), OpenAI (images, sora), Google (Gemini/Imagen/Veo), OpenRouter (chat/agents), plus the existing local `window.localAI` (sd.cpp, Wan2GP).
- [ ] Replace `packages/studio/src/muapi.js` (1045 lines) with a provider-routed client that keeps the exported function names (`generateImage`, `generateI2I`, `generateVideo`, `generateI2V`, `processV2V`, `processRecast`, `processMotionControl`, `processLipSync`, `generateAudio`, `uploadFile`, `decomposeLayers`, `upscaleImage`, `removeBackground`, `expandImage`, `generateMarketingStudioAd`) so the studios change minimally. Rename it and update `index.js:20` (`export * from './muapi'`) and the 17 studio import sites.
- [ ] Generalise `utils/generationLifecycle.js` (hard-coded `/api/v1/predictions/{id}/result`, `x-api-key`, muapi status set, `cost.refunded`/`amount_credits`) into a per-provider status mapper.
- [ ] Replace `src/lib/muapi.js` (vanilla `MuapiClient`, 520 lines, duplicated logic) with the same shared provider client; keep `getKey` but make it per provider.
- [ ] Remove or rework `formatError.js:29-34` (credits/wallet wording).
- [ ] Remove the `muapi:auth-required` event (`muapi.js:23-27`) or rename it to a generic `provider:auth-required`.
- [ ] Remove unused muapi-only exports: `getHistory`, `deleteMedia`, `estimateV2VCost`, `calculateDynamicCost`, `handleProxyRequest`, `handleServerSideProxy`, `getNodeSchemas`, `runSingleNode`, `deleteNodeRun`, `getNodeStatus`, `PROXY_WF_BASE`.

### Phase 2: model catalog
- [ ] Decide on a catalog strategy: keep the muapi-style schema format (`inputs{type,title,name,enum,minValue…}`) as the internal UI schema, but add per-provider `routes: { fal: {endpoint, mapInputs}, replicate: {...} }`, or rebuild the catalog per provider. All 587 entries are keyed by muapi route slugs; 505 have `endpoint` (49 differ from `id`).
- [ ] Write input mappers for the muapi field conventions (`images_list`, `image_url`, `last_image`, `videos_list`, `video_files`, `audios_list`, `aspect_ratio` strings, `resolution` "720p", `duration` ints, `high_bitrate`, `generate_audio`, seed -1) per provider.
- [ ] Rework variant registries that pick a muapi endpoint by resolution/speed/profile: `seedanceModels.js:89-95,156-176`, `klingModels.js:26-56`, `minimaxModels.js:27`, veo/alibaba/happyHorse/ltx/pixverse/sora/vidu/xai, `groupedVideo*`. Also `modelFamilies.js` endpoint-based family union (~L390-397) and the provider default `"muapi"` (L409-410).
- [ ] Drop or replace the 33 `provider:"muapi"` native tools (ai-* image/video effects, face swap, dress change, product shot, watermark, captions, heygen translate, ovi…) and their contracts in `imageInputContracts.js:24-60` and `videoToolCapabilities.js:230-447`.
- [ ] Rework or drop request_id continuation: `requiresRequestId` models (7), `CONTINUATION_TARGETS` (`videoToolCapabilities.js:505-524,681-753`), `videoWorkflows.js:119,131,171,370`, `modelCapabilities.js:221`, `VideoStudio.jsx:1090,2156,2277,2383-2404,2902`; Seedance `@character:<request_id>` prompt syntax; `modelParameters.js:12` (`request_id`, `api_key` common keys).
- [ ] Re-host or remove catalog media: 87 cdn.muapi.ai + 143 CloudFront + 4 aiquickdraw URLs in `models.js` (`image_url`/`example_url` thumbnails and `inputs.*.examples`).
- [ ] Strip muapi-branded example prompts and descriptions (`models.js:863,10033,10114,15163,15196,16225,16475,32838,33342,33519,34001`) and the provenance comments (`models.js:3,10,96,114,134,5888,5915`; `seedanceModels.js:153-155`).
- [ ] Delete `models_dump.json`; delete or replace `scripts/test_minimax_provider.js`.

### Phase 3: studios
- [ ] Image/Video/Audio/LipSync/Cinema/Recast/DrawModal/AiInfluencer: only need the provider client. Replace the hard-coded `nano-banana-pro(-edit)`/`nano-banana-2-edit` ids (Cinema L718,751; Layers L1196-1213; DrawModal L15,1037,1691-1738; AiInfluencer L17) with catalog lookups that resolve to a provider route (e.g. fal `fal-ai/nano-banana-pro`, Google Gemini image).
- [ ] MotionControl: move the `muapi.js:295-340` clamps and hidden prompt into catalog metadata; pick a provider offering Seedance/Kling motion control.
- [ ] Marketing: replace the `generateMarketingStudioAd` endpoint switch (`muapi.js:200-210`) with a catalog model; re-host the avatar and template media (`MarketingStudio.jsx:96-111`).
- [ ] Layers: `decomposeLayers` (`bytedance-seedream-5.0-pro-layer`, multi-image output) needs a provider or must be removed. Upscale (`topaz-image-upscale`, `seedvr2-image-upscale`, `ai-image-upscale`), `ai-background-remover` and `ai-image-extension` need substitutes. Remove the hard-coded price (`LayersStudio.jsx:4009`) and re-host the sample images (L39-46,1156,2230).
- [ ] Clipping (`ai-clipping`) and VibeMotion (`motion-graphics`, `motion-graphics-edit`) are muapi-hosted pipelines. Either drop them, mark them "unavailable", or reimplement them (LLM + ffmpeg/Remotion).
- [ ] Workflow, Agent and DesignAgent studios plus the `/agents/*` pages: they depend on hosted muapi products (workflow engine, agents, creative-agent) and the submodules. Hide them behind a feature flag or remove them; any replacement (e.g. OpenRouter chat agents with local storage) is a new build.
- [ ] Apps: remove `registerAppInterest`/`getAppInterests` and the "request access" flow; re-host or drop the 68 thumbnails; decide whether to keep the SamurAIGPT template list.
- [ ] McpCli (`McpCliStudio.jsx`, `src/components/McpCliStudio.js`): remove or rewrite (all muapi-cli/mcp/skills).
- [ ] Replace the `PROVIDER_LOGOS` maps (25 cdn.muapi.ai URLs each, `ImageStudio.jsx:630-654`, `VideoStudio.jsx:407-431`) with local `/public` assets; remove the `'muapi'` provider fallbacks (`ImageStudio.jsx:735-747,1695`, `VideoStudio.jsx:527-541,2956`).
- [ ] Re-host or remove the CloudFront empty-state images (4 per studio in 9 studios + DrawModal).
- [ ] Re-host the 128 `${CDN}` influencer option images (`AiInfluencerStudio.jsx:14`).
- [ ] Rename the `muapi-` download prefixes (`ImageStudio.jsx:1498,1536`; `src/components/ImageStudio.js:1035,1102`).
- [ ] Vanilla: update `src/components/{Image,Video,LipSync,Cinema}Studio.js` and `UploadPicker.js` (calls listed in B2), and pending-job resume (`pollForResult` with muapi requestId) to use a provider handle.

### Phase 4: auth / key UX
- [ ] Replace the single `muapi_key` (localStorage + cookie + `window.__MUAPI_KEY__`) with per-provider key storage; rename `muapi_pending_jobs`, `muapi_uploads` and `muapi_history`.
- [ ] Remove the non-HttpOnly `muapi_key` cookie (`StandaloneShell.js:584,592,599`) and the server cookie reads in `app/agents/**/page.js`.
- [ ] Redesign ApiKeyModal (`components/ApiKeyModal.js:48,79`), the Settings modal (`StandaloneShell.js:1166-1210`), vanilla `AuthModal.js:31-74` and `SettingsModal.js:55-106` for multiple providers with links to each provider's key page.
- [ ] Make the balance pill optional or per provider (`StandaloneShell.js:347,450-457,475,627-632,799-804`).
- [ ] Remove the axios `x-api-key` interceptors (`StandaloneShell.js:604-625` + 3 agent clients) once the submodules are gone.
- [ ] Clean up white-label artifacts: `wl_workflow_token`, `localStorage.token`, the "session token" comments, `persistKey.js` comments.

### Phase 5: server / proxy
- [ ] Delete the muapi proxy routes: `app/api/api/v1`, `app/api/workflow`, `app/api/agents`, `app/api/app`, `app/api/v1/creative-agent`, `app/api/v1/get_upload_url`. Delete `app/api/upload-binary` + `app/api/v1/upload-binary` too, unless they are reused for a provider's presigned uploads (fal storage and Replicate files take direct uploads; `uploadProxyTarget.js` only allows S3 plus `UPLOAD_PROXY_ALLOWED_HOSTS`).
- [ ] Add a generic server proxy (e.g. `app/api/providers/[provider]/[[...path]]`) so keys can stay server-side or be forwarded without exposing them to CORS.
- [ ] `middleware.js`: remove the `/api/v1` rewrite (L27-43); update CSP `connect-src` (L19) to the chosen provider hosts (e.g. `queue.fal.run`, `rest.alpha.fal.ai`, `*.fal.media`, `api.replicate.com`, `replicate.delivery`, `api.openai.com`, `openrouter.ai`, `generativelanguage.googleapis.com`) or to `'self'` only if everything is proxied.
- [ ] `vite.config.mjs:6-12`: retarget or remove the `/api` proxy. For packaged Electron (file:// → direct calls), add a main-process IPC fetch proxy (pattern: `electron/preload.js` `localAI`) to avoid CORS and keep keys out of the renderer.
- [ ] Remove the submodules from `package.json` workspaces and deps, `packages/studio/package.json:50-52`, `next.config.mjs:3`, `Dockerfile:7-9,16`, `.gitmodules` (only if dropping Workflow/Agents/DesignAgent).

### Phase 6: branding / docs
- [ ] README: remove or rewrite L3 badge, L22-47 White Label, L49-55, L62, L68, L71-79 hosted version, L168, L320, L436, L468, L497, L540-559, L561-572 API Integration, L595, L609, L621.
- [ ] Rewrite `project_knowledge.md`.
- [ ] i18n: `messages/en|zh/common.json` (`apiKeyModal`, `vadooPromo`); `packages/studio/src/messages/en|zh/appsStudio.json` L6,12,29; `src/lib/i18n.js:94-106,318-330`.
- [ ] Remove the Vadoo banner (`StandaloneShell.js:351-353,707-725`, `common.json:37`).
- [ ] Clean up comments and package metadata: `packages/studio/package.json:4`, `lib/locales.js:4`, `middleware.js:13-16,45-47`, `muapi.js:13-15,482,514,841,873,956-957`, `AgentStudio.jsx:177-181`, `DesignAgentStudio.jsx:33-35`, the `[Muapi]` logs in the vanilla client, and the `AgentChatClient.js:79` `usedIn="muapiapp"` prop.
