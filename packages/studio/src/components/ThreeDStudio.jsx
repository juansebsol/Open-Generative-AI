"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from "react";
import toast, { Toaster } from "react-hot-toast";
import { IconAdjustments, IconBrush, IconCube, IconDownload, IconEraser, IconMaximize, IconPencil, IconPhotoPlus, IconSend, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { generateThreeD, uploadFile } from "../generation.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { threeDModels } from "../models.js";
import { getRoutes } from "../providers/catalog/index.js";
import { isEndpointAvailable } from "../providers/client.js";
import { getProvider } from "../providers/directProviders.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { vendorById } from "../vendors.js";
import { addEntry, addPending, getEmptyLibrary, getLibrary, removeEntry, removePending, sendTo, subscribeLibrary, takeHandoff } from "../threeDLibrary.js";
import {
  PROMPT_CONTROL_LABEL_CLASS,
  PromptAction,
  PromptChevronIcon,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptMenuItem,
  PromptMenuList,
  PromptPopover,
  PromptPopoverHeader,
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
} from "./prompt/PromptComposer.jsx";
import StudioEmptyState from "./StudioEmptyState.jsx";
import en from "../messages/en/threeDStudio.json";
import zh from "../messages/zh/threeDStudio.json";
import { resolveCopy } from "../i18nUtils";

// Five pages share this component: Text to 3D and Image to 3D generate a
// mesh; Retexture, Rig and animate, and Mesh tools work on an existing one.
// All pages show the same library (threeDLibrary.js), and "Send to" moves a
// result to another page with the model preloaded.

export const THREE_D_PAGES = {
  text: { mode: "text" },
  image: { mode: "image" },
  retexture: { tools: ["retexture"] },
  rig: { tools: ["rig"] },
  mesh: { tools: ["remesh", "segment", "topology"] },
};

// "Send to" targets, in menu order: page + which tool to preselect there.
const DESTINATIONS = [
  { page: "retexture", toolLabel: "retexture" },
  { page: "rig", toolLabel: "rig" },
  { page: "mesh", toolLabel: "remesh" },
  { page: "mesh", toolLabel: "segment" },
  { page: "mesh", toolLabel: "topology" },
];

const MODEL_FILE = /\.(glb|gltf|obj|fbx|usdz|stl|ply)(\?|$)/i;
const VIEWABLE = /\.(glb|gltf)(\?|$)/i;
const MODEL_ACCEPT = ".glb,.gltf,.obj,.fbx,model/gltf-binary,model/gltf+json";

const GENERATORS = threeDModels.filter((model) => model.kind !== "edit");
const TOOLS = threeDModels.filter((model) => model.kind === "edit");
const FAMILIES = (() => {
  const map = new Map();
  for (const model of GENERATORS) {
    const family = map.get(model.family) || { id: model.family, name: model.name.replace(/ Multi-view$/, ""), vendor: vendorById(model.provider), sketch: Boolean(model.sketch), variants: {} };
    family.variants[model.kind] = model;
    map.set(model.family, family);
  }
  return [...map.values()];
})();
const SKETCH_FAMILY = FAMILIES.find((family) => family.sketch);

const isImageFile = (file) => Boolean(file?.type?.startsWith("image/"));
const isModelFile = (file) => Boolean(file) && (MODEL_FILE.test(file.name || "") || /^model\//.test(file.type || ""));
const fill = (template, values) => String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const fileExt = (url) => (String(url).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || "file").toUpperCase();
const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function variantFor(family, mode, imageCount) {
  if (!family) return null;
  if (mode === "text") return family.variants.text || null;
  if (imageCount > 1 && family.variants.multi) return family.variants.multi;
  return family.variants.image || family.variants.multi || null;
}

function defaultOptions(model) {
  const options = {};
  for (const [key, input] of Object.entries(model?.inputs || {})) {
    if (input.default !== undefined && !input.field) options[key] = input.default;
  }
  return options;
}

// Loads Google's <model-viewer> once, only when a model is on screen.
let viewerPromise = null;
function useModelViewer() {
  const [ready, setReady] = useState(() => typeof customElements !== "undefined" && Boolean(customElements.get("model-viewer")));
  useEffect(() => {
    if (ready) return;
    viewerPromise ||= import("@google/model-viewer").then(() => true).catch(() => false);
    let cancelled = false;
    viewerPromise.then((ok) => !cancelled && ok && setReady(true));
    return () => { cancelled = true; };
  }, [ready]);
  return ready;
}

function ModelView({ src, poster, interactive = false, className = "" }) {
  const ready = useModelViewer();
  if (!ready) return <div className={`flex items-center justify-center text-white/30 ${className}`}><IconCube size={28} stroke={1.5} aria-hidden="true" /></div>;
  return (
    <model-viewer
      src={src}
      poster={poster || undefined}
      alt=""
      camera-controls=""
      auto-rotate=""
      shadow-intensity="1"
      exposure="1"
      interaction-prompt={interactive ? "auto" : "none"}
      class={className}
      style={{ width: "100%", height: "100%", backgroundColor: "#0e0e11", "--poster-color": "transparent" }}
    />
  );
}

// A small drawing surface for sketch-to-3D. Exports a PNG with a white background.
function SketchPad({ copy, onUse, onClose }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [tool, setTool] = useState("pen");
  const [size, setSize] = useState(6);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);
  useEffect(() => { clear(); }, [clear]);

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = canvasRef.current.width / rect.width;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };
  const start = (event) => {
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = point(event);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = tool === "eraser" ? size * 4 : size;
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : "#111111";
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const stop = () => { drawing.current = false; };
  const use = () => canvasRef.current.toBlob((blob) => blob && onUse(new File([blob], "sketch.png", { type: "image/png" })), "image/png");

  const toolButton = (id, Icon, label) => (
    <button type="button" onClick={() => setTool(id)} aria-pressed={tool === id} title={label} className={`flex h-9 w-9 items-center justify-center rounded-lg border ${tool === id ? "border-primary/40 bg-primary/10 text-primary" : "border-white/[0.08] text-white/60 hover:text-white"}`}>
      <Icon size={16} stroke={1.75} aria-hidden="true" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4" onClick={onClose} role="presentation">
      <div className="w-[min(92vw,720px)] rounded-2xl border border-white/[0.12] bg-[#111114] p-4" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={copy.title}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-white">{copy.title}</div>
            <div className="text-[12px] text-white/45">{copy.hint}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={copy.cancel} className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/[0.06] hover:text-white"><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
        </div>
        <canvas ref={canvasRef} width={1024} height={1024} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerLeave={stop} className="aspect-square w-full touch-none rounded-xl bg-white" style={{ cursor: "crosshair" }} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {toolButton("pen", IconPencil, copy.pen)}
            {toolButton("eraser", IconEraser, copy.eraser)}
            <input type="range" min="2" max="24" value={size} onChange={(event) => setSize(Number(event.target.value))} aria-label={copy.brush} className="w-28 accent-[#22d3ee]" />
            <button type="button" onClick={clear} className="h-9 rounded-lg border border-white/[0.08] px-3 text-[12.5px] text-white/60 hover:text-white">{copy.clear}</button>
          </div>
          <button type="button" onClick={use} className="h-9 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-[#04202a]">{copy.use}</button>
        </div>
      </div>
    </div>
  );
}

function useLibrary() {
  return useSyncExternalStore(subscribeLibrary, getLibrary, getEmptyLibrary);
}

export default function ThreeDStudio({ page = "text", onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled, locale = "en" }) {
  const copy = resolveCopy(en, zh, locale);
  const pageCopy = copy.pages[page] || copy.pages.text;
  const config = THREE_D_PAGES[page] || THREE_D_PAGES.text;
  const isTool = Boolean(config.tools);
  const mode = config.mode || "text";
  const PERSIST_KEY = `hg_three_d_${page}`;

  const library = useLibrary();
  const families = useMemo(() => (isTool ? [] : FAMILIES.filter((entry) => (mode === "text" ? entry.variants.text : entry.variants.image || entry.variants.multi))), [isTool, mode]);
  const tools = useMemo(() => (isTool ? TOOLS.filter((tool) => config.tools.includes(tool.toolLabel)) : []), [isTool, config.tools]);

  const [familyId, setFamilyId] = useState(families[0]?.id || "");
  const [toolId, setToolId] = useState(tools[0]?.id || "");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState([]); // [{ url, name }]
  const [source, setSource] = useState(null); // { url, name, thumbnail, fromId }
  const [uploading, setUploading] = useState(null);
  const [options, setOptions] = useState({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [providerReady, setProviderReady] = useState(null);
  const fileInputRef = useRef(null);
  const modelInputRef = useRef(null);
  const textareaRef = useRef(null);
  const hasRestored = useRef(false);

  const family = families.find((entry) => entry.id === familyId) || families[0] || null;
  const tool = tools.find((entry) => entry.id === toolId) || tools[0] || null;
  const selectedModel = isTool ? tool : variantFor(family, mode, images.length);
  const maxImages = isTool ? 1 : family?.variants.multi ? (family.variants.multi.maxImages || 4) : 1;
  const showPrompt = mode === "text" || Boolean(selectedModel?.hasPrompt);
  const needsImage = mode === "image" || (isTool && (tool?.required || []).includes("image_url"));
  const allowsImage = needsImage || (isTool && Boolean(tool?.inputs?.image_url));
  const toolLabel = (item) => copy.tools[item?.toolLabel] || item?.name || "";
  const toolMeta = (item) => (toolLabel(item) === item.name ? item.provider_name : `${item.name} · ${item.provider_name}`);

  useEffect(() => {
    if (!selectedModel) return;
    setOptions((previous) => {
      const next = defaultOptions(selectedModel);
      for (const key of Object.keys(next)) {
        const input = selectedModel.inputs[key];
        if (previous[key] !== undefined && (input.type === "boolean" || input.enum?.includes(previous[key]))) next[key] = previous[key];
      }
      return next;
    });
  }, [selectedModel]);

  useEffect(() => {
    const sync = () => setProviderReady(Boolean(selectedModel) && isEndpointAvailable(selectedModel.endpoint || selectedModel.id));
    sync();
    return subscribeProviderSettings(sync);
  }, [selectedModel]);

  const providersText = useMemo(() => {
    const ids = [...new Set(threeDModels.flatMap((model) => getRoutes(model.endpoint || model.id).map((route) => route.provider)))];
    const labels = ids.map((id) => getProvider(id)?.label || id);
    return labels.length <= 1 ? labels[0] || "" : `${labels.slice(0, -1).join(", ")} ${copy.providers.or} ${labels[labels.length - 1]}`;
  }, [copy.providers.or]);

  const openProviderSettings = () => {
    const providers = selectedModel ? [...new Set(getRoutes(selectedModel.endpoint || selectedModel.id).map((route) => route.provider))] : [];
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers } }));
  };

  // Per-page persistence (the library persists itself).
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      if (data) {
        if (families.some((entry) => entry.id === data.familyId)) setFamilyId(data.familyId);
        if (tools.some((entry) => entry.id === data.toolId)) setToolId(data.toolId);
        if (typeof data.prompt === "string") setPrompt(data.prompt);
        if (Array.isArray(data.images)) setImages(data.images.filter((image) => typeof image?.url === "string"));
        if (data.source && typeof data.source.url === "string") setSource(data.source);
        if (data.options && typeof data.options === "object") setOptions(data.options);
      }
    } catch (error) {
      console.warn("[ThreeDStudio] could not restore state", error);
    } finally {
      hasRestored.current = true;
    }
  }, [PERSIST_KEY, families, tools]);

  useEffect(() => {
    if (!hasRestored.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ familyId, toolId, prompt, images, source, options }));
      } catch (error) {
        console.warn("[ThreeDStudio] could not save state", error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [PERSIST_KEY, familyId, toolId, prompt, images, source, options]);

  // A model sent here from another page.
  useEffect(() => {
    if (!library.handoffs[page]) return;
    const handoff = takeHandoff(page);
    if (!handoff) return;
    setSource(handoff.source);
    const target = tools.find((item) => item.toolLabel === handoff.toolLabel);
    if (target) setToolId(target.id);
    setViewer(null);
    setOpenDropdown(null);
  }, [library.handoffs, page, tools]);

  // Uploads: reference images, or a model file for the tools.
  const uploadImages = useCallback(async (fileList, { sketch = false } = {}) => {
    const files = Array.from(fileList || []).filter(isImageFile);
    if (files.length === 0) {
      toast.error(copy.errors.notImage);
      return;
    }
    const replace = maxImages === 1;
    const room = replace ? 1 : Math.max(0, maxImages - images.length);
    if (files.length > room) toast(fill(copy.media.maxImages, { max: maxImages }));
    const queue = files.slice(0, room);
    if (queue.length === 0) return;
    setUploading({ done: 0, total: queue.length, progress: 0 });
    for (const [index, file] of queue.entries()) {
      try {
        const url = await uploadFile(file, (progress) => setUploading({ done: index, total: queue.length, progress }));
        setImages((previous) => (replace ? [{ url, name: file.name }] : [...previous, { url, name: file.name }].slice(0, maxImages)));
      } catch (error) {
        toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
      }
    }
    setUploading(null);
    if (sketch && SKETCH_FAMILY) setFamilyId(SKETCH_FAMILY.id);
  }, [copy, images.length, maxImages]);

  const uploadModel = useCallback(async (file) => {
    if (!isModelFile(file)) {
      toast.error(copy.errors.notModel);
      return;
    }
    setUploading({ done: 0, total: 1, progress: 0 });
    try {
      const url = await uploadFile(file, (progress) => setUploading({ done: 0, total: 1, progress }));
      setSource({ url, name: file.name, thumbnail: null, fromId: null });
    } catch (error) {
      toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
    } finally {
      setUploading(null);
    }
  }, [copy]);

  useEffect(() => {
    if (!droppedFiles?.length) return;
    const model = droppedFiles.find(isModelFile);
    const imageFiles = droppedFiles.filter(isImageFile);
    if (isTool && model) uploadModel(model);
    else if (allowsImage && imageFiles.length > 0) uploadImages(imageFiles);
    else toast.error(isTool ? copy.errors.notModel : copy.errors.notImage);
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled, uploadImages, uploadModel, isTool, allowsImage, copy]);

  const asSource = (entry) => ({ url: entry.url, name: entry.prompt || entry.modelName, thumbnail: entry.thumbnail, fromId: entry.id });
  const useHere = (entry) => {
    setSource(asSource(entry));
    setOpenDropdown(null);
    setViewer(null);
  };
  const send = (entry, destination) => {
    setOpenDropdown(null);
    setViewer(null);
    sendTo(destination.page, { source: asSource(entry), toolLabel: destination.toolLabel });
  };

  // Generation
  const handleGenerate = async () => {
    if (!selectedModel) return;
    if (!providerReady) {
      openProviderSettings();
      return;
    }
    if (isTool && !source) return toast.error(copy.errors.needModel);
    if (showPrompt && selectedModel.promptRequired && !prompt.trim()) {
      textareaRef.current?.focus();
      return toast.error(copy.errors.needPrompt);
    }
    if (needsImage && images.length === 0) return toast.error(isTool ? copy.errors.needReference : copy.errors.needImage);

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runPrompt = showPrompt ? prompt.trim() : "";
    const payload = { model: selectedModel.id, ...options };
    if (runPrompt) payload.prompt = runPrompt;
    if (isTool) {
      payload.model_url = source.url;
      if (images[0] && allowsImage) payload.image_url = images[0].url;
    } else if (mode === "image") {
      if (selectedModel.imageField === "images_list") payload.images_list = images.map((image) => image.url);
      else payload.image_url = images[0].url;
    }
    const label = isTool ? `${toolLabel(tool)} · ${tool.provider_name}` : family.name;

    addPending({ id: runId, label, prompt: runPrompt });
    onGenerationStart?.();
    try {
      const result = await generateThreeD(payload);
      const media = result?.media?.length ? result.media : (result?.outputs || []).map((url) => ({ url, type: MODEL_FILE.test(url) ? "model" : "file" }));
      const files = media.filter((item) => item.type === "model" || MODEL_FILE.test(item.url));
      if (files.length === 0) throw new Error(copy.errors.noModel);
      const viewable = files.find((item) => VIEWABLE.test(item.url)) || files[0];
      const thumbnail = media.find((item) => item.type === "image")?.url || (isTool ? source.thumbnail : images[0]?.url) || null;
      const entry = {
        id: result.id || runId,
        url: viewable.url,
        files: files.map((item) => ({ url: item.url, ext: fileExt(item.url) })),
        thumbnail,
        prompt: runPrompt || (isTool ? `${toolLabel(tool)}: ${source.name}` : ""),
        model: selectedModel.id,
        modelName: isTool ? toolLabel(tool) : family.name,
        vendor: selectedModel.provider_name || "",
        page,
        sourceId: isTool ? source.fromId : null,
        timestamp: new Date().toISOString(),
      };
      addEntry(entry);
      onGenerationComplete?.({ url: entry.url, model: selectedModel.id, prompt: runPrompt, type: "3d" });
    } catch (error) {
      console.error("[ThreeDStudio]", error);
      const message = formatErrorMessage(error, copy.errors.generationFailed);
      if (onGenerationError) onGenerationError(message);
      else toast.error(message);
    } finally {
      removePending(runId);
      onGenerationEnd?.();
    }
  };

  const download = async (entry, file) => {
    const name = `${slug(entry.prompt) || "openstudio"}-${String(entry.id).slice(-6)}.${file.ext.toLowerCase()}`;
    try {
      const blob = await (await fetch(file.url)).blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } catch {
      window.open(file.url, "_blank", "noopener");
    }
  };

  const deleteEntry = (id) => {
    if (!confirm(copy.confirm.deleteItem)) return;
    removeEntry(id);
    if (viewer?.id === id) setViewer(null);
  };

  const setOption = (key, value) => setOptions((previous) => ({ ...previous, [key]: value }));
  const inputs = Object.entries(selectedModel?.inputs || {}).filter(([, input]) => !input.field && (Array.isArray(input.enum) || input.type === "boolean"));
  const primaryInputs = inputs.filter(([, input]) => !input.advanced);
  const advancedInputs = inputs.filter(([, input]) => input.advanced);
  const visibleInputs = showAdvanced ? inputs : primaryInputs;
  const optionLabel = (input, value) => input.optionLabels?.[value] ?? String(value);
  const hasGallery = library.entries.length > 0 || library.pending.length > 0;
  const starters = (pageCopy.starters || []).map((starter) => ({ label: starter.label, prompt: starter.prompt }));
  const destinations = DESTINATIONS.filter((destination) => destination.page !== page);

  const sendMenu = (entry, placement = "below") => (
    <div className={`absolute z-20 w-[220px] rounded-[10px] border border-white/[0.12] bg-[#111114] p-1 shadow-xl ${placement === "below" ? "right-0 top-full mt-1" : "left-0 bottom-full mb-1"}`}>
      {destinations.map((destination) => (
        <button key={`${destination.page}-${destination.toolLabel}`} type="button" onClick={() => send(entry, destination)} className="flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left hover:bg-white/[0.06]">
          <span className="text-[12.5px] text-white/90">{copy.tools[destination.toolLabel]}</span>
          {copy.pages[destination.page].title !== copy.tools[destination.toolLabel] && <span className="text-[11px] text-white/40">{copy.pages[destination.page].title}</span>}
        </button>
      ))}
    </div>
  );

  const cardActions = (entry) => (
    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {isTool && (
        <button type="button" onClick={() => useHere(entry)} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-semibold text-[#04202a] hover:brightness-110">{copy.send.here}</button>
      )}
      <div className="relative">
        <button type="button" title={copy.send.button} aria-label={copy.send.button} onClick={() => setOpenDropdown(openDropdown === `send-${entry.id}` ? null : `send-${entry.id}`)} className="flex h-8 items-center gap-1.5 rounded-lg bg-black/60 px-2.5 text-[12px] font-medium text-white hover:bg-white/20"><IconSend size={14} stroke={1.75} aria-hidden="true" />{copy.send.button}</button>
        {openDropdown === `send-${entry.id}` && sendMenu(entry)}
      </div>
      <button type="button" title={copy.gallery.fullscreen} aria-label={copy.gallery.fullscreen} onClick={() => setViewer(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconMaximize size={15} stroke={1.75} aria-hidden="true" /></button>
      <div className="relative">
        <button type="button" title={copy.gallery.download} aria-label={copy.gallery.download} onClick={() => setOpenDropdown(openDropdown === `dl-${entry.id}` ? null : `dl-${entry.id}`)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconDownload size={15} stroke={1.75} aria-hidden="true" /></button>
        {openDropdown === `dl-${entry.id}` && (
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-[10px] border border-white/[0.12] bg-[#111114] p-1 shadow-xl">
            {entry.files.map((file) => (
              <button key={file.url} type="button" onClick={() => { download(entry, file); setOpenDropdown(null); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-white/85 hover:bg-white/[0.06]">
                <span>{file.ext}</span><IconDownload size={13} stroke={1.75} className="text-white/40" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" title={copy.gallery.delete} aria-label={copy.gallery.delete} onClick={() => deleteEntry(entry.id)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-red-300 hover:bg-red-500 hover:text-white"><IconTrash size={15} stroke={1.75} aria-hidden="true" /></button>
    </div>
  );

  const sourceChip = source ? (
    <div className="flex h-10 items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] pl-1 pr-3">
      {source.thumbnail
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={source.thumbnail} alt="" className="h-8 w-8 rounded-full object-cover" />
        : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-primary"><IconCube size={15} stroke={1.75} aria-hidden="true" /></span>}
      <span className="max-w-[200px] truncate text-[12.5px] text-white/85">{source.name}</span>
      <button type="button" onClick={() => setSource(null)} aria-label={copy.edit.clearModel} className="text-white/40 hover:text-white"><IconX size={14} stroke={2} aria-hidden="true" /></button>
    </div>
  ) : (
    <button type="button" onClick={() => modelInputRef.current?.click()} disabled={Boolean(uploading)} className="flex h-10 items-center gap-2 rounded-full border border-dashed border-white/20 px-3.5 whitespace-nowrap text-[12.5px] text-white/60 hover:border-white/40 hover:text-white">
      {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconUpload size={15} stroke={1.75} aria-hidden="true" />}
      {copy.edit.uploadModel}
    </button>
  );

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative overflow-hidden">
      <Toaster position="top-center" toastOptions={{ style: { background: "#111114", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: "13px" } }} />

      {providerReady === false && (
        <div className="absolute top-4 left-1/2 z-40 w-[min(640px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-100 flex items-center justify-between gap-4">
          <span>{fill(copy.providers.needKey, { providers: providersText })}</span>
          <button type="button" onClick={openProviderSettings} className="shrink-0 rounded-lg bg-amber-300 px-3 py-1.5 text-[12px] font-semibold text-black">{copy.providers.openSettings}</button>
        </div>
      )}

      <div className="flex-1 w-full overflow-y-auto custom-scrollbar pb-64 pt-4 px-4 md:px-8">
        {hasGallery ? (
          <div className="mx-auto max-w-6xl pt-12">
            <div className="mb-3 flex items-baseline justify-between px-1">
              <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/40">{fill(copy.gallery.library, { count: library.entries.length })}</div>
              {isTool && !source && <div className="text-[12px] text-white/45">{copy.gallery.pickHint}</div>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {library.pending.map((run) => (
                <div key={run.id} className="aspect-square rounded-2xl border border-white/[0.08] bg-[#0e0e11] flex flex-col items-center justify-center gap-3 text-center p-6">
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
                  <div className="text-[14px] font-medium text-white/85">{fill(copy.gallery.pendingTitle, { model: run.label })}</div>
                  <div className="text-[12px] text-white/45">{copy.gallery.pendingHint}</div>
                </div>
              ))}
              {library.entries.map((entry) => (
                <div key={entry.id} className={`group relative aspect-square overflow-hidden rounded-2xl border bg-[#0e0e11] ${source?.fromId === entry.id ? "border-primary/60" : "border-white/[0.08]"}`}>
                  {VIEWABLE.test(entry.url)
                    ? <ModelView src={entry.url} poster={entry.thumbnail} className="h-full w-full" />
                    : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/40">
                        <IconCube size={30} stroke={1.5} aria-hidden="true" />
                        <span className="text-[12px]">{fill(copy.gallery.noPreview, { ext: entry.files[0]?.ext || "" })}</span>
                      </div>
                    )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#09090b]/95 to-transparent p-3 pt-10">
                    <div className="truncate text-[13px] font-medium text-white/90">{entry.prompt || copy.gallery.fromImage}</div>
                    <div className="text-[11.5px] text-white/45">{entry.modelName}{entry.vendor ? ` · ${entry.vendor}` : ""}</div>
                  </div>
                  {cardActions(entry)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full w-full animate-fade-in-up">
            <StudioEmptyState heading={pageCopy.heading} accent={pageCopy.accent} subtitle={pageCopy.subtitle} starters={starters} onStarter={(text) => { setPrompt(text); textareaRef.current?.focus(); }} showcase={null} />
          </div>
        )}
      </div>

      {viewer && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={() => setViewer(null)} role="presentation">
          <div className="relative h-[min(80vh,900px)] w-[min(90vw,1100px)] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0e0e11]" onClick={(event) => event.stopPropagation()} role="presentation">
            <ModelView src={viewer.url} poster={viewer.thumbnail} interactive className="h-full w-full" />
            <button type="button" onClick={() => setViewer(null)} aria-label={copy.gallery.close} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
            <div className="absolute bottom-3 left-3 flex items-center gap-2">
              <span className="rounded-lg bg-black/60 px-3 py-1.5 text-[12px] text-white/80">{viewer.prompt || viewer.modelName}</span>
              {isTool && <button type="button" onClick={() => useHere(viewer)} className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-[#04202a]">{copy.send.here}</button>}
              <div className="relative">
                <button type="button" onClick={() => setOpenDropdown(openDropdown === "viewer-send" ? null : "viewer-send")} className="flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/20"><IconSend size={14} stroke={1.75} aria-hidden="true" />{copy.send.button}</button>
                {openDropdown === "viewer-send" && sendMenu(viewer, "above")}
              </div>
            </div>
          </div>
        </div>
      )}

      {sketchOpen && <SketchPad copy={copy.sketch} onClose={() => setSketchOpen(false)} onUse={(file) => { setSketchOpen(false); uploadImages([file], { sketch: true }); }} />}

      <PromptComposer>
        <div className="flex items-start gap-2 px-1">
          {isTool && (
            <div className="flex items-center gap-2">
              {sourceChip}
              <input ref={modelInputRef} type="file" accept={MODEL_ACCEPT} className="hidden" onChange={(event) => { uploadModel(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
          )}

          {allowsImage && (
            <div className="flex items-center gap-2 flex-wrap">
              {images.map((image, index) => (
                <div key={image.url} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setImages((previous) => previous.filter((_, i) => i !== index))} aria-label={copy.media.remove} className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 hover:opacity-100"><IconX size={14} stroke={2} aria-hidden="true" /></button>
                </div>
              ))}
              {(images.length < maxImages || maxImages === 1) && (
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)} title={isTool ? copy.edit.styleImage : fill(copy.media.addImages, { max: maxImages })} className={promptMediaButtonClassName()}>
                  {uploading && !isTool ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconPhotoPlus size={16} stroke={1.75} className="text-white/60" aria-hidden="true" />}
                </button>
              )}
              {mode === "image" && SKETCH_FAMILY && (
                <button type="button" onClick={() => setSketchOpen(true)} title={copy.sketch.open} aria-label={copy.sketch.open} className={promptMediaButtonClassName()}>
                  <IconBrush size={16} stroke={1.75} className="text-white/60" aria-hidden="true" />
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" multiple={maxImages > 1} className="hidden" onChange={(event) => { uploadImages(event.target.files); event.target.value = ""; }} />
            </div>
          )}

          {showPrompt
            ? <PromptTextarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={selectedModel?.sketch ? copy.prompt.sketchPlaceholder : pageCopy.placeholder} />
            : <p className="flex-1 px-1.5 pt-2.5 text-[13.5px] text-white/40">
                {isTool
                  ? (source ? fill(copy.prompt.editHint, { tool: toolLabel(tool) }) : pageCopy.placeholder)
                  : (images.length ? fill(copy.prompt.imageHint, { count: images.length, max: maxImages }) : pageCopy.placeholder)}
              </p>}
        </div>

        <PromptFooter>
          <PromptControls>
            {(isTool ? tools.length > 1 : families.length > 1) && (
              <div className="relative">
                <button type="button" onClick={() => setOpenDropdown(openDropdown === "model" ? null : "model")} className={promptControlClassName({ active: openDropdown === "model" })}>
                  {isTool
                    ? <span className="text-[11px] text-white/40">{copy.controls.tool}</span>
                    : <span className={`flex h-5 w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-[9px] font-semibold ${family?.vendor.color || "text-primary"}`}>{family?.vendor.mono}</span>}
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{isTool ? `${toolLabel(tool)} · ${tool?.provider_name}` : family?.name}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === "model" && (
                  <PromptPopover className="w-[340px]">
                    <PromptPopoverHeader>{isTool ? copy.controls.tool : copy.controls.model}</PromptPopoverHeader>
                    <PromptMenuList>
                      {isTool
                        ? tools.map((item) => (
                          <PromptMenuItem key={item.id} selected={item.id === tool?.id} description={item.description} wrapDescription onClick={() => { setToolId(item.id); setOpenDropdown(null); }}>
                            {toolLabel(item)} <span className="text-white/40">· {toolMeta(item)}</span>
                          </PromptMenuItem>
                        ))
                        : families.map((entry) => (
                          <PromptMenuItem key={entry.id} selected={entry.id === family?.id} description={variantFor(entry, mode, images.length)?.description} wrapDescription onClick={() => { setFamilyId(entry.id); setOpenDropdown(null); }}>
                            {entry.name} <span className="text-white/40">· {entry.vendor.name}</span>
                          </PromptMenuItem>
                        ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            )}
            {isTool && tools.length === 1 && tool && (
              <span className={promptControlClassName({ active: false })} title={tool.description}>
                <span className="text-[11px] text-white/40">{copy.controls.tool}</span>
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{toolLabel(tool)} · {tool.provider_name}</span>
              </span>
            )}

            {visibleInputs.map(([key, input]) => (input.type === "boolean" ? (
              <button key={key} type="button" aria-pressed={Boolean(options[key])} onClick={() => setOption(key, !options[key])} className={promptControlClassName({ active: Boolean(options[key]) })} title={input.description || input.title}>
                <span className={`h-1.5 w-1.5 rounded-full ${options[key] ? "bg-primary" : "bg-white/25"}`} aria-hidden="true" />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{input.title}</span>
              </button>
            ) : (
              <div key={key} className="relative">
                <button type="button" onClick={() => setOpenDropdown(openDropdown === key ? null : key)} className={promptControlClassName({ active: openDropdown === key })} title={input.description || input.title}>
                  <span className="text-[11px] text-white/40">{input.title}</span>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{optionLabel(input, options[key] ?? input.default)}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === key && (
                  <PromptPopover>
                    <PromptPopoverHeader>{input.title}</PromptPopoverHeader>
                    <PromptMenuList>
                      {input.enum.map((value) => (
                        <PromptMenuItem key={String(value)} selected={options[key] === value} onClick={() => { setOption(key, value); setOpenDropdown(null); }}>{optionLabel(input, value)}</PromptMenuItem>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            )))}

            {advancedInputs.length > 0 && (
              <button type="button" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced} className={promptControlClassName({ active: showAdvanced })} title={copy.controls.advancedHint}>
                <IconAdjustments size={14} stroke={1.75} aria-hidden="true" />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{showAdvanced ? copy.controls.less : fill(copy.controls.more, { count: advancedInputs.length })}</span>
              </button>
            )}
          </PromptControls>

          <PromptAction onClick={handleGenerate} disabled={Boolean(uploading) || !selectedModel}>
            {isTool ? copy.buttons.apply : copy.buttons.generate}
          </PromptAction>
        </PromptFooter>
      </PromptComposer>
    </div>
  );
}
