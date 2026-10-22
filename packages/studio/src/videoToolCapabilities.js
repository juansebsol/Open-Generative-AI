const HEYGEN_TRANSLATION_LANGUAGES = Object.freeze([
  "English",
  "Spanish",
  "French",
  "Hindi",
  "Italian",
  "German",
  "Polish",
  "Portuguese",
  "Chinese",
  "Japanese",
  "Dutch",
  "Turkish",
  "Korean",
  "Danish",
  "Arabic",
  "Romanian",
  "Mandarin",
  "Filipino",
  "Swedish",
  "Indonesian",
  "Ukrainian",
  "Greek",
  "Czech",
  "Bulgarian",
  "Malay",
  "Slovak",
  "Croatian",
  "Tamil",
  "Finnish",
  "Russian",
  "Afrikaans (South Africa)",
  "Albanian (Albania)",
  "Amharic (Ethiopia)",
  "Arabic (Algeria)",
  "Arabic (Bahrain)",
  "Arabic (Egypt)",
  "Arabic (Iraq)",
  "Arabic (Jordan)",
  "Arabic (Kuwait)",
  "Arabic (Lebanon)",
  "Arabic (Libya)",
  "Arabic (Morocco)",
  "Arabic (Oman)",
  "Arabic (Qatar)",
  "Arabic (Saudi Arabia)",
  "Arabic (Syria)",
  "Arabic (Tunisia)",
  "Arabic (United Arab Emirates)",
  "Arabic (Yemen)",
  "Armenian (Armenia)",
  "Azerbaijani (Latin, Azerbaijan)",
  "Bangla (Bangladesh)",
  "Basque",
  "Bengali (India)",
  "Bosnian (Bosnia and Herzegovina)",
  "Bulgarian (Bulgaria)",
  "Burmese (Myanmar)",
  "Catalan",
  "Chinese (Cantonese, Traditional)",
  "Chinese (Jilu Mandarin, Simplified)",
  "Chinese (Mandarin, Simplified)",
  "Chinese (Northeastern Mandarin, Simplified)",
  "Chinese (Southwestern Mandarin, Simplified)",
  "Chinese (Taiwanese Mandarin, Traditional)",
  "Chinese (Wu, Simplified)",
  "Chinese (Zhongyuan Mandarin Henan, Simplified)",
  "Chinese (Zhongyuan Mandarin Shaanxi, Simplified)",
  "Croatian (Croatia)",
  "Czech (Czechia)",
  "Danish (Denmark)",
  "Dutch (Belgium)",
  "Dutch (Netherlands)",
  "English (Australia)",
  "English (Canada)",
  "English (Hong Kong SAR)",
  "English (India)",
  "English (Ireland)",
  "English (Kenya)",
  "English (New Zealand)",
  "English (Nigeria)",
  "English (Philippines)",
  "English (Singapore)",
  "English (South Africa)",
  "English (Tanzania)",
  "English (UK)",
  "English (United States)",
  "Estonian (Estonia)",
  "Filipino (Philippines)",
  "Finnish (Finland)",
  "French (Belgium)",
  "French (Canada)",
  "French (France)",
  "French (Switzerland)",
  "Galician",
  "Georgian (Georgia)",
  "German (Austria)",
  "German (Germany)",
  "German (Switzerland)",
  "Greek (Greece)",
  "Gujarati (India)",
  "Hebrew (Israel)",
  "Hindi (India)",
  "Hungarian (Hungary)",
  "Icelandic (Iceland)",
  "Indonesian (Indonesia)",
  "Irish (Ireland)",
  "Italian (Italy)",
  "Japanese (Japan)",
  "Javanese (Latin, Indonesia)",
  "Kannada (India)",
  "Kazakh (Kazakhstan)",
  "Khmer (Cambodia)",
  "Korean (Korea)",
  "Lao (Laos)",
  "Latvian (Latvia)",
  "Lithuanian (Lithuania)",
  "Macedonian (North Macedonia)",
  "Malay (Malaysia)",
  "Malayalam (India)",
  "Maltese (Malta)",
  "Marathi (India)",
  "Mongolian (Mongolia)",
  "Nepali (Nepal)",
  "Norwegian Bokmål (Norway)",
  "Pashto (Afghanistan)",
  "Persian (Iran)",
  "Polish (Poland)",
  "Portuguese (Brazil)",
  "Portuguese (Portugal)",
  "Romanian (Romania)",
  "Russian (Russia)",
  "Serbian (Latin, Serbia)",
  "Sinhala (Sri Lanka)",
  "Slovak (Slovakia)",
  "Slovenian (Slovenia)",
  "Somali (Somalia)",
  "Spanish (Argentina)",
  "Spanish (Bolivia)",
  "Spanish (Chile)",
  "Spanish (Colombia)",
  "Spanish (Costa Rica)",
  "Spanish (Cuba)",
  "Spanish (Dominican Republic)",
  "Spanish (Ecuador)",
  "Spanish (El Salvador)",
  "Spanish (Equatorial Guinea)",
  "Spanish (Guatemala)",
  "Spanish (Honduras)",
  "Spanish (Mexico)",
  "Spanish (Nicaragua)",
  "Spanish (Panama)",
  "Spanish (Paraguay)",
  "Spanish (Peru)",
  "Spanish (Puerto Rico)",
  "Spanish (Spain)",
  "Spanish (United States)",
  "Spanish (Uruguay)",
  "Spanish (Venezuela)",
  "Sundanese (Indonesia)",
  "Swahili (Kenya)",
  "Swahili (Tanzania)",
  "Swedish (Sweden)",
  "Tamil (India)",
  "Tamil (Malaysia)",
  "Tamil (Singapore)",
  "Tamil (Sri Lanka)",
  "Telugu (India)",
  "Thai (Thailand)",
  "Turkish (Türkiye)",
  "Ukrainian (Ukraine)",
  "Urdu (India)",
  "Urdu (Pakistan)",
  "Uzbek (Latin, Uzbekistan)",
  "Vietnamese (Vietnam)",
  "Welsh (United Kingdom)",
  "Zulu (South Africa)",
  "English - Your Accent",
  "English - American Accent",
]);

