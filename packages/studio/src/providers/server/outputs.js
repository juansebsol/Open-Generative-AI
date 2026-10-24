// Pulls media URLs out of whatever result shape a provider returns
// ({images:[{url}]}, {video:{url}}, {data:{outputs:[...]}}, ...).

const EXTENSION_TYPES = [
  [/\.(png|jpe?g|webp|gif|bmp|avif|heic)(\?|$)/i, 'image'],
  [/\.(mp4|webm|mov|m4v|mkv)(\?|$)/i, 'video'],
  [/\.(mp3|wav|m4a|ogg|flac|aac|opus)(\?|$)/i, 'audio'],
  [/\.(glb|gltf|obj|fbx|usdz|stl|ply|splat|spz)(\?|$)/i, 'model'],
];

const KEY_TYPES = [
  [/image|frame|thumbnail|layer|mask/i, 'image'],
  [/video/i, 'video'],
  [/audio|speech|music|voice|sound/i, 'audio'],
  [/model|mesh|glb|fbx|obj|usdz|pbr/i, 'model'],
];

export function mediaTypeOf(url, { contentType, key } = {}) {
  if (contentType) {
    const major = contentType.split('/')[0];
    if (['image', 'video', 'audio'].includes(major)) return major;
  }
  if (typeof url === 'string' && url.startsWith('data:')) {
    const major = url.slice(5).split('/')[0];
    if (['image', 'video', 'audio'].includes(major)) return major;
  }
  for (const [pattern, type] of EXTENSION_TYPES) {
    if (pattern.test(url)) return type;
  }
  for (const [pattern, type] of KEY_TYPES) {
    if (key && pattern.test(key)) return type;
  }
  return 'file';
}

const looksLikeMediaUrl = (value) => typeof value === 'string' && (/^https?:\/\//i.test(value) || value.startsWith('data:'));

export function extractOutputs(result) {
  const outputs = [];
  const seen = new Set();

  const push = (url, meta) => {
    if (!looksLikeMediaUrl(url) || seen.has(url)) return;
    seen.add(url);
    outputs.push({ url, type: mediaTypeOf(url, meta) });
  };

  const walk = (value, key, depth) => {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (/url|output|image|video|audio|file|result|uri/i.test(key || '') || /^data:/.test(value)) push(value, { key });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.url === 'string') {
        push(value.url, { contentType: value.content_type || value.mime_type, key });
        return;
      }
      for (const [childKey, child] of Object.entries(value)) {
        if (/^(input|inputs|request|prompt|logs|metrics|timings|has_nsfw_concepts|seed)$/i.test(childKey)) continue;
        walk(child, childKey, depth + 1);
      }
    }
  };

  walk(result, '', 0);
  return outputs;
}
