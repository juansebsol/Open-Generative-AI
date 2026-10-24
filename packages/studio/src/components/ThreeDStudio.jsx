"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import toast, { Toaster } from "react-hot-toast";
import { IconCube, IconDownload, IconMaximize, IconPhotoPlus, IconTrash, IconX } from "@tabler/icons-react";
import { generateThreeD, uploadFile } from "../generation.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { threeDModels } from "../models.js";
import { getRoutes } from "../providers/catalog/index.js";
import { isEndpointAvailable } from "../providers/client.js";
import { getProvider } from "../providers/directProviders.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { vendorById } from "../vendors.js";
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
  PromptSegmentedControl,
  PromptSegmentOption,
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
} from "./prompt/PromptComposer.jsx";
import StudioEmptyState from "./StudioEmptyState.jsx";
import en from "../messages/en/threeDStudio.json";
import zh from "../messages/zh/threeDStudio.json";
import { resolveCopy } from "../i18nUtils";

// Text, image or multi-view to a textured mesh. Models are the threeDModels
// catalog list; entries in the same family are one model with text/image
// variants, and the picker chooses the variant from the active mode.

const PERSIST_KEY = "hg_three_d_studio_persistent";
const HISTORY_LIMIT = 40;
const MODEL_FILE = /\.(glb|gltf|obj|fbx|usdz|stl|ply)(\?|$)/i;
const VIEWABLE = /\.(glb|gltf)(\?|$)/i;

const FAMILIES = (() => {
  const map = new Map();
  for (const model of threeDModels) {
    const family = map.get(model.family) || { id: model.family, name: model.name.replace(/ Multi-view$/, ""), vendor: vendorById(model.provider), variants: {} };
    family.variants[model.mode] = model;
    map.set(model.family, family);
  }
  return [...map.values()];
})();

const isImageFile = (file) => Boolean(file?.type?.startsWith("image/"));
const fill = (template, values) => String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const fileExt = (url) => (String(url).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || "file").toUpperCase();

function variantFor(family, mode, imageCount) {
  if (!family) return null;
  if (mode === "text") return family.variants.text || null;
  if (imageCount > 1 && family.variants.multi) return family.variants.multi;
  return family.variants.image || family.variants.multi || null;
}

