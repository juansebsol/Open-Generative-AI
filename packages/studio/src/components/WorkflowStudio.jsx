"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import toast, { Toaster } from "react-hot-toast";
import { uploadFile } from "../generation.js";
import { CHAT_PROVIDER_IDS, hasChatProvider } from "../providers/chat.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { resolveCopy } from "../i18nUtils";
import en from "../messages/en/workflowStudio.json";
import zh from "../messages/zh/workflowStudio.json";
import { CycleError, executeGraph, KIND_COLORS, layoutGraph, newId, topologicalOrder, wouldCreateCycle } from "../workflows/graph.js";
import {
  defaultParamValues,
  findModel,
  isConnectionValid,
  MODEL_CATEGORIES,
  nodeInputPorts,
  nodeOutputKind,
  pickModel,
  pruneEdges,
} from "../workflows/modelPorts.js";
import { evaluateNode } from "../workflows/runner.js";
import { buildTemplate, createNode, TEMPLATE_IDS } from "../workflows/templates.js";
import { exportWorkflowJson, loadWorkflowState, saveWorkflowState, toWorkflowRecord } from "../workflows/storage.js";
import { draftWorkflow } from "../workflows/describe.js";
import WorkflowInspector from "./workflow/WorkflowInspector.jsx";
import WorkflowLibrary from "./workflow/WorkflowLibrary.jsx";
import { format, NODE_COMPONENTS, NodeIcon, PlayIcon, WorkflowContext } from "./workflow/WorkflowNodes.jsx";

const SAVE_DELAY_MS = 400;
const TOOLBAR_BUTTON =
  "flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold text-white/75 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

function downloadJson(text, name) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${String(name || "workflow").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "workflow"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileKind(file) {
  const type = file?.type || "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return null;
}

function AddNodeMenu({ copy, onAdd, disabled }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (key, type, label, extra, color) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        onAdd(type, extra);
      }}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
    >
      <span style={{ color }}>
        <NodeIcon type={type} />
      </span>
      {label}
    </button>
  );
  const group = (title) => <div className="px-2.5 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wider text-white/30">{title}</div>;

  return (
    <div className="relative" ref={ref}>
      <button type="button" className={TOOLBAR_BUTTON} onClick={() => {
        const rect = ref.current?.getBoundingClientRect();
        setAlignRight(Boolean(rect && rect.left + 232 > window.innerWidth));
        setOpen((value) => !value);
      }} aria-expanded={open} aria-haspopup="menu" disabled={disabled}>
        <span className="text-sm leading-none">+</span> {copy.toolbar.add}
      </button>
      {open && (
        <div role="menu" className={`absolute ${alignRight ? "right-0" : "left-0"} top-full z-30 mt-1.5 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0c0c0f] p-1 shadow-2xl shadow-black/60`}>
          {group(copy.toolbar.inputsGroup)}
          {["text", "image", "video", "audio"].map((type) => item(type, type, copy.nodeTypes[type], undefined, KIND_COLORS[type]))}
          {group(copy.toolbar.logicGroup)}
          {item("combiner", "combiner", copy.nodeTypes.combiner, undefined, KIND_COLORS.text)}
          {group(copy.toolbar.modelsGroup)}
          {MODEL_CATEGORIES.filter((category) => category.models.length > 0).map((category) =>
            item(`model-${category.id}`, "model", copy.categories[category.id], { category: category.id }, KIND_COLORS[category.output]),
          )}
          {group(copy.toolbar.outputGroup)}
          {item("result", "result", copy.nodeTypes.result, undefined, KIND_COLORS.any)}
        </div>
      )}
    </div>
  );
}

