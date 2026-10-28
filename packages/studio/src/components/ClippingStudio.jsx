"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import toast, { Toaster } from "react-hot-toast";
import { processV2V, uploadFile } from "../generation.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { v2vModels } from "../models.js";
import { getRoutes } from "../providers/catalog/index.js";
import { isEndpointAvailable } from "../providers/client.js";
import { getProvider } from "../providers/directProviders.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import MobileGenerationActions, {
  GenerationCopyButtons,
} from "./MobileGenerationActions.jsx";
import {
  PROMPT_CONTROL_LABEL_CLASS,
  PromptAction,
  PromptAspectRatioIcon,
  PromptChevronIcon,
  PromptComposer,
  PromptControls,
  PromptDurationIcon,
  PromptFooter,
  PromptMenuItem,
  PromptMenuList,
  PromptPopover,
  PromptPopoverHeader,
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
  PromptActionGroup,
} from "./prompt/PromptComposer.jsx";
import PriceChip from "./prompt/PriceChip.jsx";
import en from "../messages/en/clippingStudio.json";
import zh from "../messages/zh/clippingStudio.json";
import { resolveCopy } from "../i18nUtils";
import StudioEmptyState from "./StudioEmptyState.jsx";

// Long footage in, short highlight clip(s) out. Models are the v2v catalog
// entries in the "ai-clipping" family (WaveSpeed AI Video Editor).
const CLIPPING_MODELS = v2vModels.filter((model) => model.family === "ai-clipping");
const PERSIST_KEY = "hg_clipping_studio_persistent";
const HISTORY_LIMIT = 50;
const OPTION_KEYS = ["aspect_ratio", "duration", "caption_style", "language"];

const isVideoFile = (file) => {
  if (!file) return false;
  if (file.type && file.type.startsWith("video/")) return true;
  const ext = file.name?.split(".").pop()?.toLowerCase();
  return ["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(ext);
};

const fill = (text, values) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), text || "");

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || "";
  return `${labels.slice(0, -1).join(", ")} / ${labels[labels.length - 1]}`;
}

function defaultOptions(model) {
  const options = {};
  for (const key of OPTION_KEYS) {
    const input = model?.inputs?.[key];
    if (input) options[key] = input.default ?? "";
  }
  return options;
}

async function downloadFile(url, filename) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
}

