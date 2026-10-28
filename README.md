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
| Vector | Three pages on a shared SVG library: Text to Logo (Recraft 4.1, Recraft 4.1 Pro, Ideogram Vector, or code-written SVG from a chat model: Gemini 4 Argon, Gemini 3.8 Flash, Claude Sonnet and Haiku 5.5 via OpenRouter, GPT-6.1 Sol and GPT-6 Luna, priced per token and refinable with a sentence) with brand palettes, Icon Set (one style, many icons, exported as an SVG sprite or a zip) and Vectorize (Image2SVG, Recraft Vectorize, Ideogram image-to-vector) with a before/after view, plus a free in-browser export kit (optimised SVG, PNG, PDF, favicon.ico, app icon set) |

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

Prices: a chip next to every Generate button names the provider (API) that run will go to and its estimated cost there; its tooltip shows the exact endpoint, and clicking it opens the Providers panel; hovering a model in the Image or Video picker shows the same provider and price for that model before you choose it. On Text to Logo and Icon Set the picker is the same rail layout as the Image and Video pickers: a left rail with All, Vector models, Chat models and the vendors with counts, and a searchable list on the right grouped under "Drawn by a vector model" and "Written by a chat model", where every row shows its provider line, price and Elo, priced in one batched request per provider when it opens. When none of your keyed providers serves the selected model it reads "No provider key" and lists the ones that do. fal and WaveSpeed are asked through their pricing APIs with your key (account discounts included; WaveSpeed quotes without media are shown as "from"). Google, OpenAI and ElevenLabs have no pricing API: their quotes come from the published price table in `packages/studio/src/providers/catalog/prices.js` (fal's OpenAI and Google models use it too), and the per-token rates behind the Google and OpenAI prices are re-read from OpenRouter's public model list every 30 minutes (`PRICE_REFRESH_MINUTES`), so a vendor price change shows up without a redeploy; the tooltip says when the rate was last confirmed. ElevenLabs is priced at its per-character API rate, and local engines are free. Finished runs are added up per provider under **Settings → Providers** ("This month"), using the tokens the provider reports after the run (OpenRouter, OpenAI, Google) or else the quote. The provider's own bill is what counts. Google and OpenAI do not expose a balance for API keys, so the panel links to their usage pages instead.

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

## Benchmarks

**Benchmarks** in the top navigation (`/studio/benchmarks`) answers one question per kind of job: which model is the best, which is the best for the money, and which is the cheapest one that is still decent. It covers text to image, image editing, text to video, image to video, speech, music, 3D and vector (SVG from a prompt), and each pick has a button that opens the right studio with that model selected.

- **Scores** are curated in `packages/studio/src/providers/catalog/benchmarks.js`, keyed by catalog model id. Each entry records the Elo read from a public blind-vote leaderboard (Artificial Analysis image, video, speech and music arenas; Top3D for 3D; Rapidata's SVG benchmark for vector models and the chat models that write SVG), the leaderboard row it came from, and the date it was read. A model that no public board lists is shown as unscored rather than guessed: Ideogram Vector and the Vectorize tracers are on no public board, so they stay unscored and there is no tracer category. Rapidata's Elo scale is stretched about 2.3× compared with the other boards, so the same gaps are stricter cuts in the vector category.
- **Prices** are the same quotes as the price chip: fal and WaveSpeed through their pricing APIs with your key, Google, OpenAI and ElevenLabs from the published table. Each model is priced on its default inputs (speech on a 500-character sample), in one `/api/price` batch per provider so fal's pricing API is asked for up to 50 endpoints per call. When none of your keyed providers serves a model, the page shows its published list price if it has one, otherwise "Needs a key".
- **Decent** means within `DECENT_GAP` (200) Elo of the category leader. **Value** is quality per dollar, counting only quality above a floor `VALUE_FLOOR_GAP` (300) Elo below the leader, so a weak model does not win just by being cheap. Both constants are explained in the catalog file.

To update the scores, open each source linked in the file header, change the numbers and `BENCHMARKS_UPDATED`, and add new catalog models by their id. `npm test` checks that every scored id exists in the catalog and cites a known source.

- **Editor's choice** is Openstudio's own recommendation per category, set by hand in `packages/studio/src/providers/catalog/editorsPicks.js` (one optional `{ modelId, note, asOf }` per category) and independent of the scores. It shows as a fourth, leading card on the Benchmarks page with a star and the note, a star next to the model in the table, its own "Editor's choice" section above the chart in the helper card on each page (the chart below stays complete, with the choice at its numbered place), and a star after the price in the model pickers. Every page whose category has a choice opens on it: a choice the visitor saved before it existed is replaced once, the page remembers having applied it, and the model they pick after that persists until the editor's choice changes (Image, Video, Audio and 3D apply it through the same path as a picker selection, so sizes and families follow). The three computed picks stay as they are. Today only the vector category has one: Gemini 4 Argon, for the cleanest geometric marks, even though a few chat models score higher on the SVG arena.

### Picks on every page

Every studio page that has a model picker shows a small **Benchmarks helper** card, top right under the header, with that page's picks (best quality, best value, cheapest decent) as a numbered mini leaderboard: name, score bar, price and Elo, and clicking a row selects that model on the page you are on. **More** continues the list with the next few ranked models, **Open Benchmarks** opens the Benchmarks page on that category, and the X closes the card; a small chart button in the same corner brings it back, and the choice is remembered in this browser (on a phone-width screen it starts as the button). Escape closes it while it has focus. On every page the card shows for ten seconds and then tucks itself away to the button so the screen stays clean; hovering or focusing it keeps it open, and opening it from the button pins it until the page changes.

The bubble follows what the page is doing: Image shows text-to-image picks until a reference image is loaded, then image-editing picks; Video shows text-to-video or image-to-video picks (none for video to video); Audio shows speech or music picks depending on the selected tool; Text to 3D and Image to 3D show the 3D models that run on that page; Text to Logo and Icon Set show the vector picks. Pages without a model picker (Vibe Motion, Agents, Workflows) and Vectorize (no public board scores tracers) show no bubble. Prices and "needs a key" states come from the same batched `/api/price` quotes as the Benchmarks page and refresh when you change provider keys.

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

Import the repository; the defaults work (framework Next.js, `npm run build`). No environment variable is required; `PRICE_REFRESH_MINUTES` (default 30) sets how often list prices are re-read. Notes:

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
| `packages/studio/src/benchmarks.js`, `packages/studio/src/providers/catalog/benchmarks.js` | Benchmarks ranking and the curated leaderboard scores |
| `packages/studio/src/benchmarksHelper.js`, `packages/studio/src/components/BenchmarksHelper.jsx` | The per-page Benchmarks helper bubble: page-to-category mapping, open state, and the card itself |

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
