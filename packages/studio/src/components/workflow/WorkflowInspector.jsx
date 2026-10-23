"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_COLORS, templateVariables } from "../../workflows/graph.js";
import {
  enumOptionLabel,
  enumOptionValue,
  findModel,
  getCategory,
  getModelParamInputs,
  MODEL_CATEGORIES,
  nodeInputPorts,
  NUMBER_TYPES,
} from "../../workflows/modelPorts.js";
import { FIELD_CLASS, format, MediaPicker, MediaPreview, NodeIcon, PlayIcon, portLabel, useWorkflow } from "./WorkflowNodes.jsx";

const LABEL_CLASS = "text-[10px] font-bold uppercase tracking-wider text-white/40";

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2 border-t border-white/[0.05] px-4 py-3.5">
      {title && <h3 className={LABEL_CLASS}>{title}</h3>}
      {children}
    </section>
  );
}

function ParamField({ input, value, onChange }) {
  const { copy } = useWorkflow();
  const { key, schema, label } = input;
  const id = `wf-param-${key}`;
  let control;
  if (schema.enum) {
    const current = value === undefined || value === null ? "" : String(value);
    control = (
      <select
        id={id}
        className={FIELD_CLASS}
        value={current}
        onChange={(event) => {
          const option = schema.enum.find((entry) => String(enumOptionValue(entry)) === event.target.value);
          onChange(option === undefined ? undefined : enumOptionValue(option));
        }}
      >
        {schema.default === undefined && <option value="">{copy.inspector.unset}</option>}
        {schema.enum.map((option) => (
          <option key={String(enumOptionValue(option))} value={String(enumOptionValue(option))}>
            {enumOptionLabel(option)}
          </option>
        ))}
      </select>
    );
  } else if (schema.type === "boolean") {
    const checked = value === true;
    control = (
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? "border-[#22d3ee]/50 bg-[#22d3ee]/30" : "border-white/10 bg-white/[0.06]"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    );
  } else if (NUMBER_TYPES.has(schema.type)) {
    control = (
      <input
        id={id}
        type="number"
        className={FIELD_CLASS}
        value={value ?? ""}
        min={schema.minValue ?? schema.minimum}
        max={schema.maxValue ?? schema.maximum}
        step={schema.step || (["int", "integer"].includes(schema.type) ? 1 : "any")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else if (schema.type === "array") {
    control = (
      <>
        <input
          id={id}
          className={FIELD_CLASS}
          value={Array.isArray(value) ? value.join(", ") : value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-[10px] text-white/30">{copy.inspector.listHint}</span>
      </>
    );
  } else {
    const long = /prompt|lyrics|text|description/i.test(key);
    control = long ? (
      <textarea id={id} className={`${FIELD_CLASS} h-20 resize-y`} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    ) : (
      <input id={id} className={FIELD_CLASS} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    );
  }
  return (
    <div className={schema.type === "boolean" && !schema.enum ? "flex items-center justify-between gap-3" : "flex flex-col gap-1.5"}>
      <label htmlFor={id} className="min-w-0">
        <span className="block text-[11px] font-semibold text-white/75">{label}</span>
        {schema.description && <span className="mt-0.5 block text-[10px] leading-relaxed text-white/35 line-clamp-3">{schema.description}</span>}
      </label>
      {control}
    </div>
  );
}

function ModelPicker({ node }) {
  const { copy, setNodeModel } = useWorkflow();
  const [query, setQuery] = useState("");
  const activeRef = useRef(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const category = getCategory(node.data.category) || MODEL_CATEGORIES[0];
  const models = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return category.models;
    return category.models.filter((model) =>
      `${model.name} ${model.id} ${model.provider_name || ""} ${model.family || ""}`.toLowerCase().includes(needle),
    );
  }, [category, query]);

  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL_CLASS} htmlFor="wf-model-category">{copy.inspector.category}</label>
      <select
        id="wf-model-category"
        className={FIELD_CLASS}
        value={category.id}
        onChange={(event) => setNodeModel(node.id, event.target.value, null)}
      >
        {MODEL_CATEGORIES.filter((entry) => entry.models.length > 0).map((entry) => (
          <option key={entry.id} value={entry.id}>
            {copy.categories[entry.id]} ({entry.models.length})
          </option>
        ))}
      </select>
      <span className={`${LABEL_CLASS} mt-1`}>{copy.inspector.model}</span>
      <input
        className={FIELD_CLASS}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.inspector.searchModels}
        aria-label={copy.inspector.searchModels}
      />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 p-1" role="listbox" aria-label={copy.inspector.model}>
        {models.length === 0 && <p className="px-2 py-3 text-[11px] text-white/35">{copy.inspector.noModels}</p>}
        {models.map((model) => {
          const active = model.id === node.data.modelId;
          return (
            <button
              key={model.id}
              ref={active ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => setNodeModel(node.id, category.id, model.id)}
              className={`flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left transition-colors ${
                active ? "bg-[#22d3ee]/10 text-[#22d3ee]" : "text-white/75 hover:bg-white/[0.05]"
              }`}
            >
              <span className="text-[11px] font-semibold">{model.name}</span>
              <span className="text-[10px] text-white/35">{model.provider_name || model.family || model.id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PortList({ node }) {
  const { copy, connectedHandles } = useWorkflow();
  const ports = nodeInputPorts(node);
  if (ports.length === 0) return null;
  return (
    <Section title={copy.inspector.inputs}>
      <ul className="flex flex-col gap-1.5">
        {ports.map((port) => {
          const connected = connectedHandles.has(`${node.id}:${port.id}`);
          return (
            <li key={port.id} className="flex items-center gap-2 text-[11px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_COLORS[port.kind] || KIND_COLORS.any }} />
              <span className="flex-1 text-white/70">
                {portLabel(port, copy)}
                {port.multiple && port.max > 1 && <span className="text-white/30"> · {format(copy.inspector.upTo, { count: port.max })}</span>}
              </span>
              <span className={connected ? "text-emerald-300/80" : port.required ? "text-amber-300/80" : "text-white/30"}>
                {connected ? copy.inspector.connected : port.required ? copy.inspector.required : copy.inspector.optional}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export default function WorkflowInspector({ node, onClose, onDelete, onDuplicate }) {
  const { copy, updateNodeData, results, statuses, runNode, running, connectedHandles } = useWorkflow();
  const data = node.data || {};
  const model = node.type === "model" ? findModel(data.category, data.modelId) : null;
  const paramInputs = node.type === "model" ? getModelParamInputs(data.category, model) : [];
  const ports = node.type === "model" ? nodeInputPorts(node) : [];
  const hasPromptPort = ports.some((port) => port.id === "prompt");
  const promptConnected = connectedHandles.has(`${node.id}:prompt`);
  const result = results[node.id];
  const state = statuses[node.id];

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-white/[0.06] bg-[#0a0a0c]/95 backdrop-blur" aria-label={copy.nodeTypes[node.type]}>
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-[#22d3ee]">
          <NodeIcon type={node.type} />
        </span>
        <span className="flex-1 text-xs font-bold uppercase tracking-wider text-white/80">{copy.nodeTypes[node.type]}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.inspector.close}
          className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        <Section>
          <label className={LABEL_CLASS} htmlFor="wf-node-label">{copy.inspector.label}</label>
          <input
            id="wf-node-label"
            className={FIELD_CLASS}
            value={data.label || ""}
            onChange={(event) => updateNodeData(node.id, { label: event.target.value })}
            placeholder={copy.inspector.labelPlaceholder}
          />
        </Section>

        {node.type === "text" && (
          <Section title={copy.nodeTypes.text}>
            <textarea
              className={`${FIELD_CLASS} h-40 resize-y`}
              value={data.text || ""}
              onChange={(event) => updateNodeData(node.id, { text: event.target.value })}
              placeholder={copy.node.textPlaceholder}
              aria-label={copy.nodeTypes.text}
            />
          </Section>
        )}

        {["image", "video", "audio"].includes(node.type) && (
          <Section title={copy.nodeTypes[node.type]}>
            <MediaPicker kind={node.type} url={data.url} onChange={(url) => updateNodeData(node.id, { url })} />
          </Section>
        )}

        {node.type === "combiner" && (
          <Section title={copy.inspector.template}>
            <textarea
              className={`${FIELD_CLASS} h-28 resize-y font-mono`}
              value={data.template || ""}
              onChange={(event) => updateNodeData(node.id, { template: event.target.value })}
              placeholder={copy.node.templatePlaceholder}
              aria-label={copy.inspector.template}
            />
            <p className="text-[10px] text-white/35">
              {templateVariables(data.template).length === 0 ? copy.inspector.noVariables : copy.node.variablesHint}
            </p>
          </Section>
        )}

        {node.type === "model" && (
          <>
            <Section>
              <ModelPicker node={node} />
            </Section>
            {hasPromptPort && (
              <Section title={copy.inspector.prompt}>
                {promptConnected ? (
                  <p className="rounded-lg bg-[#a78bfa]/10 px-2.5 py-2 text-[11px] leading-relaxed text-[#c4b5fd]">{copy.inspector.promptConnected}</p>
                ) : (
                  <textarea
                    className={`${FIELD_CLASS} h-28 resize-y`}
                    value={data.prompt || ""}
                    onChange={(event) => updateNodeData(node.id, { prompt: event.target.value })}
                    placeholder={copy.inspector.promptPlaceholder}
                    aria-label={copy.inspector.prompt}
                  />
                )}
              </Section>
            )}
            {model && (
              <Section title={copy.inspector.parameters}>
                {paramInputs.length === 0 ? (
                  <p className="text-[11px] text-white/35">{copy.inspector.noParameters}</p>
                ) : (
                  <div className="flex flex-col gap-3.5">
                    {paramInputs.map((input) => (
                      <ParamField
                        key={`${data.modelId}:${input.key}`}
                        input={input}
                        value={data.params?.[input.key]}
                        onChange={(value) => updateNodeData(node.id, { params: { ...(data.params || {}), [input.key]: value } })}
                      />
                    ))}
                  </div>
                )}
              </Section>
            )}
          </>
        )}

        <PortList node={node} />

        {node.type !== "result" && (
          <Section title={copy.inspector.result}>
            {state?.status === "error" && state.error && (
              <p className="break-words rounded-md bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">{state.error}</p>
            )}
            {result ? <MediaPreview output={result} large showAll /> : <p className="text-[11px] text-white/35">{copy.inspector.noResult}</p>}
          </Section>
        )}
        {node.type === "result" && result && (
          <Section title={copy.inspector.result}>
            <MediaPreview output={result} large showAll />
          </Section>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-white/[0.06] p-3">
        <button
          type="button"
          onClick={() => runNode(node.id)}
          disabled={running || (node.type === "model" && !model)}
          title={copy.inspector.runNodeHint}
          className="flex items-center justify-center gap-2 rounded-lg bg-[#22d3ee] px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-[#06b6d4] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlayIcon /> {copy.inspector.runNode}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDuplicate}
            className="flex-1 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            {copy.inspector.duplicate}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-red-300/80 transition-colors hover:border-red-400/40 hover:text-red-300"
          >
            {copy.inspector.delete}
          </button>
        </div>
      </div>
    </aside>
  );
}
