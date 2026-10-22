# Provider landscape for replacing muapi.ai (researched 2026-10-21)

Research date: **2026-10-21**. How the evidence was gathered:
- **[live]** means I counted the catalog through the provider's public model-list API today.
- **[probe]** means I sent a CORS OPTIONS preflight from `Origin: https://example.com`.
- **(unverified)** means the claim comes only from a secondary source.

Most vendor docs carry no date. Where a page showed one, I quote it.

Provider catalog counts were pulled live from each provider's model-list API on 2026-10-21.

---

## 0. Changes that affect the design

1. **OpenAI shut down Sora 2 and the Videos API on 2026-09-24**, with no replacement. The 6 Sora entries in our catalog are dead. Some resellers (Replicate, WaveSpeed, Segmind, AIML) still list Sora; those listings are stale or will fail. https://developers.openai.com/api/docs/deprecations
2. **Veo 3.1 preview IDs shut down on the Gemini API on 2026-10-22, which is tomorrow.**
   - Google now calls **Gemini Omni Flash (`gemini-omni-1.1-flash`)** the "default model for video generation". Veo stays GA on Vertex, now branded "Gemini Enterprise Agent Platform".
   - fal has marked its Veo endpoints deprecated. Runway, WaveSpeed, Replicate, Runware, OpenRouter and Kie still sell Veo 3.1.
   - Source: https://ai.google.dev/gemini-api/docs/video (last updated 2026-10-19)
3. **Other shutdowns:**
   - Imagen 4: shut down on the Gemini API 2026-08-17.
   - Nano Banana v1 (`gemini-2.5-flash-image`): shut down 2026-10-02.
   - `gpt-image-1`: shuts down 2026-10-23.
   - `gpt-image-1.5`: shuts down 2026-12-01.
   - `ltx-2-*` API IDs: retired 2026-08-15.
   - MiniMax: from 2026-08-20 the music and lyrics APIs take no new users.
   - remove.bg: self-serve API sunsets 2026-12-01.
   - Clipdrop: now owned by Jasper, and its API pricing is withdrawn.
4. **Unofficial models:**
   - No official public **Suno**, **Udio** or **Midjourney** API exists.
   - muapi's Suno V5 and Midjourney v7/v8/niji endpoints are wrappers around the consumer products.
   - Kie.ai is the only mainstream aggregator still selling a Suno API.
5. **"Veo 4" is not a real Google model.** Only resellers mention it. muapi lists it, presumably as a placeholder.
6. **Several catalog names we didn't recognise turn out to be real first-party models with official APIs:**
   - **HappyHorse**: Alibaba (see §2).
   - **Gemini Omni**: Google.
   - **MiniMax H3**: Hailuo third generation.
   - **Seedance 2.5**: ByteDance.
   - **GPT Image 2.5 Flare/Sunburst**: OpenAI.
   - **FLUX 3 video**: BFL, in preview.
   - **Wan 3.0**: Alibaba.
   - **Muse Image**: Meta.
   - **Krea 2**: Krea.
   - **Kling O3**: a reseller name for Kling's `kling-v3-omni`.
7. **muapi's own shape is almost the same as WaveSpeed's v3 API:**
   - muapi: `POST /{slug}` then `GET /predictions/{id}/result`
   - WaveSpeed: `POST /api/v3/{model}` then `GET /api/v3/predictions/{id}/result`
   - Our catalog even contains a `wavespeed` "Api Node" entry. muapi is probably at least partly a WaveSpeed reseller (inferred, not verified).

---

## 1. What our catalog contains (606 rows)

Rows are classified by regex on id and name. Some ids appear in several sections.

| Family | Rows | Notes |
|---|---|---|
| Seedance (1.0/1.5/2.0/2.0-mini/2.5, incl. "VIP", "Spicy", "Intl", per-resolution SKUs) | 146 | Most rows are **muapi-specific SKUs**: resolution, "VIP" (priority) and "Spicy" (permissive) variants. Upstream they collapse to about 8 real models with `resolution` and `duration` params. |
| Kling (v1–v3, O1, "O3" = v3-omni, motion control, avatar) | 50 | |
| Wan (2.1–2.7, 3.0, animate, speech-to-video, "spicy") | 47 | |
| Flux (1.x, Kontext, 2, Klein, 3 video) | 40 | |
| MiniMax / Hailuo (02, 2.3, H3, H3-Max, speech, voice clone, music) | 29 | |
| ai-* utilities, effects, watermark, captions | 28 | Muapi in-house tools. Need a utility provider or ComfyUI. |
| HappyHorse 1.0/1.1 (Alibaba) | 24 | |
| Qwen Image (1, 2512, edit, 2.0, 3.0) | 21 | |
| Nano Banana / Gemini image / Gemini Omni / Gemini TTS | 21 | |
| Vidu (Q1–Q4) | 20 | |
| Lipsync / avatar (Sync, LatentSync, Creatify, Veed, InfiniteTalk, OmniHuman, Volcengine) | 18 | |
| Seedream / SeedEdit | 17 | |
| Veo 3 / 3.1 / "4" | 15 | |
| LTX 2 / 2.3 / 2.5 | 15 | |
| GPT Image / 4o | 11 | |
| PixVerse | 10 | |
| Suno | 9 | **Unofficial.** |
| Grok Imagine | 9 | |
| Topaz | 8 | |
| Runway (Gen-3, Aleph, Act-Two) | 6 | |
| Sora | 6 | **Dead.** |
| Others: Midjourney 3 (unofficial), Lyria 3, Ideogram 4, HiDream 3, ElevenLabs 3, Hunyuan, Ovi, Luma, Leonardo, Reve, Krea, Muse, Z-Image, MMAudio, SeedVR2, Fish, HeyGen, etc. | ~40 | |

---

## 2. Aggregators and inference marketplaces