// ---------------------------------------------------------------------------
// Option dropdown (same interaction as the other studios' prompt bars)
// ---------------------------------------------------------------------------
function OptionDropdown({ id, openId, setOpenId, icon, label, title, items, selectedId, onSelect, className = "" }) {
  const anchorRef = useRef(null);
  const popoverRef = useRef(null);
  const isOpen = openId === id;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event) => {
      if (!popoverRef.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) {
        setOpenId(null);
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [isOpen, setOpenId]);

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpenId(isOpen ? null : id);
        }}
        className={promptControlClassName({ active: isOpen })}
      >
        {icon}
        <span className={PROMPT_CONTROL_LABEL_CLASS}>{label}</span>
        <PromptChevronIcon />
      </button>
      {isOpen && (
        <PromptPopover ref={popoverRef} className={className} onClick={(event) => event.stopPropagation()}>
          <PromptPopoverHeader>{title}</PromptPopoverHeader>
          <PromptMenuList>
            {items.map((item) => (
              <PromptMenuItem
                key={String(item.id)}
                selected={item.id === selectedId}
                description={item.description}
                onClick={() => {
                  onSelect(item.id);
                  setOpenId(null);
                }}
              >
                {item.name}
              </PromptMenuItem>
            ))}
          </PromptMenuList>
        </PromptPopover>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const ScissorsIcon = ({ className = "" }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.47" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

const CaptionIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M7 15h4M13 15h4M7 11h10" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const PlayIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ClippingStudio({
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  droppedFiles,
  onFilesHandled,
  locale = "en",
}) {
  const copy = resolveCopy(en, zh, locale);

  const [selectedModelId, setSelectedModelId] = useState(CLIPPING_MODELS[0]?.id ?? "");
  const selectedModel = CLIPPING_MODELS.find((model) => model.id === selectedModelId) || CLIPPING_MODELS[0];
  const maxVideos = selectedModel?.maxVideos || 1;

  const [sources, setSources] = useState([]); // [{ url, name }]
  const [uploading, setUploading] = useState(null); // { done, total, progress }
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(() => defaultOptions(CLIPPING_MODELS[0]));
  const [history, setHistory] = useState([]);
  const [pending, setPending] = useState([]); // in-flight runs
  const [openDropdown, setOpenDropdown] = useState(null);
  const [fullscreen, setFullscreen] = useState(null);
  const [providerReady, setProviderReady] = useState(null); // null until checked in the browser

  const fileInputRef = useRef(null);
  const hasRestored = useRef(false);

  // ── Provider availability ───────────────────────────────────────────────
  const routeProviderLabels = useMemo(() => {
    const ids = [...new Set(CLIPPING_MODELS.flatMap((model) => getRoutes(model.endpoint || model.id).map((route) => route.provider)))];
    return ids.map((id) => getProvider(id)?.label || id);
  }, []);
  const providersText = joinLabels(routeProviderLabels);

  useEffect(() => {
    const sync = () => setProviderReady(Boolean(selectedModel) && isEndpointAvailable(selectedModel.endpoint || selectedModel.id));
    sync();
    return subscribeProviderSettings(sync);
  }, [selectedModel]);

  const openProviderSettings = () => {
    const providers = selectedModel ? [...new Set(getRoutes(selectedModel.endpoint || selectedModel.id).map((route) => route.provider))] : [];
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers } }));
  };

  // ── Persistence ─────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PERSIST_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        const model = CLIPPING_MODELS.find((entry) => entry.id === data.selectedModelId);
        if (model) {
          setSelectedModelId(model.id);
          setOptions({ ...defaultOptions(model), ...(data.options || {}) });
        }
        if (Array.isArray(data.sources)) {
          setSources(data.sources.filter((source) => typeof source?.url === "string"));
        }
        if (typeof data.prompt === "string") setPrompt(data.prompt);
        if (Array.isArray(data.history)) {
          setHistory(data.history.filter((entry) => typeof entry?.url === "string" && entry.id));
        }
      }
    } catch (err) {
      console.warn("Failed to load ClippingStudio persistence:", err);
    } finally {
      hasRestored.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasRestored.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({
          selectedModelId,
          options,
          sources,
          prompt,
          history: history.slice(0, HISTORY_LIMIT),
        }));
      } catch (err) {
        console.warn("Failed to save ClippingStudio persistence:", err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedModelId, options, sources, prompt, history]);

  // ── Uploads ─────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (fileList) => {
    const videos = Array.from(fileList || []).filter(isVideoFile);
    if (videos.length === 0) {
      toast.error(copy.errors.notVideo);
      return;
    }
    // A single-video model swaps its source; otherwise fill the free slots.
    const replace = maxVideos === 1;
    const room = replace ? 1 : Math.max(0, maxVideos - sources.length);
    if (videos.length > room) toast(fill(copy.media.maxReached, { max: maxVideos }));
    const queue = videos.slice(0, room);
    if (queue.length === 0) return;

    setUploading({ done: 0, total: queue.length, progress: 0 });
    for (const [index, file] of queue.entries()) {
      try {
        const url = await uploadFile(file, (progress) => setUploading({ done: index, total: queue.length, progress }));
        setSources((previous) => [...previous, { url, name: file.name }].slice(-maxVideos));
      } catch (err) {
        toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(err, "") }));
      }
    }
    setUploading(null);
  }, [copy, maxVideos, sources.length]);

  useEffect(() => {
    if (!droppedFiles || droppedFiles.length === 0) return;
    const videos = droppedFiles.filter(isVideoFile);
    if (videos.length > 0) handleUpload(videos);
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled, handleUpload]);

  // ── Model selection ─────────────────────────────────────────────────────
  const handleModelSelect = (modelId) => {
    const model = CLIPPING_MODELS.find((entry) => entry.id === modelId);
    if (!model) return;
    setSelectedModelId(model.id);
    setOptions((previous) => {
      const next = defaultOptions(model);
      for (const key of Object.keys(next)) {
        const input = model.inputs[key];
        if (previous[key] === "" || input.enum?.includes(previous[key])) next[key] = previous[key];
      }
      return next;
    });
    const limit = model.maxVideos || 1;
    if (sources.length > limit) {
      setSources((previous) => previous.slice(0, limit));
      toast(fill(copy.media.maxReached, { max: limit }));
    }
  };

  const setOption = (key, value) => setOptions((previous) => ({ ...previous, [key]: value }));

  // ── Generation ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedModel) return;
    if (!providerReady) {
      openProviderSettings();
      return;
    }
    if (sources.length === 0) {
      toast.error(copy.errors.needVideo);
      return;
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runPrompt = selectedModel.hasPrompt ? prompt.trim() : "";
    const runSources = sources.slice(0, maxVideos);
    const runOptions = {};
    for (const [key, value] of Object.entries(options)) {
      if (value !== "" && value !== undefined && selectedModel.inputs?.[key]) runOptions[key] = value;
    }

    setPending((previous) => [{ id: runId, prompt: runPrompt, sourceCount: runSources.length }, ...previous]);
    onGenerationStart?.();
    try {
      const result = await processV2V({
        model: selectedModel.id,
        prompt: runPrompt,
        videos_list: runSources.map((source) => source.url),
        ...runOptions,
      });
      const media = result?.media?.length ? result.media : (result?.outputs || []).map((url) => ({ url, type: "video" }));
      const clips = media.filter((item) => item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(item.url));
      const files = media.filter((item) => !clips.includes(item)).map((item) => item.url);
      if (clips.length === 0) throw new Error(copy.errors.noClip);

      const timestamp = new Date().toISOString();
      const entries = clips.map((clip, index) => ({
        id: `${result.id || runId}-${index}`,
        url: clip.url,
        files,
        prompt: runPrompt,
        model: selectedModel.id,
        modelName: selectedModel.name,
        sourceCount: runSources.length,
        aspect_ratio: runOptions.aspect_ratio || "",
        duration: runOptions.duration || "",
        timestamp,
      }));
      setHistory((previous) => [...entries, ...previous].slice(0, HISTORY_LIMIT));
      onGenerationComplete?.({ url: entries[0].url, model: selectedModel.id, prompt: runPrompt, type: "clipping" });
    } catch (err) {
      console.error("[ClippingStudio]", err);
      const message = formatErrorMessage(err, copy.errors.generationFailed);
      if (onGenerationError) onGenerationError(message);
      else toast.error(message);
    } finally {
      setPending((previous) => previous.filter((run) => run.id !== runId));
      onGenerationEnd?.();
    }
  };

  const deleteEntry = (id) => {
    if (!confirm(copy.confirm.deleteItem)) return;
    setHistory((previous) => previous.filter((entry) => entry.id !== id));
    if (fullscreen?.id === id) setFullscreen(null);
  };

  // ── Dropdown items ──────────────────────────────────────────────────────
  const inputs = selectedModel?.inputs || {};
  const modelItems = CLIPPING_MODELS.map((model) => ({ id: model.id, name: model.name, description: model.description }));
  const aspectItems = [
    { id: "", name: copy.options.autoAspect },
    ...(inputs.aspect_ratio?.enum || []).map((value) => ({ id: value, name: value })),
  ];
  const lengthItems = [
    { id: "", name: copy.options.autoLength },
    ...(inputs.duration?.enum || []).map((value) => ({ id: value, name: fill(copy.options.seconds, { n: value }) })),
  ];
  const captionItems = (inputs.caption_style?.enum || []).map((value) => ({ id: value, name: copy.captionStyles[value] || value }));
  const languageItems = (inputs.language?.enum || []).map((value) => ({ id: value, name: copy.languages[value] || value }));

  const isUploading = Boolean(uploading);
  const canAddMore = sources.length < maxVideos || maxVideos === 1;
  const hasGallery = history.length > 0 || pending.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative overflow-hidden">
      {/* ── GALLERY ── */}
      <div className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto custom-scrollbar pb-48 lg:pb-40 px-2">
        {providerReady === false && (
          <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-200">{copy.setup.title}</p>
              <p className="text-xs text-amber-100/70 leading-relaxed">
                {routeProviderLabels.length > 0 ? fill(copy.setup.body, { providers: providersText }) : copy.setup.unavailable}
              </p>
            </div>
            {routeProviderLabels.length > 0 && (
              <button
                type="button"
                onClick={openProviderSettings}
                className="shrink-0 rounded-xl bg-amber-300 px-3 py-2 text-xs font-bold text-black hover:bg-amber-200 transition-colors"
              >
                {fill(copy.setup.button, { providers: providersText })}
              </button>
            )}
          </div>
        )}

        {hasGallery ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full pt-4 oga-enter-fade">
            {pending.map((run) => (
              <div
                key={run.id}
                className="relative rounded-2xl overflow-hidden border border-primary/30 bg-[#0a0a0a] shadow-xl flex flex-col"
              >
                <div className="w-full aspect-video bg-black/60 flex flex-col items-center justify-center gap-3 text-center px-4">
                  <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-primary animate-spin" />
                  <p className="text-sm font-semibold text-white/80">{copy.status.clipping}</p>
                  <p className="text-[11px] text-white/40">{copy.status.clippingHint}</p>
                </div>
                <div className="p-3 bg-black/80 border-t border-white/5 flex flex-col gap-1">
                  {run.prompt && <p className="text-white/60 text-xs line-clamp-2">{run.prompt}</p>}
                  <span className="text-[10px] text-white/40">{fill(copy.status.sources, { count: run.sourceCount })}</span>
                </div>
              </div>
            ))}

            {history.map((entry) => (
              <div
                key={entry.id}
                className="relative group rounded-2xl overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-xl hover:border-primary/50 transition-all duration-300 flex flex-col cursor-pointer"
                onClick={() => setFullscreen(entry)}
              >
                <div className="relative w-full aspect-video bg-black">
                  <video
                    src={entry.url}
                    className="w-full h-full object-contain"
                    preload="metadata"
                    loop
                    muted
                    playsInline
                    onMouseOver={(event) => event.currentTarget.play().catch(() => {})}
                    onMouseOut={(event) => {
                      event.currentTarget.pause();
                      event.currentTarget.currentTime = 0;
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="w-11 h-11 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white group-hover:opacity-0 transition-opacity">
                      <PlayIcon size={16} />
                    </span>
                  </div>
                </div>

                <div className="absolute top-2 right-2 hidden md:flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GenerationCopyButtons prompt={entry.prompt} onCopyError={onGenerationError} />
                  <button
                    type="button"
                    title={copy.actions.download}
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadFile(entry.url, `clip-${entry.id}.mp4`);
                    }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    type="button"
                    title={copy.actions.delete}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteEntry(entry.id);
                    }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-full text-red-400 hover:bg-red-500 hover:text-white transition-all border border-white/10"
                  >
                    <TrashIcon />
                  </button>
                </div>
                <MobileGenerationActions
                  prompt={entry.prompt}
                  onCopyError={onGenerationError}
                  actions={[
                    {
                      kind: "download",
                      label: copy.actions.download,
                      onSelect: () => downloadFile(entry.url, `clip-${entry.id}.mp4`),
                    },
                    {
                      kind: "delete",
                      label: copy.actions.delete,
                      danger: true,
                      onSelect: () => deleteEntry(entry.id),
                    },
                  ]}
                />

                <div className="p-3 bg-black/80 backdrop-blur-sm border-t border-white/5 flex-1 flex flex-col justify-between gap-2">
                  {entry.prompt && (
                    <p className="text-white/70 text-xs line-clamp-2 leading-relaxed" title={entry.prompt}>
                      {entry.prompt}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded border border-primary/20 whitespace-nowrap">
                      {entry.modelName || entry.model}
                    </span>
                    <span className="text-[10px] text-white/40">{fill(copy.status.sources, { count: entry.sourceCount || 1 })}</span>
                    {entry.aspect_ratio && <span className="text-[10px] text-white/40">{entry.aspect_ratio}</span>}
                    {entry.duration && <span className="text-[10px] text-white/40">{fill(copy.options.seconds, { n: entry.duration })}</span>}
                    {(entry.files || []).map((fileUrl, index) => (
                      <button
                        key={fileUrl}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const ext = fileUrl.split("?")[0].split(".").pop() || "srt";
                          downloadFile(fileUrl, `clip-${entry.id}-${index + 1}.${ext.length <= 4 ? ext : "srt"}`);
                        }}
                        className="text-[10px] text-white/60 hover:text-primary underline underline-offset-2"
                      >
                        {copy.actions.subtitles}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full w-full">
            <StudioEmptyState heading={copy.hero.titleLine1} accent={copy.hero.titleLine2} subtitle={copy.hero.subtitle} showcase="video" />
          </div>
        )}
      </div>

      {/* ── PROMPT BAR ── */}
      <PromptComposer>
        <div className="flex items-start gap-2 px-1">
          <div className="flex items-center gap-2 flex-wrap max-w-[50%]">
            {sources.map((source, index) => (
              <div key={`${source.url}-${index}`} className="relative inline-flex group/media">
                <div
                  className={promptMediaButtonClassName({ active: true })}
                  title={source.name || source.url}
                >
                  <video src={source.url} className="w-full h-full object-cover" muted preload="metadata" />
                </div>
                <button
                  type="button"
                  title={copy.media.remove}
                  onClick={() => setSources((previous) => previous.filter((_, i) => i !== index))}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-black/80 hover:bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] border border-white/20 transition-all z-20 shadow-md opacity-80 sm:opacity-0 sm:group-hover/media:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}

            {(canAddMore || isUploading) && (
              <div className="relative inline-flex">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple={maxVideos > 1}
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    handleUpload(files);
                  }}
                />
                <button
                  type="button"
                  disabled={isUploading}
                  title={maxVideos > 1 ? copy.media.addVideos : copy.media.addVideo}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleUpload(event.dataTransfer?.files);
                  }}
                  className={promptMediaButtonClassName({ active: false })}
                >
                  {isUploading ? (
                    <span className="flex flex-col items-center justify-center w-full h-full bg-black/80 text-[9px] font-black text-primary leading-tight">
                      <span>{uploading.progress}%</span>
                      {uploading.total > 1 && <span className="text-white/40">{uploading.done + 1}/{uploading.total}</span>}
                    </span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40 group-hover:text-[#22d3ee] transition-colors" aria-hidden="true">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {selectedModel?.hasPrompt ? (
              <PromptTextarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={copy.prompt.placeholder}
              />
            ) : (
              <p className="text-white/40 text-sm py-2">{copy.prompt.noPromptModel}</p>
            )}
            <span className="text-[10px] text-white/30 px-1">
              {sources.length > 0
                ? fill(copy.media.sourceCount, { count: sources.length, max: maxVideos })
                : copy.media.noSources}
            </span>
          </div>
        </div>

        <PromptFooter>
          <PromptControls>
            {CLIPPING_MODELS.length > 1 && (
              <OptionDropdown
                id="model"
                openId={openDropdown}
                setOpenId={setOpenDropdown}
                icon={<span className="w-3.5 h-3.5 bg-[#22d3ee] rounded-sm flex items-center justify-center text-black"><ScissorsIcon className="w-2.5 h-2.5" /></span>}
                label={selectedModel?.name || copy.options.model}
                title={copy.options.model}
                items={modelItems}
                selectedId={selectedModelId}
                onSelect={handleModelSelect}
                className="w-80 max-w-[calc(100vw-3rem)]"
              />
            )}
            {inputs.aspect_ratio && (
              <OptionDropdown
                id="aspect"
                openId={openDropdown}
                setOpenId={setOpenDropdown}
                icon={<PromptAspectRatioIcon />}
                label={options.aspect_ratio || copy.options.auto}
                title={copy.options.aspectRatio}
                items={aspectItems}
                selectedId={options.aspect_ratio ?? ""}
                onSelect={(value) => setOption("aspect_ratio", value)}
              />
            )}
            {inputs.duration && (
              <OptionDropdown
                id="duration"
                openId={openDropdown}
                setOpenId={setOpenDropdown}
                icon={<PromptDurationIcon />}
                label={options.duration ? fill(copy.options.seconds, { n: options.duration }) : copy.options.auto}
                title={copy.options.length}
                items={lengthItems}
                selectedId={options.duration ?? ""}
                onSelect={(value) => setOption("duration", value)}
              />
            )}
            {inputs.caption_style && (
              <OptionDropdown
                id="captions"
                openId={openDropdown}
                setOpenId={setOpenDropdown}
                icon={<CaptionIcon />}
                label={copy.captionStyles[options.caption_style] || options.caption_style}
                title={copy.options.captions}
                items={captionItems}
                selectedId={options.caption_style}
                onSelect={(value) => setOption("caption_style", value)}
              />
            )}
            {inputs.language && (
              <OptionDropdown
                id="language"
                openId={openDropdown}
                setOpenId={setOpenDropdown}
                icon={<GlobeIcon />}
                label={copy.languages[options.language] || options.language}
                title={copy.options.language}
                items={languageItems}
                selectedId={options.language}
                onSelect={(value) => setOption("language", value)}
                className="max-h-80 overflow-y-auto"
              />
            )}
          </PromptControls>

<PromptActionGroup>
<PriceChip locale={locale} endpoint={selectedModel.endpoint || selectedModel.id} payload={options} />
          <PromptAction onClick={handleGenerate} disabled={isUploading || !selectedModel}>
            {pending.length > 0 ? (
              <>
                <span className="animate-spin inline-block text-black">◌</span> {copy.actions.generating}
              </>
            ) : (
              <span>{copy.actions.generate}</span>
            )}
          </PromptAction>
</PromptActionGroup>
        </PromptFooter>
      </PromptComposer>

      {/* ── FULLSCREEN PLAYER ── */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/95 backdrop-blur-sm animate-fade-in"
          onClick={() => setFullscreen(null)}
        >
          <button
            type="button"
            title={copy.actions.close}
            className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors border border-white/10"
            onClick={(event) => {
              event.stopPropagation();
              setFullscreen(null);
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <video
            src={fullscreen.url}
            controls
            autoPlay
            className="max-w-[95vw] max-h-[85vh] rounded-2xl shadow-2xl object-contain animate-scale-up"
            onClick={(event) => event.stopPropagation()}
          />
          <div className="flex items-center gap-3" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => downloadFile(fullscreen.url, `clip-${fullscreen.id}.mp4`)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-black text-sm font-bold hover:opacity-90 transition-opacity"
            >
              <DownloadIcon /> {copy.actions.download}
            </button>
            <button
              type="button"
              onClick={() => deleteEntry(fullscreen.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-red-300 text-sm font-bold hover:bg-red-500 hover:text-white transition-colors border border-white/10"
            >
              <TrashIcon /> {copy.actions.delete}
            </button>
          </div>
        </div>
      )}
      <Toaster position="top-right" containerStyle={{ zIndex: 99999 }} toastOptions={{ duration: 5000, style: { background: '#18181b', color: '#ffffff', border: '1px solid rgba(255,255,255,0.15)', fontSize: '13px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', maxWidth: '440px', wordBreak: 'break-word', whiteSpace: 'pre-wrap', padding: '12px 16px' } }} />
    </div>
  );
}
