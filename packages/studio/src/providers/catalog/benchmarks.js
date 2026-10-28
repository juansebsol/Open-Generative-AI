// Curated quality scores for the Benchmarks page, keyed by catalog model id.
//
// Every number here was read off a public leaderboard on BENCHMARKS_UPDATED;
// nothing is estimated. A catalog model that is missing from this file is
// shown as "unscored" rather than given a guess. When a leaderboard lists a
// model under a different name or tier than the catalog uses, `note` says
// which row the score was taken from.
//
// Sources (all read on 2026-10-27):
//   aa-t2i   Artificial Analysis AA-Image-T2I v2.1 (Image Arena, overall)
//            https://artificialanalysis.ai/image/leaderboard/text-to-image
//   aa-edit  Artificial Analysis AA-Image-Editing v2.1 (overall)
//            https://artificialanalysis.ai/image/leaderboard/editing
//   aa-t2v   Artificial Analysis AA-Video-T2V v2.1 (with audio, overall)
//            https://artificialanalysis.ai/video/leaderboard/text-to-video
//   aa-i2v   Artificial Analysis AA-Video-I2V v1.1 (with audio, overall)
//            https://artificialanalysis.ai/video/leaderboard/image-to-video
//   aa-tts   Artificial Analysis Text to Speech Arena (provider voices)
//            https://artificialanalysis.ai/text-to-speech/leaderboard
//   aa-vocal Artificial Analysis AA-Music-Vocal v1.1
//            https://artificialanalysis.ai/music/leaderboard/vocals
//   aa-inst  Artificial Analysis AA-Music-Instrumental v1.1
//            https://artificialanalysis.ai/music/leaderboard/instrumental
//   top3d    Top3D.ai 3D AI Tools Leaderboard, overall quality (user votes)
//            https://www.top3d.ai/leaderboard
//            Cross-checked against https://crafiq.ai/rankings/3d, which ranks
//            Tripo H3.1 and Hunyuan3D 3.1 first and second on its own scale.
//   rapidata-svg
//            Rapidata SVG benchmark (benchmark.ai), overall ranking: blind
//            pairwise human preference on SVGs written by language models
//            and native vector models, Bradley-Terry fitted and rescaled to
//            Elo as R = 400β + 1000, which stretches the spread about 2.3×
//            compared with a standard Elo board. The same DECENT_GAP and
//            VALUE_FLOOR_GAP apply, so on this board they are stricter cuts.
//            https://www.benchmark.ai/svg (data: huggingface.co/datasets/Rapidata/svg-benchmark)
//            Read 2026-10-27; the page dates its latest update 2026-10-28 (UTC+).
//   Also consulted: LMArena / arena.ai text-to-image and image-edit boards
//   (https://arena.ai/leaderboard). Their Elo is on a different scale, so
//   only one scale per category is used here.
//
// All scores are Elo-style ratings from blind pairwise votes: 1000 is the
// board's anchor, and a model 100 points above another is expected to win
// about 64% of head-to-head comparisons. Scores are only comparable within
// one source, which is why every category below uses a single board (music
// uses the vocal board, with the instrumental board for instrumental-only
// models, and says so on each row).
//
// To update: open each source, read the Elo for the rows named below, change
// the numbers and BENCHMARKS_UPDATED, and add new catalog models by their
// catalog id. `npm test` checks that every scored id exists in the catalog.

export const BENCHMARKS_UPDATED = '2026-10-27';

