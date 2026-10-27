// Published list prices for providers without a pricing API (Google, OpenAI)
// and tokens-per-image used for OpenRouter quotes. USD per generated image
// unless `per` says otherwise; tiers are keyed by the output resolution or
// quality the studio sends. Edit this file when a provider changes prices.
// Sources: https://ai.google.dev/gemini-api/docs/pricing · https://developers.openai.com/api/docs/pricing · https://openrouter.ai/api/v1/models (image_output per token) × tokens per image below

export const PRICES_UPDATED = "2026-10-27";

export const PRICES = {
  google: {
    "gemini-nano-banana-2.1": {
      per: "image",
      tier: "resolution",
      default: "1K",
      prices: {
        "1K": 0.0336,
        "2K": 0.0504,
        "4K": 0.113
      },
      tokens: {
        "1K": 1120,
        "2K": 1680,
        "4K": 3780
      }
    },
    "gemini-3.1-flash-image": {
      per: "image",
      tier: "resolution",
      default: "1K",
      prices: {
        "512": 0.045,
        "1K": 0.067,
        "2K": 0.101,
        "4K": 0.151
      },
      tokens: {
        "512": 747,
        "1K": 1120,
        "2K": 1680,
        "4K": 2520
      }
    },
    "gemini-3.1-flash-lite-image": {
      per: "image",
      tier: "resolution",
      default: "1K",
      prices: {
        "1K": 0.0336
      },
      tokens: {
        "1K": 1120
      }
    },
    "gemini-3-pro-image": {
      per: "image",
      tier: "resolution",
      default: "1K",
      prices: {
        "1K": 0.134,
        "2K": 0.134,
        "4K": 0.24
      },
      tokens: {
        "1K": 1120,
        "2K": 1120,
        "4K": 2000
      }
    },
    "gemini-2.5-flash-image": {
      per: "image",
      tier: "resolution",
      default: "1K",
      prices: {
        "1K": 0.039
      },
      tokens: {
        "1K": 1290
      }
    }
  },
  openai: {
    "gpt-image-2": {
      per: "image",
      tier: "quality",
      default: "high",
      prices: {
        low: [
          0.006,
          0.005
        ],
        medium: [
          0.053,
          0.041
        ],
        high: [
          0.211,
          0.165
        ]
      },
      // Larger sizes are billed per output token by OpenAI; these are fal's
      // published GPT Image 2 prices for 2560×1440 and 3840×2160.
      sizes: {
        "2K": { low: 0.007, medium: 0.056, high: 0.222 },
        "4K": { low: 0.012, medium: 0.101, high: 0.401 }
      },
      note: "square, then portrait or landscape. 2K and 4K sizes have no published per-image price."
    },
    "gpt-image-2.5-flare": {
      per: "token",
      perMillionOutputTokens: 30,
      note: "OpenAI publishes only the token rate for GPT Image 2.5."
    },
    "gpt-image-2.5-sunburst": {
      per: "token",
      perMillionOutputTokens: 30,
      note: "OpenAI publishes only the token rate for GPT Image 2.5."
    }
  }
};
