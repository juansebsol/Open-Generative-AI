import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOutputs } from '../packages/studio/src/providers/server/outputs.js';

test('mesh files and textures are extracted from 3D provider results', () => {
  const outputs = extractOutputs({
    model_glb: { url: 'https://cdn/x/model.glb', content_type: 'model/gltf-binary' },
    model_fbx: { url: 'https://cdn/x/model.fbx' },
    model_usdz: { url: 'https://cdn/x/model.usdz' },
    thumbnail_url: 'https://cdn/x/thumb.png',
    texture_urls: [{ base_color: { url: 'https://cdn/x/base.png' } }],
    seed: 1,
  });
  assert.deepEqual(outputs.map((o) => [o.url, o.type]), [
    ['https://cdn/x/model.glb', 'model'],
    ['https://cdn/x/model.fbx', 'model'],
    ['https://cdn/x/model.usdz', 'model'],
    ['https://cdn/x/thumb.png', 'image'],
    ['https://cdn/x/base.png', 'image'],
  ]);
  assert.deepEqual(extractOutputs({ model_mesh: { url: 'https://cdn/y/mesh.glb' } }), [{ url: 'https://cdn/y/mesh.glb', type: 'model' }]);
});