export const SOURCES = {
  'aa-t2i': { name: 'Artificial Analysis Image Arena (text to image)', url: 'https://artificialanalysis.ai/image/leaderboard/text-to-image' },
  'aa-edit': { name: 'Artificial Analysis Image Arena (editing)', url: 'https://artificialanalysis.ai/image/leaderboard/editing' },
  'aa-t2v': { name: 'Artificial Analysis Video Arena (text to video)', url: 'https://artificialanalysis.ai/video/leaderboard/text-to-video' },
  'aa-i2v': { name: 'Artificial Analysis Video Arena (image to video)', url: 'https://artificialanalysis.ai/video/leaderboard/image-to-video' },
  'aa-tts': { name: 'Artificial Analysis Speech Arena', url: 'https://artificialanalysis.ai/text-to-speech/leaderboard' },
  'aa-vocal': { name: 'Artificial Analysis Music Arena (vocal)', url: 'https://artificialanalysis.ai/music/leaderboard/vocals' },
  'aa-inst': { name: 'Artificial Analysis Music Arena (instrumental)', url: 'https://artificialanalysis.ai/music/leaderboard/instrumental' },
  top3d: { name: 'Top3D.ai 3D arena (overall quality)', url: 'https://www.top3d.ai/leaderboard' },
  'rapidata-svg': { name: 'Rapidata SVG benchmark (human preference)', url: 'https://www.benchmark.ai/svg' },
};

// ── Thresholds ──────────────────────────────────────────────────────────────
//
// "Decent" is relative to the best model in the category: a model counts as
// decent when its score is within DECENT_GAP Elo of the category leader. At
// 200 points the leader wins roughly three of four head-to-head votes against
// it, which is the point where most people still accept the cheaper result.
export const DECENT_GAP = 200;

// Value is quality per dollar, but raw Elo per dollar would crown whatever is
// cheapest: a 740-Elo model at half a cent beats everything. So value only
// counts quality above a floor set VALUE_FLOOR_GAP Elo below the leader; at
// 300 points the leader wins about 85% of votes, and anything that far back
// is treated as having no usable quality in this category.
//
//   value = max(0, score - (topScore - VALUE_FLOOR_GAP)) / pricePerRun
//
// A free (local) model with any quality above the floor has infinite value.
export const VALUE_FLOOR_GAP = 300;

const entry = (source, score, leaderboardName, note) => ({ score, source, leaderboardName, ...(note ? { note } : {}) });

