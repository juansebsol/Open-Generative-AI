"use client";

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import toast from "react-hot-toast";
import { uploadFile } from "../../generation.js";
import { formatErrorMessage } from "../../utils/formatError.js";
import { KIND_COLORS, templateVariables } from "../../workflows/graph.js";
import { findModel, getModelPorts, modelOutputKind, nodeInputPorts } from "../../workflows/modelPorts.js";

export const WorkflowContext = createContext(null);
export const useWorkflow = () => useContext(WorkflowContext);

export function format(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (match, key) => (values[key] ?? match));
}

export function portLabel(port, copy) {
  return port.label || copy.ports[port.labelKey] || port.id;
}

export const FIELD_CLASS =
  "w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white placeholder:text-white/25 outline-none transition-colors focus:border-[#22d3ee]/50";

const STATUS_STYLES = {
  queued: "bg-white/[0.06] text-white/50",
  running: "bg-[#22d3ee]/15 text-[#22d3ee] animate-pulse",
  done: "bg-emerald-400/15 text-emerald-300",
  error: "bg-red-500/15 text-red-300",
  skipped: "bg-white/[0.06] text-white/40",
  cancelled: "bg-amber-400/10 text-amber-300/80",
};

const handleStyle = (kind) => ({
  width: 11,
  height: 11,
  background: KIND_COLORS[kind] || KIND_COLORS.any,
  border: "2px solid #0d0d10",
});

export const PlayIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const NODE_ICONS = {
  text: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="5" width="15" height="14" rx="2" />
      <path d="M17 10l5-3v10l-5-3" />
    </>
  ),
  audio: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  combiner: <path d="M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-6 6" />,
  model: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </>
  ),
  result: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </>
  ),
};

export function NodeIcon({ type, className = "" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {NODE_ICONS[type] || NODE_ICONS.model}
    </svg>
  );
}

function guessKind(url) {
  const clean = String(url || "").split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return "video";
  if (/\.(mp3|wav|m4a|ogg|flac|aac)$/.test(clean)) return "audio";
  return "image";
}

