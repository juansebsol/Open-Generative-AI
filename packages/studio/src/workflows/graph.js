// Pure graph helpers for the Workflows studio: node kinds, template
// variables, cycle checks, topological order, layout and the run scheduler.
// No React and no network here, so it can be unit tested in Node.

export const INPUT_NODE_TYPES = ['text', 'image', 'video', 'audio'];
// "result" nodes show final outputs (not named "output", which React Flow
// styles as one of its built-in node types).
export const NODE_TYPES = [...INPUT_NODE_TYPES, 'combiner', 'model', 'result'];

// Nodes that evaluate instantly in the browser (no provider call). They are
// always re-evaluated so edits show up without re-running models.
export const INSTANT_NODE_TYPES = new Set([...INPUT_NODE_TYPES, 'combiner', 'result']);

export const KIND_COLORS = {
  text: '#a78bfa',
  image: '#22d3ee',
  video: '#f472b6',
  audio: '#fbbf24',
  any: '#e4e4e7',
};

let idCounter = 0;
export function newId(prefix = 'n') {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Variable names used in a combiner template, in order of first use. */
export function templateVariables(template) {
  const names = [];
  for (const match of String(template || '').matchAll(VARIABLE_PATTERN)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

export function fillTemplate(template, values = {}) {
  return String(template || '')
    .replace(VARIABLE_PATTERN, (_, name) => (values[name] == null ? '' : String(values[name])))
    .trim();
}

/** A source kind can feed a target port of the same kind, or an `any` port. */
export function kindsCompatible(sourceKind, targetKind) {
  if (!sourceKind || !targetKind) return false;
  return targetKind === 'any' || sourceKind === targetKind;
}

/** True when adding source → target would close a loop. */
export function wouldCreateCycle(edges, source, target) {
  if (source === target) return true;
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge.target);
  }
  const stack = [target];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(outgoing.get(current) || []));
  }
  return false;
}

export class CycleError extends Error {
  constructor() {
    super('The workflow contains a loop.');
    this.name = 'CycleError';
  }
}

/** Kahn's algorithm over the given node ids; edges outside the set are ignored. */
export function topologicalOrder(nodeIds, edges) {
  const ids = [...nodeIds];
  const idSet = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    indegree.set(edge.target, indegree.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) throw new CycleError();
  return order;
}

export function incomingEdges(nodeId, edges) {
  return edges.filter((edge) => edge.target === nodeId);
}

/**
 * Which nodes a run has to execute. A full run executes everything. Running
 * one node executes it plus any ancestors that are instant or have no
 * cached output yet (walking up stops at cached model results).
 */
export function planRun(nodes, edges, targetIds, cached = {}) {
  if (!targetIds) return nodes.map((node) => node.id);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const plan = new Set();
  const visit = (id, isTarget) => {
    if (plan.has(id) || !byId.has(id)) return;
    const node = byId.get(id);
    if (!isTarget && !INSTANT_NODE_TYPES.has(node.type) && cached[id]) return;
    plan.add(id);
    for (const edge of incomingEdges(id, edges)) visit(edge.source, false);
  };
  for (const id of targetIds) visit(id, true);
  return nodes.filter((node) => plan.has(node.id)).map((node) => node.id);
}

/**
 * Runs the graph. `evaluate(node, inputs)` returns an output
 * `{ kind, value, values }`; `inputs` maps target handle → outputs of the
 * connected upstream nodes. Independent branches run in parallel.
 * Statuses reported: queued, running, done, error, skipped, cancelled.
 */
