// "Describe a workflow": asks the visitor's chat model for a graph draft and
// turns it into validated nodes and edges.

import { chatJson } from '../providers/chat.js';
import { layoutGraph, newId, NODE_TYPES } from './graph.js';
import { getCategory, isConnectionValid, MODEL_CATEGORIES, nodeInputPorts, pruneEdges } from './modelPorts.js';
import { createNode } from './templates.js';

const MODELS_PER_CATEGORY = 30;

const CATEGORY_NOTES = {
  t2i: 'text → image. Inputs: prompt (+ optional image on a few models).',
  i2i: 'image → image (edit, upscale, background removal...). Inputs: image (required), prompt when the model takes one.',
  t2v: 'text → video. Inputs: prompt.',
  i2v: 'image → video. Inputs: image (required), prompt, sometimes last_image.',
  v2v: 'video → video (edit, upscale, restyle...). Inputs: video (required), sometimes image and prompt.',
  audio: 'text → audio (speech, music, sound). Inputs: prompt.',
  lipsync: 'talking video. Inputs: audio (required) plus image or video (required).',
};

function systemPrompt() {
  const catalog = MODEL_CATEGORIES
    .filter((category) => category.models.length > 0)
    .map((category) => `- ${category.id}: ${CATEGORY_NOTES[category.id]}\n  model ids: ${category.models.slice(0, MODELS_PER_CATEGORY).map((model) => model.id).join(', ')}`)
    .join('\n');
  return `You design node graphs for a generative media pipeline builder.
Node types:
- "text": a text prompt. Field "text".
- "image", "video", "audio": media the user uploads later. No fields.
- "combiner": merges text with a template using {{name}} placeholders. Field "template". Each placeholder is an input named after it.
- "model": runs one AI model. Fields "category", "modelId", optional "prompt" (used only when no text node feeds the prompt input).
- "output": shows a final result. Input "in".
Model categories:
${catalog}
Edges go from a node's output to a named input of another node: "prompt", "image", "last_image", "video", "audio", "in" (output nodes) or a combiner placeholder name.
Kinds must match: text/combiner output text; image nodes and t2i/i2i models output image; video nodes and t2v/i2v/v2v/lipsync models output video; audio nodes and audio models output audio. Output nodes accept anything.
Keep graphs small (2-8 nodes) and always end every branch that matters with an output node.
Return {"name": string, "nodes": [{"id": string, "type": string, ...fields}], "edges": [{"from": string, "to": string, "input": string}]}.`;
}

function handleFor(targetNode, input) {
  const name = String(input || '').trim();
  if (targetNode.type === 'result') return 'in';
  if (targetNode.type === 'combiner') return `var:${name.replace(/^var:/, '')}`;
  const ports = nodeInputPorts(targetNode);
  if (ports.some((port) => port.id === name)) return name;
  const byField = ports.find((port) => port.field === name || port.id === `field:${name}`);
  if (byField) return byField.id;
  const kind = name.replace(/s$/, '').replace(/_url$/, '');
  return ports.find((port) => port.kind === kind)?.id || name;
}

/** Converts a draft from the chat model into a laid-out workflow graph. */
export function workflowFromDraft(draft) {
  const draftNodes = Array.isArray(draft?.nodes) ? draft.nodes : [];
  const idMap = new Map();
  const nodes = [];
  for (const raw of draftNodes.slice(0, 24)) {
    // The chat model is told about "output" nodes; internally they are "result" nodes.
    const type = raw?.type === 'output' ? 'result' : raw?.type;
    if (!NODE_TYPES.includes(type)) continue;
    let node;
    if (type === 'model') {
      const category = getCategory(raw.category) ? raw.category : 't2i';
      node = createNode('model', undefined, {
        category,
        modelId: typeof raw.modelId === 'string' ? raw.modelId : undefined,
        prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      });
    } else if (type === 'text') {
      node = createNode('text', undefined, { text: String(raw.text || '') });
    } else if (type === 'combiner') {
      node = createNode('combiner', undefined, { template: String(raw.template || '{{a}}') });
    } else {
      node = createNode(type);
    }
    idMap.set(String(raw.id ?? newId('draft')), node);
    nodes.push(node);
  }
  const edges = [];
  for (const raw of Array.isArray(draft?.edges) ? draft.edges : []) {
    const source = idMap.get(String(raw?.from ?? raw?.source));
    const target = idMap.get(String(raw?.to ?? raw?.target));
    if (!source || !target) continue;
    const targetHandle = handleFor(target, raw.input ?? raw.targetHandle);
    if (!isConnectionValid(source, target, targetHandle)) continue;
    edges.push({ id: newId('e'), source: source.id, target: target.id, sourceHandle: 'out', targetHandle });
  }
  const validEdges = pruneEdges(nodes, edges);
  return {
    name: typeof draft?.name === 'string' && draft.name.trim() ? draft.name.trim().slice(0, 80) : null,
    nodes: layoutGraph(nodes, validEdges),
    edges: validEdges,
  };
}

export async function draftWorkflow(description) {
  const draft = await chatJson({ system: systemPrompt(), user: description, temperature: 0.3 });
  const workflow = workflowFromDraft(draft);
  if (workflow.nodes.length === 0) throw new Error('empty');
  return workflow;
}
