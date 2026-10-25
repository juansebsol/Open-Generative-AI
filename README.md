# Openstudio

An open-source, **bring-your-own-key** studio for AI images, video, audio and lip sync. You plug in keys from the providers you already use (fal.ai, WaveSpeed, OpenRouter, Google Gemini, OpenAI) or point it at your own ComfyUI, and every model those providers serve shows up in the studios.

- **No account, no middleman billing.** You pay providers directly.
- **Keys stay in your browser.** Each request sends only the key it needs to this app's server, which forwards it to the provider and never stores or logs it.
- **Runs anywhere Node runs.** `npm run build && npm start`, pm2 on a VPS, or Vercel.

## Studios

| Studio | What it does |
|---|---|
| Image | Text-to-image and image editing, up to 14 reference images on models that accept them |
| Layers | Layer decomposition, upscaling, background removal and canvas expansion |
| Cinema | Photoreal shots with camera, lens, focal length and aperture controls |
| AI Influencer | Consistent character portraits from structured traits |
| Video | Text-to-video, image-to-video, first/last frame, reference and video-to-video models |
| Motion Control | Transfer motion from a reference video onto new characters |
| Lip Sync | Talking portraits from an image + audio, or re-sync an existing video |
| Body Swap | Recast the subject of a video from a reference image |
| Marketing | Product ad videos from product and avatar images |
| Audio | Text-to-speech, sound effects and music |
| 3D | Text to 3D and Image to 3D (Meshy 7.1, Tripo, Hunyuan 3D 3.1, Rodin 2.5, Trellis 2, sketch input), plus Retexture, Rig and animate, and Mesh tools (remesh, split into parts, smart topology) on a shared model library with a built-in viewer |

## Providers

Add any combination in **Settings → Providers**. A model appears when at least one configured provider serves it. When several do, the highest one in your priority list is used.