| Provider | Catalog [live] | Async pattern | Upload | JS SDK | Browser / CORS | Machine-readable schema | ToS |
|---|---|---|---|---|---|---|---|
| **fal.ai** | **1,525 active endpoints** (i2i 408, t2i 207, v2v 202, i2v 196, t2v 134, audio ~150) | Queue: `POST queue.fal.run/{id}` returns status/response/cancel URLs. Status via **SSE**. **Signed webhooks** via `?fal_webhook=`. Sync via `fal.run`. Realtime over WebSocket. | `fal.storage.upload()` returns a CDN URL. The client auto-uploads Blobs. | `@fal-ai/client` | **`@fal-ai/server-proxy`**, a first-party proxy for Next.js, Express and Hono with an `allowedEndpoints` allow-list. | **Best.** `GET api.fal.ai/v1/models?expand=openapi-3.0` (public, paginated, filter by category). Per endpoint: `GET fal.ai/api/openapi/queue/openapi.json?endpoint_id=…` | Clean, all official or licensed. |
| **WaveSpeedAI** | **1,097** (type_counts in the listing) | `POST /api/v3/{model}`, then `GET /api/v3/predictions/{id}/result`. Webhook via `?standard_webhook=`. Optional `enable_sync_mode`. SSE for a few models. | Signed upload `POST /api/v3/media/uploads` then PUT (200 MB, kept 7 days). Legacy binary endpoint is 100 MB. | `wavespeed` | SDK claims browser support, but there are no scoped tokens, so proxy. | `GET /api/v3/models` (needs key) returns `api_schema.api_schemas[].request_schema` (JSON Schema with enums, defaults, min/max). Public undocumented list at `wavespeed.ai/api/models`. | Mostly official. Some self-hosted open weights. |
| **Replicate** (Cloudflare-owned since late 2025) | 50k+ community, about 440 "official" | Predictions API. `Prefer: wait=N` for sync. Webhooks with event filter, signed. SSE stream. | `POST /v1/files` (100 MB). Data URLs up to 256 KB. **Outputs deleted after 1 h.** | `replicate` (server only; README says not for browsers) | Proxy required. | `GET /v1/models/{o}/{n}` returns `latest_version.openapi_schema` (needs token). Collections API: `/v1/collections/official`. Search: `/v1/search`. | Official models are clean. Community models carry per-model licenses. |
| **Runware** | 450 curated models plus Civitai community checkpoints | **WebSocket** `wss://ws-api.runware.ai/v1` or REST task arrays. `deliveryMethod: sync\|async`, `getResponse` polling, `webhookURL`. | Inputs accept UUID, URL, data URI or base64. `mediaStorage` task. | `@runware/sdk` (Node and browser) | Exposes the key, so proxy. | **Public, no auth:** `schemas.runware.ai/resolve/{AIR}` (request and response JSON Schema). Catalog: `content.runware.ai/models` (capabilities, pricing). Undocumented, but the official CLI uses them. | Clean. |
| **Kie.ai** | About 590 priced SKUs | `POST /api/v1/jobs/createTask` with `callBackUrl`, then `GET /jobs/recordInfo`. **Errors come back as HTTP 200 with a `code` field.** Rate limit 20 requests per 10 s. | Separate domain `kieai.redpandaai.co` (files deleted after 24 h). | None | Proxy. | OpenAPI YAML embedded in docs `.md` pages (scrape only). | **Suno API is unofficial.** Midjourney docs removed. Treat as an opt-in community adapter. |
| **OpenRouter** | 468 LLMs, **63 image, 30 video, 36 TTS** models | Images: `POST /api/v1/images` (sync, base64 output). **Video:** `POST /api/v1/videos` returns 202, then poll; signed HMAC webhooks. TTS: `/audio/speech`. | No upload API; inputs are URL or data URL. | `@openrouter/sdk` | **CORS `*` [probe]. OAuth PKCE gives user-owned keys**, so a browser-only BYOK app works. | `GET /api/v1/{images,videos}/models` (durations, resolutions, pricing). `/models?output_modalities=`. Not full JSON Schemas. | Clean. |
| **Eachlabs** | 598 (video 292, image 124, audio 27) | `POST /v1/prediction` with signed webhook, then poll. | Presigned upload (100 MB, retention configurable). | None (fetch) | CORS `*` [probe] | **Excellent.** Public `GET /v1/models` with inline `request_schema`, plus `/v1/models/{slug}`. | Clean. |
| **Segmind** | 556 | Sync `/v1/{slug}`. Async `/v2/{slug}`, then poll `/v2/requests/{id}`. | Base64 to `upload-asset` (public URLs include the uploader's email). | Python only | CORS `*` [probe] | Public `GET api.segmind.com/model/{slug}` returns `parameters_schema` (JSON Schema 2020-12). | Clean. |
| **AIML API** | 945 (many aliases): 187 video, 136 image | OpenAI-compatible chat and images. Video: `POST /v2/video/generations`, then poll. **No webhooks.** | None | OpenAI SDK | Echoes Origin [probe] | List has docs links only, no inline schema. | Live catalog has no Suno or MJ. |
| **Together AI** | About 26 image, 25 video, 8 audio | Images are sync and OpenAI-style. Video `POST /v2/videos`, then poll. **No webhooks.** | URLs only | `together-ai` | CORS `*` [probe] | No per-model schema. | Clean. |
| **DeepInfra** | 401 (57 t2i, 31 t2v, 20 TTS, 1 music) | Native `/v1/inference/{model}` plus OpenAI-compatible images, speech and `/videos`. Webhooks. | Multipart | `deepinfra` | CORS `*` [probe] | `GET /models/{name}/schema/{variant}` (public). | Clean. |
| **Fireworks** | LLM-focused; only FLUX.1 for media | n/a | n/a | OpenAI SDK | No CORS | none | **Skip for media.** |
| muapi.ai (baseline) | 777 including LLMs | `POST /{slug}`, then `GET /predictions/{id}/result`. `?webhook=` (unsigned). | `upload_file` (10 MB image, 50 MB video), presigned for larger files. | none | No CORS [probe] | Public `GET /api/v1/models` with `input_fields`. | Suno and MJ unofficial. |

Sources:
- fal: https://fal.ai/docs/platform-apis/v1/models, https://fal.ai/docs/documentation/model-apis/inference/queue, https://fal.ai/docs/documentation/model-apis/inference/proxy-setup, https://fal.ai/pricing
- WaveSpeed: https://wavespeed.ai/docs/list-models, https://wavespeed.ai/docs/submit-task, https://wavespeed.ai/docs/upload-files-api
- Replicate: https://replicate.com/docs/reference/http, https://api.replicate.com/openapi.json, https://github.com/replicate/replicate-js
- Runware: https://runware.ai/docs/platform/webhooks, https://github.com/runware/runware-cli
- Kie: https://docs.kie.ai/, https://docs.kie.ai/llms.txt
- OpenRouter: https://openrouter.ai/docs/features/multimodal/image-generation, https://openrouter.ai/docs/guides/overview/multimodal/video-generation.md, https://openrouter.ai/blog/insights/every-modality-one-api/ (2026-07-16, updated 2026-09-24), https://openrouter.ai/docs/guides/overview/auth/oauth
- Eachlabs: https://docs.eachlabs.ai/api/models/get-model
- Segmind: https://docs.segmind.com/docs/platform/release-notes/2026-09-27-weekly, https://docs.segmind.com/docs/serverless-api/async-inference
- AIML: https://docs.aimlapi.com/llms.txt
- Together: https://docs.together.ai/docs/videos-overview
- DeepInfra: https://docs.deepinfra.com/api-reference/models/model-schema.md
- muapi: https://muapi.ai/docs/api-reference, https://muapi.ai/docs/webhooks

### 2a. Family coverage by aggregator

Legend: Y = carried, P = partial or old versions only, D = deprecated or dead, - = absent.

| Family | fal | WaveSpeed | Replicate | Runware | OpenRouter | Eachlabs | Segmind | Kie | Together | AIML |
|---|---|---|---|---|---|---|---|---|---|---|
| Seedance 1.x / 2.0 / 2.5 | Y (2.5 "us") | Y (50) | Y | Y | Y (2.0, 2.5) | Y | Y | Y | Y | Y |
| Kling 2.x/3.0/O1/O3 + motion + avatar | Y | Y (78) | Y | Y (no motion ctrl) | P (v3, O1) | Y (43) | Y (38) | Y | P (1.6/2.1) | Y |
| Veo 3.1 | D (unlisted) | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Sora 2 | D | D (listed) | D (listed) | - | - | D | D | - | D | D |
| Wan 2.x / 3.0 | Y | Y (102) | Y | Y | Y | Y | Y | Y | P (2.7) | Y |
| MiniMax Hailuo 02/2.3/H3 | Y | Y | P (no H3) | Y | Y | Y | Y | Y | Y | Y |
| HappyHorse 1.0/1.1 | Y | Y | Y | Y | Y | ? | ? | Y | Y | ? |
| Gemini Omni | Y | Y | Y | Y | - | ? | ? | Y | - | ? |
| Vidu Q2/Q3/Q4 | Y | Y | P (Q3) | Y | - | Y | - | P (Q4) | Y | - |
| PixVerse v5–v6 | Y | Y | Y | Y | - | Y | Y | Y | Y | Y |
| Runway Gen-4.5 / Aleph / Act-Two | **-** | Y | Y | Y | Y | P | Y | Y | - | Y |
| Luma Ray 3.2 | Y | Y | Y | Y | - | Y | Y | - | - | Y |
| LTX 2.x | Y | Y | Y | Y | - | Y | Y | - | - | Y |
| Grok Imagine | Y | Y | Y | Y | Y | Y | Y | Y | - | Y |
| GPT Image 2 / 2.5 | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Nano Banana 2 / 2.1 / Pro | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Seedream 4–5 | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Flux Kontext / 2 / 3 | Y (Kontext not seen) | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Qwen Image | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Ideogram | Y | Y | Y | Y | - | Y | Y | Y | Y | - |
| Topaz | Y (15) | P (image) | Y | Y | - | Y | - | Y | - | Y |
| SeedVR2 | Y | Y | community | - | - | ? | ? | - | - | - |
| OmniHuman | Y | Y | Y | Y | - | Y | Y | Y | - | Y |
| InfiniteTalk | Y | Y | - | - | - | Y | ? | Y | - | - |
| Sync lipsync | Y | Y | Y | Y | - | Y | Y | - | - | - |
| LatentSync / MMAudio | Y | Y | Y (comm.) | - | - | Y | ? | - | - | P |
| ElevenLabs (TTS/SFX/music) | Y | Y | Y | - | P (TTS) | - | Y | P | - | Y |
| MiniMax speech/music | Y | Y | Y | P | P (speech) | Y | Y | - | - | Y |
| Lyria 3 / 3.5 | Y | Y | Y | - | Y (chat) | Y | ? | - | - | P (2) |
| Suno | - | - | - | - | - | - | - | **Y (unofficial)** | - | - |
| Midjourney | - | - | - | - | - | - | - | - (removed) | - | - |

### 2b. OpenRouter now does media (answering the specific question)

- **Image output through chat completions still works:** send `modalities: ["image","text"]`. In the live list, 12 chat models expose image output:
  - Gemini 2.5/3/3.1 Flash Image, 3 Pro Image, Nano Banana 2.1
  - `openai/gpt-5-image`, `gpt-5-image-mini`, `gpt-5.4-image-2`
- **The newer, recommended route is the dedicated `POST /api/v1/images`.** It has 63 models: GPT Image 1/2/2.5, Nano Banana family, Seedream 4.5/5, FLUX.2/FLUX 3, Qwen Image, Grok Imagine Image 2, about 18 Recraft models, Krea 2, Muse, Hunyuan Image 3.5. There is no Ideogram.
- **Video:** `POST /api/v1/videos` (async, with webhooks) has 30 models:
  - Seedance 1.5/2.0/2.5
  - Veo 3.1
  - Kling v3 / O1
  - Hailuo 2.3/3/3-max
  - Wan 2.6/2.7/3.0
  - Grok Imagine video 1.5
  - Runway Gen-4.5 / Aleph-2
  - FLUX 3 video
  - HeyGen avatar-iv
  - HappyHorse
  - There is no Vidu, PixVerse, Luma or LTX.
- **TTS:** `/audio/speech` has 36 models (ElevenLabs v2–v4, MiniMax 2.8, Fish S2.1, Gemini TTS, …).
- **Music:** only Lyria 3, and only through chat audio output.
- **Not available:** lipsync (other than the HeyGen avatar), upscale, background removal.

---

## 3. First-party model APIs

| Provider | Models via API (Oct 2026) | Async pattern | File input | JS SDK | Browser | Notes |
|---|---|---|---|---|---|---|
| **OpenAI** | `gpt-image-2.5-sunburst` and `-flare`, `gpt-image-2`. Older image models deprecated. `gpt-4o-mini-tts`. Realtime `gpt-realtime-2.1`. **No video.** | Images are sync. Output is base64 only. | Multipart for edits, or Files API / URL in the Responses tool. | `openai` | `dangerouslyAllowBrowser` only. Realtime has ephemeral secrets. | Sora shut down 2026-09-24. https://developers.openai.com/api/docs/deprecations |
| **Google Gemini API** | **Image:** Nano Banana 2.1 `gemini-nano-banana-2.1` (GA 2026-10-06), `gemini-3.1-flash-image`, `-lite-image`, `gemini-3-pro-image`. **Video:** `gemini-omni-1.1-flash` (GA 2026-08-27). **Music:** `lyria-3.5`, `lyria-3-pro-preview`, `lyria-3-clip-preview`, RealTime. **TTS:** `gemini-3.8-flash-tts` / `-lite-tts`. | Interactions API. Video is sync, or `delivery:"uri"` and you poll the file. OpenAI-compatible `/openai/` including `/images` and a Sora-style `/videos`. | Inline base64 or Files API. | `@google/genai` | Ephemeral tokens cover the Live API only, so proxy everything else. | Veo 3.1 previews end 2026-10-22; use Vertex for Veo GA. https://ai.google.dev/gemini-api/docs/models, https://ai.google.dev/gemini-api/docs/omni, https://ai.google.dev/gemini-api/docs/music-generation |
| **xAI** | `grok-imagine-image-2.0`, `-image-quality`, `-image`. Video: `grok-imagine-video-1.5`, `-1.5-lite`, `grok-imagine-video` (edit). | Images OpenAI-compatible and sync. Video: `POST /v1/videos/generations`, then poll. No webhooks. | URL, data URI or Files ID. | xAI SDK, AI SDK provider | Proxy. | https://docs.x.ai/docs/guides/video-generations |
| **Black Forest Labs** | FLUX.2 max/pro/flex/klein, Kontext, FLUX 3 Image, FLUX 3 Klein (open weights). **FLUX 3 Video** (preview, t2v/i2v/v2v, up to 4K). Video edit and upscale, erase, outpaint, try-on. | `{id, polling_url}`, then poll. **Signed webhooks.** | URL or base64. | none (AI SDK provider) | **Result URLs expire in 10 min and have no CORS.** | https://docs.bfl.ml/release-notes.md, https://docs.bfl.ml/api_integration/integration_guidelines.md |
| **BytePlus ModelArk** (intl) / Volcengine (CN) | Seedance `dreamina-seedance-2-5-260628`, 2.0, 2.0-fast, 2.0-mini, 1.5-pro, 1.0. Seedream 5.0 pro/flash/lite, 4.5, 4.0. OmniHuman is a separate product. | `POST /contents/generations/tasks`, then `GET /tasks/{id}`. `callback_url`. | URL, data URI or `asset://`. | none (OpenAI-ish REST) | Proxy. | Seedance 2.x needs account activation (>$30 balance) and **rejects real human faces in references**. Seedance 2.0 launched in 100+ countries **excluding the US**. https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list |
| **Kling** (Kuaishou) | `kling-v3`, `kling-v3-omni` (the "O3"), `kling-video-o1`, v2.6/2.5-turbo/2.1, image O1/v3. Motion control, lipsync, avatar, try-on. | Task plus `callback_url`. **JWT (AK/SK, HS256)**. | URL or base64. | none | Needs a server (secret signing). | https://kling.ai/llms.txt. Endpoint paths unverified because the docs are rendered client-side. |
| **MiniMax** | `MiniMax-H3`, `-H3-Max`, legacy Hailuo 2.3/02. `speech-2.8/2.6`, voice clone and design. `music-3.0` (closed to new users). `image-01`. | `/v2/video_generation`, then query, then file download. | URL. | none | Proxy. | https://platform.minimax.io/docs/guides/video-generation |
| **Alibaba Model Studio** (DashScope) | `wan3.0-video` / `-prime`, wan2.7/2.6/2.5. **HappyHorse** `happyhorse-1.1-t2v/i2v/r2v`, `1.0-video-edit`. `qwen-image-3.0-pro`, `qwen-image-2.0(-pro)`, `wan2.7-image-pro`. | `X-DashScope-Async: enable`, then poll `/tasks/{id}`. Outputs last 24 h. | URL or data URI. | none | Proxy. | Regional hosts; key, model and endpoint must be in the same region. https://www.alibabacloud.com/help/en/model-studio/video-generate-edit-model/ |
| **Runway** | `gen4.5`, `gen4_turbo`, `aleph2`, `act_two`. Also resells `veo3.1`/`_fast`, `muse_image`, ElevenLabs, Magnific upscale. | Tasks, then poll. | URL or data URI. | `@runwayml/sdk` (`waitForTaskOutput`) | Proxy. | https://docs.dev.runwayml.com/guides/models/ |
| **Luma** | Agents API: `ray-3.2`, `uni-1`/`-max`. Legacy Dream Machine API (Ray 2, Photon). | Generations, then poll or callback. | URL or base64. | `luma-agents` | Proxy. | https://docs.agents.lumalabs.ai/ |
| **Vidu** | Q4 preview, Q3, Q2, Q1, Q2 image, TTS. | Tasks plus signed callbacks. | – | – | Proxy. | https://platform.vidu.com/docs/introduction (IDs unverified) |
| **PixVerse** | V6, C1, lipsync. | `video_id`, then poll or webhook. Upload returns `img_id`. | upload | – | Proxy. | https://docs.platform.pixverse.ai/ |
| **LTX** (Lightricks) | `ltx-2-5-pro`, `ltx-2-3-pro`/`-fast`. | v1 sync (MP4 bytes). v2 async `job_id`. | URL, `ltx://` upload or base64. | – | Proxy. | https://docs.ltx.io/quickstart |
| **Tencent Hunyuan** | `hy-video-v1.5` (TokenHub intl). | Task, then poll. | URL | – | Proxy. | https://intl.cloud.tencent.com/document/product/1300/83716 |
| **Ideogram** | v2 API: Ideogram 4.5/4.0/3.0, plus GPT Image 2.5, Nano Banana, Kling/H3/Seedance video. | Poll plus Ed25519-signed webhooks. | multipart | – | Proxy. | https://developer.ideogram.ai/v2/llms.txt |
| **Recraft** | V4.1, V4.1 Flash, vector (SVG). | Sync, OpenAI-compatible. | – | OpenAI SDK | Proxy. | https://www.recraft.ai/docs/api-reference/getting-started |
| **Stability** | SD 3.5, upscalers, Stable Audio 2.5/3. | Sync, or 202 then poll. | multipart | – | Proxy. | https://docs.stability.ai/api-reference |
| **Krea / Reve / Leonardo / Meta Muse** | Krea 2 Medium/Large (`api.krea.ai`, job plus webhook header). Reve (console-only docs). Leonardo Phoenix/Lucid (v1/v2, webhooks). Muse Image ($0.01, Meta Model API). | | | | | https://www.krea.ai/docs/developers/krea-2/overview, https://dev.meta.ai/models/muse-image/ |
| **ElevenLabs** | `eleven_v4`/`_v4_turbo` (2026-09-28), v3, dialogue, SFX `eleven_text_to_sound_v2`, music `music_v2_5`, Scribe, voice clone. | Sync REST, plus WebSocket streaming. | multipart | `@elevenlabs/elevenlabs-js` | **Single-use tokens only for TTS WebSocket and Scribe.** | https://elevenlabs.io/docs/overview/models, https://elevenlabs.io/docs/api-reference/tokens/create |
| **Fish Audio** | `s2.1-pro` ($15 per 1M bytes), `s2-pro`, `drama-3`. `s1` retires 2026-12-31. | Sync plus WebSocket. | – | AI SDK provider | Proxy. | https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits |
| **Sync Labs** | `sync-3`, `lipsync-2-pro`, `lipsync-2`, `react-1`. | `POST /v2/generate`, then poll, or webhook. Assets API. | URL or asset. | `@sync.so/sdk` | Proxy. | https://sync.so/docs/api-reference/api-overview |
| **HeyGen / Hedra / Creatify / VEED** | HeyGen Avatar IV and video translate. Hedra Character-3 (v3 jobs, SSE, webhooks). Creatify Aurora. VEED Fabric (billed via fal). | Job, then poll or webhook. | upload asset | – | Proxy. | https://docs.heygen.com/docs/create-avatar-iv-videos, https://www.hedra.com/docs/api-reference/v3/run-a-model/run-hedra-character-3-hedra-character-3, https://support.veed.io/en/articles/15230480-veed-fabric-1-0-api |
| **Topaz** | Image: Standard V2, Wonder, Redefine, Recover, Bloom, matting. Video: Proteus, Starlight, Astra 2, Apollo/Chronos. | `/enhance/async`, then status, then download. | multipart (500 MB) | none | Proxy. | https://developer.topazlabs.com/getting-started/quickstart.md |
| **BRIA** (utilities) | RMBG 2.0, eraser, gen_fill, expand, increase_resolution, replace background. Video background removal and upscale. | v2 async `status_url`, `webhook_url`, or `sync:true`. | URL or base64. | – | Proxy. | https://docs.bria.ai/llms.txt |
| **Photoroom** | Background removal (about $0.02), edit/expand/relight (about $0.10). | Sync. | multipart | – | Proxy. | https://docs.photoroom.com/getting-started/which-api-should-i-use |
| **Suno / Udio / Midjourney** | **No official API.** Suno announced an invite-only partner program in July 2026. Midjourney has only an enterprise survey, and its ToS bans automation. | – | – | – | – | https://www.digitalmusicnews.com/2026/07/03/suno-is-opening-an-api-partner-program/, https://updates.midjourney.com/enterprise-api-survey/ |

---

## 4. LLM providers (agent, workflow and design-agent features)

All of these speak "OpenAI-compatible chat + tools". The Vercel AI SDK has first-class providers for each.

| Provider | OpenAI-compatible | Tool calling | Direct browser calls with the user's key |
|---|---|---|---|
| OpenAI | native | yes | Works (SDK flag `dangerouslyAllowBrowser`). |
| Anthropic | `https://api.anthropic.com/v1/` compat layer. Anthropic says it is **not production-grade**; use the native SDK or the AI SDK. | yes (no `strict`, `response_format` ignored) | **Yes**, with header `anthropic-dangerous-direct-browser-access: true`. |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` (beta, updated 2026-10-14) | yes | Unclear, so plan a proxy. |
| OpenRouter | native | yes | **Yes**: CORS `*` plus **OAuth PKCE**. Best BYOK story. |
| Groq | yes | yes | Disputed, so proxy. |
| Ollama | `/v1/chat/completions`, `/v1/responses` | yes (model-dependent) | Yes on localhost. Set `OLLAMA_ORIGINS` for other origins. |
| LM Studio | `localhost:1234/v1` (plus Anthropic-compatible `/v1/messages` in 0.4) | yes | Enable CORS in server settings. |

Sources: https://platform.claude.com/docs/en/api/openai-sdk, https://ai.google.dev/gemini-api/docs/openai, https://docs.ollama.com/api/openai-compatibility, https://lmstudio.ai/docs/developer/openai-compat

---

## 5. Local and self-hosted backends

- **ComfyUI** is the main local target and covers nearly every open-weight family: Wan, LTX, Qwen, Flux, HunyuanVideo, InfiniteTalk, MMAudio, SeedVR2 and background removal. https://docs.comfy.org/development/comfyui-server/comms_routes
  - **API:**
    - `POST /prompt` with an API-format workflow and `client_id` returns a `prompt_id`.
    - `GET /ws?clientId=` streams progress and previews.
    - `POST /upload/image` uploads inputs.
    - `GET /history/{id}`, then `GET /view?filename=…` fetches outputs.
    - `GET /object_info` returns node schemas, so forms can be generated.
  - **How to plug in:** ship one template per tool, patch node inputs by ID, then submit, follow progress over the WebSocket and fetch the output.
  - **Comfy Cloud and API nodes:**
    - `cloud.comfy.org` exposes the same API with an `X-API-Key` header (experimental).
    - Partner "API nodes" can run paid models (Kling, Veo, …) inside local graphs when you pass `extra_data.api_key_comfy_org`.
- **Wan2GP** has no REST API.
  - Options: a headless `wgp.py --process queue.zip`, an `--mcp` mode (unverified), or `@gradio/client` (fragile).
  - Best plugged in through the desktop or Electron main process as a CLI job runner.
- **stable-diffusion.cpp `sd-server`**, **LocalAI**: both expose an OpenAI-compatible `/v1/images/generations` (and edits), so one generic "OpenAI-images" adapter covers both. LocalAI also does TTS, STT and LTX video (unverified).
- **Ollama:**
  - Image generation is experimental, macOS only and CLI only (Z-Image Turbo, FLUX.2 Klein) as of 2026-01. There is no documented REST image route. https://ollama.com/blog/image-generation
  - For now, use Ollama only for LLMs.
- **InvokeAI** (`/api/v1/queue/default/enqueue_batch`), **SwarmUI** (session plus `GenerateText2Image`/WS), **Forge/A1111** (`/sdapi/v1/*`): optional adapters.

---

## 6. Unifying libraries

- **Vercel AI SDK v7** went GA on 2026-06-25 (`ai@7.x`). https://vercel.com/blog/ai-sdk-7
  - **`generateImage`** is stable and supports reference images and masks. Providers: OpenAI, xAI, Google/Vertex, Bedrock, **fal, Replicate**, DeepInfra, Fireworks, Luma, Together, BFL. https://ai-sdk.dev/docs/ai-sdk-core/image-generation
  - **`generateSpeech`** providers: OpenAI, ElevenLabs, Hume, Gemini TTS, xAI, Cartesia, Mistral, Azure, Fish Audio. https://ai-sdk.dev/docs/ai-sdk-core/speech
  - **`experimental_generateVideo`** handles polling, webhooks, `frameImages` and `inputReferences`. Providers: BFL (flux-3-video), fal, Google/Vertex Veo, Kling, Replicate, xAI, OpenRouter. https://ai-sdk.dev/docs/ai-sdk-core/video-generation
  - **v7 also adds** `uploadFile` and a durable `WorkflowAgent`.
  - **Gaps:** no lipsync, music, SFX, upscale or background-removal abstraction. The model-specific params go through `providerOptions` as untyped passthrough, so the SDK **doesn't help with auto-generating UI params.**
- **LiteLLM** is a Python proxy that offers `/v1/images/generations` and an OpenAI-shaped `/v1/videos` for Veo, Runway, DashScope, MiniMax and Volcengine. It's worth it only as an optional self-hosted gateway. https://docs.litellm.ai/docs/videos
- **Portkey gateway** covers image and TTS, but not video. any-llm, aisuite and genai-processors are text-only.
- **There is no mature open-source "universal media generation" layer.**
  - The de-facto conventions are OpenAI `/images/*`, a Sora-style `/videos` (create, poll, then `/content`; still used by Gemini-compat, OpenRouter, DeepInfra and LiteLLM), and everything else as a job: submit, then poll or webhook, then fetch URLs.

**Recommendation:**
- Use the AI SDK v7 for LLM and agent work, plus as a convenience for simple image and TTS calls.
- Build our own thin **job-based media adapter interface**: `listModels()`, `getSchema(model)`, `upload(file)`, `submit(model, input)`, `poll(id)` or a webhook, then a normalized `{status, outputs[], cost}`.
- Drive the UI from each provider's JSON Schema, not from AI SDK types.

---

## 7. Capability × provider matrix

Legend: Y = yes, P = partial, - = no. "bg" = background removal.

| Provider | t2i | i2i/edit | t2v | i2v | v2v/edit | lipsync/avatar | TTS | music | SFX / V2A | upscale | bg | LLM |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fal.ai | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | P (router) |
| WaveSpeedAI | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | P |
| Replicate | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Runware | Y | Y | Y | Y | Y | Y | Y | P | Y | Y | Y | Y |
| OpenRouter | Y | Y | Y | Y | P | P (HeyGen) | Y | P (Lyria) | - | P (flux-video-upscale) | - | **Y** |
| Eachlabs | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Segmind | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Kie.ai | Y | Y | Y | Y | Y | Y | Y | Y* | P | Y | Y | Y |
| AIML API | Y | Y | Y | Y | Y | Y | Y | Y | P | Y | - | Y |
| Together | Y | Y | Y | Y | Y | - | Y | - | - | - | - | Y |
| DeepInfra | Y | Y | Y | Y | P | P | Y | P | - | Y | Y | Y |
| Fireworks | P | - | - | - | - | - | - | - | - | - | - | Y |
| OpenAI | Y | Y | - (Sora dead) | - | - | - | Y | - | - | - | - | Y |
| Google Gemini / Vertex | Y | Y | Y (Omni / Veo) | Y | Y | - | Y | Y | P | P (Omni) | - | Y |
| xAI | Y | Y | Y | Y | Y | - | Y | - | - | - | - | Y |
| BFL | Y | Y | Y (preview) | Y | Y | - | - | - | - | Y | P (erase) | - |
| BytePlus | Y | Y | Y | Y | Y | P (OmniHuman) | - | - | - | - | - | Y |
| Kling | Y | Y | Y | Y | Y | Y | P | - | - | - | - | - |
| MiniMax | Y | P | Y | Y | - | - | Y | P (closed to new) | - | - | - | Y |
| Alibaba DashScope | Y | Y | Y | Y | Y | P (wan s2v) | Y | - | - | - | - | Y |
| Runway | Y | Y | Y | Y | Y | Y (Act-Two) | P | - | - | Y | - | - |
| Luma / Vidu / PixVerse / LTX | P | P | Y | Y | Y | P | P (Vidu) | - | P (PixVerse) | - | - | - |
| ElevenLabs | - | - | - | - | - | - | Y | Y | Y | - | - | - |
| Sync / HeyGen / Hedra / Creatify | - | - | - | P | - | Y | P | - | - | - | - | - |
| Topaz | - | - | - | - | - | - | - | - | - | Y | Y | - |
| BRIA / Photoroom | P | Y | - | - | P | - | - | - | - | Y | Y | - |
| ComfyUI (local) | Y | Y | Y | Y | Y | Y | P | P | Y | Y | Y | - |
| Ollama / LM Studio | P (Ollama, mac) | - | - | - | - | - | - | - | - | - | - | Y |

\* Kie music means Suno, which is unofficial.

---

## 8. Per-family routing: best direct API and best aggregator fallback

| Catalog family (rows) | Best direct (first-party) | Best aggregator fallback | Notes |
|---|---|---|---|
| Seedance 1.x–2.5 (146) | BytePlus ModelArk (ap-southeast-1) | **fal** (2.5 "us" variants), WaveSpeed (most SKUs) | Collapse muapi's VIP/Spicy/Intl/resolution SKUs into params. Direct BytePlus excludes the US and blocks real faces. "Spicy" (permissive) SKUs have no official equivalent. |
| Kling incl. O1/"O3", motion control, avatar (50) | Kling API (JWT) | **fal** or WaveSpeed (78) | Map "O3" to `kling-v3-omni`. |
| Wan 2.x/3.0, animate, s2v (47) | Alibaba DashScope | **WaveSpeed** (102) or fal | Open-weight Wan 2.1/2.2 also runs on ComfyUI or Wan2GP. "Spicy" Wan = permissive fine-tunes, aggregator only. |
| Flux 1/Kontext/2/Klein/3 video (40) | BFL API | fal, Runware (Kontext) | Klein and dev also run locally (ComfyUI). |
| MiniMax Hailuo/H3, speech, clone (29) | MiniMax platform | fal or WaveSpeed | MiniMax music is closed to new users; use fal or WaveSpeed. |
| ai-* utilities, effects, watermark (28) | BRIA (bg, erase, expand, upscale), Topaz (upscale, colorize), Photoroom | fal (Bria, BiRefNet, ESRGAN, etc.) | Face swap and "dress change": fal/Replicate models or ComfyUI. Watermark add/remove, captions and passthrough: implement locally with ffmpeg/canvas rather than a paid API. |
| HappyHorse 1.0/1.1 (24) | Alibaba DashScope `happyhorse-1.1-*` | fal, WaveSpeed, OpenRouter | |
| Qwen Image (21) | DashScope | fal or WaveSpeed | LoRA variants are aggregator or local only. |
| Nano Banana / Gemini Omni / Gemini TTS (21) | Gemini API | fal, OpenRouter (images) | Nano Banana v1 is gone; map to 2.1. |
| Vidu (20) | Vidu platform | fal or WaveSpeed | Not on OpenRouter. |
| Seedream / SeedEdit (17) | BytePlus | fal, OpenRouter | |
| Veo 3/3.1 (15) | Vertex AI (GA) or Runway API | **WaveSpeed**, Runware, Replicate, OpenRouter | Gemini API Veo dies 2026-10-22; fal deprecated it. Drop "Veo 4". |
| LTX 2.x (15) | LTX API (`ltx-2-5-pro`, `2-3`) | fal or WaveSpeed | Open weights run on ComfyUI. |
| GPT Image / 4o (11) | OpenAI | fal, OpenRouter | Retire 4o, 1 and 1.5; map to 2/2.5. |
| PixVerse (10) | PixVerse platform | fal or WaveSpeed | |
| Suno (9) | **none official** | Kie.ai (unofficial) | Replace with ElevenLabs Music, Lyria 3.5 or MiniMax music via fal. Offer Suno only as an opt-in community plugin. |
| Grok Imagine (9) | xAI | fal, OpenRouter | |
| Topaz (8) | Topaz API | fal (15 endpoints) | |
| Runway Gen-4.5/Aleph/Act-Two (6) | Runway API | WaveSpeed, Replicate | **Not on fal.** |
| Sora (6) | dead | – | Remove. |
| Lipsync (Sync, LatentSync, Creatify, Veed, InfiniteTalk, OmniHuman, Volcengine) (18) | sync.so, Creatify, HeyGen, BytePlus | **fal** (Sync, VEED, LatentSync, InfiniteTalk, OmniHuman), WaveSpeed | Volcengine lipsync is aggregator only. |
| ElevenLabs / Fish / MMAudio / Lyria (~10) | ElevenLabs, Fish, Gemini (Lyria) | fal, OpenRouter (TTS) | MMAudio: fal or local. |
| Midjourney (3) | **none official** | none legit | Drop or community plugin. |
| HiDream, Hunyuan, Ovi, Z-Image, Chroma, SDXL, Pony, Neta Lumina | open weights | fal, WaveSpeed, Runware | Also ComfyUI. |
| Luma, Leonardo, Reve, Krea, Muse, Ideogram, Recraft | own APIs | fal, WaveSpeed, Runware | |

---

## 9. Ranked recommendation

**Support first** (together they cover about 95% of the catalog rows that are still valid):

1. **fal.ai: the primary media provider.**
   - Covers every family except Runway, Veo (deprecated there), Sora (dead), Suno and Midjourney.
   - It has the best public schema discovery (OpenAPI 3.0 per endpoint, no key), a first-party browser proxy, signed webhooks, SSE status, a storage upload API, and AI SDK providers for image and video.
2. **WaveSpeedAI: the secondary provider, and the closest to muapi's model.**
   - Its submit-and-poll API is nearly identical to muapi's. It has the widest family coverage (1,097 models) and JSON Schema per model.
   - It fills fal's gaps: **Veo 3.1, Runway, InfiniteTalk variants**, most Seedance/Wan SKUs.
   - Porting the current muapi code to it would be the cheapest path.
3. **OpenRouter: LLMs for the agents, plus a "one key, browser-only" media tier.**
   - Media coverage: 63 image, 30 video and 36 TTS models.
   - CORS `*`, OAuth PKCE BYOK, signed video webhooks.
   - Lets users run the app without our server.
4. **ComfyUI (local and Comfy Cloud): the local or self-hosted path** for open weights (Wan, LTX, Flux Klein, Qwen, HunyuanVideo, InfiniteTalk, MMAudio, SeedVR2, RMBG). Node schemas come from `/object_info`.
5. **Direct Google Gemini API: Nano Banana 2.1, Gemini Omni, Lyria 3.5 and Gemini TTS.**
   - Cheapest for the highest-traffic image family.
   - It's the only source of Omni at first-party price.
   - It also gives the agent features a strong LLM.

**Add later, in rough order:**
- **Replicate or Runware**: a third aggregator for redundancy. Runware has public JSON Schemas and is cheap; Replicate has the biggest long tail.
- **Direct first-party adapters where price or features matter:** BytePlus (Seedance/Seedream), Alibaba (HappyHorse/Wan/Qwen), Kling, MiniMax, BFL, xAI, OpenAI (GPT Image 2.5), Runway, ElevenLabs, sync.so, Topaz, BRIA.
- **Eachlabs or Segmind:** alternative aggregators. Both have excellent public JSON-schema endpoints and CORS `*`.
- **Local extras:** the OpenAI-images adapter (sd.cpp, LocalAI) and Ollama/LM Studio for LLMs.
- **Opt-in "community" adapters, off by default and clearly labelled:** Kie.ai (Suno). **Don't ship Midjourney.**
- **Skip:** Fireworks (for media), AIML (no webhooks, upload or schemas), Together (no webhooks or schemas; fine as an LLM option).

---

## 10. Implementation notes

### 10a. Schema discovery (auto-building forms)

| Provider | Endpoint | Auth | Format |
|---|---|---|---|
| fal | `GET https://api.fal.ai/v1/models?category=…&status=active&expand=openapi-3.0` (paginated with `cursor`); per endpoint `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/…` | none (key raises rate limit) | OpenAPI 3.0: `{Name}Input` and `{Name}Output` |
| Runware | `GET https://schemas.runware.ai/resolve/{AIR}`; catalog `GET https://content.runware.ai/models` | none (undocumented, used by the official CLI) | JSON Schema req/resp |
| Eachlabs | `GET https://api.eachlabs.ai/v1/models?limit=&offset=` (inline `request_schema`), `GET /v1/models/{slug}` | none | JSON Schema |
| Segmind | `GET https://api.segmind.com/models` (facets), `GET https://api.segmind.com/model/{slug}` | none | JSON Schema 2020-12 (`parameters_schema`) |
| DeepInfra | `GET https://api.deepinfra.com/models/{name}/schema/{variant}` | none | `schema_in` / `schema_out` |
| WaveSpeed | `GET https://api.wavespeed.ai/api/v3/models` | Bearer key | JSON Schema (`api_schema.api_schemas[].request_schema`) |
| Replicate | `GET https://api.replicate.com/v1/models/{o}/{n}` (`latest_version.openapi_schema`) | token | OpenAPI |
| OpenRouter | `GET /api/v1/videos/models`, `/images/models` | none | Capability metadata (durations, resolutions, pricing), not full schemas |
| ComfyUI | `GET /object_info` | local | Node input specs |
| Kie | OpenAPI YAML inside `https://docs.kie.ai/market/{family}/{model}.md` | none | Scrape |
| muapi (current) | `GET https://api.muapi.ai/api/v1/models` | none | `input_fields` / `required_fields` |

**Suggested approach:**
- Normalize every schema to JSON Schema.
- Render forms with a generic JSON Schema form renderer (for example `@rjsf/core`, or a custom one).
- Keep a small hand-maintained **override layer** per family: grouping, widget hints (image upload, aspect-ratio picker, duration slider), and hiding advanced fields.
- Cache the schemas in-repo, because rate limits and unauthenticated 429s are common.

### 10b. Async and webhook patterns

Normalize every provider to `submit → {jobId} → status stream | poll | webhook → outputs[]`.

| Provider | Submit | Status | Webhook |
|---|---|---|---|
| fal | queue | SSE stream or poll | `fal_webhook`, signed |
| WaveSpeed | `/api/v3/{model}` | poll `/predictions/{id}/result` | `standard_webhook` |
| Replicate | predictions | `Prefer: wait`, SSE or poll | signed webhook with event filter |
| Runware | WS or REST tasks | `getResponse` | `webhookURL` |
| OpenRouter video | 202 + `polling_url` | poll | HMAC `X-OpenRouter-Signature` |
| Eachlabs | prediction | poll | signed webhook |
| BFL | `polling_url` | poll | signed webhook |
| BytePlus / Kling | task | poll | `callback_url` |
| DashScope / MiniMax / xAI | task | poll only | none |
| Gemini | synchronous | file poll for large video | none |
| ComfyUI | `/prompt` | WebSocket `/ws` | none |

**Webhooks need a public server.** For the desktop or local app, default to polling or SSE. Use webhooks only for the hosted deployment.

**Output URLs are short-lived**, so the app must download and re-host outputs into its own storage or IndexedDB:
- Replicate: 1 h
- BFL: 10 min, no CORS
- DashScope: 24 h
- Kie uploads: 24 h
- WaveSpeed uploads: 7 days
- OpenAI and Gemini return base64; OpenRouter video needs an authenticated download.

### 10c. CORS and browser-direct keys

| Provider | Browser-direct |
|---|---|
| OpenRouter | CORS `*` plus OAuth PKCE. The only clean browser-only BYOK. |
| Together, DeepInfra, Segmind, Eachlabs | CORS `*` [probe]. Works, but the key is exposed. |
| AIML | Echoes the request Origin [probe]. |
| Anthropic | Works with the `anthropic-dangerous-direct-browser-access` header. |
| Ollama / LM Studio | Works on localhost once origins are allowed. |
| fal | Official pattern is `@fal-ai/server-proxy`, a thin route that injects the key. |
| Replicate, Kling (JWT secret), BFL (result URLs lack CORS), muapi (no CORS), Fireworks | Server required. |
| Most first-party media APIs | No CORS or scoped tokens. |
| Scoped tokens | Exist only for ElevenLabs single-use tokens (TTS WebSocket and STT), Gemini ephemeral tokens (Live API only) and OpenAI Realtime client secrets. |

**Recommendation:** route everything through one thin proxy: a Next.js route or the Electron main process. It holds BYOK keys in server or main-process memory and forwards requests with an allow-list, mirroring fal's proxy. The one exception is an optional pure-browser mode through OpenRouter PKCE.

### 10d. File uploads

| Provider | Method |
|---|---|
| fal | `fal.storage.upload()`, auto-upload of Blobs |
| WaveSpeed | signed PUT, 200 MB |
| Replicate | `/v1/files`, 100 MB |
| Eachlabs | presigned PUT, 100 MB |
| Runware | `mediaStorage`, or inline base64 |
| Segmind | base64, then public URL |
| Kie | 3rd-party domain, 24 h |
| ComfyUI | `/upload/image` |
| Sync | assets |
| HeyGen | asset upload |
| Topaz | multipart |
| OpenRouter, Together, AIML, xAI, BytePlus, DashScope | No upload. URL or data URI only. Together, Kling (some endpoints) and MiniMax video need hosted URLs. |
| Gemini | inline base64, or Files API for video |

**Strategy:**
- Abstract `upload(file) → url` per provider.
- Fall back to a data URI for small images.
- Where a provider needs public URLs and has no upload, upload through another provider's storage (for example fal storage) or our own S3 or R2 bucket.
