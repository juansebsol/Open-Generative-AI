// The Vector studio's catalog: SVG generators and image tracers served by
// fal. Kept apart from models.js (which the other studios share) because
// vector outputs are files to sanitise and inline, not images to display,
// and the studio handles them through vector/ instead of the image path.
//
// `kind`: "text" makes SVGs from a prompt; "vectorize" traces a raster.
// `palette`: the endpoint takes Recraft's `colors` / `background_color`.
// `candidates`: how several results are requested, "runs" (one call each)
// or "num_images" (one call with a count, the Ideogram way).
// `listPrice` is only a hint for copy; the price chip quotes fal live.

import { hasRoute } from './providers/catalog/index.js';

const RECRAFT_SIZES = {
  title: 'Size',
  type: 'string',
  enum: ['square_hd', 'square', 'landscape_4_3', 'portrait_4_3', 'landscape_16_9', 'portrait_16_9'],
  default: 'square_hd',
  optionLabels: { square_hd: 'Square HD', square: 'Square', landscape_4_3: 'Landscape 4:3', portrait_4_3: 'Portrait 3:4', landscape_16_9: 'Landscape 16:9', portrait_16_9: 'Portrait 9:16' },
};

export const ALL_vectorModels = [
  {
    id: 'recraft-v4-1-text-to-vector',
    endpoint: 'recraft-v4-1-text-to-vector',
    name: 'Recraft 4.1',
    family: 'recraft-v4-1',
    kind: 'text',
    description: 'Editable SVGs with structured layers and clean geometry. The default for logos and icon systems.',
    provider: 'recraft',
    provider_name: 'Recraft',
    promptRequired: true,
    palette: true,
    candidates: 'runs',
    maxCandidates: 4,
    listPrice: 0.08,
    inputs: { image_size: RECRAFT_SIZES },
  },
  {
    id: 'recraft-v4-1-pro-text-to-vector',
    endpoint: 'recraft-v4-1-pro-text-to-vector',
    name: 'Recraft 4.1 Pro',
    family: 'recraft-v4-1-pro',
    kind: 'text',
    description: 'Large-format SVGs with the structural clarity of professional illustration. For posters and complex brand assets.',
    provider: 'recraft',
    provider_name: 'Recraft',
    promptRequired: true,
    palette: true,
    candidates: 'runs',
    maxCandidates: 4,
    listPrice: 0.3,
    inputs: { image_size: RECRAFT_SIZES },
  },
  {
    id: 'ideogram-vector-text-to-vector',
    endpoint: 'ideogram-vector-text-to-vector',
    name: 'Ideogram Vector',
    family: 'ideogram-vector',
    kind: 'text',
    description: 'SVGs from a prompt with three quality levels and up to five reference images. Palette colours go into the prompt.',
    provider: 'ideogram',
    provider_name: 'Ideogram',
    promptRequired: true,
    palette: false,
    references: { field: 'image_urls', max: 5 },
    candidates: 'num_images',
    maxCandidates: 8,
    listPrice: 0.16,
    inputs: {
      quality: {
        title: 'Quality',
        type: 'string',
        enum: ['low', 'medium', 'high'],
        default: 'medium',
        optionLabels: { low: 'Low', medium: 'Medium', high: 'High' },
        description: 'Low is fastest and cheapest; high costs the most.',
      },
      aspect_ratio: {
        title: 'Aspect',
        type: 'string',
        enum: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '3:1'],
        default: '1:1',
        optionLabels: { auto: 'Auto' },
      },
    },
  },
  {
    id: 'image2svg',
    endpoint: 'image2svg',
    name: 'Image2SVG',
    family: 'image2svg',
    kind: 'vectorize',
    description: 'Geometric tracing (VTracer). Cheapest tier; best for flat art, logos and screenshots. Every knob is exposed.',
    provider: 'tools',
    provider_name: 'fal',
    listPrice: 0.005,
    inputs: {
      colormode: { title: 'Colours', type: 'string', enum: ['color', 'binary'], default: 'color', optionLabels: { color: 'Colour', binary: 'Black and white' } },
      mode: { title: 'Curves', type: 'string', enum: ['spline', 'polygon'], default: 'spline', optionLabels: { spline: 'Smooth splines', polygon: 'Straight polygons' } },
      filter_speckle: { title: 'Speckle filter', type: 'integer', default: 4, minimum: 0, maximum: 20, description: 'Drops specks smaller than this many pixels.' },
      color_precision: { title: 'Colour precision', type: 'integer', default: 6, minimum: 1, maximum: 10, description: 'More bits keep more distinct colours.' },
      hierarchical: { title: 'Layering', type: 'string', enum: ['stacked', 'cutout'], default: 'stacked', optionLabels: { stacked: 'Stacked', cutout: 'Cutout' }, advanced: true },
      layer_difference: { title: 'Layer difference', type: 'integer', default: 16, minimum: 1, maximum: 32, advanced: true },
      corner_threshold: { title: 'Corner threshold', type: 'integer', default: 60, minimum: 0, maximum: 180, advanced: true },
      length_threshold: { title: 'Length threshold', type: 'number', default: 4, minimum: 0, maximum: 10, advanced: true },
      max_iterations: { title: 'Iterations', type: 'integer', default: 10, minimum: 1, maximum: 20, advanced: true },
      splice_threshold: { title: 'Splice threshold', type: 'integer', default: 45, minimum: 0, maximum: 90, advanced: true },
      path_precision: { title: 'Path precision', type: 'integer', default: 3, minimum: 1, maximum: 10, advanced: true },
    },
  },
  {
    id: 'recraft-vectorize',
    endpoint: 'recraft-vectorize',
    name: 'Recraft Vectorize',
    family: 'recraft-vectorize',
    kind: 'vectorize',
    description: 'Recraft’s tracer: smooth shapes that stay editable. PNG, JPG or WebP under 5 MB, 256 to 4096 px.',
    provider: 'recraft',
    provider_name: 'Recraft',
    listPrice: 0.01,
    inputs: {},
  },
  {
    id: 'ideogram-vector-image-to-vector',
    endpoint: 'ideogram-vector-image-to-vector',
    name: 'Ideogram Image to Vector',
    family: 'ideogram-vector',
    kind: 'vectorize',
    description: 'Ideogram’s redraw of a raster as vector art. Default keeps detail; simple uses fewer shapes.',
    provider: 'ideogram',
    provider_name: 'Ideogram',
    listPrice: 0.1,
    inputs: {
      mode: { title: 'Detail', type: 'string', enum: ['default', 'simple'], default: 'default', optionLabels: { default: 'Default', simple: 'Simple' } },
    },
  },
];

export const vectorModels = ALL_vectorModels.filter((model) => hasRoute(model.endpoint));
export const vectorTextModels = vectorModels.filter((model) => model.kind === 'text');
export const vectorizeModels = vectorModels.filter((model) => model.kind === 'vectorize');
export const getVectorModelById = (id) => vectorModels.find((model) => model.id === id) || null;

/** Default option values for a model, from its declared inputs. */
export function vectorModelDefaults(model) {
  const options = {};
  for (const [key, input] of Object.entries(model?.inputs || {})) {
    if (input.default !== undefined) options[key] = input.default;
  }
  return options;
}
