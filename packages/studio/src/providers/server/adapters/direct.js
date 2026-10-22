// Shared input handling for the direct (synchronous) image adapters:
// Google Gemini, OpenAI and OpenRouter. They receive the studio payload as-is
// rather than a schema-mapped input.

export function collectImages(payload = {}) {
  const images = [];
  const add = (value) => {
    if (Array.isArray(value)) value.forEach(add);
    else if (typeof value === 'string' && value) images.push(value);
  };
  add(payload.image_url);
  add(payload.images_list);
  add(payload.reference_image_urls);
  return [...new Set(images)];
}

export function requirePrompt(payload, provider) {
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) {
    const error = new Error(`${provider} needs a prompt.`);
    error.status = 400;
    throw error;
  }
  return prompt;
}

export function imageCount(payload, max = 4) {
  const count = Number(payload.num_images || 1);
  return Math.min(Math.max(Number.isFinite(count) ? Math.round(count) : 1, 1), max);
}
