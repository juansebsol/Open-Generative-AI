// Published list prices for providers without a pricing API (Google, OpenAI,
// ElevenLabs). USD per generated image unless `per` says otherwise; tiers are
// keyed by the output resolution or quality the studio sends.
//
// Every image entry also records `rate`, the USD per output token the prices
// were built from, and (where listed) its OpenRouter model id. OpenRouter
// mirrors the vendors' per-token rates, so the server re-reads them every
// PRICE_REFRESH_MINUTES and scales these prices when a rate has moved. Token
// counts per image (`tokens`) and the price table itself still need a hand
// edit when a vendor changes them.
//
// Sources: https://ai.google.dev/gemini-api/docs/pricing
//          https://developers.openai.com/api/docs/pricing
//          https://fal.ai/models/openai/gpt-image-2 and /gpt-image-2.5/flare/text-to-image (per-size tables)
//          https://elevenlabs.io/pricing/api (per-character API rates)
//          https://openrouter.ai/api/v1/models (image_output per token)

export const PRICES_UPDATED = "2026-10-27";

export const PRICES = {
  google: {
    "gemini-nano-banana-2.1": {
      "per": "image",
      "tier": "resolution",
      "default": "1K",
      "prices": {
        "1K": 0.0336,
        "2K": 0.0504,
        "4K": 0.113
      },
      "tokens": {
        "1K": 1120,
        "2K": 1680,
        "4K": 3780
      },
      "rate": 3e-05,
      "inputRate": 1.5e-06,
      "openrouter": "google/gemini-nano-banana-2.1"
    },
    "gemini-3.1-flash-image": {
      "per": "image",
      "tier": "resolution",
      "default": "1K",
      "prices": {
        "512": 0.045,
        "1K": 0.067,
        "2K": 0.101,
        "4K": 0.151
      },
      "tokens": {
        "512": 747,
        "1K": 1120,
        "2K": 1680,
        "4K": 2520
      },
      "rate": 6e-05,
      "inputRate": 5e-07,
      "openrouter": "google/gemini-3.1-flash-image"
    },
    "gemini-3.1-flash-lite-image": {
      "per": "image",
      "tier": "resolution",
      "default": "1K",
      "prices": {
        "1K": 0.0336
      },
      "tokens": {
        "1K": 1120
      },
      "rate": 3e-05,
      "inputRate": 2.5e-07,
      "openrouter": "google/gemini-3.1-flash-lite-image"
    },
    "gemini-3-pro-image": {
      "per": "image",
      "tier": "resolution",
      "default": "1K",
      "prices": {
        "1K": 0.134,
        "2K": 0.134,
        "4K": 0.24
      },
      "tokens": {
        "1K": 1120,
        "2K": 1120,
        "4K": 2000
      },
      "rate": 0.00012,
      "inputRate": 2e-06,
      "openrouter": "google/gemini-3-pro-image"
    },
    "gemini-2.5-flash-image": {
      "per": "image",
      "tier": "resolution",
      "default": "1K",
      "prices": {
        "1K": 0.039
      },
      "tokens": {
        "1K": 1290
      },
      "rate": 3e-05,
      "inputRate": 3e-07,
      "openrouter": "google/gemini-2.5-flash-image"
    }
  },
  openai: {
    "gpt-image-2": {
      "per": "image",
      "tier": "quality",
      "default": "high",
      "prices": {
        "low": [
          0.006,
          0.005
        ],
        "medium": [
          0.053,
          0.041
        ],
        "high": [
          0.211,
          0.165
        ]
      },
      "sizes": {
        "2K": {
          "low": 0.007,
          "medium": 0.056,
          "high": 0.222
        },
        "4K": {
          "low": 0.012,
          "medium": 0.101,
          "high": 0.401
        }
      },
      "rate": 3e-05,
      "inputRate": 5e-06,
      "imageInputRate": 8e-06,
      "openrouter": "openai/gpt-5.4-image-2",
      "note": "1K prices are OpenAI's list; 2K and 4K are billed per token by OpenAI and come from fal's GPT Image 2 page (2560\u00d71440 and 3840\u00d72160)."
    },
    "gpt-image-2.5-flare": {
      "per": "image",
      "tier": "quality",
      "default": "high",
      "prices": {
        "low": [
          0.00588,
          0.00474
        ],
        "medium": [
          0.01317,
          0.01029
        ],
        "high": [
          0.05268,
          0.04116
        ],
        "xhigh": [
          0.09366,
          0.07377
        ],
        "max": [
          0.21072,
          0.16464
        ]
      },
      "sizes": {
        "2K": {
          "low": 0.00615,
          "medium": 0.01434,
          "high": 0.05529,
          "xhigh": 0.09828,
          "max": 0.2211
        },
        "4K": {
          "low": 0.01113,
          "medium": 0.02595,
          "high": 0.10008,
          "xhigh": 0.1779,
          "max": 0.40026
        }
      },
      "rate": 3e-05,
      "inputRate": 5e-06,
      "imageInputRate": 8e-06,
      "note": "OpenAI bills GPT Image 2.5 per output token ($30 per 1M); these per-image figures are fal's published table for the same model. \"auto\" quality can reach the max column."
    },
    "gpt-image-2.5-sunburst": {
      "per": "image",
      "tier": "quality",
      "default": "high",
      "prices": {
        "low": [
          0.00588,
          0.00474
        ],
        "medium": [
          0.01317,
          0.01029
        ],
        "high": [
          0.05268,
          0.04116
        ],
        "xhigh": [
          0.09366,
          0.07377
        ],
        "max": [
          0.21072,
          0.16464
        ]
      },
      "sizes": {
        "2K": {
          "low": 0.00615,
          "medium": 0.01434,
          "high": 0.05529,
          "xhigh": 0.09828,
          "max": 0.2211
        },
        "4K": {
          "low": 0.01113,
          "medium": 0.02595,
          "high": 0.10008,
          "xhigh": 0.1779,
          "max": 0.40026
        }
      },
      "rate": 3e-05,
      "inputRate": 5e-06,
      "imageInputRate": 8e-06,
      "note": "OpenAI bills GPT Image 2.5 per output token ($30 per 1M); these per-image figures are fal's published table for the same model. \"auto\" quality can reach the max column."
    }
  },
  // Pay-as-you-go API rates per 1,000 characters. Subscription plans count
  // the same characters against their included credits instead.
  elevenlabs: {
    perThousandCharacters: { standard: 0.08, flash: 0.04 },
    flashModels: /flash|turbo|conversational/i
  }
};