const KLING_EDIT_TOOL_IDS = Object.freeze([
  "kling-o1-video-edit",
  "kling-o1-video-edit-fast",
  "kling-o1-standard-video-edit",
]);

// Edit and extend tools always forward the prompt to the provider.
const PROMPT_TOOL_IDS = Object.freeze([
  ...KLING_EDIT_TOOL_IDS,
  "gemini-omni-video-edit",
  "wan2.2-edit-video",
  "wan2.7-video-edit",
  "happy-horse-1-video-edit-1080p",
  "happy-horse-1-video-edit-720p",
  "seedance-v1.5-pro-video-extend",
  "seedance-v1.5-pro-video-extend-fast",
  "wan2.7-video-extend",
  "pixverse-v6-extend",
]);

const KLING_ASPECT_RATIO_TOOL_IDS = new Set([
  "kling-o1-video-edit",
  "kling-o1-video-edit-fast",
]);

const VIDEO_TOOL_OVERRIDES = Object.create(null);

for (const id of PROMPT_TOOL_IDS) {
  VIDEO_TOOL_OVERRIDES[id] = { hasPrompt: true };
}

for (const id of KLING_EDIT_TOOL_IDS) {
  const inputs = {};

  if (KLING_ASPECT_RATIO_TOOL_IDS.has(id)) {
    inputs.aspect_ratio = {
      title: "Aspect ratio",
      type: "string",
      enum: ["16:9", "9:16", "1:1"],
      default: "16:9",
      configurable: true,
    };
  }
  inputs.keep_original_sound = {
    title: "Keep original sound",
    type: "boolean",
    default: true,
    configurable: true,
  };

  VIDEO_TOOL_OVERRIDES[id] = {
    ...VIDEO_TOOL_OVERRIDES[id],
    inputs,
    payloadDefaults: { images_list: [] },
  };
}