function DescribeDialog({ copy, onClose, onDrafted }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const description = text.trim();
    if (!description || busy) return;
    setBusy(true);
    try {
      const graph = await draftWorkflow(description);
      onDrafted(graph, description);
    } catch (error) {
      toast.error(error?.message === "empty" ? copy.describe.empty : format(copy.describe.failed, { message: formatErrorMessage(error, "") }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wf-describe-title"
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0c0f] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 id="wf-describe-title" className="text-sm font-bold text-white">{copy.describe.title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-white/45">{copy.describe.body}</p>
        <textarea
          autoFocus
          className="mt-4 h-28 w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white outline-none placeholder:text-white/25 focus:border-[#22d3ee]/50"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          }}
          placeholder={copy.describe.placeholder}
          aria-label={copy.describe.title}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={TOOLBAR_BUTTON}>
            {copy.describe.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !text.trim()}
            className="rounded-lg bg-[#22d3ee] px-3.5 py-1.5 text-[11px] font-bold text-black transition-colors hover:bg-[#06b6d4] disabled:opacity-40"
          >
            {busy ? copy.describe.drafting : copy.describe.submit}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkflowStudioInner({
  locale = "en",
  droppedFiles,
  onFilesHandled,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const copy = useMemo(() => resolveCopy(en, zh, locale), [locale]);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fitPendingRef = useRef(false);
  const loadedRef = useRef(false);
  const rootRef = useRef(null);
  const canvasRef = useRef(null);

  const [workflows, setWorkflows] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [results, setResults] = useState({});
  const [statuses, setStatuses] = useState({});
  const [running, setRunning] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [chatReady, setChatReady] = useState(false);

  // Latest values for callbacks that outlive a render (runs, saves).
  const current = useRef({});
  current.current = { workflows, activeId, name, nodes, edges, results };
  const runTokenRef = useRef(0);
  const runningRef = useRef(false);

  const selectedNode = useMemo(() => {
    const selected = nodes.filter((node) => node.selected);
    return selected.length === 1 ? selected[0] : null;
  }, [nodes]);

  // ── Library ────────────────────────────────────────────────────────────
  const snapshotWorkflows = useCallback(() => {
    const { workflows: list, activeId: id, name: currentName, nodes: currentNodes, edges: currentEdges, results: currentResults } = current.current;
    return list.map((workflow) =>
      workflow.id === id ? { ...workflow, name: currentName, nodes: currentNodes, edges: currentEdges, results: currentResults } : workflow,
    );
  }, []);

  const openGraph = useCallback((workflow) => {
    setActiveId(workflow.id);
    setName(workflow.name);
    setNodes(workflow.nodes.map((node) => ({ ...node, selected: false })));
    setEdges(pruneEdges(workflow.nodes, workflow.edges));
    setResults(workflow.results || {});
    setStatuses({});
    fitPendingRef.current = true;
  }, [setEdges, setNodes]);

  // Fit the view once a freshly opened graph has been measured.
  useEffect(() => {
    if (!nodesInitialized || !fitPendingRef.current) return;
    fitPendingRef.current = false;
    fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
  }, [nodesInitialized, fitView]);

  const commitWorkflows = useCallback((list, nextActiveId) => {
    setWorkflows(list);
    if (!saveWorkflowState({ workflows: list, activeId: nextActiveId })) toast.error(copy.library.storageFull, { id: "wf-storage" });
  }, [copy.library.storageFull]);

  const stopIfRunning = useCallback(() => {
    if (!runningRef.current) return true;
    toast(copy.run.busy);
    return false;
  }, [copy.run.busy]);

  const addWorkflow = useCallback((graph, workflowName) => {
    if (!stopIfRunning()) return;
    const record = toWorkflowRecord({ ...graph, name: workflowName });
    if (!record) return;
    setWorkflows([record, ...snapshotWorkflows()]);
    openGraph(record);
    setLibraryOpen(false);
  }, [openGraph, snapshotWorkflows, stopIfRunning]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const state = loadWorkflowState();
    if (state.workflows.length === 0) {
      const record = toWorkflowRecord({ ...buildTemplate(TEMPLATE_IDS[0]), name: en.templates[TEMPLATE_IDS[0]].name });
      setWorkflows([record]);
      openGraph(record);
    } else {
      setWorkflows(state.workflows);
      openGraph(state.workflows.find((workflow) => workflow.id === state.activeId) || state.workflows[0]);
    }
    setLoaded(true);
  }, [openGraph]);

  // Debounced autosave of the open workflow.
  useEffect(() => {
    if (!loaded || !activeId) return undefined;
    const timer = setTimeout(() => {
      const ids = new Set(nodes.map((node) => node.id));
      const keptResults = Object.fromEntries(Object.entries(results).filter(([id]) => ids.has(id)));
      const list = snapshotWorkflows().map((workflow) =>
        workflow.id === activeId ? { ...workflow, results: keptResults, updatedAt: Date.now() } : workflow,
      );
      commitWorkflows(list, activeId);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // Workflows list changes are written by this effect itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeId, name, nodes, edges, results]);

  const openWorkflow = (id) => {
    if (id === activeId || !stopIfRunning()) return;
    const list = snapshotWorkflows();
    setWorkflows(list);
    const target = list.find((workflow) => workflow.id === id);
    if (target) openGraph(target);
    setLibraryOpen(false);
  };

  const renameWorkflow = (id, nextName) => {
    if (id === activeId) setName(nextName);
    commitWorkflows(snapshotWorkflows().map((workflow) => (workflow.id === id ? { ...workflow, name: nextName } : workflow)), activeId);
  };

  const duplicateWorkflow = (id) => {
    const source = snapshotWorkflows().find((workflow) => workflow.id === id);
    if (source) addWorkflow(source, format(copy.library.copyName, { name: source.name }));
  };

  const exportWorkflow = (id) => {
    const source = snapshotWorkflows().find((workflow) => workflow.id === id);
    if (source) downloadJson(exportWorkflowJson(source), source.name);
  };

  const deleteWorkflow = (id) => {
    const list = snapshotWorkflows();
    const target = list.find((workflow) => workflow.id === id);
    if (!target || !window.confirm(format(copy.library.deleteConfirm, { name: target.name }))) return;
    if (id === activeId && !stopIfRunning()) return;
    let remaining = list.filter((workflow) => workflow.id !== id);
    if (remaining.length === 0) remaining = [toWorkflowRecord({ nodes: [], edges: [], name: copy.library.untitled })];
    const nextActiveId = id === activeId ? remaining[0].id : activeId;
    commitWorkflows(remaining, nextActiveId);
    if (id === activeId) openGraph(remaining[0]);
  };

  const importWorkflow = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      const record = toWorkflowRecord(parsed);
      if (!record) throw new Error("invalid");
      addWorkflow({ ...record, results: {} }, record.name);
      toast.success(format(copy.library.imported, { name: record.name }));
    } catch {
      toast.error(copy.library.importFailed);
    }
  };

  const applyTemplate = (templateId) => {
    addWorkflow(buildTemplate(templateId), copy.templates[templateId]?.name || templateId);
  };

  // ── Chat provider for "Describe" ───────────────────────────────────────
  useEffect(() => {
    setChatReady(hasChatProvider());
    return subscribeProviderSettings(() => setChatReady(hasChatProvider()));
  }, []);

  // ── Graph editing ──────────────────────────────────────────────────────
  const updateNodeData = useCallback((id, patch) => {
    setNodes((list) => list.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)));
  }, [setNodes]);

  const setNodeModel = useCallback((id, categoryId, modelId) => {
    const model = (modelId && findModel(categoryId, modelId)) || pickModel(categoryId);
    updateNodeData(id, { category: categoryId, modelId: model?.id || "", params: defaultParamValues(categoryId, model) });
  }, [updateNodeData]);

  // Port layout changes (model swapped, combiner template edited) can
  // invalidate connections; drop the ones that no longer fit.
  const portSignature = nodes
    .map((node) => (node.type === "model" ? `${node.id}:${node.data.category}:${node.data.modelId}` : node.type === "combiner" ? `${node.id}:${node.data.template}` : node.id))
    .join("|");
  useEffect(() => {
    const snapshot = current.current.nodes;
    const ids = new Set(snapshot.map((node) => node.id));
    // Only judge edges between nodes of this snapshot; a newly opened graph
    // may already be queued with nodes this render has not seen yet.
    const known = (edge) => ids.has(edge.source) && ids.has(edge.target);
    setEdges((list) => {
      const valid = new Set(pruneEdges(snapshot, list.filter(known)).map((edge) => edge.id));
      const next = list.filter((edge) => !known(edge) || valid.has(edge.id));
      return next.length === list.length ? list : next;
    });
  }, [portSignature, setEdges]);

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const isValidConnection = useCallback((connection) => {
    const source = nodesById.get(connection.source);
    const target = nodesById.get(connection.target);
    return isConnectionValid(source, target, connection.targetHandle) && !wouldCreateCycle(current.current.edges, connection.source, connection.target);
  }, [nodesById]);

  const onConnect = useCallback((connection) => {
    const target = nodesById.get(connection.target);
    const port = nodeInputPorts(target).find((entry) => entry.id === connection.targetHandle);
    if (!port) return;
    setEdges((list) => {
      const kept = port.multiple
        ? list
        : list.filter((edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle));
      if (kept.some((edge) => edge.source === connection.source && edge.target === connection.target && edge.targetHandle === connection.targetHandle)) return kept;
      return [...kept, { id: newId("e"), source: connection.source, target: connection.target, sourceHandle: "out", targetHandle: connection.targetHandle }];
    });
  }, [nodesById, setEdges]);

  const connectedHandles = useMemo(() => new Set(edges.map((edge) => `${edge.target}:${edge.targetHandle}`)), [edges]);

  const displayEdges = useMemo(() => edges.map((edge) => {
    const color = KIND_COLORS[nodeOutputKind(nodesById.get(edge.source))] || KIND_COLORS.any;
    return {
      ...edge,
      animated: statuses[edge.target]?.status === "running",
      style: { stroke: color, strokeWidth: edge.selected ? 3 : 2, opacity: edge.selected ? 1 : 0.75 },
    };
  }), [edges, nodesById, statuses]);

  const viewportCenter = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    // Keep new nodes clear of the inspector panel on wide canvases.
    const usableWidth = rect.width > 720 ? rect.width - 340 : rect.width;
    return screenToFlowPosition({ x: rect.left + usableWidth / 2, y: rect.top + rect.height / 2 });
  };

  const addNode = (type, extra = {}, position) => {
    const center = position || viewportCenter();
    const offset = (nodes.length % 5) * 24;
    const node = createNode(type, { x: center.x - 134 + offset, y: center.y - 80 + offset }, extra);
    setNodes((list) => [...list.map((entry) => (entry.selected ? { ...entry, selected: false } : entry)), { ...node, selected: true }]);
    return node;
  };

  const deselectAll = () => setNodes((list) => list.map((node) => (node.selected ? { ...node, selected: false } : node)));

  const deleteNode = (id) => {
    setNodes((list) => list.filter((node) => node.id !== id));
    setEdges((list) => list.filter((edge) => edge.source !== id && edge.target !== id));
  };

  const duplicateNode = (node) => {
    const copyNode = createNode(node.type, { x: node.position.x + 40, y: node.position.y + 40 }, JSON.parse(JSON.stringify(node.data)));
    setNodes((list) => [...list.map((entry) => (entry.selected ? { ...entry, selected: false } : entry)), { ...copyNode, selected: true }]);
  };

  const tidyLayout = () => {
    setNodes((list) => layoutGraph(list, current.current.edges));
    setTimeout(() => fitView({ padding: 0.2, maxZoom: 1, duration: 200 }), 50);
  };

  // Files dropped on the shell while this studio is visible become input nodes.
  useEffect(() => {
    if (!droppedFiles?.length || !rootRef.current || rootRef.current.offsetParent === null) return;
    onFilesHandled?.();
    const media = droppedFiles.filter((file) => fileKind(file));
    if (media.length === 0) {
      toast.error(copy.errors.unsupportedFile);
      return;
    }
    const center = viewportCenter();
    media.forEach((file, index) => {
      const node = addNode(fileKind(file), {}, { x: center.x + index * 30, y: center.y + index * 30 });
      const toastId = toast.loading(format(copy.errors.uploading, { name: file.name }));
      uploadFile(file)
        .then((url) => {
          updateNodeData(node.id, { url });
          toast.dismiss(toastId);
        })
        .catch((error) => toast.error(format(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }), { id: toastId }));
    });
    // Only react to a new drop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles]);

  // ── Running ────────────────────────────────────────────────────────────
  const run = useCallback(async (targetIds = null) => {
    if (runningRef.current) {
      toast(copy.run.alreadyRunning);
      return;
    }
    const { nodes: graphNodes, edges: graphEdges, results: cached } = current.current;
    if (graphNodes.length === 0) {
      toast(copy.run.nothing);
      return;
    }
    try {
      topologicalOrder(graphNodes.map((node) => node.id), graphEdges);
    } catch (error) {
      toast.error(error instanceof CycleError ? copy.run.cycle : formatErrorMessage(error));
      return;
    }
    const token = ++runTokenRef.current;
    const isActive = () => runTokenRef.current === token;
    runningRef.current = true;
    setRunning(true);
    onGenerationStart?.();
    try {
      const { outputs, errors, order } = await executeGraph({
        nodes: graphNodes,
        edges: graphEdges,
        targetIds,
        cached,
        evaluate: (node, inputs) => evaluateNode(node, inputs, { copy }),
        isCancelled: () => !isActive(),
        onStatus: (id, status, extra = {}) => {
          if (!isActive()) return;
          setStatuses((previous) => ({
            ...previous,
            [id]: { status, error: extra.error ? formatErrorMessage(extra.error) : undefined },
          }));
          if (status === "done") setResults((previous) => ({ ...previous, [id]: extra.output }));
        },
      });
      if (!isActive()) return;
      const failures = Object.values(errors).filter((error) => error !== "skipped");
      if (failures.length > 0) {
        toast.error(format(copy.run.failed, { count: failures.length }));
        onGenerationError?.(failures[0]);
      } else {
        const byId = new Map(graphNodes.map((node) => [node.id, node]));
        const finalId = [...order].reverse().find((id) => outputs[id] && ["result", "model"].includes(byId.get(id)?.type));
        const final = finalId ? outputs[finalId] : null;
        toast.success(copy.run.finished);
        if (final && final.kind !== "text") onGenerationComplete?.({ url: final.value, type: final.kind });
      }
    } catch (error) {
      if (isActive()) {
        toast.error(error instanceof CycleError ? copy.run.cycle : formatErrorMessage(error));
        onGenerationError?.(error);
      }
    } finally {
      if (isActive()) {
        runningRef.current = false;
        setRunning(false);
        onGenerationEnd?.();
      }
    }
  }, [copy, onGenerationComplete, onGenerationEnd, onGenerationError, onGenerationStart]);

  const cancelRun = () => {
    if (!runningRef.current) return;
    runTokenRef.current += 1;
    runningRef.current = false;
    setRunning(false);
    setStatuses((previous) => Object.fromEntries(
      Object.entries(previous).map(([id, state]) => [id, ["queued", "running"].includes(state.status) ? { status: "cancelled" } : state]),
    ));
    onGenerationEnd?.();
    toast(copy.run.cancelled);
  };

  const runNode = useCallback((id) => run([id]), [run]);

  const clearResults = () => {
    setResults({});
    setStatuses({});
  };

  const onDrafted = (graph, description) => {
    setDescribeOpen(false);
    const fallback = format(copy.describe.draftName, { text: description.length > 40 ? `${description.slice(0, 40)}…` : description });
    addWorkflow({ ...graph, results: {} }, graph.name || fallback);
  };

  const openChatSetup = () => {
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers: CHAT_PROVIDER_IDS } }));
  };

  const contextValue = useMemo(() => ({
    copy,
    updateNodeData,
    setNodeModel,
    results,
    statuses,
    running,
    runNode,
    connectedHandles,
  }), [copy, updateNodeData, setNodeModel, results, statuses, running, runNode, connectedHandles]);

  const libraryProps = {
    copy,
    workflows,
    activeId,
    onOpen: openWorkflow,
    onNew: () => addWorkflow({ nodes: [], edges: [] }, copy.library.untitled),
    onImport: importWorkflow,
    onTemplate: applyTemplate,
    onRename: renameWorkflow,
    onDuplicate: duplicateWorkflow,
    onExport: exportWorkflow,
    onDelete: deleteWorkflow,
  };

  return (
    <WorkflowContext.Provider value={contextValue}>
      <div ref={rootRef} className="relative flex h-full w-full overflow-hidden bg-[#030303] text-white">
        <aside className="oga-enter-fade hidden w-72 shrink-0 border-r border-white/[0.06] lg:flex">
          <WorkflowLibrary {...libraryProps} />
        </aside>
        {libraryOpen && (
          <div className="absolute inset-0 z-40 flex lg:hidden" onClick={() => setLibraryOpen(false)}>
            <div className="h-full w-[min(20rem,85vw)] border-r border-white/10 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <WorkflowLibrary {...libraryProps} onClose={() => setLibraryOpen(false)} />
            </div>
            <div className="flex-1 bg-black/50" />
          </div>
        )}

        <div style={{ "--i": 1 }} className="oga-enter-fade flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#070708] px-3 py-2">
            <button type="button" className={`${TOOLBAR_BUTTON} lg:hidden`} onClick={() => setLibraryOpen(true)} aria-label={copy.toolbar.library}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <input
              className="min-w-0 flex-1 basis-32 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-white outline-none transition-colors hover:border-white/10 focus:border-[#22d3ee]/50 sm:max-w-xs"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => !name.trim() && setName(copy.library.untitled)}
              aria-label={copy.toolbar.nameLabel}
            />
            <AddNodeMenu copy={copy} onAdd={(type, extra) => addNode(type, extra)} />
            <button
              type="button"
              className={TOOLBAR_BUTTON}
              onClick={() => (chatReady ? setDescribeOpen(true) : openChatSetup())}
              title={chatReady ? copy.describe.title : copy.toolbar.describeSetup}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 3-1.9 5.8L4 10.7l5.1 3.7L7.2 21 12 17.3 16.8 21l-1.9-6.6 5.1-3.7-6.1-1.9Z" />
              </svg>
              {copy.toolbar.describe}
              {!chatReady && <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" aria-hidden="true" />}
            </button>
            <div className="hidden items-center gap-2 md:flex">
              <button type="button" className={TOOLBAR_BUTTON} onClick={tidyLayout} disabled={nodes.length === 0}>
                {copy.toolbar.tidy}
              </button>
              <button type="button" className={TOOLBAR_BUTTON} onClick={clearResults} disabled={running || Object.keys(results).length === 0}>
                {copy.toolbar.clearResults}
              </button>
              <button type="button" className={TOOLBAR_BUTTON} onClick={() => exportWorkflow(activeId)} disabled={!activeId}>
                {copy.toolbar.export}
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {running && (
                <button type="button" onClick={cancelRun} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-[11px] font-bold text-red-300 transition-colors hover:bg-red-500/10">
                  {copy.toolbar.cancel}
                </button>
              )}
              <button
                type="button"
                onClick={() => run()}
                disabled={running || nodes.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-[#22d3ee] px-3.5 py-1.5 text-[11px] font-bold text-black shadow-glow transition-colors hover:bg-[#06b6d4] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                <PlayIcon /> {running ? copy.toolbar.running : copy.toolbar.run}
              </button>
            </div>
          </div>

          <div ref={canvasRef} className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={NODE_COMPONENTS}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              colorMode="dark"
              deleteKeyCode={["Backspace", "Delete"]}
              minZoom={0.2}
              maxZoom={1.75}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              defaultEdgeOptions={{ type: "default" }}
              style={{ background: "#030303" }}
            >
              <Background color="rgba(255,255,255,0.07)" bgColor="#030303" gap={22} size={1.2} />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                className="!hidden md:!block"
                style={{ background: "#0a0a0c", width: 160, height: 110 }}
                maskColor="rgba(3,3,3,0.7)"
                nodeColor={(node) => KIND_COLORS[nodeOutputKind(node)] || KIND_COLORS.any}
              />
            </ReactFlow>

            {loaded && nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0c]/95 p-5 text-center shadow-2xl">
                  <h2 className="text-sm font-bold text-white">{copy.inspector.emptyCanvas}</h2>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">{copy.inspector.emptyBody}</p>
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-white/30">{copy.inspector.startFromTemplate}</p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {TEMPLATE_IDS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          const graph = buildTemplate(id);
                          setNodes(graph.nodes);
                          setEdges(graph.edges);
                          if (name === copy.library.untitled) setName(copy.templates[id]?.name || name);
                          fitPendingRef.current = true;
                        }}
                        className="rounded-lg border border-white/[0.08] px-2.5 py-2 text-[11px] font-semibold text-white/75 transition-colors hover:border-[#22d3ee]/40 hover:text-[#22d3ee]"
                      >
                        {copy.templates[id]?.name || id}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {selectedNode && (
              <div className="absolute inset-y-0 right-0 z-20 w-full max-w-[340px] sm:w-[340px]">
                <WorkflowInspector
                  key={selectedNode.id}
                  node={selectedNode}
                  onClose={deselectAll}
                  onDelete={() => deleteNode(selectedNode.id)}
                  onDuplicate={() => duplicateNode(selectedNode)}
                />
              </div>
            )}

            {describeOpen && <DescribeDialog copy={copy} onClose={() => setDescribeOpen(false)} onDrafted={onDrafted} />}
          </div>
        </div>
        <Toaster position="top-right" containerStyle={{ zIndex: 99999 }} toastOptions={{ duration: 5000, style: { background: '#18181b', color: '#ffffff', border: '1px solid rgba(255,255,255,0.15)', fontSize: '13px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', maxWidth: '440px', wordBreak: 'break-word', whiteSpace: 'pre-wrap', padding: '12px 16px' } }} />
      </div>
    </WorkflowContext.Provider>
  );
}

export default function WorkflowStudio(props) {
  return (
    <ReactFlowProvider>
      <WorkflowStudioInner {...props} />
    </ReactFlowProvider>
  );
}
