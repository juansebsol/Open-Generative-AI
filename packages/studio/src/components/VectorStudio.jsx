"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconAdjustments, IconArrowsExchange, IconDownload, IconFileExport, IconFileZip, IconMaximize, IconMoon, IconPalette, IconPhotoPlus,
  IconPhotoUp, IconSun, IconSvg, IconTrash, IconUpload, IconWand, IconX,
} from "@tabler/icons-react";
import { generateVector, uploadFile } from "../generation.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { vectorTextModels, vectorizeModels, vectorModels, vectorModelDefaults, getVectorModelById } from "../vectorModels.js";
import { getRoutes } from "../providers/catalog/index.js";
import { isEndpointAvailable, runSvgChat } from "../providers/client.js";
import { getProvider } from "../providers/directProviders.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { fetchMediaBlob, saveLocalBlob } from "../providers/mediaStore.js";
import { addEntry, addPending, getEmptyLibrary, getLibrary, removeEntry, removePending, removeSet, sendToVector, subscribeLibrary, takeHandoff, updatePending } from "../vectorLibrary.js";
import { sanitizeSvg } from "../vector/svgSanitize.js";
import { buildSprite, iconFileName } from "../vector/svgSprite.js";
import { planIconSet, MAX_ICONS } from "../vector/iconSetPlanner.js";
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
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
} from "./prompt/PromptComposer.jsx";
import PriceChip, { PriceHint } from "./prompt/PriceChip.jsx";
import ModelRailPicker from "./prompt/ModelRailPicker.jsx";
import StudioEmptyState from "./StudioEmptyState.jsx";
import { Entrance } from "./motion/index.js";
import en from "../messages/en/vectorStudio.json";
import zh from "../messages/zh/vectorStudio.json";
import { resolveCopy } from "../i18nUtils";
import { defaultModelId } from "../benchmarks.js";
import { useEditorsPickPreselect } from "./benchmarks/shared.jsx";

// Three pages share this component, like the 3D pages share ThreeDStudio:
// Text to Logo and Icon Set generate SVGs from a prompt (Recraft and
// Ideogram draw them; chat models such as Gemini, Claude and GPT write the
// markup, see vector/svgChat.js, and those results can be refined with an
// instruction); Vectorize traces a raster. Every page shows the same library
// (vectorLibrary.js), results are sanitised SVGs, and the Export kit turns
// any of them into PNG, PDF, favicon or app icons in the browser for free.
// Later pages (Logo Rescue, Sketch to Vector, the Vibe Motion and 3D
// bridges) add an entry here and a tab in the shell.

export const VECTOR_PAGES = {
  logo: { kind: "text" },
  icons: { kind: "text" },
  vectorize: { kind: "vectorize" },
};

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

function ExportKitDialog({ entry, copy, onClose, onVectorize }) {
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

// Sends a code-written SVG back to its model with an instruction.
function RefineDialog({ entry, model, copy, locale, onClose, onSubmit }) {
  const svg = useSvgText(entry.url);
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = () => {
    if (!text.trim()) return toast.error(copy.refine.needText);
    if (!svg) return toast.error(copy.errors.badSvg);
    onSubmit(entry, text.trim(), svg);
  };
  const pricePayload = useMemo(() => ({ num_images: 1, prompt_characters: Math.ceil(text.length / 100) * 100, source_characters: svg ? Math.ceil(svg.length / 500) * 500 : 0 }), [text.length, svg]);
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4" onClick={onClose} role="presentation">
      <div className="w-[min(94vw,720px)] rounded-2xl border border-white/[0.12] bg-[#111114] p-4" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={copy.refine.action} data-vector-refine>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-white">{fill(copy.refine.title, { model: model.name })}</div>
            <p className="mt-1 max-w-[52ch] text-[12.5px] text-white/50">{copy.refine.hint}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={copy.buttons.close} className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/[0.06] hover:text-white"><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
          <div className="aspect-square overflow-hidden rounded-xl border border-white/[0.08]"><Preview entry={entry} tone="light" /></div>
          <div className="flex flex-col gap-3">
            <textarea ref={inputRef} value={text} onChange={(event) => setText(event.target.value)} placeholder={copy.refine.placeholder} rows={4} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(); }} className="min-h-[96px] w-full resize-y rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] text-white/85 placeholder:text-white/30 focus:border-white/20 focus:outline-none" />
            <div className="flex items-center justify-between gap-3">
              <PriceChip locale={locale} endpoint={model.endpoint} payload={pricePayload} runs={1} />
              <button type="button" onClick={submit} disabled={!svg} className="flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-[#04202a] hover:brightness-110 disabled:opacity-60"><IconWand size={15} stroke={1.75} aria-hidden="true" />{copy.refine.apply}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function useLibrary() {
  return useSyncExternalStore(subscribeLibrary, getLibrary, getEmptyLibrary);
}