/** Preview for a node output ({ kind, value, values }). */
export function MediaPreview({ output, large = false, showAll = false }) {
  const { copy } = useWorkflow();
  if (!output?.value) return null;
  if (output.kind === "text") {
    return (
      <p className={`whitespace-pre-wrap break-words rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] leading-relaxed text-white/75 ${large ? "" : "line-clamp-4"}`}>
        {output.value}
      </p>
    );
  }
  const values = output.values?.length ? output.values : [output.value];
  const shown = showAll ? values : values.slice(0, 1);
  const kind = ["image", "video", "audio"].includes(output.kind) ? output.kind : guessKind(output.value);
  const mediaClass = `w-full rounded-lg bg-black/40 object-contain ${large ? "max-h-72" : "max-h-40"}`;
  return (
    <div className="flex flex-col gap-2">
      {shown.map((url) => (
        <div key={url} className="flex flex-col gap-1">
          {kind === "image" && <img src={url} alt="" className={mediaClass} draggable={false} />}
          {kind === "video" && <video src={url} className={mediaClass} controls muted playsInline loop />}
          {kind === "audio" && <audio src={url} className="nodrag w-full" controls />}
          {large && (
            <a href={url} target="_blank" rel="noreferrer" className="self-end text-[10px] font-semibold text-[#22d3ee]/80 hover:text-[#22d3ee]">
              {copy.node.openResult} ↗
            </a>
          )}
        </div>
      ))}
      {!showAll && values.length > 1 && (
        <span className="text-[10px] text-white/35">{format(copy.node.moreResults, { count: values.length - 1 })}</span>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const { copy } = useWorkflow();
  if (!status) return null;
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLES[status] || STATUS_STYLES.queued}`}>
      {copy.status[status] || status}
    </span>
  );
}

function PortRow({ port }) {
  const { copy } = useWorkflow();
  return (
    <div className="relative flex items-center gap-1.5 px-3 py-[3px] text-[10px]">
      <Handle type="target" position={Position.Left} id={port.id} style={handleStyle(port.kind)} />
      <span className="text-white/55">{portLabel(port, copy)}</span>
      {port.required && <span className="text-red-300/70">*</span>}
      {port.multiple && port.max > 1 && <span className="text-white/25">≤{port.max}</span>}
    </div>
  );
}

function NodeShell({ id, type, selected, title, subtitle, ports = [], outputKind, runnable = false, children }) {
  const { copy, statuses, runNode, running } = useWorkflow();
  const updateNodeInternals = useUpdateNodeInternals();
  const portKey = ports.map((port) => port.id).join("|");
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portKey, updateNodeInternals]);
  const state = statuses[id];
  const accent = outputKind ? KIND_COLORS[outputKind] : KIND_COLORS.any;
  return (
    <div
      className={`w-[268px] rounded-xl border bg-[#0d0d10]/95 text-white shadow-2xl shadow-black/60 transition-colors ${
        selected ? "border-[#22d3ee]/70 ring-1 ring-[#22d3ee]/25" : state?.status === "error" ? "border-red-500/40" : "border-white/10"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.05]" style={{ color: accent }}>
          <NodeIcon type={type} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold text-white/85">{title}</div>
          {subtitle && <div className="truncate text-[10px] text-white/40">{subtitle}</div>}
        </div>
        <StatusBadge status={state?.status} />
        {runnable && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              runNode(id);
            }}
            disabled={running}
            title={copy.node.runNode}
            aria-label={copy.node.runNode}
            className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-[#22d3ee]/15 hover:text-[#22d3ee] disabled:opacity-30"
          >
            <PlayIcon />
          </button>
        )}
      </div>
      {ports.length > 0 && (
        <div className="border-b border-white/[0.04] py-1.5">
          {ports.map((port) => (
            <PortRow key={port.id} port={port} />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 px-3 py-2.5">{children}</div>
      {state?.status === "error" && state.error && (
        <div className="mx-3 mb-2.5 break-words rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-red-300">{state.error}</div>
      )}
      {outputKind && (
        <div className="relative flex items-center justify-end gap-1.5 border-t border-white/[0.04] px-3 py-1.5 text-[10px] text-white/45">
          {copy.ports[outputKind] || outputKind}
          <Handle type="source" position={Position.Right} id="out" style={handleStyle(outputKind)} />
        </div>
      )}
    </div>
  );
}

const ACCEPT = { image: "image/*", video: "video/*", audio: "audio/*" };

/** Upload / URL picker used by media input nodes and the inspector. */
export function MediaPicker({ kind, url, onChange }) {
  const { copy } = useWorkflow();
  const [progress, setProgress] = useState(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    setProgress(0);
    try {
      onChange(await uploadFile(file, setProgress));
    } catch (error) {
      toast.error(format(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
    } finally {
      setProgress(null);
    }
  };

  const commitUrl = () => {
    const value = draftUrl.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) {
      toast.error(copy.node.invalidUrl);
      return;
    }
    onChange(value);
    setDraftUrl("");
  };

  return (
    <div
      className="nodrag flex flex-col gap-2"
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        upload(event.dataTransfer.files?.[0]);
      }}
    >
      {url ? (
        <MediaPreview output={{ kind, value: url }} />
      ) : (
        <div className={`flex h-16 items-center justify-center rounded-lg border border-dashed text-[10px] ${dragging ? "border-[#22d3ee]/60 text-[#22d3ee]" : "border-white/10 text-white/30"}`}>
          {copy.node.dropHint}
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={progress !== null}
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[11px] font-semibold text-white/80 transition-colors hover:border-[#22d3ee]/40 hover:text-[#22d3ee] disabled:opacity-60"
        >
          {progress !== null ? format(copy.node.uploading, { progress }) : url ? copy.node.replace : copy.node.upload}
        </button>
        {url && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-white/50 transition-colors hover:border-red-400/40 hover:text-red-300"
          >
            {copy.node.clear}
          </button>
        )}
      </div>
      <input
        className={`${FIELD_CLASS} py-1.5 text-[11px]`}
        value={draftUrl}
        onChange={(event) => setDraftUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitUrl();
        }}
        onBlur={commitUrl}
        placeholder={copy.node.pasteUrl}
        aria-label={copy.node.pasteUrl}
      />
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[kind]}
        className="hidden"
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

const TextNode = memo(function TextNode({ id, data, selected }) {
  const { copy, updateNodeData } = useWorkflow();
  return (
    <NodeShell id={id} type="text" selected={selected} title={data.label || copy.nodeTypes.text} outputKind="text">
      <textarea
        className={`${FIELD_CLASS} nodrag nowheel h-24 resize-none`}
        value={data.text || ""}
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
        placeholder={copy.node.textPlaceholder}
        aria-label={copy.nodeTypes.text}
      />
    </NodeShell>
  );
});

function makeMediaNode(kind) {
  return memo(function MediaNode({ id, data, selected }) {
    const { copy, updateNodeData } = useWorkflow();
    return (
      <NodeShell id={id} type={kind} selected={selected} title={data.label || copy.nodeTypes[kind]} outputKind={kind}>
        <MediaPicker kind={kind} url={data.url} onChange={(url) => updateNodeData(id, { url })} />
      </NodeShell>
    );
  });
}

const CombinerNode = memo(function CombinerNode({ id, data, selected }) {
  const { copy, updateNodeData, results } = useWorkflow();
  const ports = useMemo(() => nodeInputPorts({ type: "combiner", data }), [data]);
  return (
    <NodeShell id={id} type="combiner" selected={selected} title={data.label || copy.nodeTypes.combiner} ports={ports} outputKind="text">
      <textarea
        className={`${FIELD_CLASS} nodrag nowheel h-20 resize-none font-mono text-[11px]`}
        value={data.template || ""}
        onChange={(event) => updateNodeData(id, { template: event.target.value })}
        placeholder={copy.node.templatePlaceholder}
        aria-label={copy.inspector.template}
      />
      {templateVariables(data.template).length === 0 && <p className="text-[10px] text-white/35">{copy.node.variablesHint}</p>}
      {results[id] && <MediaPreview output={results[id]} />}
    </NodeShell>
  );
});

const ModelNode = memo(function ModelNode({ id, data, selected }) {
  const { copy, results, connectedHandles } = useWorkflow();
  const model = findModel(data.category, data.modelId);
  const ports = useMemo(() => getModelPorts(data.category, model), [data.category, model]);
  const promptConnected = connectedHandles.has(`${id}:prompt`);
  const hasPromptPort = ports.some((port) => port.id === "prompt");
  return (
    <NodeShell
      id={id}
      type="model"
      selected={selected}
      title={data.label || model?.name || copy.node.chooseModel}
      subtitle={copy.categories[data.category] || data.category}
      ports={ports}
      outputKind={model ? modelOutputKind(data.category) : null}
      runnable={Boolean(model)}
    >
      {!model && <p className="text-[11px] text-amber-300/80">{copy.node.chooseModel}</p>}
      {hasPromptPort && !promptConnected && data.prompt && (
        <p className="line-clamp-3 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[11px] italic text-white/55">{data.prompt}</p>
      )}
      {results[id] ? <MediaPreview output={results[id]} /> : null}
    </NodeShell>
  );
});

const ResultNode = memo(function ResultNode({ id, data, selected }) {
  const { copy, results } = useWorkflow();
  const ports = useMemo(() => nodeInputPorts({ type: "result" }), []);
  return (
    <NodeShell id={id} type="result" selected={selected} title={data.label || copy.nodeTypes.result} ports={ports} runnable>
      {results[id] ? (
        <MediaPreview output={results[id]} large showAll />
      ) : (
        <p className="text-[11px] leading-relaxed text-white/35">{copy.node.waiting}</p>
      )}
    </NodeShell>
  );
});

export const NODE_COMPONENTS = {
  text: TextNode,
  image: makeMediaNode("image"),
  video: makeMediaNode("video"),
  audio: makeMediaNode("audio"),
  combiner: CombinerNode,
  model: ModelNode,
  result: ResultNode,
};