function defaultOptions(model) {
  const options = {};
  for (const [key, input] of Object.entries(model?.inputs || {})) {
    if (input.default !== undefined) options[key] = input.default;
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

export default function ThreeDStudio({ onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled, locale = "en" }) {
  const copy = resolveCopy(en, zh, locale);
  const [mode, setMode] = useState("text");
  const [familyId, setFamilyId] = useState(FAMILIES[0]?.id || "");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState([]); // [{ url, name }]
  const [uploading, setUploading] = useState(null);
  const [options, setOptions] = useState({});
  const [history, setHistory] = useState([]);
  const [pending, setPending] = useState([]);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [providerReady, setProviderReady] = useState(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const hasRestored = useRef(false);

  const family = FAMILIES.find((entry) => entry.id === familyId) || FAMILIES[0];
  const selectedModel = variantFor(family, mode, images.length);
  const maxImages = family?.variants.multi ? (family.variants.multi.maxImages || 4) : 1;
  const familiesForMode = FAMILIES.filter((entry) => (mode === "text" ? entry.variants.text : entry.variants.image || entry.variants.multi));

  // Keep a family that exists in the current mode.
  useEffect(() => {
    if (!familiesForMode.some((entry) => entry.id === family?.id) && familiesForMode[0]) setFamilyId(familiesForMode[0].id);
  }, [mode, family?.id, familiesForMode]);

  // Options follow the selected variant; compatible values survive a switch.
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

  // Provider availability for the selected variant.
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

  // Persistence
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      if (data) {
        if (data.mode === "image" || data.mode === "text") setMode(data.mode);
        if (FAMILIES.some((entry) => entry.id === data.familyId)) setFamilyId(data.familyId);
        if (typeof data.prompt === "string") setPrompt(data.prompt);
        if (Array.isArray(data.images)) setImages(data.images.filter((image) => typeof image?.url === "string"));
        if (data.options && typeof data.options === "object") setOptions(data.options);
        if (Array.isArray(data.history)) setHistory(data.history.filter((entry) => entry?.id && typeof entry.url === "string"));
      }
    } catch (error) {
      console.warn("[ThreeDStudio] could not restore state", error);
    } finally {
      hasRestored.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasRestored.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ mode, familyId, prompt, images, options, history: history.slice(0, HISTORY_LIMIT) }));
      } catch (error) {
        console.warn("[ThreeDStudio] could not save state", error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [mode, familyId, prompt, images, options, history]);

  // Uploads
  const handleUpload = useCallback(async (fileList) => {
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
    setMode("image");
  }, [copy, images.length, maxImages]);

  useEffect(() => {
    if (!droppedFiles?.length) return;
    const files = droppedFiles.filter(isImageFile);
    if (files.length > 0) handleUpload(files);
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled, handleUpload]);

  // Generation
  const handleGenerate = async () => {
    if (!selectedModel) return;
    if (!providerReady) {
      openProviderSettings();
      return;
    }
    if (mode === "text" && !prompt.trim()) {
      toast.error(copy.errors.needPrompt);
      textareaRef.current?.focus();
      return;
    }
    if (mode === "image" && images.length === 0) {
      toast.error(copy.errors.needImage);
      return;
    }
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runPrompt = mode === "text" ? prompt.trim() : "";
    const payload = { model: selectedModel.id, ...options };
    if (mode === "text") payload.prompt = runPrompt;
    else if (selectedModel.imageField === "images_list") payload.images_list = images.map((image) => image.url);
    else payload.image_url = images[0].url;

    setPending((previous) => [{ id: runId, label: family.name, prompt: runPrompt, thumbnail: images[0]?.url }, ...previous]);
    onGenerationStart?.();
    try {
      const result = await generateThreeD(payload);
      const media = result?.media?.length ? result.media : (result?.outputs || []).map((url) => ({ url, type: MODEL_FILE.test(url) ? "model" : "file" }));
      const files = media.filter((item) => item.type === "model" || MODEL_FILE.test(item.url));
      if (files.length === 0) throw new Error(copy.errors.noModel);
      const viewable = files.find((item) => VIEWABLE.test(item.url)) || files[0];
      const thumbnail = media.find((item) => item.type === "image")?.url || images[0]?.url || null;
      const entry = {
        id: result.id || runId,
        url: viewable.url,
        files: files.map((item) => ({ url: item.url, ext: fileExt(item.url) })),
        thumbnail,
        prompt: runPrompt,
        model: selectedModel.id,
        modelName: family.name,
        vendor: family.vendor.name,
        mode,
        timestamp: new Date().toISOString(),
      };
      setHistory((previous) => [entry, ...previous].slice(0, HISTORY_LIMIT));
      onGenerationComplete?.({ url: entry.url, model: selectedModel.id, prompt: runPrompt, type: "3d" });
    } catch (error) {
      console.error("[ThreeDStudio]", error);
      const message = formatErrorMessage(error, copy.errors.generationFailed);
      if (onGenerationError) onGenerationError(message);
      else toast.error(message);
    } finally {
      setPending((previous) => previous.filter((run) => run.id !== runId));
      onGenerationEnd?.();
    }
  };

  const download = async (url, name) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  const deleteEntry = (id) => {
    if (!confirm(copy.confirm.deleteItem)) return;
    setHistory((previous) => previous.filter((entry) => entry.id !== id));
    if (viewer?.id === id) setViewer(null);
  };

  const setOption = (key, value) => setOptions((previous) => ({ ...previous, [key]: value }));
  const inputs = selectedModel?.inputs || {};
  const enumOptions = Object.entries(inputs).filter(([, input]) => Array.isArray(input.enum));
  const boolOptions = Object.entries(inputs).filter(([, input]) => input.type === "boolean");
  const hasGallery = history.length > 0 || pending.length > 0;
  const starters = (copy.empty.starters || []).map((starter) => ({ label: starter.label, prompt: starter.prompt }));

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative overflow-hidden">
      <Toaster position="top-center" toastOptions={{ style: { background: "#111114", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: "13px" } }} />

      {providerReady === false && (
        <div className="absolute top-4 left-1/2 z-40 w-[min(640px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-100 flex items-center justify-between gap-4">
          <span>{fill(copy.providers.needKey, { providers: providersText })}</span>
          <button type="button" onClick={openProviderSettings} className="shrink-0 rounded-lg bg-amber-300 px-3 py-1.5 text-[12px] font-semibold text-black">{copy.providers.openSettings}</button>
        </div>
      )}

      <div className="flex-1 w-full overflow-y-auto custom-scrollbar pb-56 pt-4 px-4 md:px-8">
        {hasGallery ? (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((run) => (
              <div key={run.id} className="aspect-square rounded-2xl border border-white/[0.08] bg-[#0e0e11] flex flex-col items-center justify-center gap-3 text-center p-6">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
                <div className="text-[14px] font-medium text-white/85">{fill(copy.gallery.pendingTitle, { model: run.label })}</div>
                <div className="text-[12px] text-white/45">{copy.gallery.pendingHint}</div>
              </div>
            ))}
            {history.map((entry) => (
              <div key={entry.id} className="group relative aspect-square overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e0e11]">
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
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" title={copy.gallery.fullscreen} aria-label={copy.gallery.fullscreen} onClick={() => setViewer(entry)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-primary hover:text-black"><IconMaximize size={15} stroke={1.75} aria-hidden="true" /></button>
                  <div className="relative">
                    <button type="button" title={copy.gallery.download} aria-label={copy.gallery.download} onClick={() => setOpenDropdown(openDropdown === `dl-${entry.id}` ? null : `dl-${entry.id}`)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-primary hover:text-black"><IconDownload size={15} stroke={1.75} aria-hidden="true" /></button>
                    {openDropdown === `dl-${entry.id}` && (
                      <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-[10px] border border-white/[0.12] bg-[#111114] p-1 shadow-xl">
                        {entry.files.map((file) => (
                          <button key={file.url} type="button" onClick={() => { download(file.url, `openstudio-${entry.id}.${file.ext.toLowerCase()}`); setOpenDropdown(null); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-white/85 hover:bg-white/[0.06]">
                            <span>{file.ext}</span><IconDownload size={13} stroke={1.75} className="text-white/40" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" title={copy.gallery.delete} aria-label={copy.gallery.delete} onClick={() => deleteEntry(entry.id)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-red-300 hover:bg-red-500 hover:text-white"><IconTrash size={15} stroke={1.75} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full w-full animate-fade-in-up">
            <StudioEmptyState heading={copy.empty.heading} accent={family?.name || copy.empty.accent} subtitle={copy.empty.subtitle} starters={starters} onStarter={(text) => { setMode("text"); setPrompt(text); textareaRef.current?.focus(); }} showcase={null} />
          </div>
        )}
      </div>

      {viewer && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onClick={() => setViewer(null)} role="presentation">
          <div className="relative h-[min(80vh,900px)] w-[min(90vw,1100px)] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0e0e11]" onClick={(event) => event.stopPropagation()} role="presentation">
            <ModelView src={viewer.url} poster={viewer.thumbnail} interactive className="h-full w-full" />
            <button type="button" onClick={() => setViewer(null)} aria-label={copy.gallery.close} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-white/20"><IconX size={16} stroke={1.75} aria-hidden="true" /></button>
            <div className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-3 py-1.5 text-[12px] text-white/80">{viewer.prompt || viewer.modelName}</div>
          </div>
        </div>
      )}

      <PromptComposer>
        <div className="flex items-start gap-2 px-1">
          {mode === "image" && (
            <div className="flex items-center gap-2 flex-wrap">
              {images.map((image, index) => (
                <div key={image.url} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setImages((previous) => previous.filter((_, i) => i !== index))} aria-label={copy.media.remove} className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 hover:opacity-100"><IconX size={14} stroke={2} aria-hidden="true" /></button>
                </div>
              ))}
              {(images.length < maxImages || maxImages === 1) && (
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)} title={fill(copy.media.addImages, { max: maxImages })} className={promptMediaButtonClassName()}>
                  {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconPhotoPlus size={16} stroke={1.75} className="text-white/60" aria-hidden="true" />}
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" multiple={maxImages > 1} className="hidden" onChange={(event) => { handleUpload(event.target.files); event.target.value = ""; }} />
            </div>
          )}
          {mode === "text"
            ? <PromptTextarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={copy.prompt.placeholder} />
            : <p className="flex-1 px-1.5 pt-2.5 text-[13.5px] text-white/40">{images.length ? fill(copy.prompt.imageHint, { count: images.length, max: maxImages }) : copy.prompt.imageEmpty}</p>}
        </div>

        <PromptFooter>
          <PromptControls>
            <PromptSegmentedControl>
              <PromptSegmentOption selected={mode === "text"} onClick={() => setMode("text")}>{copy.modes.text}</PromptSegmentOption>
              <PromptSegmentOption selected={mode === "image"} onClick={() => setMode("image")}>{copy.modes.image}</PromptSegmentOption>
            </PromptSegmentedControl>

            <div className="relative">
              <button type="button" onClick={() => setOpenDropdown(openDropdown === "model" ? null : "model")} className={promptControlClassName({ active: openDropdown === "model" })}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-[9px] font-semibold ${family?.vendor.color || "text-primary"}`}>{family?.vendor.mono}</span>
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{family?.name}</span>
                <PromptChevronIcon />
              </button>
              {openDropdown === "model" && (
                <PromptPopover className="w-[320px]">
                  <PromptPopoverHeader>{copy.controls.model}</PromptPopoverHeader>
                  <PromptMenuList>
                    {familiesForMode.map((entry) => (
                      <PromptMenuItem key={entry.id} selected={entry.id === family?.id} description={variantFor(entry, mode, images.length)?.description} wrapDescription onClick={() => { setFamilyId(entry.id); setOpenDropdown(null); }}>
                        {entry.name} <span className="text-white/40">· {entry.vendor.name}</span>
                      </PromptMenuItem>
                    ))}
                  </PromptMenuList>
                </PromptPopover>
              )}
            </div>

            {enumOptions.map(([key, input]) => (
              <div key={key} className="relative">
                <button type="button" onClick={() => setOpenDropdown(openDropdown === key ? null : key)} className={promptControlClassName({ active: openDropdown === key })}>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{String(options[key] ?? input.default ?? input.title)}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === key && (
                  <PromptPopover>
                    <PromptPopoverHeader>{input.title}</PromptPopoverHeader>
                    <PromptMenuList>
                      {input.enum.map((value) => (
                        <PromptMenuItem key={String(value)} selected={options[key] === value} onClick={() => { setOption(key, value); setOpenDropdown(null); }}>{String(value)}</PromptMenuItem>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            ))}

            {boolOptions.map(([key, input]) => (
              <button key={key} type="button" aria-pressed={Boolean(options[key])} onClick={() => setOption(key, !options[key])} className={promptControlClassName({ active: Boolean(options[key]) })} title={input.description || input.title}>
                <span className={`h-1.5 w-1.5 rounded-full ${options[key] ? "bg-primary" : "bg-white/25"}`} aria-hidden="true" />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{input.title}</span>
              </button>
            ))}
          </PromptControls>

          <PromptAction onClick={handleGenerate} disabled={Boolean(uploading) || !selectedModel}>
            {copy.buttons.generate}
          </PromptAction>
        </PromptFooter>
      </PromptComposer>
    </div>
  );
}