export async function executeGraph({
  nodes,
  edges,
  targetIds = null,
  cached = {},
  evaluate,
  onStatus = () => {},
  isCancelled = () => false,
}) {
  const allIds = nodes.map((node) => node.id);
  topologicalOrder(allIds, edges);
  const planIds = planRun(nodes, edges, targetIds, cached);
  const planSet = new Set(planIds);
  const order = topologicalOrder(planIds, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outputs = {};
  const errors = {};
  const promises = new Map();

  for (const id of order) onStatus(id, 'queued');

  const runNode = async (id) => {
    const incoming = incomingEdges(id, edges);
    const upstream = await Promise.all(
      incoming.map(async (edge) => {
        if (planSet.has(edge.source)) {
          await promises.get(edge.source);
          return { edge, output: outputs[edge.source] };
        }
        return { edge, output: cached[edge.source] };
      }),
    );
    if (isCancelled()) {
      onStatus(id, 'cancelled');
      return;
    }
    const failed = upstream.find(({ edge }) => planSet.has(edge.source) && !outputs[edge.source]);
    if (failed) {
      errors[id] = 'skipped';
      onStatus(id, 'skipped');
      return;
    }
    const inputs = {};
    for (const { edge, output } of upstream) {
      if (!output) continue;
      const handle = edge.targetHandle || 'in';
      (inputs[handle] ||= []).push(output);
    }
    onStatus(id, 'running');
    try {
      const output = await evaluate(byId.get(id), inputs);
      if (isCancelled()) {
        onStatus(id, 'cancelled');
        return;
      }
      outputs[id] = output;
      onStatus(id, 'done', { output });
    } catch (error) {
      if (isCancelled()) {
        onStatus(id, 'cancelled');
        return;
      }
      errors[id] = error;
      onStatus(id, 'error', { error });
    }
  };

  for (const id of order) promises.set(id, runNode(id));
  await Promise.all(promises.values());
  return { outputs, errors, order };
}

/** Left-to-right layout by dependency depth. */
export function layoutGraph(nodes, edges, { columnWidth = 340, rowHeight = 290 } = {}) {
  const ids = nodes.map((node) => node.id);
  let order;
  try {
    order = topologicalOrder(ids, edges);
  } catch {
    order = ids;
  }
  const depth = new Map();
  for (const id of order) {
    const parents = incomingEdges(id, edges).map((edge) => depth.get(edge.source) ?? 0);
    depth.set(id, parents.length ? Math.max(...parents) + 1 : 0);
  }
  const rows = new Map();
  return nodes.map((node) => {
    const column = depth.get(node.id) ?? 0;
    const row = rows.get(column) || 0;
    rows.set(column, row + 1);
    return { ...node, position: { x: column * columnWidth, y: row * rowHeight } };
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates an imported or stored workflow and returns a clean copy
 * ({ name, nodes, edges, results }), or null when it is not a workflow.
 */
export function sanitizeWorkflow(raw) {
  if (!isPlainObject(raw) || !Array.isArray(raw.nodes)) return null;
  const nodes = raw.nodes
    .filter((node) => isPlainObject(node) && typeof node.id === 'string' && NODE_TYPES.includes(node.type))
    .map((node) => ({
      id: node.id,
      type: node.type,
      position: {
        x: Number.isFinite(node.position?.x) ? node.position.x : 0,
        y: Number.isFinite(node.position?.y) ? node.position.y : 0,
      },
      data: isPlainObject(node.data) ? { ...node.data } : {},
    }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((edge) => isPlainObject(edge) && ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target)
    .map((edge) => ({
      id: typeof edge.id === 'string' ? edge.id : newId('e'),
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'out',
      targetHandle: edge.targetHandle || 'in',
    }));
  const results = {};
  if (isPlainObject(raw.results)) {
    for (const [id, output] of Object.entries(raw.results)) {
      if (ids.has(id) && isPlainObject(output) && typeof output.value === 'string') {
        results[id] = {
          kind: String(output.kind || 'text'),
          value: output.value,
          values: Array.isArray(output.values) ? output.values.filter((v) => typeof v === 'string') : [output.value],
        };
      }
    }
  }
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : 'Untitled workflow',
    nodes,
    edges,
    results,
  };
}
