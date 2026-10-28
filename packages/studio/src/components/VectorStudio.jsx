"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconAdjustments, IconArrowsExchange, IconDownload, IconFileExport, IconFileZip, IconIcons, IconMaximize, IconMoon, IconPalette, IconPhotoPlus,
  IconPhotoUp, IconSun, IconSvg, IconTrash, IconUpload, IconVectorBezier2, IconVectorSpline, IconX,
} from "@tabler/icons-react";
import { generateVector, uploadFile } from "../generation.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { vectorTextModels, vectorizeModels, vectorModels, vectorModelDefaults } from "../vectorModels.js";
import { getRoutes } from "../providers/catalog/index.js";
import { isEndpointAvailable } from "../providers/client.js";
import { getProvider } from "../providers/directProviders.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { fetchMediaBlob, saveLocalBlob } from "../providers/mediaStore.js";
import { addEntry, addPending, getEmptyLibrary, getLibrary, removeEntry, removePending, removeSet, subscribeLibrary, takeHandoff, updatePending } from "../vectorLibrary.js";
import { sanitizeSvg } from "../vector/svgSanitize.js";
import { buildSprite, iconFileName } from "../vector/svgSprite.js";
import { planIconSet, parseIconNames, MAX_ICONS } from "../vector/iconSetPlanner.js";
import { optimizeSvg, optimizeStats } from "../vector/svgOptimize.js";
import { buildZip } from "../vector/zip.js";
import { classifyVectorOutput, describeVectorOutputs } from "../vector/outputs.js";
import { PALETTES, MAX_PALETTE_COLORS, normalizePalette, paletteToPromptWords, paletteToRecraft } from "../vector/palettes.js";
import { PNG_SIZES, downloadBytes, downloadText, svgToAppIconZip, svgToFavicon, svgToPdf, svgToPngBlob } from "../vector/exportKit.js";
import {
  PROMPT_CONTROL_LABEL_CLASS,
  PromptAction,
  PromptActionGroup,
  PromptChevronIcon,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptMenuItem,
  PromptMenuList,
  PromptPopover,
  PromptPopoverHeader,
  PromptSegmentedControl,
  PromptSegmentOption,
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
} from "./prompt/PromptComposer.jsx";
import PriceChip, { PriceHint } from "./prompt/PriceChip.jsx";
import StudioEmptyState from "./StudioEmptyState.jsx";
import en from "../messages/en/vectorStudio.json";
import zh from "../messages/zh/vectorStudio.json";
import { resolveCopy } from "../i18nUtils";

// One studio, three tools on a rail: Text to Logo and Icon Set generate
// SVGs from a prompt (Recraft, Ideogram); Vectorize traces a raster. Every
// result lands in one library (vectorLibrary.js) as a sanitised SVG, and
// the Export kit turns any of them into PNG, PDF, favicon or app icons in
// the browser for free. Later tools (Logo Rescue, Sketch to Vector, the
// Vibe Motion and 3D bridges) plug into the same rail and library.

export const VECTOR_TOOLS = ["logo", "icons", "vectorize"];
const TOOL_ICONS = { logo: IconVectorBezier2, icons: IconIcons, vectorize: IconVectorSpline };

const PERSIST_KEY = "oga_vector_studio_v1";
const IMAGE_STUDIO_KEY = "hg_image_studio_persistent";
const THUMBNAIL_SIZE = 256;
const LOGO_CONCURRENCY = 4;
const ICON_CONCURRENCY = 3;

const CHECKER = {
  light: { backgroundColor: "#ffffff", backgroundImage: "linear-gradient(45deg,#e4e4e7 25%,transparent 25%,transparent 75%,#e4e4e7 75%),linear-gradient(45deg,#e4e4e7 25%,transparent 25%,transparent 75%,#e4e4e7 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" },
  dark: { backgroundColor: "#121216", backgroundImage: "linear-gradient(45deg,#1d1d23 25%,transparent 25%,transparent 75%,#1d1d23 75%),linear-gradient(45deg,#1d1d23 25%,transparent 25%,transparent 75%,#1d1d23 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" },
};