export const BENCHMARKS = {
  // ── Text to image: aa-t2i ─────────────────────────────────────────────────
  'gpt-image-2.5-sunburst-text-to-image': entry('aa-t2i', 1222, 'GPT Image 2.5 Sunburst (max)', 'Scored at max quality; the studio default is high.'),
  'gpt-image-2.5-flare-text-to-image': entry('aa-t2i', 1207, 'GPT Image 2.5 Flare (max)', 'Scored at max quality; the studio default is high.'),
  'gpt-image-2': entry('aa-t2i', 1186, 'GPT Image 2 (high)'),
  'nano-banana-2-1': entry('aa-t2i', 1176, 'Nano Banana 2.1'),
  'grok-imagine-image-2': entry('aa-t2i', 1166, 'Grok Imagine Image 2.0'),
  'nano-banana-2': entry('aa-t2i', 1140, 'Nano Banana 2 (Gemini 3.1 Flash Image)'),
  'muse-image-text-to-image': entry('aa-t2i', 1127, 'Muse Image'),
  'gpt-image-1.5': entry('aa-t2i', 1123, 'GPT Image 1.5 (high)'),
  'nano-banana-pro': entry('aa-t2i', 1118, 'Nano Banana Pro (Gemini 3 Pro Image)'),
  'nano-banana-2-lite': entry('aa-t2i', 1107, 'Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)'),
  'bytedance-seedream-5.0-pro': entry('aa-t2i', 1100, 'Seedream 5.0 Pro'),
  'qwen3-pro-text-to-image': entry('aa-t2i', 1095, 'Qwen-Image-3.0-Pro'),
  'qwen3-text-to-image': entry('aa-t2i', 1070, 'Qwen-Image-3.0'),
  'grok-imagine-text-to-image-quality': entry('aa-t2i', 1049, 'grok-imagine-image-quality'),
  'qwen-image-2.0-pro': entry('aa-t2i', 1030, 'Qwen Image 2.0 Pro (2026-04-22)'),
  'wan2.6-text-to-image': entry('aa-t2i', 1027, 'Wan 2.6 Image'),
  'bytedance-seedream-v4.5': entry('aa-t2i', 1026, 'Seedream 4.5'),
  'flux-2-flex': entry('aa-t2i', 1026, 'FLUX.2 [flex]'),
  'grok-imagine-text-to-image': entry('aa-t2i', 1022, 'grok-imagine-image'),
  'krea-v2-turbo': entry('aa-t2i', 1020, 'Krea 2 Medium Turbo', 'The board lists the Medium Turbo tier.'),
  'seedream-5.0': entry('aa-t2i', 1017, 'Seedream 5.0 Lite', 'The catalog route is the Lite endpoint.'),
  'bytedance-seedream-v5.0': entry('aa-t2i', 1017, 'Seedream 5.0 Lite', 'The catalog route is the Lite endpoint.'),
  'flux-2-pro': entry('aa-t2i', 1003, 'FLUX.2 [pro]'),
  'ideogram-v4': entry('aa-t2i', 1002, 'Ideogram 4.0', 'The Quality tier scores 1026 on the same board.'),
  'flux-2-dev': entry('aa-t2i', 1000, 'FLUX.2 [dev]'),
  'qwen-image-2.0': entry('aa-t2i', 990, 'Qwen Image 2.0 (2026-03-03)'),
  'wan2.7-text-to-image': entry('aa-t2i', 986, 'Wan 2.7'),
  'nano-banana': entry('aa-t2i', 985, 'Nano Banana (Gemini 2.5 Flash Image)'),
  'wan2.7-text-to-image-pro': entry('aa-t2i', 979, 'Wan 2.7 Pro'),
  'z-image-turbo': entry('aa-t2i', 936, 'Z-Image Turbo'),
  'hunyuan-image-3.0': entry('aa-t2i', 932, 'HunyuanImage 3.0', 'The open-weights row; Tencent Cloud\'s hosted version scores 989.'),
  'flux-2-klein-9b': entry('aa-t2i', 929, 'FLUX.2 [klein] 9B'),
  'flux-kontext-max-t2i': entry('aa-t2i', 929, 'FLUX.1 Kontext [max]'),
  'kling-o3-image': entry('aa-t2i', 918, 'Kling Image 3.0 Omni'),
  'flux-kontext-pro-t2i': entry('aa-t2i', 917, 'FLUX.1 Kontext [pro]'),
  'ideogram-v3-t2i': entry('aa-t2i', 911, 'Ideogram 3.0'),
  'qwen-image': entry('aa-t2i', 903, 'Qwen Image'),
  'flux-krea-dev': entry('aa-t2i', 896, 'FLUX.1 Krea [dev]'),
  'vidu-q2-text-to-image': entry('aa-t2i', 896, 'Vidu Q2'),
  'z-image-base': entry('aa-t2i', 891, 'Z-Image Base'),
  'flux-2-klein-4b': entry('aa-t2i', 837, 'FLUX.2 [klein] 4B'),
  'flux-dev': entry('aa-t2i', 823, 'FLUX.1 [dev]'),
  'flux-schnell': entry('aa-t2i', 740, 'FLUX.1 [schnell]'),

  // ── Image editing: aa-edit ────────────────────────────────────────────────
  'gpt-image-2.5-sunburst-image-to-image': entry('aa-edit', 1199, 'GPT Image 2.5 Sunburst (max)', 'Scored at max quality; the studio default is high.'),
  'gpt-image-2.5-flare-image-to-image': entry('aa-edit', 1182, 'GPT Image 2.5 Flare (max)', 'Scored at max quality; the studio default is high.'),
  'nano-banana-2-1-edit': entry('aa-edit', 1151, 'Nano Banana 2.1'),
  'gpt-image-2-edit': entry('aa-edit', 1136, 'GPT Image 2 (high)'),
  'bytedance-seedream-5.0-pro-edit': entry('aa-edit', 1131, 'Seedream 5.0 Pro'),
  'muse-image-edit': entry('aa-edit', 1129, 'Muse Image'),
  'nano-banana-2-edit': entry('aa-edit', 1123, 'Nano Banana 2 (Gemini 3.1 Flash Image)'),
  'gpt-image-1.5-edit': entry('aa-edit', 1119, 'GPT Image 1.5 (high)'),
  'nano-banana-pro-edit': entry('aa-edit', 1108, 'Nano Banana Pro (Gemini 3 Pro Image)'),
  'qwen3-pro-image-to-image': entry('aa-edit', 1091, 'Qwen-Image-3.0-Pro'),
  'grok-imagine-image-to-image': entry('aa-edit', 1073, 'grok-imagine-image', 'The Image 2.0 edit row scores 1117; the catalog route is the first-generation edit endpoint.'),
  'qwen3-image-to-image': entry('aa-edit', 1068, 'Qwen-Image-3.0'),
  'seedream-5.0-edit': entry('aa-edit', 1062, 'Seedream 5.0 Lite', 'The catalog route is the Lite endpoint.'),
  'bytedance-seedream-v5.0-edit': entry('aa-edit', 1062, 'Seedream 5.0 Lite', 'The catalog route is the Lite endpoint.'),
  'qwen-image-2.0-pro-edit': entry('aa-edit', 1058, 'Qwen Image 2.0 Pro (2026-04-22)'),
  'nano-banana-2-lite-edit': entry('aa-edit', 1054, 'Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)'),
  'wan2.7-image-edit-pro': entry('aa-edit', 1050, 'Wan 2.7 Pro'),
  'wan2.6-image-edit': entry('aa-edit', 1044, 'Wan 2.6 Image'),
  'bytedance-seedream-v4.5-edit': entry('aa-edit', 1043, 'Seedream 4.5'),
  'wan2.7-image-edit': entry('aa-edit', 1042, 'Wan 2.7'),
  'flux-2-klein-9b-edit': entry('aa-edit', 1015, 'FLUX.2 [klein] 9B'),
  'flux-2-pro-edit': entry('aa-edit', 1012, 'FLUX.2 [pro]'),
  'flux-2-dev-edit': entry('aa-edit', 1000, 'FLUX.2 [dev]'),
  'flux-2-flex-edit': entry('aa-edit', 999, 'FLUX.2 [flex]'),
  'qwen-image-edit-2511': entry('aa-edit', 991, 'Qwen Image Edit Plus 2511'),
  'nano-banana-edit': entry('aa-edit', 984, 'Nano Banana (Gemini 2.5 Flash Image)'),
  'qwen-image-2.0-edit': entry('aa-edit', 966, 'Qwen Image 2.0 (2026-03-03)'),
  'qwen-image-edit-plus': entry('aa-edit', 965, 'Qwen Image Edit Plus 2509'),
  'kling-o3-image-edit': entry('aa-edit', 952, 'Kling Image 3.0 Omni'),
  'kling-o1-edit-image': entry('aa-edit', 944, 'Kling Image O1'),
  'flux-2-klein-4b-edit': entry('aa-edit', 938, 'FLUX.2 [klein] 4B'),
  'flux-kontext-max-i2i': entry('aa-edit', 932, 'FLUX.1 Kontext [max]'),
  'flux-kontext-pro-i2i': entry('aa-edit', 916, 'FLUX.1 Kontext [pro]'),
  'qwen-image-edit': entry('aa-edit', 889, 'Qwen Image Edit'),
  'flux-kontext-dev-i2i': entry('aa-edit', 883, 'FLUX.1 Kontext [dev]'),

  // ── Text to video: aa-t2v (with audio) ────────────────────────────────────
  'wan3.0-text-to-video': entry('aa-t2v', 1174, 'Wan 3.0'),
  'minimax-h3-text-to-video': entry('aa-t2v', 1158, 'MiniMax H3 (768p)'),
  'seedance-2.5-text-to-video': entry('aa-t2v', 1156, 'Dreamina Seedance 2.5'),
  'seedance-2.5-text-to-video-480p': entry('aa-t2v', 1156, 'Dreamina Seedance 2.5', 'Same model at 480p; the board does not score resolutions separately.'),
  'seedance-2.5-text-to-video-1080p': entry('aa-t2v', 1156, 'Dreamina Seedance 2.5', 'Same model at 1080p; the board does not score resolutions separately.'),
  'seedance-2.5-text-to-video-4k': entry('aa-t2v', 1156, 'Dreamina Seedance 2.5', 'Same model at 4K; the board does not score resolutions separately.'),
  'minimax-h3-max-text-to-video': entry('aa-t2v', 1152, 'MiniMax H3 Max'),
  'flux-3-text-to-video': entry('aa-t2v', 1142, 'FLUX 3'),
  'seedance-2-text-to-video': entry('aa-t2v', 1136, 'Dreamina Seedance 2.0'),
  'seedance-2-t2v-480p': entry('aa-t2v', 1136, 'Dreamina Seedance 2.0', 'Same model at 480p.'),
  'seedance-2-vip-text-to-video-1080p': entry('aa-t2v', 1136, 'Dreamina Seedance 2.0', 'Same model at 1080p.'),
  'seedance-2-vip-text-to-video-4k': entry('aa-t2v', 1136, 'Dreamina Seedance 2.0', 'Same model at 4K.'),
  'gemini-omni-flash-1-1-text-to-video': entry('aa-t2v', 1128, 'Gemini Omni Flash 1.1'),
  'happy-horse-1.1-text-to-video': entry('aa-t2v', 1050, 'HappyHorse-1.1'),
  'happy-horse-1.1-text-to-video-1080p': entry('aa-t2v', 1050, 'HappyHorse-1.1', 'Same model at 1080p.'),
  'happy-horse-1.1-text-to-video-720p': entry('aa-t2v', 1050, 'HappyHorse-1.1', 'Same model at 720p.'),
  'wan2.7-text-to-video': entry('aa-t2v', 1037, 'Wan2.7-260612'),
  'happy-horse-1-text-to-video': entry('aa-t2v', 1033, 'HappyHorse-1.0'),
  'happy-horse-1-text-to-video-1080p': entry('aa-t2v', 1033, 'HappyHorse-1.0', 'Same model at 1080p.'),
  'happy-horse-1-text-to-video-720p': entry('aa-t2v', 1033, 'HappyHorse-1.0', 'Same model at 720p.'),
  'kling-v3.0-omni-pro-text-to-video': entry('aa-t2v', 1020, 'Kling 3.0 Omni 1080p (Pro)'),
  'kling-v3.0-pro-text-to-video': entry('aa-t2v', 1000, 'Kling 3.0 1080p (Pro)', 'The board\'s anchor model.'),
  'pixverse-v6-t2v': entry('aa-t2v', 983, 'PixVerse V6'),
  'veo3.1-text-to-video': entry('aa-t2v', 961, 'Veo 3.1'),
  'veo3.1-fast-text-to-video': entry('aa-t2v', 958, 'Veo 3.1 Fast'),
  'veo3.1-lite-text-to-video': entry('aa-t2v', 951, 'Veo 3.1 Lite'),
  'ltx-2.5-text-to-video': entry('aa-t2v', 944, 'LTX-2.5 Pro', 'Scored as the Pro tier; LTX-2.5 Fast scores 949.'),
  'vidu-q3-pro-text-to-video': entry('aa-t2v', 937, 'Vidu Q3 Pro'),
  'vidu-q3-turbo-text-to-video': entry('aa-t2v', 915, 'Vidu Q3 Turbo'),
  'ltx-2.3-text-to-video': entry('aa-t2v', 886, 'LTX-2.3 Pro', 'Scored as the Pro tier; LTX-2.3 Fast scores 839.'),

  // ── Image to video: aa-i2v (with audio) ───────────────────────────────────
  'minimax-h3-image-to-video': entry('aa-i2v', 1140, 'MiniMax H3 (768p)'),
  'seedance-2.5-image-to-video': entry('aa-i2v', 1138, 'Dreamina Seedance 2.5'),
  'seedance-2.5-image-to-video-480p': entry('aa-i2v', 1138, 'Dreamina Seedance 2.5', 'Same model at 480p.'),
  'seedance-2.5-image-to-video-1080p': entry('aa-i2v', 1138, 'Dreamina Seedance 2.5', 'Same model at 1080p.'),
  'seedance-2.5-image-to-video-4k': entry('aa-i2v', 1138, 'Dreamina Seedance 2.5', 'Same model at 4K.'),
  'seedance-2.5-first-last-frame': entry('aa-i2v', 1138, 'Dreamina Seedance 2.5', 'Same model, first and last frame input.'),
  'seedance-2.5-omni-reference': entry('aa-i2v', 1138, 'Dreamina Seedance 2.5', 'Same model, reference input.'),
  'gemini-omni-flash-1-1-image-to-video': entry('aa-i2v', 1132, 'Gemini Omni Flash 1.1'),
  'wan3.0-image-to-video': entry('aa-i2v', 1127, 'Wan 3.0'),
  'minimax-h3-max-image-to-video': entry('aa-i2v', 1125, 'MiniMax H3 Max'),
  'seedance-2-image-to-video': entry('aa-i2v', 1121, 'Dreamina Seedance 2.0'),
  'seedance-2-i2v-480p': entry('aa-i2v', 1121, 'Dreamina Seedance 2.0', 'Same model at 480p.'),
  'seedance-2-vip-image-to-video-1080p': entry('aa-i2v', 1121, 'Dreamina Seedance 2.0', 'Same model at 1080p.'),
  'seedance-2-vip-image-to-video-4k': entry('aa-i2v', 1121, 'Dreamina Seedance 2.0', 'Same model at 4K.'),
  'seedance-2-first-last-frame': entry('aa-i2v', 1121, 'Dreamina Seedance 2.0', 'Same model, first and last frame input.'),
  'flux-3-image-to-video': entry('aa-i2v', 1086, 'FLUX 3', 'FLUX 3 Max (720p) scores 1138 but is not in the catalog.'),
  'grok-imagine-video-1-5-preview': entry('aa-i2v', 1067, 'Grok Imagine Video 1.5'),
  'happy-horse-1.1-image-to-video': entry('aa-i2v', 1061, 'HappyHorse-1.1'),
  'happy-horse-1.1-image-to-video-1080p': entry('aa-i2v', 1061, 'HappyHorse-1.1', 'Same model at 1080p.'),
  'happy-horse-1.1-image-to-video-720p': entry('aa-i2v', 1061, 'HappyHorse-1.1', 'Same model at 720p.'),
  'happy-horse-1-image-to-video': entry('aa-i2v', 1042, 'HappyHorse-1.0'),
  'happy-horse-1-image-to-video-1080p': entry('aa-i2v', 1042, 'HappyHorse-1.0', 'Same model at 1080p.'),
  'happy-horse-1-image-to-video-720p': entry('aa-i2v', 1042, 'HappyHorse-1.0', 'Same model at 720p.'),
  'veo3.1-image-to-video': entry('aa-i2v', 1028, 'Veo 3.1'),
  'pixverse-v6-i2v': entry('aa-i2v', 1024, 'PixVerse V6'),
  'veo3.1-fast-image-to-video': entry('aa-i2v', 1017, 'Veo 3.1 Fast'),
  'vidu-q3-pro-image-to-video': entry('aa-i2v', 1016, 'Vidu Q3 Pro'),
  'kling-v3.0-omni-pro-image-to-video': entry('aa-i2v', 1004, 'Kling 3.0 Omni 1080p (Pro)'),
  'kling-v3.0-pro-image-to-video': entry('aa-i2v', 1000, 'Kling 3.0 1080p (Pro)', 'The board\'s anchor model.'),
  'vidu-q3-turbo-image-to-video': entry('aa-i2v', 967, 'Vidu Q3 Turbo'),
  'ltx-2.5-image-to-video': entry('aa-i2v', 958, 'LTX-2.5 Pro', 'Scored as the Pro tier; LTX-2.5 Fast scores 984.'),
  'ltx-2.3-image-to-video': entry('aa-i2v', 903, 'LTX-2.3 Pro', 'Scored as the Pro tier; LTX-2.3 Fast scores 888.'),

  // ── Text to speech: aa-tts (provider voices) ──────────────────────────────
  'elevenlabs-v4': entry('aa-tts', 1335, 'Eleven v4'),
  'gemini-3-1-flash-tts': entry('aa-tts', 1212, 'Gemini 3.1 Flash TTS'),
  'elevenlabs-text-to-dialogue-v3': entry('aa-tts', 1187, 'Eleven v3', 'Dialogue runs on the Eleven v3 model.'),
  'minimax-speech-2.6-hd': entry('aa-tts', 1126, 'Speech 2.6 HD'),
  'minimax-speech-2.6-turbo': entry('aa-tts', 1120, 'Speech 2.6 Turbo'),
  'elevenlabs-tts-turbo-2-5': entry('aa-tts', 1095, 'Turbo v2.5'),
  'gemini-2-5-pro-tts': entry('aa-tts', 1042, 'Gemini 2.5 Pro (Dec 2025)'),

  // ── Music: aa-vocal, with aa-inst for instrumental-only models ────────────
  'mureka-song': entry('aa-vocal', 1101, 'Mureka V9.5'),
  'mureka-instrumental': entry('aa-inst', 1084, 'Mureka V9.5', 'Instrumental board.'),
  'lyria-3-pro': entry('aa-vocal', 1047, 'Lyria 3 Pro'),
  'elevenlabs-music-v2-5': entry('aa-vocal', 1016, 'Eleven Music v2.5'),
  'minimax-music-3.0': entry('aa-vocal', 1000, 'MiniMax Music 3.0', 'The board\'s anchor model.'),
  'lyria-2': entry('aa-inst', 926, 'Lyria 2', 'Instrumental board.'),

  // ── 3D: top3d ─────────────────────────────────────────────────────────────
  'tripo-h3-1-text-to-3d': entry('top3d', 1123, 'Tripo AI v3.1'),
  'tripo-h3-1-image-to-3d': entry('top3d', 1123, 'Tripo AI v3.1'),
  'rodin-2-5-text-to-3d': entry('top3d', 1080, 'Rodin Gen 2.5'),
  'rodin-2-5-image-to-3d': entry('top3d', 1080, 'Rodin Gen 2.5'),
  'meshy-7-1-text-to-3d': entry('top3d', 1073, 'Meshy 7.1'),
  'meshy-7-1-image-to-3d': entry('top3d', 1073, 'Meshy 7.1'),
  'meshy-7-1-multi-image-to-3d': entry('top3d', 1073, 'Meshy 7.1'),
  'hunyuan-3d-3-1-pro-text-to-3d': entry('top3d', 1042, 'Hunyuan 3D v3.1'),
  'hunyuan-3d-3-1-pro-image-to-3d': entry('top3d', 1042, 'Hunyuan 3D v3.1'),
  'trellis-2-image-to-3d': entry('top3d', 861, 'TRELLIS.2'),

  // ── Vector (SVG from a prompt): rapidata-svg ──────────────────────────────
  // Chat models were scored at medium reasoning effort, which the board notes
  // per model. Ideogram Vector, Recraft Vectorize, Ideogram Image to Vector
  // and Image2SVG are on no public board and stay unscored.
  'svg-gpt-6-1-sol': entry('rapidata-svg', 1437, 'gpt-6.1-sol', 'Scored at medium reasoning effort.'),
  'svg-claude-sonnet-5-5': entry('rapidata-svg', 1392, 'claude-sonnet-5.5'),
  'svg-gemini-4-argon': entry('rapidata-svg', 1318, 'gemini-4-argon', 'Scored at medium reasoning effort.'),
  'svg-claude-haiku-5-5': entry('rapidata-svg', 1247, 'claude-haiku-5.5-thinking', 'The board lists only the thinking variant; the studio calls the model without extended thinking.'),
  'svg-gemini-3-8-flash': entry('rapidata-svg', 1079, 'gemini-3.8-flash', 'Scored at medium reasoning effort.'),
  'svg-gpt-6-luna': entry('rapidata-svg', 1054, 'gpt-6-luna'),
  'recraft-v4-1-pro-text-to-vector': entry('rapidata-svg', 1009, 'recraft-v4.1-pro-vector'),
  'recraft-v4-1-text-to-vector': entry('rapidata-svg', 998, 'recraft-v4.1-vector'),
};

/** Score entry for a catalog model id, or null when the model is unscored. */
export function getBenchmark(modelId) {
  return BENCHMARKS[modelId] || null;
}