export default function VectorStudio({ page = "logo", onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled, locale = "en" }) {
  const copy = resolveCopy(en, zh, locale);
  const pageCopy = copy.pages[page] || copy.pages.logo;
  const config = VECTOR_PAGES[page] || VECTOR_PAGES.logo;
  const isVectorize = config.kind === "vectorize";
  const isIcons = page === "icons";
  const PERSIST_KEY = `oga_vector_${page}_v1`;
  const library = useLibrary();
  const models = isVectorize ? vectorizeModels : vectorTextModels;

  // The editor's pick of the vector category, unless a saved choice is restored below.
  const [modelId, setModelId] = useState(() => defaultModelId(isVectorize ? null : "vector", models));
  const [options, setOptions] = useState({});
  const [prompt, setPrompt] = useState(""); // the logo prompt, or the icon style
  const [iconNames, setIconNames] = useState("");
  const [candidates, setCandidates] = useState(1);
  const [references, setReferences] = useState([]);
  const [paletteId, setPaletteId] = useState("none");
  const [customPalette, setCustomPalette] = useState({ colors: ["#2563eb", "#111827"], background: "#ffffff" });
  const [source, setSource] = useState(null); // { url, name, fromId }
  const [tone, setTone] = useState("light");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [refining, setRefining] = useState(null); // library entry being refined
  const [dragging, setDragging] = useState(false);
  const [providerReady, setProviderReady] = useState(null);
  const [libraryImages, setLibraryImages] = useState([]);
  const fileInputRef = useRef(null);
  const referenceInputRef = useRef(null);
  const textareaRef = useRef(null);
  const hasRestored = useRef(false);

  const selectedModel = models.find((model) => model.id === modelId) || models[0] || null;
  const isChat = selectedModel?.kind === "chat"; // a language model writes the SVG
  const palette = paletteId === "custom" ? customPalette : PALETTES.find((entry) => entry.id === paletteId) || PALETTES[0];
  const paletteSummary = normalizePalette(palette);
  const maxCandidates = selectedModel?.maxCandidates || 1;
  // Recraft takes the palette as an input and chat models get it in their
  // system prompt; only Ideogram needs the colours spelled out in the prompt.
  const plan = useMemo(() => planIconSet({ names: iconNames, style: prompt, paletteWords: selectedModel?.palette || selectedModel?.kind === "chat" ? "" : paletteToPromptWords(palette) }), [iconNames, prompt, selectedModel, palette]);
  const iconCount = plan.count;

  // Option defaults follow the selected model; values that still apply are kept.
  useEffect(() => {
    if (!selectedModel) return;
    setOptions((previous) => {
      const next = vectorModelDefaults(selectedModel);
      for (const key of Object.keys(next)) {
        const input = selectedModel.inputs[key];
        if (previous[key] === undefined) continue;
        if (input.enum ? input.enum.includes(previous[key]) : typeof previous[key] === typeof next[key]) next[key] = previous[key];
      }
      return next;
    });
  }, [selectedModel]);
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

  const openProviderSettings = (model = selectedModel) => {
    const providers = model ? [...new Set(getRoutes(model.endpoint).map((route) => route.provider))] : [];
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers } }));
  };

  // Per-page persistence (the library persists itself).
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      if (data) {
        if (models.some((model) => model.id === data.modelId)) setModelId(data.modelId);
        if (data.options && typeof data.options === "object") setOptions(data.options);
        if (typeof data.prompt === "string") setPrompt(data.prompt);
        if (typeof data.iconNames === "string") setIconNames(data.iconNames);
        if (Number.isFinite(data.candidates)) setCandidates(Math.max(1, Math.min(8, data.candidates)));
        if (PALETTES.some((entry) => entry.id === data.paletteId)) setPaletteId(data.paletteId);
        if (data.customPalette?.colors) setCustomPalette({ colors: data.customPalette.colors.slice(0, MAX_PALETTE_COLORS), background: data.customPalette.background || "#ffffff" });
        if (data.source && typeof data.source.url === "string") setSource(data.source);
        if (Array.isArray(data.references)) setReferences(data.references.filter((item) => typeof item?.url === "string"));
        if (data.tone === "dark" || data.tone === "light") setTone(data.tone);
      }
    } catch (error) {
      console.warn("[VectorStudio] could not restore state", error);
    } finally {
      hasRestored.current = true;
    }
  }, [PERSIST_KEY, models]);

  useEffect(() => {
    if (!hasRestored.current) return undefined;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ modelId, options, prompt, iconNames, candidates, paletteId, customPalette, source, references, tone }));
      } catch (error) {
        console.warn("[VectorStudio] could not save state", error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [PERSIST_KEY, modelId, options, prompt, iconNames, candidates, paletteId, customPalette, source, references, tone]);

  // A raster sent to Vectorize from another page or studio.
  useEffect(() => {
    if (!isVectorize || !library.handoffs.vectorize) return;
    const handoff = takeHandoff("vectorize");
    if (!handoff?.source) return;
    setSource(handoff.source);
    setOpenDropdown(null);
    setViewer(null);
  }, [library.handoffs, isVectorize]);

  // The Benchmarks page opens a page with a model preselected.
  useEffect(() => {
    const preselect = (event) => {
      const { tabId, modelId: wanted } = event.detail || {};
      if (tabId !== `vector-${page}` || !wanted) return;
      if (models.some((model) => model.id === wanted)) setModelId(wanted);
    };
    window.addEventListener("oga:open-studio", preselect);
    return () => window.removeEventListener("oga:open-studio", preselect);
  }, [page, models]);

  // The editor's choice of the vector category opens the page until the
  // visitor has seen it; a choice they make after that persists.
  useEditorsPickPreselect({
    page: `vector-${page}`,
    read: () => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null")?.modelId || null; } catch { saved = null; }
      return { categoryId: isVectorize ? null : "vector", modelIds: models.map((model) => model.id), savedModelId: saved };
    },
    apply: (wanted) => setModelId(wanted),
  });

  // Uploads: the image to trace (on this page, or sent to Vectorize from
  // another page), or Ideogram references.
  const uploadSource = useCallback(async (file, { send = false } = {}) => {
    if (!isImageFile(file)) {
      toast.error(copy.errors.notImage);
      return;
    }
    setUploading({ progress: 0 });
    try {
      const url = await uploadFile(file, (progress) => setUploading({ progress }));
      const next = { url, name: file.name, fromId: null };
      if (send) sendToVector("vectorize", { source: next });
      else setSource(next);
    } catch (error) {
      toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
    } finally {
      setUploading(null);
    }
  }, [copy]);

  const uploadReferences = useCallback(async (fileList) => {
    const max = selectedModel?.references?.max || 0;
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
  }, [copy, selectedModel, references.length]);

  useEffect(() => {
    if (!droppedFiles?.length) return;
    const images = droppedFiles.filter(isImageFile);
    if (images.length === 0) toast.error(copy.errors.notImage);
    else if (isVectorize) uploadSource(images[0]);
    else if (selectedModel?.references) uploadReferences(images);
    else uploadSource(images[0], { send: true });
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled, isVectorize, selectedModel, uploadReferences, uploadSource, copy]);

  useEffect(() => {
    if (openDropdown === "library") setLibraryImages(readImageStudioImages());
  }, [openDropdown]);

  // Stores sanitised SVG text as image/svg+xml with a PNG thumbnail.
  const fileSvg = useCallback(async (svg, remoteUrl = null) => {
    const url = await saveLocalBlob(new Blob([svg], { type: "image/svg+xml" }), { name: "vector.svg" });
    svgCache.set(url, Promise.resolve(svg));
    let thumbnail = null;
    try {
      thumbnail = await saveLocalBlob(await svgToPngBlob(svg, THUMBNAIL_SIZE), { name: "vector-thumbnail.png" });
    } catch (error) {
      console.warn("[VectorStudio] no thumbnail", error);
    }
    return { kind: "svg", url, thumbnail, remoteUrl, bytes: svg.length };
  }, []);

  // Provider results: download, sniff, sanitise, file.
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
    return fileSvg(svg, output.remoteUrl || null);
  }, [copy, fileSvg]);

  const report = (error) => {
    console.error("[VectorStudio]", error);
    const message = formatErrorMessage(error, copy.errors.generationFailed);
    if (onGenerationError) onGenerationError(message);
    else toast.error(message);
  };

  // Runs `jobs` a few at a time and files every output. A job is either
  // { payload, meta } for a provider endpoint or { chat, meta } for a chat
  // model writing the SVG (chat = runSvgChat's input, sanitised server-side
  // and again here before it is filed).
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
          const files = [];
          if (job.chat) {
            const data = await runSvgChat(job.chat.model, job.chat);
            const svg = sanitizeSvg(data?.svg);
            if (!svg) throw new Error(copy.errors.badSvg);
            files.push(await fileSvg(svg));
          } else {
            const result = await generateVector(job.payload);
            const outputs = describeVectorOutputs(result);
            if (outputs.length === 0) throw new Error(copy.errors.noOutput);
            for (const output of outputs) files.push(await materialize(output));
          }
          for (const file of files) {
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

  const modelMeta = (model) => ({ model: model.id, modelName: model.name, vendor: model.provider_name || "", chat: model.kind === "chat" });

  const generateLogo = async () => {
    const text = prompt.trim();
    if (!text) {
      textareaRef.current?.focus();
      return toast.error(copy.errors.needPrompt);
    }
    if (isChat) {
      // One call per candidate: the model writes a whole SVG each time.
      const chat = { model: selectedModel.id, prompt: text, page: "logo", palette: paletteSummary };
      const meta = { page: "logo", prompt: text, name: "", ...modelMeta(selectedModel), setId: null, palette: paletteSummary };
      return runJobs({ jobs: Array.from({ length: candidates }, () => ({ chat, meta })), label: selectedModel.name, promptText: text, concurrency: LOGO_CONCURRENCY });
    }
    const words = selectedModel.palette ? "" : paletteToPromptWords(palette);
    const payload = { model: selectedModel.id, prompt: words ? `${text}, ${words}` : text, ...options, ...(selectedModel.palette ? paletteToRecraft(palette) : {}) };
    if (selectedModel.references && references.length) payload[selectedModel.references.field] = references.map((item) => item.url);
    const runs = selectedModel.candidates === "runs" ? candidates : 1;
    if (selectedModel.candidates === "num_images") payload.num_images = candidates;
    const meta = { page: "logo", prompt: text, name: "", ...modelMeta(selectedModel), setId: null };
    return runJobs({ jobs: Array.from({ length: runs }, () => ({ payload, meta })), label: selectedModel.name, promptText: text, concurrency: LOGO_CONCURRENCY });
  };

  const generateIcons = async () => {
    if (!prompt.trim()) {
      textareaRef.current?.focus();
      return toast.error(copy.errors.needStyle);
    }
    if (iconCount === 0) return toast.error(copy.errors.needNames);
    const setId = newId();
    const names = plan.runs.map((run) => run.name);
    const setName = `${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`;
    if (isChat) {
      // Still one run per icon, so every icon is its own SVG in the set.
      const jobs = plan.runs.map((run) => ({
        chat: { model: selectedModel.id, prompt: run.prompt, page: "icons", palette: paletteSummary },
        meta: { page: "icons", prompt: run.prompt, name: run.name, ...modelMeta(selectedModel), setId, setName, palette: paletteSummary },
      }));
      return runJobs({ jobs, label: selectedModel.name, promptText: prompt.trim(), concurrency: ICON_CONCURRENCY });
    }
    const shape = selectedModel.candidates === "num_images" ? { aspect_ratio: "1:1", num_images: 1 } : { image_size: "square_hd" };
    const paletteInput = selectedModel.palette ? paletteToRecraft(palette) : {};
    const jobs = plan.runs.map((run) => ({
      payload: { model: selectedModel.id, prompt: run.prompt, ...(options.quality ? { quality: options.quality } : {}), ...shape, ...paletteInput },
      meta: { page: "icons", prompt: run.prompt, name: run.name, ...modelMeta(selectedModel), setId, setName },
    }));
    return runJobs({ jobs, label: selectedModel.name, promptText: prompt.trim(), concurrency: ICON_CONCURRENCY });
  };

  const generateVectorize = async () => {
    if (!source) return toast.error(copy.errors.needImage);
    const payload = { model: selectedModel.id, image_url: source.url, ...options };
    const meta = { page: "vectorize", prompt: selectedModel.name, name: source.name || "", ...modelMeta(selectedModel), setId: null, sourceUrl: source.url, sourceName: source.name || "", sourceId: source.fromId || null };
    const made = await runJobs({ jobs: [{ payload, meta }], label: selectedModel.name, promptText: source.name || "", concurrency: 1 });
    if (made[0]) setCompareId(made[0].id);
  };

  const handleGenerate = async () => {
    if (!selectedModel) return;
    if (!providerReady) return openProviderSettings();
    if (isVectorize) return generateVectorize();
    if (isIcons) return generateIcons();
    return generateLogo();
  };

  // Refine: the current SVG plus an instruction go back to the model that
  // wrote it; the answer is a new entry linked to this one (parentId).
  const refineModelFor = (entry) => {
    const model = entry?.chat ? getVectorModelById(entry.model) : null;
    return model?.kind === "chat" ? model : null;
  };
  const openRefine = (entry) => {
    const model = refineModelFor(entry);
    if (!model) return;
    if (!isEndpointAvailable(model.endpoint)) {
      const providers = [...new Set(getRoutes(model.endpoint).map((route) => getProvider(route.provider)?.label || route.provider))].join(` ${copy.providers.or} `);
      toast.error(fill(copy.errors.chatUnavailable, { model: model.name, providers }));
      return openProviderSettings(model);
    }
    setViewer(null);
    setRefining(entry);
  };
  const refineEntry = async (entry, instruction, svg) => {
    const model = refineModelFor(entry);
    if (!model) return;
    setRefining(null);
    const meta = { page: entry.page, prompt: entry.prompt, name: entry.name || "", ...modelMeta(model), setId: null, palette: entry.palette || null, parentId: entry.id, refinement: instruction };
    const chat = { model: model.id, page: entry.page === "icons" ? "icons" : "logo", palette: entry.palette || null, refine: { svg, instruction } };
    await runJobs({ jobs: [{ chat, meta }], label: model.name, promptText: instruction, concurrency: 1 });
  };

  // Library actions
  const sendToVectorize = (entry) => {
    const next = { url: entry.url, name: entry.name || entry.prompt || "image", fromId: entry.id };
    setOpenDropdown(null);
    setViewer(null);
    setExporting(null);
    if (isVectorize) setSource(next);
    else sendToVector("vectorize", { source: next });
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
  const compareEntry = isVectorize ? library.entries.find((entry) => entry.id === compareId && entry.sourceUrl) || library.entries.find((entry) => entry.sourceUrl) || null : null;
  const hasGallery = library.entries.length > 0 || library.pending.length > 0;
  const starters = (pageCopy.starters || []).map((starter) => ({ label: starter.label, prompt: starter.prompt }));
  const onStarter = (text) => {
    setPrompt(text);
    textareaRef.current?.focus();
  };

  // Controls
  const setOption = (key, value) => setOptions((previous) => ({ ...previous, [key]: value }));
  const inputs = Object.entries(selectedModel?.inputs || {}).filter(([key]) => !isIcons || key === "quality");
  const numericInputs = inputs.filter(([, input]) => !Array.isArray(input.enum) && (input.type === "integer" || input.type === "number"));
  const advancedInputs = inputs.filter(([, input]) => input.advanced);
  const visibleNumeric = showAdvanced ? numericInputs : numericInputs.filter(([, input]) => !input.advanced);
  const visibleEnums = inputs.filter(([, input]) => Array.isArray(input.enum) && (showAdvanced || !input.advanced));
  const optionLabel = (input, value) => input.optionLabels?.[value] ?? String(value);
  const shapeFor = (model) => (model.candidates === "num_images" ? { aspect_ratio: "1:1", num_images: 1 } : { image_size: "square_hd" });
  // Chat models are priced per token, so the quote needs the prompt length
  // (rounded, so typing does not re-quote every keystroke) and one SVG per run.
  const chatPayload = () => ({ num_images: 1, prompt_characters: Math.ceil((isIcons ? plan.runs[0]?.prompt.length || prompt.length : prompt.length) / 100) * 100 });
  const pricePayload = isVectorize
    ? options
    : isChat ? chatPayload()
      : isIcons ? { ...(options.quality ? { quality: options.quality } : {}), ...shapeFor(selectedModel || {}) } : { ...options, ...(selectedModel?.candidates === "num_images" ? { num_images: candidates } : {}) };
  const priceRuns = isIcons ? Math.max(1, iconCount) : selectedModel?.candidates === "runs" ? candidates : 1;
  const pickerPayload = (model) => (model.kind === "chat" ? chatPayload() : isIcons ? { ...(options.quality ? { quality: options.quality } : {}), ...shapeFor(model) } : { ...options, ...(model.candidates === "num_images" ? { num_images: candidates } : {}) });
  // The rail picker's groups: models drawn by a vector model (cyan) and
  // chat models writing the markup (violet). The Elo on each row comes from
  // the Benchmarks "vector" category, prices from the chip's own payload.
  const pickerGroups = useMemo(() => [
    { id: "vector", label: copy.picker.vectorSection, railLabel: copy.picker.vectorRail, tone: "cyan", mono: "VM", models: models.filter((model) => model.kind !== "chat") },
    { id: "chat", label: copy.picker.chatSection, railLabel: copy.picker.chatRail, tone: "violet", mono: "AI", models: models.filter((model) => model.kind === "chat") },
  ].filter((group) => group.models.length > 0), [models, copy.picker]);
  const toggle = (id) => setOpenDropdown(openDropdown === id ? null : id);
  const actionLabel = isIcons ? fill(copy.icons.generate, { count: number(iconCount, locale) }) : isVectorize ? copy.vectorize.apply : copy.buttons.generate;

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
      {entry.kind === "svg" && refineModelFor(entry) && (
        <button type="button" title={copy.refine.hint} onClick={() => openRefine(entry)} data-vector-refine-action className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-semibold text-[#04202a] hover:brightness-110"><IconWand size={14} stroke={1.75} aria-hidden="true" />{copy.refine.action}</button>
      )}
      <button type="button" title={copy.buttons.export} aria-label={copy.buttons.export} onClick={() => setExporting(entry)} className="flex h-8 items-center gap-1.5 rounded-lg bg-black/60 px-2.5 text-[12px] font-medium text-white hover:bg-white/20"><IconFileExport size={14} stroke={1.75} aria-hidden="true" />{copy.buttons.export}</button>
      <button type="button" title={copy.buttons.download} aria-label={copy.buttons.download} onClick={() => downloadSvg(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconDownload size={15} stroke={1.75} aria-hidden="true" /></button>
      <button type="button" title={copy.buttons.fullscreen} aria-label={copy.buttons.fullscreen} onClick={() => setViewer(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconMaximize size={15} stroke={1.75} aria-hidden="true" /></button>
      <button type="button" title={copy.buttons.delete} aria-label={copy.buttons.delete} onClick={() => deleteEntry(entry.id)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-red-300 hover:bg-red-500 hover:text-white"><IconTrash size={15} stroke={1.75} aria-hidden="true" /></button>
    </div>
  );

  const card = (entry, { compact = false, index = 0 } = {}) => (
    <Entrance once variant="card" index={index} key={entry.id} data-vector-entry={entry.kind} className={`group relative aspect-square overflow-hidden rounded-2xl border bg-[#0e0e11] ${compareId === entry.id && isVectorize ? "border-primary/60" : "border-white/[0.08]"}`} onClick={() => entry.sourceUrl && setCompareId(entry.id)} role={entry.sourceUrl ? "button" : undefined} tabIndex={entry.sourceUrl ? 0 : undefined}>
      <Preview entry={entry} tone={tone} />
      {entry.kind === "raster" && <span className="absolute left-2 top-2 rounded-md bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-semibold text-black" title={copy.vectorize.rasterNote}>{copy.gallery.raster}</span>}
      {entry.kind === "svg" && entry.chat && (
        <span className="absolute left-2 top-2 flex items-center gap-1">
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white/80" title={copy.gallery.chatNote}>{copy.gallery.chat}</span>
          {entry.refinement && <span className="rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#04202a]" title={entry.refinement}>{copy.refine.badge}</span>}
        </span>
      )}
      {!compact && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#09090b]/95 to-transparent p-3 pt-10">
          <div className="truncate text-[13px] font-medium text-white/90">{entry.refinement || entry.name || entry.prompt || copy.gallery.fromImage}</div>
          <div className="truncate text-[11.5px] text-white/45">{entry.refinement ? `${copy.refine.badge} · ` : ""}{entry.modelName}{entry.vendor ? ` · ${entry.vendor}` : ""}</div>
        </div>
      )}
      {compact && <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-[#09090b]/90 to-transparent px-2 pb-1.5 pt-6 text-[11px] text-white/85">{entry.name}</div>}
      {cardActions(entry)}
    </Entrance>
  );

  // Vectorize: the image, the tracer and its knobs live in one panel in the
  // page body, so the choice is in plain sight rather than behind a picker.
  const dropHandlers = {
    onDragOver: (event) => { event.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); uploadSource(event.dataTransfer.files?.[0]); },
  };
  const vectorizePanel = isVectorize && (
    <div className="mx-auto w-full max-w-5xl rounded-2xl border border-white/[0.08] bg-[#0e0e11] p-4" data-vector-panel="vectorize">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className={`relative flex min-h-[260px] flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed p-4 text-center transition-colors ${dragging ? "border-primary/70 bg-primary/[0.06]" : "border-white/15"}`} style={source ? CHECKER[tone] : undefined} {...dropHandlers}>
          {source ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.url} alt="" className="max-h-[320px] w-full object-contain" />
              <div className="absolute left-2 top-2 max-w-[70%] truncate rounded-md bg-black/70 px-2 py-1 text-[11.5px] text-white">{source.name}</div>
              <button type="button" onClick={() => setSource(null)} aria-label={copy.vectorize.clear} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-white/20"><IconX size={15} stroke={1.75} aria-hidden="true" /></button>
            </>
          ) : (
            <>
              <IconPhotoUp size={30} stroke={1.5} className="text-white/35" aria-hidden="true" />
              <div className="mt-3 text-[14px] font-medium text-white/85">{copy.vectorize.dropTitle}</div>
              <div className="mt-1 max-w-[32ch] text-[12.5px] text-white/45">{copy.vectorize.dropHint}</div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)} className="flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-[#04202a] hover:brightness-110 disabled:opacity-60">
                  {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#04202a]/30 border-t-[#04202a]" aria-hidden="true" /> : <IconUpload size={15} stroke={1.75} aria-hidden="true" />}
                  {copy.vectorize.upload}
                </button>
                <div className="relative">
                  <button type="button" onClick={() => toggle("library")} className="flex h-10 items-center gap-2 rounded-[10px] border border-white/[0.12] px-4 text-[13px] text-white/75 hover:border-white/30 hover:text-white">
                    <IconPhotoUp size={15} stroke={1.75} aria-hidden="true" />{copy.vectorize.fromLibrary}
                  </button>
                  {openDropdown === "library" && (
                    <PromptPopover className="w-[360px]" positionClassName="absolute left-0 top-full mt-2 z-30">
                      <PromptPopoverHeader>{copy.vectorize.libraryTitle}</PromptPopoverHeader>
                      {libraryImages.length === 0 ? (
                        <p className="px-2 py-3 text-left text-[12.5px] text-white/45">{copy.vectorize.libraryEmpty}</p>
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
              </div>
            </>
          )}
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { uploadSource(event.target.files?.[0]); event.target.value = ""; }} />
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">{copy.controls.tier}</div>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={copy.controls.tier}>
            {models.map((model) => (
              <button key={model.id} type="button" role="radio" aria-checked={model.id === selectedModel?.id} onClick={() => { setModelId(model.id); setShowAdvanced(false); }} onMouseEnter={() => setHoveredId(model.id)} onMouseLeave={() => setHoveredId((current) => (current === model.id ? null : current))} className={`flex items-start justify-between gap-3 rounded-[10px] border px-3 py-2 text-left transition-colors ${model.id === selectedModel?.id ? "border-primary/50 bg-primary/[0.08]" : "border-white/[0.08] hover:border-white/20"}`}>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-white/90">{model.name} <span className="font-normal text-white/40">· {model.provider_name}</span></span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-white/45">{model.description}</span>
                </span>
                <PriceHint locale={locale} endpoint={model.endpoint} payload={{}} hovered={hoveredId === model.id || model.id === selectedModel?.id} className="mt-0.5" />
              </button>
            ))}
          </div>
          {(visibleEnums.length > 0 || visibleNumeric.length > 0) && (
            <div className="grid grid-cols-1 gap-3 border-t border-white/[0.08] pt-3 sm:grid-cols-2">
              {visibleEnums.map(([key, input]) => (
                <div key={key} className="flex flex-col gap-1 text-[12px] text-white/70" title={input.description || ""}>
                  <span>{input.title}</span>
                  <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-white/[0.07] bg-white/[0.04] p-0.5">
                    {input.enum.map((value) => (
                      <button key={String(value)} type="button" aria-pressed={(options[key] ?? input.default) === value} onClick={() => setOption(key, value)} className={`min-h-7 flex-1 rounded-lg px-2 py-1 text-xs font-medium ${(options[key] ?? input.default) === value ? "bg-white/[0.1] text-white" : "text-white/45 hover:text-white/75"}`}>{optionLabel(input, value)}</button>
                    ))}
                  </div>
                </div>
              ))}
              {visibleNumeric.map(([key, input]) => (
                <label key={key} className="flex flex-col gap-1 text-[12px] text-white/70" title={input.description || ""}>
                  <span className="flex items-center justify-between"><span>{input.title}</span><span className="tabular-nums text-white/45">{options[key] ?? input.default}</span></span>
                  <input type="range" min={input.minimum ?? 0} max={input.maximum ?? 100} step={input.type === "integer" ? 1 : 0.1} value={options[key] ?? input.default} onChange={(event) => setOption(key, Number(event.target.value))} className="w-full accent-[#22d3ee]" />
                </label>
              ))}
            </div>
          )}
          {advancedInputs.length > 0 && (
            <button type="button" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced} className="self-start text-[12px] text-white/50 hover:text-white" title={copy.controls.advancedHint}>
              {showAdvanced ? copy.controls.less : fill(copy.controls.more, { count: advancedInputs.length })}
            </button>
          )}
        </div>
      </div>
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

      <div className="flex-1 w-full overflow-y-auto custom-scrollbar pb-64 pt-4 px-4 md:px-8">
        {hasGallery || isVectorize ? (
          <div className="mx-auto max-w-6xl pt-12">
            {isVectorize && (
              <div className="mb-6">
                {!hasGallery && (
                  <div className="mx-auto mb-6 max-w-5xl">
                    <h1 className="text-[28px] md:text-[34px] font-semibold tracking-[-0.025em] leading-[1.1] text-white/[0.92]">{pageCopy.heading} <em className="not-italic text-primary whitespace-nowrap">{pageCopy.accent}</em></h1>
                    <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-white/55">{pageCopy.subtitle}</p>
                  </div>
                )}
                {vectorizePanel}
              </div>
            )}
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
            {hasGallery && (
              <>
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/40">{fill(copy.gallery.library, { count: library.entries.length })}</div>
                  <ToneToggle tone={tone} onChange={setTone} copy={copy} />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {library.pending.map((run) => (
                    <Entrance once variant="card" key={run.id} className="aspect-square rounded-2xl border border-white/[0.08] bg-[#0e0e11] flex flex-col items-center justify-center gap-3 text-center p-6">
                      <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
                      <div className="text-[14px] font-medium text-white/85">{fill(copy.gallery.pendingTitle, { model: run.label })}</div>
                      <div className="text-[12px] text-white/45">{run.total > 1 ? fill(copy.gallery.pendingProgress, { done: run.done, total: run.total }) : copy.gallery.pendingHint}</div>
                    </Entrance>
                  ))}
                  {groups.map((group, groupIndex) => (group.type === "single" ? card(group.entry, { index: groupIndex }) : (
                    <Entrance once variant="card" index={groupIndex} key={group.setId} className="col-span-full rounded-2xl border border-white/[0.08] bg-[#0e0e11] p-3">
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
                        {group.entries.map((entry, index) => card(entry, { compact: true, index }))}
                      </div>
                    </Entrance>
                  )))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="h-full w-full">
            <StudioEmptyState heading={pageCopy.heading} accent={pageCopy.accent} subtitle={pageCopy.subtitle} starters={starters} onStarter={onStarter} showcase={null} />
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
              {viewer.kind === "svg" && refineModelFor(viewer) && (
                <button type="button" onClick={() => openRefine(viewer)} className="flex items-center gap-1.5 rounded-lg bg-white/[0.1] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/20"><IconWand size={14} stroke={1.75} aria-hidden="true" />{copy.refine.action}</button>
              )}
              <button type="button" onClick={() => { setExporting(viewer); setViewer(null); }} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-[#04202a]"><IconFileExport size={14} stroke={1.75} aria-hidden="true" />{copy.buttons.export}</button>
            </div>
          </div>
        </div>
      )}

      {exporting && <ExportKitDialog entry={exporting} copy={copy} onClose={() => setExporting(null)} onVectorize={sendToVectorize} />}
      {refining && refineModelFor(refining) && <RefineDialog entry={refining} model={refineModelFor(refining)} copy={copy} locale={locale} onClose={() => setRefining(null)} onSubmit={refineEntry} />}

      <PromptComposer>
        <div className="flex items-start gap-2 px-1">
          {isVectorize && (
            <>
              {source ? (
                <div className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] pl-1 pr-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={source.url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  <span className="max-w-[200px] truncate text-[12.5px] text-white/85">{source.name}</span>
                  <button type="button" onClick={() => setSource(null)} aria-label={copy.vectorize.clear} className="text-white/40 hover:text-white"><IconX size={14} stroke={2} aria-hidden="true" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)} className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-dashed border-white/20 px-3.5 whitespace-nowrap text-[12.5px] text-white/60 hover:border-white/40 hover:text-white">
                  {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconUpload size={15} stroke={1.75} aria-hidden="true" />}
                  {copy.vectorize.upload}
                </button>
              )}
              <p className="flex-1 px-1.5 pt-2.5 text-[13.5px] text-white/40">{source ? fill(copy.vectorize.readyHint, { model: selectedModel?.name || "" }) : pageCopy.placeholder}</p>
            </>
          )}

          {page === "logo" && selectedModel?.references && (
            <div className="flex items-center gap-2 flex-wrap">
              {references.map((image, index) => (
                <div key={image.url} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setReferences((previous) => previous.filter((_, i) => i !== index))} aria-label={copy.controls.removeReference} className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 hover:opacity-100"><IconX size={14} stroke={2} aria-hidden="true" /></button>
                </div>
              ))}
              {references.length < selectedModel.references.max && (
                <button type="button" onClick={() => referenceInputRef.current?.click()} disabled={Boolean(uploading)} title={fill(copy.controls.addReference, { max: selectedModel.references.max })} className={promptMediaButtonClassName()}>
                  {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconPhotoPlus size={16} stroke={1.75} className="text-white/60" aria-hidden="true" />}
                </button>
              )}
              <input ref={referenceInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => { uploadReferences(event.target.files); event.target.value = ""; }} />
            </div>
          )}

          {page === "logo" && <PromptTextarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={pageCopy.placeholder} />}
          {isIcons && (
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
              <PromptTextarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={pageCopy.placeholder} className="flex-1" />
              <div className="flex w-full flex-col gap-1 sm:w-[220px]">
                <textarea value={iconNames} onChange={(event) => setIconNames(event.target.value)} placeholder={pageCopy.namesPlaceholder} rows={3} spellCheck={false} aria-label={copy.icons.none} className="max-h-[150px] min-h-[76px] w-full resize-y rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12.5px] text-white/85 placeholder:text-white/30 focus:border-white/20 focus:outline-none" />
                <span className={`px-1 text-[11.5px] ${plan.truncated ? "text-amber-300/90" : "text-white/45"}`}>
                  {iconCount === 0 ? copy.icons.none : plan.truncated ? fill(copy.icons.truncated, { max: MAX_ICONS }) : iconCount === 1 ? copy.icons.countOne : fill(copy.icons.count, { count: number(iconCount, locale) })}
                </span>
              </div>
            </div>
          )}
        </div>

        <PromptFooter>
          <PromptControls>
            {!isVectorize && models.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => toggle("model")} className={promptControlClassName({ active: openDropdown === "model" })}>
                  <span className="text-[11px] text-white/40">{copy.controls.model}</span>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{selectedModel?.name}</span>
                  <PromptChevronIcon />
                </button>
                <ModelRailPicker
                  open={openDropdown === "model"}
                  onClose={() => setOpenDropdown(null)}
                  groups={pickerGroups}
                  selectedId={selectedModel?.id}
                  onSelect={(model) => setModelId(model.id)}
                  pricePayload={pickerPayload}
                  benchmarksCategory="vector"
                  locale={locale}
                />
              </div>
            )}

            {isVectorize && selectedModel && (
              <span className={promptControlClassName({ active: false })} title={selectedModel.description}>
                <span className="text-[11px] text-white/40">{copy.controls.tier}</span>
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{selectedModel.name}</span>
              </span>
            )}

            {!isVectorize && (
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

            {page === "logo" && maxCandidates > 1 && (
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

            {!isVectorize && visibleEnums.map(([key, input]) => (
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

            {!isVectorize && advancedInputs.length > 0 && (
              <button type="button" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced} className={promptControlClassName({ active: showAdvanced })} title={copy.controls.advancedHint}>
                <IconAdjustments size={14} stroke={1.75} aria-hidden="true" />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{showAdvanced ? copy.controls.less : fill(copy.controls.more, { count: advancedInputs.length })}</span>
              </button>
            )}
          </PromptControls>

          <PromptActionGroup>
            <PriceChip locale={locale} endpoint={selectedModel?.endpoint} enabled={Boolean(selectedModel)} payload={pricePayload} runs={priceRuns} />
            <PromptAction onClick={handleGenerate} disabled={Boolean(uploading) || !selectedModel} data-vector-action={page} className="whitespace-nowrap">
              {actionLabel}
            </PromptAction>
          </PromptActionGroup>
        </PromptFooter>
      </PromptComposer>
    </div>
  );
}