const isImageFile = (file) => /^image\/(png|jpe?g|webp)$/i.test(file?.type || "");
const fill = (template, values) => String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const formatBytes = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`);
const number = (value, locale) => new Intl.NumberFormat(locale).format(value);

// Sanitised SVG text per local URL, shared by every card that shows it.
const svgCache = new Map();
function loadSvgText(url) {
  if (!svgCache.has(url)) {
    svgCache.set(url, fetchMediaBlob(url).then((blob) => blob.text()).then((text) => sanitizeSvg(text)).catch(() => null));
  }
  return svgCache.get(url);
}
function useSvgText(url) {
  const [svg, setSvg] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setSvg(null);
      return undefined;
    }
    loadSvgText(url).then((text) => { if (!cancelled) setSvg(text); });
    return () => { cancelled = true; };
  }, [url]);
  return svg;
}

// Runs `worker` over `items`, a few at a time, keeping result order.
async function runPool(items, worker, concurrency) {
  const queue = items.map((item, index) => [item, index]);
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length) {
      const [item, index] = queue.shift();
      results[index] = await worker(item, index);
    }
  }));
  return results;
}

function readImageStudioImages() {
  try {
    const data = JSON.parse(localStorage.getItem(IMAGE_STUDIO_KEY) || "null");
    const outputs = (data?.localHistory || []).filter((entry) => typeof entry?.url === "string").map((entry) => ({ url: entry.url, name: entry.prompt || "Image Studio" }));
    const uploads = (data?.uploadHistory || []).filter((entry) => typeof entry?.url === "string" && !entry.pending).map((entry) => ({ url: entry.url, name: entry.name || "Upload" }));
    return [...outputs, ...uploads];
  } catch {
    return [];
  }
}

function SvgView({ url, svg, className = "" }) {
  const loaded = useSvgText(svg ? null : url);
  const markup = svg ?? loaded;
  if (!markup) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
      </div>
    );
  }
  return <div className={`oga-svg-fit ${className}`} dangerouslySetInnerHTML={{ __html: markup }} />;
}

function Preview({ entry, tone, className = "" }) {
  if (entry.kind === "raster") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={entry.url} alt="" className={`h-full w-full object-contain ${className}`} style={CHECKER[tone]} />;
  }
  return <div className={`h-full w-full p-[6%] ${className}`} style={CHECKER[tone]}><SvgView url={entry.url} className="h-full w-full" /></div>;
}

function ToneToggle({ tone, onChange, copy }) {
  return (
    <button type="button" onClick={() => onChange(tone === "light" ? "dark" : "light")} title={copy.preview.toggle} aria-label={copy.preview.toggle} className={promptControlClassName({ active: false })}>
      {tone === "light" ? <IconSun size={14} stroke={1.75} aria-hidden="true" /> : <IconMoon size={14} stroke={1.75} aria-hidden="true" />}
      <span className={PROMPT_CONTROL_LABEL_CLASS}>{tone === "light" ? copy.preview.light : copy.preview.dark}</span>
    </button>
  );
}

function ExportKitDialog({ entry, copy, locale, onClose, onVectorize }) {
  const svg = useSvgText(entry.kind === "svg" ? entry.url : null);
  const optimised = useMemo(() => (svg ? optimizeSvg(svg) : null), [svg]);
  const stats = useMemo(() => (svg && optimised ? optimizeStats(svg, optimised) : null), [svg, optimised]);
  const [busy, setBusy] = useState(null);
  const base = slug(entry.name || entry.prompt) || "vector";

  const run = async (key, action) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(fill(copy.export.failed, { message: formatErrorMessage(error, "") }));
    } finally {
      setBusy(null);
    }
  };
  const button = (key, label, action, hint = null) => (
    <button key={key} type="button" disabled={Boolean(busy) || !optimised} onClick={() => run(key, action)} className="flex h-11 items-center justify-between gap-3 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 text-left text-[13px] text-white/85 hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50">
      <span className="min-w-0">
        <span className="block truncate">{busy === key ? copy.export.working : label}</span>
        {hint && <span className="block truncate text-[11px] text-white/40">{hint}</span>}
      </span>
      <IconDownload size={14} stroke={1.75} className="shrink-0 text-white/40" aria-hidden="true" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4" onClick={onClose} role="presentation">
      <div className="w-[min(94vw,760px)] max-h-[90vh] overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#111114] p-4" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={copy.export.title}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-white">{copy.export.title}</div>
            <div className="mt-0.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-2 py-0.5 text-[11.5px] font-semibold text-emerald-300/90">{copy.export.free}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={copy.buttons.close} className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/[0.06] hover:text-white"><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[260px_1fr]">
          <div className="aspect-square overflow-hidden rounded-xl border border-white/[0.08]"><Preview entry={entry} tone="light" /></div>
          {entry.kind === "raster" ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-white/60">{copy.export.rasterOnly}</p>
              <button type="button" onClick={() => { onVectorize(entry); onClose(); }} className="h-10 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-[#04202a]">{copy.vectorize.sendHere}</button>
              <button type="button" onClick={() => run("png", async () => downloadBytes(await fetchMediaBlob(entry.url), `${base}.png`, "image/png"))} className="h-10 rounded-[10px] border border-white/[0.08] px-4 text-[13px] text-white/80 hover:text-white">{fill(copy.export.png, { size: "" }).trim()}</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {stats && <div className="text-[12px] text-white/45">{fill(copy.export.optimised, { from: formatBytes(stats.from), to: formatBytes(stats.to), percent: stats.percent })}</div>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {button("svg", copy.export.svg, async () => downloadText(optimised, `${base}.svg`))}
                {button("svg-original", copy.export.svgOriginal, async () => downloadText(svg, `${base}-original.svg`))}
                {PNG_SIZES.map((size) => button(`png-${size}`, fill(copy.export.png, { size: `${size}px` }), async () => downloadBytes(await svgToPngBlob(optimised, size), `${base}-${size}.png`, "image/png")))}
                {button("pdf", copy.export.pdf, async () => downloadBytes(await svgToPdf(optimised, { title: entry.prompt || entry.name || "" }), `${base}.pdf`, "application/pdf"))}
                {button("favicon", copy.export.favicon, async () => downloadBytes(await svgToFavicon(optimised), "favicon.ico", "image/x-icon"))}
                {button("app-icons", copy.export.appIcons, async () => downloadBytes(await svgToAppIconZip(optimised, { name: base }), `${base}-app-icons.zip`, "application/zip"), copy.export.appIconsHint)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function useLibrary() {
  return useSyncExternalStore(subscribeLibrary, getLibrary, getEmptyLibrary);
}

export default function VectorStudio({ onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled, locale = "en" }) {
  const copy = resolveCopy(en, zh, locale);
  const library = useLibrary();

  const [tool, setTool] = useState("logo");
  const [prompt, setPrompt] = useState("");
  const [logoModelId, setLogoModelId] = useState(vectorTextModels[0]?.id || "");
  const [logoOptions, setLogoOptions] = useState({});
  const [candidates, setCandidates] = useState(1);
  const [references, setReferences] = useState([]);
  const [paletteId, setPaletteId] = useState("none");
  const [customPalette, setCustomPalette] = useState({ colors: ["#2563eb", "#111827"], background: "#ffffff" });
  const [iconStyle, setIconStyle] = useState("");
  const [iconNames, setIconNames] = useState("");
  const [iconModelId, setIconModelId] = useState(vectorTextModels[0]?.id || "");
  const [iconOptions, setIconOptions] = useState({});
  const [vectorizeModelId, setVectorizeModelId] = useState(vectorizeModels[0]?.id || "");
  const [traceOptions, setTraceOptions] = useState({});
  const [source, setSource] = useState(null); // { url, name, fromId }
  const [tone, setTone] = useState("light");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [providerReady, setProviderReady] = useState(null);
  const [libraryImages, setLibraryImages] = useState([]);
  const fileInputRef = useRef(null);
  const referenceInputRef = useRef(null);
  const textareaRef = useRef(null);
  const hasRestored = useRef(false);

  const toolCopy = copy.tools[tool] || copy.tools.logo;
  const logoModel = vectorTextModels.find((model) => model.id === logoModelId) || vectorTextModels[0] || null;
  const iconModel = vectorTextModels.find((model) => model.id === iconModelId) || vectorTextModels[0] || null;
  const vectorizeModel = vectorizeModels.find((model) => model.id === vectorizeModelId) || vectorizeModels[0] || null;
  const selectedModel = tool === "logo" ? logoModel : tool === "icons" ? iconModel : vectorizeModel;
  const palette = paletteId === "custom" ? customPalette : PALETTES.find((entry) => entry.id === paletteId) || PALETTES[0];
  const paletteSummary = normalizePalette(palette);
  const maxCandidates = logoModel?.maxCandidates || 1;
  const plan = useMemo(() => planIconSet({ names: iconNames, style: iconStyle, paletteWords: iconModel?.palette ? "" : paletteToPromptWords(palette) }), [iconNames, iconStyle, iconModel, palette]);
  const iconCount = plan.count;

  // Option defaults follow the selected model; values that still apply are kept.
  const syncOptions = (model, setter) => setter((previous) => {
    const next = vectorModelDefaults(model);
    for (const key of Object.keys(next)) {
      const input = model.inputs[key];
      if (previous[key] === undefined) continue;
      if (input.enum ? input.enum.includes(previous[key]) : typeof previous[key] === typeof next[key]) next[key] = previous[key];
    }
    return next;
  });
  useEffect(() => { if (logoModel) syncOptions(logoModel, setLogoOptions); }, [logoModel]);
  useEffect(() => { if (iconModel) syncOptions(iconModel, setIconOptions); }, [iconModel]);
  useEffect(() => { if (vectorizeModel) syncOptions(vectorizeModel, setTraceOptions); }, [vectorizeModel]);
  useEffect(() => { setCandidates((value) => Math.min(value, maxCandidates)); }, [maxCandidates]);

  useEffect(() => {
    const sync = () => setProviderReady(Boolean(selectedModel) && isEndpointAvailable(selectedModel.endpoint));
    sync();
    return subscribeProviderSettings(sync);
  }, [selectedModel]);

  const providersText = useMemo(() => {
    const ids = [...new Set(vectorModels.flatMap((model) => getRoutes(model.endpoint).map((route) => route.provider)))];
    const labels = ids.map((id) => getProvider(id)?.label || id);
    return labels.length <= 1 ? labels[0] || "" : `${labels.slice(0, -1).join(", ")} ${copy.providers.or} ${labels[labels.length - 1]}`;
  }, [copy.providers.or]);

  const openProviderSettings = () => {
    const providers = selectedModel ? [...new Set(getRoutes(selectedModel.endpoint).map((route) => route.provider))] : [];
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers } }));
  };

  // Persistence (the library persists itself).
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      if (data) {
        if (VECTOR_TOOLS.includes(data.tool)) setTool(data.tool);
        if (typeof data.prompt === "string") setPrompt(data.prompt);
        if (vectorTextModels.some((model) => model.id === data.logoModelId)) setLogoModelId(data.logoModelId);
        if (vectorTextModels.some((model) => model.id === data.iconModelId)) setIconModelId(data.iconModelId);
        if (vectorizeModels.some((model) => model.id === data.vectorizeModelId)) setVectorizeModelId(data.vectorizeModelId);
        if (data.logoOptions && typeof data.logoOptions === "object") setLogoOptions(data.logoOptions);
        if (data.iconOptions && typeof data.iconOptions === "object") setIconOptions(data.iconOptions);
        if (data.traceOptions && typeof data.traceOptions === "object") setTraceOptions(data.traceOptions);
        if (Number.isFinite(data.candidates)) setCandidates(Math.max(1, Math.min(8, data.candidates)));
        if (PALETTES.some((entry) => entry.id === data.paletteId)) setPaletteId(data.paletteId);
        if (data.customPalette?.colors) setCustomPalette({ colors: data.customPalette.colors.slice(0, MAX_PALETTE_COLORS), background: data.customPalette.background || "#ffffff" });
        if (typeof data.iconStyle === "string") setIconStyle(data.iconStyle);
        if (typeof data.iconNames === "string") setIconNames(data.iconNames);
        if (data.source && typeof data.source.url === "string") setSource(data.source);
        if (Array.isArray(data.references)) setReferences(data.references.filter((item) => typeof item?.url === "string"));
        if (data.tone === "dark" || data.tone === "light") setTone(data.tone);
      }
    } catch (error) {
      console.warn("[VectorStudio] could not restore state", error);
    } finally {
      hasRestored.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasRestored.current) return undefined;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ tool, prompt, logoModelId, iconModelId, vectorizeModelId, logoOptions, iconOptions, traceOptions, candidates, paletteId, customPalette, iconStyle, iconNames, source, references, tone }));
      } catch (error) {
        console.warn("[VectorStudio] could not save state", error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [tool, prompt, logoModelId, iconModelId, vectorizeModelId, logoOptions, iconOptions, traceOptions, candidates, paletteId, customPalette, iconStyle, iconNames, source, references, tone]);

  // A raster sent here from another tool or studio.
  useEffect(() => {
    if (!library.handoffs.vectorize) return;
    const handoff = takeHandoff("vectorize");
    if (!handoff?.source) return;
    setSource(handoff.source);
    setTool("vectorize");
    setOpenDropdown(null);
    setViewer(null);
  }, [library.handoffs]);

  // Uploads: the image to trace, or Ideogram references.
  const uploadSource = useCallback(async (file) => {
    if (!isImageFile(file)) {
      toast.error(copy.errors.notImage);
      return;
    }
    setUploading({ progress: 0 });
    try {
      const url = await uploadFile(file, (progress) => setUploading({ progress }));
      setSource({ url, name: file.name, fromId: null });
      setTool("vectorize");
    } catch (error) {
      toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
    } finally {
      setUploading(null);
    }
  }, [copy]);

  const uploadReferences = useCallback(async (fileList) => {
    const max = logoModel?.references?.max || 0;
    const files = Array.from(fileList || []).filter(isImageFile).slice(0, Math.max(0, max - references.length));
    if (files.length === 0) return;
    setUploading({ progress: 0 });
    for (const file of files) {
      try {
        const url = await uploadFile(file, (progress) => setUploading({ progress }));
        setReferences((previous) => [...previous, { url, name: file.name }].slice(0, max));
      } catch (error) {
        toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
      }
    }
    setUploading(null);
  }, [copy, logoModel, references.length]);

  useEffect(() => {
    if (!droppedFiles?.length) return;
    const images = droppedFiles.filter(isImageFile);
    if (images.length === 0) toast.error(copy.errors.notImage);
    else if (tool === "logo" && logoModel?.references) uploadReferences(images);
    else uploadSource(images[0]);
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled, tool, logoModel, uploadReferences, uploadSource, copy]);

  useEffect(() => {
    if (openDropdown === "library") setLibraryImages(readImageStudioImages());
  }, [openDropdown]);

  // Results: download, sniff, sanitise, store as image/svg+xml with a PNG thumbnail.
  const materialize = useCallback(async (output) => {
    const blob = await fetchMediaBlob(output.url);
    const head = await blob.slice(0, 512).text();
    let kind = classifyVectorOutput({ url: output.remoteUrl || output.url, contentType: blob.type, head });
    if (kind === "unknown") kind = output.kind;
    const svg = kind === "raster" ? null : sanitizeSvg(await blob.text());
    if (!svg) {
      if (kind === "svg") throw new Error(copy.errors.badSvg);
      return { kind: "raster", url: output.url, thumbnail: output.url, remoteUrl: output.remoteUrl || null, bytes: blob.size };
    }
    const url = await saveLocalBlob(new Blob([svg], { type: "image/svg+xml" }), { name: "vector.svg" });
    svgCache.set(url, Promise.resolve(svg));
    let thumbnail = null;
    try {
      thumbnail = await saveLocalBlob(await svgToPngBlob(svg, THUMBNAIL_SIZE), { name: "vector-thumbnail.png" });
    } catch (error) {
      console.warn("[VectorStudio] no thumbnail", error);
    }
    return { kind: "svg", url, thumbnail, remoteUrl: output.remoteUrl || null, bytes: svg.length };
  }, [copy]);

  const report = (error) => {
    console.error("[VectorStudio]", error);
    const message = formatErrorMessage(error, copy.errors.generationFailed);
    if (onGenerationError) onGenerationError(message);
    else toast.error(message);
  };

  // Runs `jobs` ({ payload, meta }) a few at a time and files every output.
  const runJobs = async ({ jobs, label, promptText, concurrency }) => {
    const runId = newId();
    addPending({ id: runId, label, prompt: promptText, done: 0, total: jobs.length });
    onGenerationStart?.();
    const errors = [];
    const made = [];
    let done = 0;
    try {
      await runPool(jobs, async (job) => {
        try {
          const result = await generateVector(job.payload);
          const outputs = describeVectorOutputs(result);
          if (outputs.length === 0) throw new Error(copy.errors.noOutput);
          for (const output of outputs) {
            const file = await materialize(output);
            const entry = { id: newId(), ...file, ...job.meta, timestamp: new Date().toISOString() };
            addEntry(entry);
            made.push(entry);
          }
        } catch (error) {
          errors.push(error);
        } finally {
          done += 1;
          updatePending(runId, { done });
        }
      }, concurrency);
      if (made.length === 0) throw errors[0] || new Error(copy.errors.generationFailed);
      if (errors.length > 0) toast.error(fill(copy.icons.partial, { failed: errors.length, total: jobs.length, message: formatErrorMessage(errors[0], "") }));
      const first = made[0];
      onGenerationComplete?.({ url: first.thumbnail || first.url, model: first.model, prompt: promptText, type: "image" });
      return made;
    } catch (error) {
      report(error);
      return made;
    } finally {
      removePending(runId);
      onGenerationEnd?.();
    }
  };

  const modelMeta = (model) => ({ model: model.id, modelName: model.name, vendor: model.provider_name || "" });

  const generateLogo = async () => {
    const text = prompt.trim();
    if (!text) {
      textareaRef.current?.focus();
      return toast.error(copy.errors.needPrompt);
    }
    const words = logoModel.palette ? "" : paletteToPromptWords(palette);
    const payload = { model: logoModel.id, prompt: words ? `${text}, ${words}` : text, ...logoOptions, ...(logoModel.palette ? paletteToRecraft(palette) : {}) };
    if (logoModel.references && references.length) payload[logoModel.references.field] = references.map((item) => item.url);
    const runs = logoModel.candidates === "runs" ? candidates : 1;
    if (logoModel.candidates === "num_images") payload.num_images = candidates;
    const meta = { tool: "logo", prompt: text, name: "", ...modelMeta(logoModel), setId: null };
    return runJobs({ jobs: Array.from({ length: runs }, () => ({ payload, meta })), label: logoModel.name, promptText: text, concurrency: LOGO_CONCURRENCY });
  };

  const generateIcons = async () => {
    if (!iconStyle.trim()) {
      textareaRef.current?.focus();
      return toast.error(copy.errors.needStyle);
    }
    if (iconCount === 0) return toast.error(copy.errors.needNames);
    const setId = newId();
    const names = plan.runs.map((run) => run.name);
    const setName = `${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`;
    const shape = iconModel.candidates === "num_images" ? { aspect_ratio: "1:1", num_images: 1 } : { image_size: "square_hd" };
    const paletteInput = iconModel.palette ? paletteToRecraft(palette) : {};
    const jobs = plan.runs.map((run) => ({
      payload: { model: iconModel.id, prompt: run.prompt, ...iconOptions, ...shape, ...paletteInput },
      meta: { tool: "icons", prompt: run.prompt, name: run.name, ...modelMeta(iconModel), setId, setName },
    }));
    return runJobs({ jobs, label: iconModel.name, promptText: iconStyle.trim(), concurrency: ICON_CONCURRENCY });
  };

  const generateVectorize = async () => {
    if (!source) return toast.error(copy.errors.needImage);
    const payload = { model: vectorizeModel.id, image_url: source.url, ...traceOptions };
    const meta = { tool: "vectorize", prompt: vectorizeModel.name, name: source.name || "", ...modelMeta(vectorizeModel), setId: null, sourceUrl: source.url, sourceName: source.name || "", sourceId: source.fromId || null };
    const made = await runJobs({ jobs: [{ payload, meta }], label: vectorizeModel.name, promptText: source.name || "", concurrency: 1 });
    if (made[0]) setCompareId(made[0].id);
  };

  const handleGenerate = async () => {
    if (!selectedModel) return;
    if (!providerReady) return openProviderSettings();
    if (tool === "logo") return generateLogo();
    if (tool === "icons") return generateIcons();
    return generateVectorize();
  };

  // Library actions
  const sendToVectorize = (entry) => {
    setSource({ url: entry.url, name: entry.name || entry.prompt || "image", fromId: entry.id });
    setTool("vectorize");
    setOpenDropdown(null);
    setViewer(null);
    setExporting(null);
  };
  const downloadSvg = async (entry) => {
    const name = `${slug(entry.name || entry.prompt) || "vector"}-${String(entry.id).slice(-6)}`;
    try {
      if (entry.kind === "svg") downloadText(optimizeSvg(await loadSvgText(entry.url)), `${name}.svg`);
      else downloadBytes(await fetchMediaBlob(entry.url), `${name}.png`, "image/png");
    } catch (error) {
      toast.error(fill(copy.export.failed, { message: formatErrorMessage(error, "") }));
    }
  };
  const deleteEntry = (id) => {
    if (!confirm(copy.confirm.deleteItem)) return;
    removeEntry(id);
    if (viewer?.id === id) setViewer(null);
    if (compareId === id) setCompareId(null);
  };
  const deleteSet = (setId) => {
    if (!confirm(copy.confirm.deleteSet)) return;
    removeSet(setId);
  };
  const exportSet = async (group, format) => {
    try {
      const icons = [];
      for (const entry of group.entries) {
        if (entry.kind !== "svg") continue;
        const svg = await loadSvgText(entry.url);
        if (svg) icons.push({ name: entry.name || entry.prompt, svg: optimizeSvg(svg) });
      }
      const base = slug(group.entries[0]?.setName) || "icon-set";
      if (format === "sprite") {
        downloadText(buildSprite(icons).sprite, `${base}-sprite.svg`);
      } else {
        const used = new Set();
        downloadBytes(buildZip(icons.map((icon) => ({ name: `${base}/${iconFileName(icon.name, used)}`, data: icon.svg }))), `${base}.zip`, "application/zip");
      }
    } catch (error) {
      toast.error(fill(copy.export.failed, { message: formatErrorMessage(error, "") }));
    }
  };

  // Icon sets are shown as one group; everything else as single cards.
  const groups = useMemo(() => {
    const list = [];
    const sets = new Map();
    for (const entry of library.entries) {
      if (!entry.setId) {
        list.push({ type: "single", entry });
        continue;
      }
      if (!sets.has(entry.setId)) {
        const group = { type: "set", setId: entry.setId, entries: [] };
        sets.set(entry.setId, group);
        list.push(group);
      }
      sets.get(entry.setId).entries.push(entry);
    }
    return list;
  }, [library.entries]);
  const compareEntry = tool === "vectorize" ? library.entries.find((entry) => entry.id === compareId && entry.sourceUrl) || library.entries.find((entry) => entry.tool === "vectorize" && entry.sourceUrl) || null : null;
  const hasGallery = library.entries.length > 0 || library.pending.length > 0;
  const starters = (toolCopy.starters || []).map((starter) => ({ label: starter.label, prompt: starter.prompt }));
  const onStarter = (text) => {
    if (tool === "icons") setIconStyle(text);
    else setPrompt(text);
    textareaRef.current?.focus();
  };

  // Controls
  const setOption = (key, value) => {
    if (tool === "logo") setLogoOptions((previous) => ({ ...previous, [key]: value }));
    else if (tool === "icons") setIconOptions((previous) => ({ ...previous, [key]: value }));
    else setTraceOptions((previous) => ({ ...previous, [key]: value }));
  };
  const options = tool === "logo" ? logoOptions : tool === "icons" ? iconOptions : traceOptions;
  const inputs = Object.entries(selectedModel?.inputs || {}).filter(([key]) => tool !== "icons" || key === "quality");
  const enumInputs = inputs.filter(([, input]) => Array.isArray(input.enum) && !input.advanced);
  const numericInputs = inputs.filter(([, input]) => !Array.isArray(input.enum) && (input.type === "integer" || input.type === "number"));
  const advancedInputs = inputs.filter(([, input]) => input.advanced);
  const visibleNumeric = showAdvanced ? numericInputs : numericInputs.filter(([, input]) => !input.advanced);
  const visibleEnums = showAdvanced ? inputs.filter(([, input]) => Array.isArray(input.enum)) : enumInputs;
  const optionLabel = (input, value) => input.optionLabels?.[value] ?? String(value);
  const pricePayload = tool === "logo"
    ? { ...logoOptions, ...(logoModel?.candidates === "num_images" ? { num_images: candidates } : {}) }
    : tool === "icons" ? { ...iconOptions, ...(iconModel?.candidates === "num_images" ? { aspect_ratio: "1:1", num_images: 1 } : { image_size: "square_hd" }) } : traceOptions;
  const priceRuns = tool === "logo" ? (logoModel?.candidates === "runs" ? candidates : 1) : tool === "icons" ? Math.max(1, iconCount) : 1;
  const pickerModels = tool === "vectorize" ? vectorizeModels : vectorTextModels;
  const pickerPayload = (model) => (tool === "vectorize" ? {} : tool === "icons" ? { ...iconOptions, ...(model.candidates === "num_images" ? { aspect_ratio: "1:1" } : { image_size: "square_hd" }) } : { ...logoOptions, ...(model.candidates === "num_images" ? { num_images: candidates } : {}) });
  const choosePickerModel = (model) => {
    if (tool === "logo") setLogoModelId(model.id);
    else if (tool === "icons") setIconModelId(model.id);
    else setVectorizeModelId(model.id);
    setOpenDropdown(null);
  };
  const toggle = (id) => setOpenDropdown(openDropdown === id ? null : id);
  const actionLabel = tool === "icons" ? fill(copy.icons.generate, { count: number(iconCount, locale) }) : tool === "vectorize" ? copy.vectorize.apply : copy.buttons.generate;

  const paletteSwatches = (entry, size = "h-3.5 w-3.5") => (
    <span className="flex items-center -space-x-1">
      {entry.colors.slice(0, MAX_PALETTE_COLORS).map((color, index) => <span key={`${color}-${index}`} className={`${size} rounded-full border border-black/40`} style={{ backgroundColor: color }} aria-hidden="true" />)}
      {entry.colors.length === 0 && <span className={`${size} rounded-full border border-dashed border-white/30`} aria-hidden="true" />}
    </span>
  );

  const cardActions = (entry) => (
    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {entry.kind === "raster" && (
        <button type="button" onClick={() => sendToVectorize(entry)} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-semibold text-[#04202a] hover:brightness-110"><IconArrowsExchange size={14} stroke={1.75} aria-hidden="true" />{copy.vectorize.sendHere}</button>
      )}
      <button type="button" title={copy.buttons.export} aria-label={copy.buttons.export} onClick={() => setExporting(entry)} className="flex h-8 items-center gap-1.5 rounded-lg bg-black/60 px-2.5 text-[12px] font-medium text-white hover:bg-white/20"><IconFileExport size={14} stroke={1.75} aria-hidden="true" />{copy.buttons.export}</button>
      <button type="button" title={copy.buttons.download} aria-label={copy.buttons.download} onClick={() => downloadSvg(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconDownload size={15} stroke={1.75} aria-hidden="true" /></button>
      <button type="button" title={copy.buttons.fullscreen} aria-label={copy.buttons.fullscreen} onClick={() => setViewer(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconMaximize size={15} stroke={1.75} aria-hidden="true" /></button>
      <button type="button" title={copy.buttons.delete} aria-label={copy.buttons.delete} onClick={() => deleteEntry(entry.id)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-red-300 hover:bg-red-500 hover:text-white"><IconTrash size={15} stroke={1.75} aria-hidden="true" /></button>
    </div>
  );

  const card = (entry, { compact = false } = {}) => (
    <div key={entry.id} data-vector-entry={entry.kind} className={`group relative aspect-square overflow-hidden rounded-2xl border bg-[#0e0e11] ${compareId === entry.id && tool === "vectorize" ? "border-primary/60" : "border-white/[0.08]"}`} onClick={() => entry.sourceUrl && setCompareId(entry.id)} role={entry.sourceUrl ? "button" : undefined} tabIndex={entry.sourceUrl ? 0 : undefined}>
      <Preview entry={entry} tone={tone} />
      {entry.kind === "raster" && <span className="absolute left-2 top-2 rounded-md bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-semibold text-black" title={copy.vectorize.rasterNote}>{copy.gallery.raster}</span>}
      {!compact && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#09090b]/95 to-transparent p-3 pt-10">
          <div className="truncate text-[13px] font-medium text-white/90">{entry.name || entry.prompt || copy.gallery.fromImage}</div>
          <div className="text-[11.5px] text-white/45">{entry.modelName}{entry.vendor ? ` · ${entry.vendor}` : ""}</div>
        </div>
      )}
      {compact && <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-[#09090b]/90 to-transparent px-2 pb-1.5 pt-6 text-[11px] text-white/85">{entry.name}</div>}
      {cardActions(entry)}
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative overflow-hidden">
      <Toaster position="top-center" toastOptions={{ style: { background: "#111114", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: "13px" } }} />
      <style>{`.oga-svg-fit > svg { width: 100%; height: 100%; display: block; }`}</style>

      {providerReady === false && (
        <div className="absolute top-4 left-1/2 z-40 w-[min(640px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-100 flex items-center justify-between gap-4">
          <span>{fill(copy.providers.needKey, { providers: providersText })}</span>
          <button type="button" onClick={openProviderSettings} className="shrink-0 rounded-lg bg-amber-300 px-3 py-1.5 text-[12px] font-semibold text-black">{copy.providers.openSettings}</button>
        </div>
      )}

      <div className="flex-1 w-full overflow-y-auto custom-scrollbar pb-72 pt-4 px-4 md:px-8">
        {hasGallery ? (
          <div className="mx-auto max-w-6xl pt-12">
            {compareEntry && (
              <div className="mb-6 rounded-2xl border border-white/[0.08] bg-[#0e0e11] p-3">
                <div className="mb-2 flex items-center justify-between px-1">
                  <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/40">{copy.vectorize.compare}</div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setExporting(compareEntry)} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[12px] font-medium text-white hover:bg-white/[0.12]"><IconFileExport size={14} stroke={1.75} aria-hidden="true" />{copy.buttons.export}</button>
                    <button type="button" onClick={() => downloadSvg(compareEntry)} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[12px] font-medium text-white hover:bg-white/[0.12]"><IconDownload size={14} stroke={1.75} aria-hidden="true" />{copy.buttons.download}</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative aspect-square overflow-hidden rounded-xl border border-white/[0.08]" style={CHECKER[tone]}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={compareEntry.sourceUrl} alt="" className="h-full w-full object-contain" />
                    <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">{copy.vectorize.source}</span>
                  </div>
                  <div className="relative aspect-square overflow-hidden rounded-xl border border-white/[0.08]">
                    <Preview entry={compareEntry} tone={tone} />
                    <span className="absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-[10.5px] font-semibold text-[#04202a]">{compareEntry.kind === "svg" ? copy.vectorize.result : copy.gallery.raster}</span>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/40">{fill(copy.gallery.library, { count: library.entries.length })}</div>
              <ToneToggle tone={tone} onChange={setTone} copy={copy} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {library.pending.map((run) => (
                <div key={run.id} className="aspect-square rounded-2xl border border-white/[0.08] bg-[#0e0e11] flex flex-col items-center justify-center gap-3 text-center p-6">
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
                  <div className="text-[14px] font-medium text-white/85">{fill(copy.gallery.pendingTitle, { model: run.label })}</div>
                  <div className="text-[12px] text-white/45">{run.total > 1 ? fill(copy.gallery.pendingProgress, { done: run.done, total: run.total }) : copy.gallery.pendingHint}</div>
                </div>
              ))}
              {groups.map((group) => (group.type === "single" ? card(group.entry) : (
                <div key={group.setId} className="col-span-full rounded-2xl border border-white/[0.08] bg-[#0e0e11] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-white/90">{group.entries[0].setName || fill(copy.icons.set, { count: group.entries.length })}</div>
                      <div className="text-[11.5px] text-white/45">{fill(copy.icons.set, { count: group.entries.length })} · {group.entries[0].modelName}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => exportSet(group, "sprite")} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[12px] font-medium text-white hover:bg-white/[0.12]"><IconSvg size={14} stroke={1.75} aria-hidden="true" />{copy.icons.sprite}</button>
                      <button type="button" onClick={() => exportSet(group, "zip")} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[12px] font-medium text-white hover:bg-white/[0.12]"><IconFileZip size={14} stroke={1.75} aria-hidden="true" />{copy.icons.zip}</button>
                      <button type="button" title={copy.icons.deleteSet} aria-label={copy.icons.deleteSet} onClick={() => deleteSet(group.setId)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-red-300 hover:bg-red-500 hover:text-white"><IconTrash size={14} stroke={1.75} aria-hidden="true" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                    {group.entries.map((entry) => card(entry, { compact: true }))}
                  </div>
                </div>
              )))}
            </div>
          </div>
        ) : (
          <div className="h-full w-full animate-fade-in-up">
            <StudioEmptyState heading={toolCopy.heading} accent={toolCopy.accent} subtitle={toolCopy.subtitle} starters={starters} onStarter={onStarter} showcase={null} />
          </div>
        )}
      </div>

      {viewer && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={() => setViewer(null)} role="presentation">
          <div className="relative h-[min(80vh,900px)] w-[min(90vw,1100px)] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0e0e11]" onClick={(event) => event.stopPropagation()} role="presentation">
            <Preview entry={viewer} tone={tone} />
            <button type="button" onClick={() => setViewer(null)} aria-label={copy.buttons.close} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
            <div className="absolute bottom-3 left-3 flex items-center gap-2">
              <span className="max-w-[50vw] truncate rounded-lg bg-black/60 px-3 py-1.5 text-[12px] text-white/80">{viewer.name || viewer.prompt || viewer.modelName}</span>
              <ToneToggle tone={tone} onChange={setTone} copy={copy} />
              <button type="button" onClick={() => { setExporting(viewer); setViewer(null); }} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-[#04202a]"><IconFileExport size={14} stroke={1.75} aria-hidden="true" />{copy.buttons.export}</button>
            </div>
          </div>
        </div>
      )}

      {exporting && <ExportKitDialog entry={exporting} copy={copy} locale={locale} onClose={() => setExporting(null)} onVectorize={sendToVectorize} />}

      <PromptComposer>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <PromptSegmentedControl aria-label={copy.rail.label}>
            {VECTOR_TOOLS.map((id) => {
              const Icon = TOOL_ICONS[id];
              return (
                <PromptSegmentOption key={id} selected={tool === id} onClick={() => { setTool(id); setOpenDropdown(null); setShowAdvanced(false); }} data-vector-tool={id}>
                  <Icon size={14} stroke={1.75} aria-hidden="true" />
                  {copy.tools[id].label}
                </PromptSegmentOption>
              );
            })}
          </PromptSegmentedControl>
          {tool === "icons" && (
            <span className={`text-[12px] ${plan.truncated ? "text-amber-300/90" : "text-white/45"}`}>
              {iconCount === 0 ? copy.icons.none : plan.truncated ? fill(copy.icons.truncated, { max: MAX_ICONS }) : iconCount === 1 ? copy.icons.countOne : fill(copy.icons.count, { count: number(iconCount, locale) })}
            </span>
          )}
        </div>

        <div className="flex items-start gap-2 px-1">
          {tool === "vectorize" && (
            <div className="flex items-center gap-2">
              {source ? (
                <div className="flex h-10 items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] pl-1 pr-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={source.url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  <span className="max-w-[200px] truncate text-[12.5px] text-white/85">{source.name}</span>
                  <button type="button" onClick={() => setSource(null)} aria-label={copy.vectorize.clear} className="text-white/40 hover:text-white"><IconX size={14} stroke={2} aria-hidden="true" /></button>
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)} className="flex h-10 items-center gap-2 rounded-full border border-dashed border-white/20 px-3.5 whitespace-nowrap text-[12.5px] text-white/60 hover:border-white/40 hover:text-white">
                    {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconUpload size={15} stroke={1.75} aria-hidden="true" />}
                    {copy.vectorize.upload}
                  </button>
                  <div className="relative">
                    <button type="button" onClick={() => toggle("library")} className="flex h-10 items-center gap-2 rounded-full border border-white/[0.12] px-3.5 whitespace-nowrap text-[12.5px] text-white/60 hover:border-white/40 hover:text-white">
                      <IconPhotoUp size={15} stroke={1.75} aria-hidden="true" />{copy.vectorize.fromLibrary}
                    </button>
                    {openDropdown === "library" && (
                      <PromptPopover className="w-[360px]">
                        <PromptPopoverHeader>{copy.vectorize.libraryTitle}</PromptPopoverHeader>
                        {libraryImages.length === 0 ? (
                          <p className="px-2 py-3 text-[12.5px] text-white/45">{copy.vectorize.libraryEmpty}</p>
                        ) : (
                          <div className="grid max-h-[280px] grid-cols-4 gap-1.5 overflow-y-auto p-1">
                            {libraryImages.slice(0, 40).map((image, index) => (
                              <button key={`${image.url}-${index}`} type="button" title={image.name} onClick={() => { setSource({ url: image.url, name: image.name, fromId: null }); setOpenDropdown(null); }} className="aspect-square overflow-hidden rounded-lg border border-white/[0.08] hover:border-primary/60">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                              </button>
                            ))}
                          </div>
                        )}
                      </PromptPopover>
                    )}
                  </div>
                </>
              )}
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { uploadSource(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
          )}

          {tool === "logo" && logoModel?.references && (
            <div className="flex items-center gap-2 flex-wrap">
              {references.map((image, index) => (
                <div key={image.url} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setReferences((previous) => previous.filter((_, i) => i !== index))} aria-label={copy.controls.removeReference} className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 hover:opacity-100"><IconX size={14} stroke={2} aria-hidden="true" /></button>
                </div>
              ))}
              {references.length < logoModel.references.max && (
                <button type="button" onClick={() => referenceInputRef.current?.click()} disabled={Boolean(uploading)} title={fill(copy.controls.addReference, { max: logoModel.references.max })} className={promptMediaButtonClassName()}>
                  {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconPhotoPlus size={16} stroke={1.75} className="text-white/60" aria-hidden="true" />}
                </button>
              )}
              <input ref={referenceInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => { uploadReferences(event.target.files); event.target.value = ""; }} />
            </div>
          )}

          {tool === "logo" && <PromptTextarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={toolCopy.placeholder} />}
          {tool === "icons" && (
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
              <PromptTextarea ref={textareaRef} value={iconStyle} onChange={(event) => setIconStyle(event.target.value)} placeholder={toolCopy.placeholder} className="flex-1" />
              <textarea value={iconNames} onChange={(event) => setIconNames(event.target.value)} placeholder={toolCopy.namesPlaceholder} rows={3} spellCheck={false} aria-label={copy.icons.none} className="max-h-[150px] min-h-[76px] w-full resize-y rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12.5px] text-white/85 placeholder:text-white/30 focus:border-white/20 focus:outline-none sm:w-[220px]" />
            </div>
          )}
          {tool === "vectorize" && (
            <p className="flex-1 px-1.5 pt-2.5 text-[13.5px] text-white/40">{source ? `${vectorizeModel?.name || ""} · ${vectorizeModel?.description || ""}` : toolCopy.placeholder}</p>
          )}
        </div>

        <PromptFooter>
          <PromptControls>
            {pickerModels.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => toggle("model")} className={promptControlClassName({ active: openDropdown === "model" })}>
                  <span className="text-[11px] text-white/40">{tool === "vectorize" ? copy.controls.tier : copy.controls.model}</span>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{selectedModel?.name}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === "model" && (
                  <PromptPopover className="w-[360px]">
                    <PromptPopoverHeader>{tool === "vectorize" ? copy.controls.tier : copy.controls.model}</PromptPopoverHeader>
                    <PromptMenuList>
                      {pickerModels.map((model) => (
                        <div key={model.id} onMouseEnter={() => setHoveredId(model.id)} onMouseLeave={() => setHoveredId((current) => (current === model.id ? null : current))} className="flex items-center gap-2">
                          <PromptMenuItem selected={model.id === selectedModel?.id} description={model.description} wrapDescription onClick={() => choosePickerModel(model)} className="flex-1">
                            {model.name} <span className="text-white/40">· {model.provider_name}</span>
                          </PromptMenuItem>
                          <PriceHint locale={locale} endpoint={model.endpoint} payload={pickerPayload(model)} hovered={hoveredId === model.id} className="pr-2" />
                        </div>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            )}

            {tool !== "vectorize" && (
              <div className="relative">
                <button type="button" onClick={() => toggle("palette")} className={promptControlClassName({ active: openDropdown === "palette" })} title={copy.palette.hint}>
                  <IconPalette size={14} stroke={1.75} aria-hidden="true" />
                  {paletteSwatches(paletteSummary)}
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{paletteId === "custom" ? copy.palette.custom : (PALETTES.find((entry) => entry.id === paletteId) || PALETTES[0]).name}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === "palette" && (
                  <PromptPopover className="w-[320px]">
                    <PromptPopoverHeader>{copy.palette.title}</PromptPopoverHeader>
                    <p className="px-2.5 pb-2 text-[11.5px] text-white/45">{copy.palette.hint}</p>
                    <PromptMenuList>
                      {PALETTES.map((entry) => (
                        <PromptMenuItem key={entry.id} selected={entry.id === paletteId} onClick={() => { setPaletteId(entry.id); if (entry.id !== "custom") setOpenDropdown(null); }}>
                          <span className="flex items-center gap-2">{paletteSwatches(entry.id === "custom" ? customPalette : entry)}{entry.name}</span>
                        </PromptMenuItem>
                      ))}
                    </PromptMenuList>
                    {paletteId === "custom" && (
                      <div className="mt-2 border-t border-white/[0.08] px-2 pt-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {customPalette.colors.map((color, index) => (
                            <span key={index} className="relative">
                              <input type="color" value={color} aria-label={`${copy.palette.custom} ${index + 1}`} onChange={(event) => setCustomPalette((previous) => ({ ...previous, colors: previous.colors.map((item, i) => (i === index ? event.target.value : item)) }))} className="h-8 w-8 cursor-pointer rounded-md border border-white/10 bg-transparent p-0" />
                              <button type="button" aria-label={copy.palette.remove} onClick={() => setCustomPalette((previous) => ({ ...previous, colors: previous.colors.filter((_, i) => i !== index) }))} className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black text-white/70 hover:text-white"><IconX size={10} stroke={2.5} aria-hidden="true" /></button>
                            </span>
                          ))}
                          {customPalette.colors.length < MAX_PALETTE_COLORS && (
                            <button type="button" onClick={() => setCustomPalette((previous) => ({ ...previous, colors: [...previous.colors, "#22d3ee"] }))} className="h-8 rounded-md border border-dashed border-white/20 px-2 text-[11.5px] text-white/60 hover:text-white">{copy.palette.addColor}</button>
                          )}
                        </div>
                        <label className="mt-2 flex items-center gap-2 text-[11.5px] text-white/60">
                          <input type="color" value={customPalette.background || "#ffffff"} onChange={(event) => setCustomPalette((previous) => ({ ...previous, background: event.target.value }))} className="h-7 w-7 cursor-pointer rounded-md border border-white/10 bg-transparent p-0" />
                          {copy.palette.background}
                        </label>
                      </div>
                    )}
                  </PromptPopover>
                )}
              </div>
            )}

            {tool === "logo" && maxCandidates > 1 && (
              <div className="relative">
                <button type="button" onClick={() => toggle("candidates")} className={promptControlClassName({ active: openDropdown === "candidates" })} title={copy.controls.candidatesTitle}>
                  <span className="text-[11px] text-white/40">{copy.controls.candidates}</span>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{candidates}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === "candidates" && (
                  <PromptPopover>
                    <PromptPopoverHeader>{copy.controls.candidates}</PromptPopoverHeader>
                    <PromptMenuList>
                      {Array.from({ length: maxCandidates }, (_, index) => index + 1).map((count) => (
                        <PromptMenuItem key={count} selected={candidates === count} onClick={() => { setCandidates(count); setOpenDropdown(null); }}>{count}</PromptMenuItem>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            )}

            {visibleEnums.map(([key, input]) => (
              <div key={key} className="relative">
                <button type="button" onClick={() => toggle(key)} className={promptControlClassName({ active: openDropdown === key })} title={input.description || input.title}>
                  <span className="text-[11px] text-white/40">{input.title}</span>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{optionLabel(input, options[key] ?? input.default)}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === key && (
                  <PromptPopover>
                    <PromptPopoverHeader>{input.title}</PromptPopoverHeader>
                    <PromptMenuList>
                      {input.enum.map((value) => (
                        <PromptMenuItem key={String(value)} selected={(options[key] ?? input.default) === value} onClick={() => { setOption(key, value); setOpenDropdown(null); }}>{optionLabel(input, value)}</PromptMenuItem>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            ))}

            {visibleNumeric.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => toggle("tracing")} className={promptControlClassName({ active: openDropdown === "tracing" })}>
                  <IconAdjustments size={14} stroke={1.75} aria-hidden="true" />
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{copy.controls.tracing}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === "tracing" && (
                  <PromptPopover className="w-[300px]">
                    <PromptPopoverHeader>{copy.controls.tracing}</PromptPopoverHeader>
                    <div className="flex flex-col gap-3 px-2 pb-1">
                      {visibleNumeric.map(([key, input]) => (
                        <label key={key} className="flex flex-col gap-1 text-[12px] text-white/70" title={input.description || ""}>
                          <span className="flex items-center justify-between"><span>{input.title}</span><span className="tabular-nums text-white/45">{options[key] ?? input.default}</span></span>
                          <input type="range" min={input.minimum ?? 0} max={input.maximum ?? 100} step={input.type === "integer" ? 1 : 0.1} value={options[key] ?? input.default} onChange={(event) => setOption(key, Number(event.target.value))} className="w-full accent-[#22d3ee]" />
                        </label>
                      ))}
                    </div>
                  </PromptPopover>
                )}
              </div>
            )}

            {advancedInputs.length > 0 && (
              <button type="button" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced} className={promptControlClassName({ active: showAdvanced })} title={copy.controls.advancedHint}>
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{showAdvanced ? copy.controls.less : fill(copy.controls.more, { count: advancedInputs.length })}</span>
              </button>
            )}
          </PromptControls>

          <PromptActionGroup>
            <PriceChip locale={locale} endpoint={selectedModel?.endpoint} enabled={Boolean(selectedModel)} payload={pricePayload} runs={priceRuns} />
            <PromptAction onClick={handleGenerate} disabled={Boolean(uploading) || !selectedModel} data-vector-action={tool} className="whitespace-nowrap">
              {actionLabel}
            </PromptAction>
          </PromptActionGroup>
        </PromptFooter>
      </PromptComposer>
    </div>
  );
}
