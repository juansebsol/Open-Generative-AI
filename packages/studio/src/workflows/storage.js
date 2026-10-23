// Saved workflows live in this browser's localStorage. Only small values
// are kept (text and media URLs); inline data: URLs are dropped.

import { newId, sanitizeWorkflow } from './graph.js';

export const STORAGE_KEY = 'hg_workflows_studio_persistent';
const MAX_INLINE_VALUE = 4096;

function keepValue(value) {
  return typeof value !== 'string' || !value.startsWith('data:') || value.length <= MAX_INLINE_VALUE;
}

function compactData(data = {}) {
  const compact = {};
  for (const [key, value] of Object.entries(data)) {
    if (keepValue(value)) compact[key] = value;
  }
  return compact;
}

/** Strips React Flow runtime fields and oversized values before saving. */
export function serializeWorkflow(workflow) {
  const results = {};
  for (const [id, output] of Object.entries(workflow.results || {})) {
    if (!output || !keepValue(output.value)) continue;
    results[id] = {
      kind: output.kind,
      value: output.value,
      values: (output.values || []).filter((value) => keepValue(value)).slice(0, 12),
    };
  }
  return {
    id: workflow.id,
    name: workflow.name,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    nodes: (workflow.nodes || []).map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: Math.round(node.position?.x || 0), y: Math.round(node.position?.y || 0) },
      data: compactData(node.data),
    })),
    edges: (workflow.edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'out',
      targetHandle: edge.targetHandle || 'in',
    })),
    results,
  };
}

/** Builds a stored workflow record from any (possibly untrusted) graph. */
export function toWorkflowRecord(raw, overrides = {}) {
  const clean = sanitizeWorkflow(raw);
  if (!clean) return null;
  const now = Date.now();
  return {
    ...clean,
    id: newId('wf'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function loadWorkflowState() {
  if (typeof localStorage === 'undefined') return { workflows: [], activeId: null };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const workflows = (Array.isArray(parsed?.workflows) ? parsed.workflows : [])
      .map((raw) => {
        const clean = sanitizeWorkflow(raw);
        if (!clean || typeof raw.id !== 'string') return null;
        return { ...clean, id: raw.id, createdAt: raw.createdAt || Date.now(), updatedAt: raw.updatedAt || Date.now() };
      })
      .filter(Boolean);
    const activeId = workflows.some((workflow) => workflow.id === parsed?.activeId) ? parsed.activeId : workflows[0]?.id || null;
    return { workflows, activeId };
  } catch {
    return { workflows: [], activeId: null };
  }
}

export function saveWorkflowState({ workflows, activeId }) {
  if (typeof localStorage === 'undefined') return true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId, workflows: workflows.map(serializeWorkflow) }));
    return true;
  } catch {
    return false;
  }
}

/** Portable JSON for export (no ids or timestamps needed on import). */
export function exportWorkflowJson(workflow) {
  const { name, nodes, edges } = serializeWorkflow(workflow);
  return JSON.stringify({ format: 'open-generative-ai-workflow', version: 1, name, nodes, edges }, null, 2);
}