Object.assign(VIDEO_TOOL_OVERRIDES, {
  "video-watermark-remover": {
    hasPrompt: false,
  },
  "ai-video-upscaler": {
    hasPrompt: false,
    inputs: {
      resolution: {
        title: "Target resolution",
        type: "string",
        enum: ["720p", "1080p", "2k", "4k"],
        default: "720p",
        configurable: true,
      },
      copy_audio: {
        title: "Keep audio",
        type: "boolean",
        default: true,
        configurable: true,
      },
    },
  },
  "heygen-video-translate": {
    hasPrompt: false,
    inputs: {
      language: {
        title: "Target language",
        type: "string",
        enum: HEYGEN_TRANSLATION_LANGUAGES,
        default: "Hindi",
        configurable: true,
      },
    },
  },
  "topaz-video-upscale": {
    hasPrompt: false,
    inputs: {
      upscale_factor: {
        title: "Upscale factor",
        type: "integer",
        enum: [1, 2, 4],
        default: 2,
        configurable: true,
      },
    },
  },
  "ltx-2.3-video-extend": {
    hasPrompt: true,
    inputs: {
      duration: {
        configurable: true,
      },
    },
  },
  "pixverse-v6-extend": {
    ...VIDEO_TOOL_OVERRIDES["pixverse-v6-extend"],
    inputs: {
      resolution: {
        configurable: true,
      },
      duration: {
        configurable: true,
      },
      generate_audio_switch: {
        configurable: true,
      },
      negative_prompt: {
        configurable: true,
        optional: true,
      },
      style: {
        configurable: true,
        optional: true,
      },
    },
  },
});

for (const id of ["seedance-v1.5-pro-video-extend", "seedance-v1.5-pro-video-extend-fast"]) {
  VIDEO_TOOL_OVERRIDES[id] = {
    ...VIDEO_TOOL_OVERRIDES[id],
    inputs: {
      resolution: { configurable: true },
      duration: { configurable: true },
      generate_audio: { configurable: true },
      camera_fixed: { configurable: true },
    },
  };
}

function mergeInputs(modelInputs = {}, overrideInputs = {}) {
  const inputs = { ...modelInputs };
  for (const [key, override] of Object.entries(overrideInputs)) {
    inputs[key] = { ...modelInputs[key], ...override };
  }
  return inputs;
}

function getVideoToolCapabilities(model) {
  if (!model) return null;
  const override = VIDEO_TOOL_OVERRIDES[model.id] || {};
  return {
    ...model,
    ...override,
    inputs: mergeInputs(model.inputs, override.inputs),
  };
}

function getVideoToolOptionDefinitions(model) {
  const capabilities = getVideoToolCapabilities(model);
  if (!capabilities) return [];

  return Object.entries(capabilities.inputs || {})
    .filter(([, input]) => input.configurable)
    .map(([key, input]) => ({ key, ...input }));
}

export function serializeVideoToolOptions(model, values = {}) {
  const payload = {};
  for (const input of getVideoToolOptionDefinitions(model)) {
    const value = values[input.key];
    if (typeof value === "string") {
      const normalizedValue = value.trim();
      if (normalizedValue) payload[input.key] = normalizedValue;
    } else if (value !== undefined && value !== null) {
      payload[input.key] = value;
    }
  }
  return payload;
}

function getVideoToolPayloadDefaults(model) {
  const capabilities = getVideoToolCapabilities(model);
  return { ...(capabilities?.payloadDefaults || {}) };
}

export function buildVideoToolPayload(model, params = {}) {
  const capabilities = getVideoToolCapabilities(model);
  const videoField = capabilities?.videoField || "video_url";
  const payload = {
    [videoField]: params.video_url,
    ...getVideoToolPayloadDefaults(model),
  };

  if (capabilities?.imageField && params.image_url) {
    payload[capabilities.imageField] = params.image_url;
  }
  if (capabilities?.hasPrompt && params.prompt) {
    payload.prompt = params.prompt;
  }

  return {
    ...payload,
    ...serializeVideoToolOptions(model, params.options),
  };
}