| Provider | Good for | Get a key |
|---|---|---|
| [fal.ai](https://fal.ai) | Largest catalog: Seedance, Kling, Wan, FLUX, Hailuo, Vidu, PixVerse, LTX, Nano Banana, lip sync, upscalers. Also stores your uploads. | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) |
| [WaveSpeedAI](https://wavespeed.ai) | Wide video coverage including Veo 3.1, Runway, Seedance and Wan. Also stores your uploads. | [wavespeed.ai/accesskey](https://wavespeed.ai/accesskey) |
| [OpenRouter](https://openrouter.ai) | One key for Gemini and GPT image models | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| [Google Gemini](https://aistudio.google.com) | Nano Banana image models, direct | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| [OpenAI](https://platform.openai.com) | GPT Image models, direct | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| [ElevenLabs](https://elevenlabs.io) | Speech and multi-voice dialogue with the voices in your own account; your plan's characters are used instead of a reseller's rate. Optional: fal and WaveSpeed also serve these models. | [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) |
| ComfyUI (local) | Your own checkpoints and workflows | — |
| sd.cpp `sd-server` (local) | Lightweight local Stable Diffusion | — |

Uploads: with a fal or WaveSpeed key, reference images, videos and audio go straight from your browser to that provider's storage (signed upload URL). Without one, images up to 8 MB are sent inline.

Results and uploads are also saved in your browser (IndexedDB), so your history keeps working after provider links expire (WaveSpeed deletes files after 7 days). A small service worker (`public/oga-media-sw.js`) serves them at `/oga-media/…`; when you reuse one (Extend, Reframe, edits), the app re-uploads it if the provider link is more than 6 days old. Saved files stay on that device and browser only, and clearing site data removes them. Files from providers that block browser downloads (WaveSpeed) are streamed through `/api/media`, which only accepts fal and WaveSpeed hosts; add others with `MEDIA_PROXY_ALLOWED_HOSTS` (comma-separated host suffixes).

### Local engines

Local engines are called **straight from your browser** to your machine, never through the server, so they work the same whether the app runs on your laptop, a VPS or Vercel.

- **ComfyUI:** start it with CORS enabled, then enter its URL (default `http://127.0.0.1:8188`) and pick a checkpoint in Settings. You can also paste a workflow exported with *Save (API Format)* using `{{prompt}}`, `{{negative_prompt}}`, `{{seed}}`, `{{width}}` and `{{height}}` placeholders.

  ```bash
  python main.py --enable-cors-header '*'
  ```

- **sd.cpp server** (or any OpenAI-compatible `/v1/images/generations` server): enter its URL, e.g. `http://127.0.0.1:1234`.

Chrome asks once to allow local network access for the site. An HTTPS site can reach `http://localhost` and `http://127.0.0.1`, but not plain-http LAN addresses. To use a GPU box elsewhere on your network, serve it over HTTPS (Tailscale, Caddy) or run this app on that network.

## Quick start

Requires Node.js 20.9 or newer.

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:3000 and add a provider key in **Settings → Providers**.

## Deploy

### VPS with pm2

```bash
npm ci
npm run build
npm install -g pm2
npm run pm2:start
pm2 save && pm2 startup
```

[`ecosystem.config.js`](ecosystem.config.js) runs `next start` on `127.0.0.1:3000` (override with `HOST` / `PORT`) and writes logs to `logs/`. Put a reverse proxy in front for HTTPS, for example Caddy:

```
studio.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

To update: `git pull && npm ci && npm run build && npm run pm2:reload`.

### Vercel

Import the repository; the defaults work (framework Next.js, `npm run build`). There are no environment variables to set. Notes:

- Generation requests are short (submit, then the browser polls), so function time limits don't matter. Direct Gemini/OpenAI/OpenRouter image calls run synchronously and are allowed up to 300 s.
- Vercel rejects request bodies over 4.5 MB. Uploads go straight to fal/WaveSpeed storage so they aren't affected, but the inline fallback (no fal/WaveSpeed key) is limited to small images.

## Security model

- Keys live in the visitor's `localStorage`. They are sent per request in an `x-provider-key` header to this app's `/api/generate`, `/api/jobs` and `/api/uploads` routes, which call the provider and discard the key.
- The server only calls provider endpoints from the route table, never URLs the browser supplies. Media URLs it has to download for Gemini/OpenAI must be public `https` URLs that don't resolve to private addresses.
- API routes reject cross-site requests, and a Content-Security-Policy is applied to every page.
- Anyone who opens your deployment can use it **with their own keys**. Nothing is billed to you.
- Keys in `localStorage` are readable by any script running on the page, so the app loads no third-party scripts, renders no raw HTML, and the CSP only allows scripts from its own origin. Browser extensions with access to the site can still read them, so use keys with spending limits.
- Serve the app over HTTPS (Caddy/nginx in front of pm2, or Vercel) so keys are encrypted in transit, and don't enable request-header logging in your reverse proxy.
- Next.js collects anonymous build telemetry by default. `ecosystem.config.js` turns it off for the server; run `npx next telemetry disable` once to turn it off for builds on your machine.

## How it works

```
studio component ─▶ generation.js (builds a payload in one shared vocabulary)
                 ─▶ providers/client.js  picks a route for the model from the visitor's configured providers
                       ├─ local engine ─▶ browser ─▶ ComfyUI / sd-server
                       └─ cloud ─▶ POST /api/generate ─▶ providers/server ─▶ mapper ─▶ fal / WaveSpeed / Gemini / OpenAI / OpenRouter
                                   POST /api/jobs (poll) ◀───────────────────────────┘
```

| Path | Purpose |
|---|---|
| `packages/studio/src/components/` | The studios (React) |
| `packages/studio/src/models.js` and `*Models.js` | Model catalog and UI parameters |
| `packages/studio/src/generation.js` | Studio entry points (`generateImage`, `generateVideo`, `processLipSync`, …) |
| `packages/studio/src/providers/catalog/routes/*.json` | Which provider endpoints serve each catalog model |
| `packages/studio/src/providers/catalog/schemas/*.json` | Snapshots of each provider endpoint's input schema |
| `packages/studio/src/providers/mapper.js` | Translates a studio payload into a provider's input using the schema |
| `packages/studio/src/providers/server/` | Provider adapters (fal queue, WaveSpeed, Gemini, OpenAI, OpenRouter) |
| `packages/studio/src/providers/local/` | Browser-direct ComfyUI and sd-server connectors |
| `app/api/` | `generate`, `jobs`, `uploads` and `media` route handlers |
| `packages/studio/src/providers/mediaStore.js`, `public/oga-media-sw.js` | Saves results and uploads in the browser and serves them at `/oga-media/…` |
| `components/StandaloneShell.js`, `components/ProvidersModal.js` | App shell and provider settings |

### Adding or fixing a model route

A route maps one catalog endpoint to a provider endpoint:

```json
"seedance-2.5-image-to-video-1080p": [
  { "provider": "fal", "endpoint": "bytedance/seedance-2.5/image-to-video", "fixed": { "resolution": "1080p" } },
  { "provider": "wavespeed", "endpoint": "bytedance/seedance-2.5/image-to-video", "fixed": { "resolution": "1080p" } }
]
```

Optional keys: `rename` (our field → provider field), `split` (spread a list over several fields, e.g. first/last frame), `fixed` (always send), `defaults` (fill when empty), `drop`, and `values` (enum remaps). The mapper handles common aliases, type coercion and enum matching against the schema snapshot.

```bash
node scripts/sync-provider-schemas.mjs      # snapshot input schemas for new routes (public, no key needed)
node scripts/validate-routes.mjs --verbose  # check every route against its schema
node scripts/build-catalog-index.mjs        # regenerate the bundled catalog modules
```

## Models that are not included

The catalog only contains models that at least one supported provider serves. Not included: Sora (OpenAI shut the API down), Midjourney and Suno (no official API). To add a model, add its catalog entry and a route (see above), then run the validator.

## License

[MIT](LICENSE)

## Credits

Openstudio started as a fork of [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI) by Anil Matcha and contributors (MIT). The provider layer, studios and UI have since been rebuilt; the original copyright notice is kept in `LICENSE`.
