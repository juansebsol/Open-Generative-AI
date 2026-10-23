import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CycleError,
  executeGraph,
  fillTemplate,
  planRun,
  sanitizeWorkflow,
  templateVariables,
  topologicalOrder,
  wouldCreateCycle,
} from '../packages/studio/src/workflows/graph.js';
import { findModel, getModelPorts, isConnectionValid, pruneEdges } from '../packages/studio/src/workflows/modelPorts.js';
import { buildModelParams, evaluateNode } from '../packages/studio/src/workflows/runner.js';
import { buildTemplate, TEMPLATE_IDS } from '../packages/studio/src/workflows/templates.js';
import { workflowFromDraft } from '../packages/studio/src/workflows/describe.js';
import en from '../packages/studio/src/messages/en/workflowStudio.json' with { type: 'json' };

const edge = (source, target, targetHandle = 'in') => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle: 'out', targetHandle });

test('template variables are parsed in order and filled', () => {
  assert.deepEqual(templateVariables('{{a}} and {{ b }} then {{a}}'), ['a', 'b']);
  assert.equal(fillTemplate('{{a}}, {{b}}!', { a: 'cat' }), 'cat, !');
});

test('topological order and cycle detection', () => {
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')];
  assert.deepEqual(topologicalOrder(['c', 'b', 'a'], edges), ['a', 'b', 'c']);
  assert.equal(wouldCreateCycle(edges, 'c', 'a'), true);
  assert.equal(wouldCreateCycle(edges, 'a', 'c'), false);
  assert.throws(() => topologicalOrder(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]), CycleError);
});

test('single-node runs reuse cached model results upstream', () => {
  const nodes = [
    { id: 't', type: 'text' },
    { id: 'm1', type: 'model' },
    { id: 'm2', type: 'model' },
    { id: 'o', type: 'result' },
  ];
  const edges = [edge('t', 'm1', 'prompt'), edge('m1', 'm2', 'image'), edge('m2', 'o')];
  assert.deepEqual(planRun(nodes, edges, ['m2'], { m1: { kind: 'image', value: 'x' } }), ['m2']);
  assert.deepEqual(planRun(nodes, edges, ['m2'], {}), ['t', 'm1', 'm2']);
  assert.deepEqual(planRun(nodes, edges, null), ['t', 'm1', 'm2', 'o']);
});

test('executeGraph passes upstream outputs by handle and skips after failures', async () => {
  const nodes = [
    { id: 'a', type: 'text', data: { text: 'hello' } },
    { id: 'b', type: 'model', data: {} },
    { id: 'c', type: 'result', data: {} },
    { id: 'd', type: 'result', data: {} },
  ];
  const edges = [edge('a', 'b', 'prompt'), edge('b', 'c'), edge('a', 'd')];
  const statuses = {};
  const { outputs } = await executeGraph({
    nodes,
    edges,
    evaluate: async (node, inputs) => {
      if (node.id === 'b') throw new Error(`boom ${inputs.prompt[0].value}`);
      return evaluateNode(node, inputs, { copy: en });
    },
    onStatus: (id, status, extra) => {
      statuses[id] = extra?.error ? `${status}: ${extra.error.message}` : status;
    },
  });
  assert.deepEqual(statuses, { a: 'done', b: 'error: boom hello', c: 'skipped', d: 'done' });
  assert.equal(outputs.d.value, 'hello');
});

test('combiner nodes fill their template from connected text', async () => {
  const output = await evaluateNode(
    { id: 'c', type: 'combiner', data: { template: '{{subject}} in {{style}}' } },
    { 'var:subject': [{ kind: 'text', value: 'a fox' }], 'var:style': [{ kind: 'text', value: 'ink' }] },
    { copy: en },
  );
  assert.deepEqual(output, { kind: 'text', value: 'a fox in ink', values: [] });
});

test('connections are type checked against model ports', () => {
  const text = { id: 't', type: 'text', data: {} };
  const image = { id: 'i', type: 'image', data: {} };
  const model = { id: 'm', type: 'model', data: { category: 'i2i', modelId: 'nano-banana-edit' } };
  const output = { id: 'o', type: 'result', data: {} };
  assert.equal(isConnectionValid(text, model, 'prompt'), true);
  assert.equal(isConnectionValid(image, model, 'image'), true);
  assert.equal(isConnectionValid(text, model, 'image'), false);
  assert.equal(isConnectionValid(model, output, 'in'), true);
  const kept = pruneEdges([text, image, model, output], [edge('t', 'm', 'prompt'), edge('t', 'm', 'image'), edge('i', 'm', 'image')]);
  assert.deepEqual(kept.map((entry) => entry.targetHandle), ['prompt', 'image']);
});

test('model params put upstream media where the generation functions expect it', () => {
  const faceSwap = findModel('i2i', 'ai-image-face-swap');
  assert.deepEqual(getModelPorts('i2i', faceSwap).map((port) => port.id), ['image', 'field:swap_url']);
  const params = buildModelParams('i2i', faceSwap, { prompt: '', paramValues: {}, media: { image: ['https://x/a.png'], 'field:swap_url': ['https://x/b.png'] } });
  assert.equal(params.image_url, 'https://x/a.png');
  assert.equal(params.swap_url, 'https://x/b.png');

  const i2v = findModel('i2v', 'kling-v2.6-pro-i2v');
  const videoParams = buildModelParams('i2v', i2v, { prompt: 'move', paramValues: { duration: '10' }, media: { image: ['https://x/a.png'] } });
  assert.equal(videoParams.image_url, 'https://x/a.png');
  assert.equal(videoParams.duration, 10);
  assert.equal(videoParams.prompt, 'move');
});

test('templates build valid graphs', () => {
  for (const id of TEMPLATE_IDS) {
    const { nodes, edges } = buildTemplate(id);
    assert.ok(nodes.length > 0, id);
    assert.equal(pruneEdges(nodes, edges).length, edges.length, `${id} has invalid edges`);
    assert.doesNotThrow(() => topologicalOrder(nodes.map((node) => node.id), edges));
  }
});

test('drafts from the chat model are validated', () => {
  const graph = workflowFromDraft({
    name: 'Fox video',
    nodes: [
      { id: '1', type: 'text', text: 'a fox' },
      { id: '2', type: 'model', category: 't2i', modelId: 'does-not-exist' },
      { id: '3', type: 'output' },
      { id: '4', type: 'bogus' },
    ],
    edges: [
      { from: '1', to: '2', input: 'prompt' },
      { from: '2', to: '3', input: 'in' },
      { from: '1', to: '2', input: 'image' },
    ],
  });
  assert.equal(graph.name, 'Fox video');
  assert.equal(graph.nodes.length, 3);
  assert.ok(graph.nodes[1].data.modelId, 'falls back to an available model');
  assert.deepEqual(graph.edges.map((entry) => entry.targetHandle), ['prompt', 'in']);
});

test('sanitizeWorkflow drops unknown nodes and dangling edges', () => {
  const clean = sanitizeWorkflow({
    name: '  Demo ',
    nodes: [{ id: 'a', type: 'text', data: { text: 'x' } }, { id: 'b', type: 'script' }],
    edges: [{ source: 'a', target: 'b' }],
  });
  assert.equal(clean.name, 'Demo');
  assert.deepEqual(clean.nodes.map((node) => node.id), ['a']);
  assert.deepEqual(clean.edges, []);
  assert.equal(sanitizeWorkflow({ nodes: 'nope' }), null);
});
