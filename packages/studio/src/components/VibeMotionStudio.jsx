"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import toast, { Toaster } from "react-hot-toast";
import { chatComplete, hasChatProvider, ChatSetupError, CHAT_PROVIDER_IDS } from "../providers/chat.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { saveLocalBlob } from "../providers/mediaStore.js";
import { formatErrorMessage } from "../utils/formatError.js";
import {
  ASPECT_RATIOS,
  STYLE_IDS,
  MIN_DURATION,
  MAX_DURATION,
  DEFAULT_DURATION,
  FRAME_MESSAGE_SOURCE,
  HOST_MESSAGE_SOURCE,
  clampDuration,
  frameSize,
  buildGenerateMessages,
  buildEditMessages,
  extractHtml,
  extractTitle,
  prepareDocument,
} from "../vibeMotion.js";
import StudioEmptyState from "./StudioEmptyState.jsx";
import MobileGenerationActions, { GenerationCopyButtons } from "./MobileGenerationActions.jsx";
import {
  PROMPT_CONTROL_LABEL_CLASS,
  PROMPT_MEDIA_PREVIEW_CLASS,
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
} from "./prompt/PromptComposer.jsx";
import en from "../messages/en/vibeMotionStudio.json";
import zh from "../messages/zh/vibeMotionStudio.json";
import { resolveCopy } from "../i18nUtils";

const PERSIST_KEY = "hg_vibe_motion_studio_persistent";
const MAX_VERSIONS = 30;
const MAX_EXPORTS = 40;
const MAX_IMAGE_SIDE = 1280;
const DURATIONS = Array.from({ length: MAX_DURATION - MIN_DURATION + 1 }, (_, i) => MIN_DURATION + i);

// ── helpers ─────────────────────────────────────────────────────────────────
function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveAs(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function slug(text) {
  return String(text || "vibe-motion").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "vibe-motion";
}

const extensionOf = (mimeType) => (String(mimeType).includes("mp4") ? "mp4" : "webm");
const formatSeconds = (t) => `${Math.max(0, t).toFixed(1)}s`;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Downscales an attached image so it stays small inside the frame document.
async function readImageFile(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 512) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 512) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    const keepAlpha = /png|svg|gif|webp/i.test(file.type);
    const type = keepAlpha ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (!blob) throw new Error("Could not read the image");
    return { blob, dataUrl: canvas.toDataURL(type, 0.9), width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// ── icons ───────────────────────────────────────────────────────────────────
const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
);
const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
);
const RestartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
  </svg>
);
const DownloadIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);
const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  </svg>
);
const FilmIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5" />
  </svg>
);
const SparkIcon = ({ className = "" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </svg>
);
const ImageIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40 group-hover:text-[#22d3ee] transition-colors" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
);

// ── popover wrapper that closes on outside click ────────────────────────────
function ControlPopover({ open, title, onClose, anchorRef, className = "", children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      if (!ref.current?.contains(event.target) && !anchorRef?.current?.contains(event.target)) onClose();
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return (
    <PromptPopover ref={ref} className={className} onClick={(event) => event.stopPropagation()}>
      <PromptPopoverHeader>{title}</PromptPopoverHeader>
      {children}
    </PromptPopover>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function VibeMotionStudio({
  locale = "en",
  droppedFiles,
  onFilesHandled,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const copy = resolveCopy(en, zh, locale);

  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [style, setStyle] = useState("bold");
  const [image, setImage] = useState(null); // { url, width, height, name }
  const [versions, setVersions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [exportsList, setExportsList] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exporting, setExporting] = useState(null); // { progress, versionId }
  const [frame, setFrame] = useState(null); // { key, srcdoc }
  const [playback, setPlayback] = useState({ t: 0, playing: true });
  const [frameError, setFrameError] = useState(null);
  const [showCode, setShowCode] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [hasChat, setHasChat] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [fullscreenUrl, setFullscreenUrl] = useState(null);

  const rootRef = useRef(null);
  const iframeRef = useRef(null);
  const fileInputRef = useRef(null);
  const aspectBtnRef = useRef(null);
  const durationBtnRef = useRef(null);
  const styleBtnRef = useRef(null);
  const imageCache = useRef(new Map()); // local url -> data URL
  const exportTimer = useRef(null);
  const messageHandlers = useRef({});

  const activeVersion = versions.find((v) => v.id === activeId) || null;
  const isEditing = Boolean(activeVersion);

  // ── chat provider availability ───────────────────────────────────────────
  useEffect(() => {
    const sync = () => setHasChat(hasChatProvider());
    sync();
    return subscribeProviderSettings(sync);
  }, []);

  const openProviderSettings = () => {
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers: CHAT_PROVIDER_IDS } }));
  };

  // ── persistence ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      if (data) {
        if (ASPECT_RATIOS[data.aspect]) setAspect(data.aspect);
        if (data.duration) setDuration(clampDuration(data.duration));
        if (STYLE_IDS.includes(data.style)) setStyle(data.style);
        if (Array.isArray(data.versions)) setVersions(data.versions);
        if (Array.isArray(data.exports)) setExportsList(data.exports);
        if (data.image?.url) setImage(data.image);
        if (data.activeId) setActiveId(data.activeId);
      }
    } catch (error) {
      console.warn("Failed to load VibeMotionStudio persistence:", error);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return undefined;
    const timer = setTimeout(() => {
      // blob: URLs die with the page, so only local (/oga-media) URLs are kept.
      const keepUrl = (url) => typeof url === "string" && !url.startsWith("blob:");
      const keepImage = (img) => (img && keepUrl(img.url) ? img : null);
      const state = (list) => ({
        aspect,
        duration,
        style,
        activeId,
        image: keepImage(image),
        versions: list.map((v) => ({ ...v, image: keepImage(v.image) })),
        exports: exportsList.filter((entry) => keepUrl(entry.url)),
      });
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify(state(versions)));
      } catch {
        try {
          localStorage.setItem(PERSIST_KEY, JSON.stringify(state(versions.slice(0, 8))));
        } catch (error) {
          console.warn("Failed to save VibeMotionStudio persistence:", error);
        }
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [loaded, aspect, duration, style, activeId, image, versions, exportsList]);

  // ── preview frame ────────────────────────────────────────────────────────
  const imageDataFor = useCallback(async (url) => {
    if (imageCache.current.has(url)) return imageCache.current.get(url);
    if (!url.startsWith("/oga-media/")) throw new Error("Image is no longer available");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Image is no longer available");
    const dataUrl = await blobToDataUrl(await response.blob());
    imageCache.current.set(url, dataUrl);
    return dataUrl;
  }, []);

  const loadFrame = useCallback(async (version, autoExport = false) => {
    if (!version) {
      setFrame(null);
      return;
    }
    let imageDataUrl = null;
    if (version.image?.url) {
      try {
        imageDataUrl = await imageDataFor(version.image.url);
      } catch {
        // Render without the image; the animation checks for it.
      }
    }
    setFrameError(null);
    setPlayback({ t: 0, playing: true });
    setFrame({
      key: `${version.id}-${Date.now()}`,
      srcdoc: prepareDocument(version.html, { aspect: version.aspect, duration: version.duration, imageDataUrl, autoExport }),
    });
  }, [imageDataFor]);

  useEffect(() => {
    if (!loaded) return;
    loadFrame(versions.find((v) => v.id === activeId) || null);
    // Reload only when the selected version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeId]);

  const postToFrame = (message) => {
    iframeRef.current?.contentWindow?.postMessage({ ...message, source: HOST_MESSAGE_SOURCE }, "*");
  };

  // ── generation ───────────────────────────────────────────────────────────
  const runGeneration = async (text, base) => {
    const instruction = text.trim();
    if (!instruction || isGenerating) return;
    if (!hasChatProvider()) {
      setHasChat(false);
      openProviderSettings();
      return;
    }
    const imageInfo = image ? { width: image.width, height: image.height } : null;
    setIsGenerating(true);
    onGenerationStart?.();
    try {
      const messages = base
        ? buildEditMessages({
          html: base.html,
          instruction,
          aspect,
          duration,
          style,
          image: imageInfo,
          formatChanged: base.aspect !== aspect || base.duration !== clampDuration(duration),
        })
        : buildGenerateMessages({ prompt: instruction, aspect, duration, style, image: imageInfo });
      const reply = await chatComplete({ messages });
      const html = extractHtml(reply?.content);
      const version = {
        id: newId(),
        number: versions.reduce((max, v) => Math.max(max, v.number || 0), 0) + 1,
        parentId: base?.id || null,
        title: extractTitle(html, instruction.slice(0, 48)),
        prompt: instruction,
        html,
        aspect,
        duration: clampDuration(duration),
        style,
        image: image ? { url: image.url, width: image.width, height: image.height, name: image.name } : null,
        createdAt: Date.now(),
      };
      setVersions((prev) => [version, ...prev].slice(0, MAX_VERSIONS));
      setActiveId(version.id);
      setPrompt("");
      setShowCode(false);
      onGenerationComplete?.({ url: null, type: "motion", prompt: instruction, model: "vibe-motion" });
    } catch (error) {
      console.error("[VibeMotionStudio]", error);
      if (error instanceof ChatSetupError) {
        setHasChat(false);
      } else {
        const message = formatErrorMessage(error, copy.errors.generationFailed);
        if (onGenerationError) onGenerationError(message);
        else toast.error(message);
      }
    } finally {
      setIsGenerating(false);
      onGenerationEnd?.();
    }
  };

  const handleSubmit = () => runGeneration(prompt, activeVersion);

  const handleFix = () => {
    if (!activeVersion || !frameError) return;
    runGeneration(copy.fix.instruction.replace("{error}", frameError), activeVersion);
  };

  const selectVersion = (version) => {
    if (exporting) return;
    setActiveId(version.id);
    setAspect(version.aspect);
    setDuration(version.duration);
    setStyle(version.style);
    setImage(version.image || null);
    setShowCode(false);
  };

  const startNew = () => {
    if (exporting) return;
    setActiveId(null);
    setShowCode(false);
  };

  const deleteVersion = (version) => {
    if (exporting || !confirm(copy.confirm.deleteVersion)) return;
    setVersions((prev) => prev.filter((v) => v.id !== version.id));
    if (version.id === activeId) setActiveId(null);
  };

  // ── image attachment ─────────────────────────────────────────────────────
  const attachImage = useCallback(async (file) => {
    if (!file || !file.type?.startsWith("image/")) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error(copy.image.tooLarge);
      return;
    }
    try {
      const { blob, dataUrl, width, height } = await readImageFile(file);
      const url = await saveLocalBlob(blob, { name: file.name });
      imageCache.current.set(url, dataUrl);
      setImage({ url, width, height, name: file.name });
    } catch (error) {
      toast.error(copy.image.readFailed.replace("{message}", error.message));
    }
  }, [copy.image.readFailed, copy.image.tooLarge]);

  useEffect(() => {
    if (!droppedFiles?.length) return;
    // The shell hands drops to every studio; only take them while visible.
    if (rootRef.current?.offsetParent === null) return;
    const file = droppedFiles.find((f) => f.type?.startsWith("image/"));
    if (file) attachImage(file);
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled, attachImage]);

  // ── export ───────────────────────────────────────────────────────────────
  const finishExport = () => {
    clearTimeout(exportTimer.current);
    setExporting(null);
    onGenerationEnd?.();
  };

  const failExport = (message) => {
    finishExport();
    if (onGenerationError) onGenerationError(message);
    else toast.error(message);
  };

  const handleExport = () => {
    if (!activeVersion || exporting) return;
    setExporting({ progress: 0, versionId: activeVersion.id });
    onGenerationStart?.();
    loadFrame(activeVersion, true);
    clearTimeout(exportTimer.current);
    exportTimer.current = setTimeout(
      () => failExport(copy.errors.exportTimeout),
      (activeVersion.duration + 45) * 1000,
    );
  };

  const handleExported = async (blob, mimeType) => {
    const version = versions.find((v) => v.id === exporting?.versionId) || activeVersion;
    if (!blob || typeof blob.size !== "number" || blob.size === 0) {
      failExport(copy.errors.exportEmpty);
      return;
    }
    try {
      const url = await saveLocalBlob(blob, { name: `${slug(version?.title)}.${extensionOf(mimeType)}` });
      const entry = {
        id: newId(),
        url,
        mimeType,
        title: version?.title || "",
        prompt: version?.prompt || "",
        aspect: version?.aspect || aspect,
        duration: version?.duration || duration,
        versionNumber: version?.number || null,
        createdAt: Date.now(),
      };
      setExportsList((prev) => [entry, ...prev].slice(0, MAX_EXPORTS));
      finishExport();
      toast.success(copy.toasts.exported);
      onGenerationComplete?.({ url, type: "video", prompt: entry.prompt, model: "vibe-motion" });
    } catch (error) {
      failExport(formatErrorMessage(error, copy.errors.exportFailed));
    }
  };

  useEffect(() => () => clearTimeout(exportTimer.current), []);

  // Messages from the sandboxed frame (opaque origin, so match the window).
  messageHandlers.current = { handleExported, failExport };
  useEffect(() => {
    const onMessage = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== FRAME_MESSAGE_SOURCE) return;
      if (data.type === "time") setPlayback({ t: Number(data.t) || 0, playing: Boolean(data.playing) });
      else if (data.type === "error") setFrameError(String(data.message || "").slice(0, 500));
      else if (data.type === "export-progress") setExporting((prev) => (prev ? { ...prev, progress: Number(data.progress) || 0 } : prev));
      else if (data.type === "export-error") messageHandlers.current.failExport(String(data.message || copy.errors.exportFailed));
      else if (data.type === "exported") messageHandlers.current.handleExported(data.blob, String(data.mimeType || "video/webm"));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [copy.errors.exportFailed]);

  // ── downloads ────────────────────────────────────────────────────────────
  const downloadHtml = async () => {
    if (!activeVersion) return;
    let imageDataUrl = null;
    if (activeVersion.image?.url) imageDataUrl = await imageDataFor(activeVersion.image.url).catch(() => null);
    const doc = prepareDocument(activeVersion.html, { aspect: activeVersion.aspect, duration: activeVersion.duration, imageDataUrl });
    const href = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
    saveAs(href, `${slug(activeVersion.title)}.html`);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const downloadExport = (entry) => saveAs(entry.url, `${slug(entry.title)}-${entry.id.slice(0, 6)}.${extensionOf(entry.mimeType)}`);

  const deleteExport = (entry) => {
    if (!confirm(copy.confirm.deleteExport)) return;
    setExportsList((prev) => prev.filter((item) => item.id !== entry.id));
  };

  // ── derived UI values ────────────────────────────────────────────────────
  const previewAspect = activeVersion?.aspect || aspect;
  const previewSize = frameSize(previewAspect);
  const previewDuration = activeVersion?.duration || duration;
  const progressPct = Math.min(100, (playback.t / previewDuration) * 100);
  const canSubmit = prompt.trim().length > 0 && !isGenerating && !exporting;

  const handleScrub = (event) => {
    if (exporting) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * previewDuration;
    postToFrame({ type: "seek", t });
  };

  const toggleMenu = (name) => (event) => {
    event.stopPropagation();
    setOpenMenu((current) => (current === name ? null : name));
  };
  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const examples = copy.examples || [];

  return (
    <div ref={rootRef} className="w-full h-full flex flex-col items-center bg-app-bg relative overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          attachImage(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {/* ── MAIN AREA ── */}
      <div className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto custom-scrollbar pb-56 lg:pb-48 px-3 sm:px-4">
        {!hasChat && (
          <div className="mt-4 mx-auto max-w-3xl flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06]">
            <div className="flex-1">
              <div className="text-sm font-bold text-amber-200">{copy.setup.title}</div>
              <p className="text-xs text-white/60 mt-1 leading-relaxed">{copy.setup.body}</p>
            </div>
            <button
              type="button"
              onClick={openProviderSettings}
              className="px-4 py-2 rounded-full bg-amber-300 text-black text-xs font-bold hover:bg-white transition-colors whitespace-nowrap"
            >
              {copy.setup.cta}
            </button>
          </div>
        )}

        {activeVersion || isGenerating ? (
          <div className="w-full pt-4 space-y-4 animate-fade-in-up">
            {/* Stage */}
            <div className="flex flex-col items-center gap-3">
              <div
                className="relative rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl"
                style={{
                  aspectRatio: `${previewSize.width} / ${previewSize.height}`,
                  width: `min(100%, calc(46vh * ${previewSize.width / previewSize.height}))`,
                }}
              >
                {frame && (
                  <iframe
                    key={frame.key}
                    ref={iframeRef}
                    title={copy.preview.frameTitle}
                    sandbox="allow-scripts"
                    srcDoc={frame.srcdoc}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full border-0"
                  />
                )}
                {isGenerating && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-10">
                    <div className="w-14 h-14 border-[3px] border-white/10 border-t-[#22d3ee] rounded-full animate-spin" />
                    <div className="text-center px-6">
                      <div className="text-xs font-black text-[#22d3ee] uppercase tracking-[0.25em] animate-pulse">
                        {isEditing ? copy.loading.editing : copy.loading.generating}
                      </div>
                      <div className="text-xs text-white/50 mt-2">{copy.loading.hint}</div>
                    </div>
                  </div>
                )}
                {exporting && (
                  <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-3 px-3 py-2 rounded-xl bg-black/70 backdrop-blur border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                    <span className="text-[11px] font-bold text-white whitespace-nowrap">{copy.export.recording}</span>
                    <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#22d3ee] transition-all duration-200" style={{ width: `${Math.round(exporting.progress * 100)}%` }} />
                    </div>
                    <span className="text-[11px] font-mono text-white/70">{Math.round(exporting.progress * 100)}%</span>
                  </div>
                )}
              </div>

              {activeVersion && (
                <div className="w-full max-w-4xl flex flex-col gap-3">
                  {/* Transport */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={Boolean(exporting)}
                      onClick={() => postToFrame({ type: playback.playing ? "pause" : "play" })}
                      title={playback.playing ? copy.preview.pause : copy.preview.play}
                      aria-label={playback.playing ? copy.preview.pause : copy.preview.play}
                      className="w-9 h-9 rounded-full bg-[#22d3ee] text-black flex items-center justify-center hover:bg-white transition-colors disabled:opacity-40"
                    >
                      {playback.playing ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(exporting)}
                      onClick={() => {
                        postToFrame({ type: "seek", t: 0 });
                        postToFrame({ type: "play" });
                      }}
                      title={copy.preview.restart}
                      aria-label={copy.preview.restart}
                      className="w-9 h-9 rounded-full bg-white/5 border border-white/10 text-white/80 flex items-center justify-center hover:text-[#22d3ee] hover:border-[#22d3ee]/40 transition-colors disabled:opacity-40"
                    >
                      <RestartIcon />
                    </button>
                    <div
                      role="slider"
                      aria-label={copy.preview.timeline}
                      aria-valuemin={0}
                      aria-valuemax={previewDuration}
                      aria-valuenow={Number(playback.t.toFixed(1))}
                      tabIndex={0}
                      onClick={handleScrub}
                      className="flex-1 h-2 bg-white/10 rounded-full cursor-pointer relative group"
                    >
                      <div className="absolute left-0 top-0 bottom-0 bg-[#22d3ee] rounded-full" style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="text-[11px] font-mono text-white/60 w-20 text-right">
                      {formatSeconds(playback.t)} / {previewDuration}s
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-white truncate">{activeVersion.title || copy.versions.untitled}</div>
                      <div className="text-[11px] text-white/40">
                        v{activeVersion.number} · {activeVersion.aspect} · {activeVersion.duration}s · {copy.styles[activeVersion.style] || activeVersion.style}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCode((v) => !v)}
                      className={promptControlClassName({ active: showCode, compact: true })}
                    >
                      <CodeIcon />
                      <span className={PROMPT_CONTROL_LABEL_CLASS}>{showCode ? copy.preview.hideCode : copy.preview.showCode}</span>
                    </button>
                    <button type="button" onClick={downloadHtml} className={promptControlClassName({ compact: true })}>
                      <DownloadIcon />
                      <span className={PROMPT_CONTROL_LABEL_CLASS}>{copy.preview.downloadHtml}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExport}
                      disabled={Boolean(exporting) || isGenerating}
                      className="h-[38px] px-4 rounded-md bg-[#22d3ee] text-black text-xs font-bold flex items-center gap-2 hover:bg-white transition-colors disabled:opacity-50"
                    >
                      <FilmIcon />
                      {exporting ? copy.export.exporting : copy.export.cta}
                    </button>
                  </div>
                  {exporting && <p className="text-[11px] text-white/40">{copy.export.keepVisible}</p>}

                  {frameError && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-red-500/25 bg-red-500/[0.07]">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-red-300">{copy.fix.title}</div>
                        <div className="text-[11px] text-white/60 font-mono truncate" title={frameError}>{frameError}</div>
                      </div>
                      <button
                        type="button"
                        onClick={handleFix}
                        disabled={isGenerating || Boolean(exporting)}
                        className="px-4 py-2 rounded-full bg-red-400 text-black text-xs font-bold hover:bg-white transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        {copy.fix.cta}
                      </button>
                    </div>
                  )}

                  {showCode && (
                    <pre className="max-h-80 overflow-auto custom-scrollbar text-[11px] leading-relaxed text-white/70 bg-black/60 border border-white/10 rounded-xl p-4 whitespace-pre-wrap break-all">
                      {activeVersion.html}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Versions */}
            {versions.length > 0 && (
              <div className="max-w-4xl mx-auto w-full">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] font-bold text-white/40 uppercase tracking-wider">{copy.versions.heading}</h4>
                  <button
                    type="button"
                    onClick={startNew}
                    disabled={Boolean(exporting)}
                    className="text-[11px] font-bold text-[#22d3ee] hover:text-white transition-colors disabled:opacity-40"
                  >
                    + {copy.versions.new}
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2">
                  {versions.map((version) => {
                    const parent = versions.find((v) => v.id === version.parentId);
                    const active = version.id === activeId;
                    return (
                      <div
                        key={version.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectVersion(version)}
                        onKeyDown={(event) => { if (event.key === "Enter") selectVersion(version); }}
                        title={version.prompt}
                        className={`relative group/version flex-shrink-0 w-44 p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                          active ? "border-[#22d3ee]/60 bg-[#22d3ee]/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] font-bold">
                          <span className={active ? "text-[#22d3ee]" : "text-white/70"}>v{version.number}</span>
                          {parent && <span className="text-white/30">← v{parent.number}</span>}
                          <span className="text-white/30 ml-auto">{version.aspect}</span>
                        </div>
                        <div className="text-[11px] text-white/80 line-clamp-2 leading-snug mt-1">{version.prompt}</div>
                        <button
                          type="button"
                          title={copy.actions.delete}
                          aria-label={copy.actions.delete}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteVersion(version);
                          }}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/80 border border-white/15 text-white/70 hover:bg-red-500 hover:text-white text-[11px] leading-none flex items-center justify-center opacity-0 group-hover/version:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full w-full animate-fade-in-up">
            <StudioEmptyState heading={copy.hero.titleLine1} accent={copy.hero.titleLine2} subtitle={copy.hero.subtitle} starters={examples.map((example) => ({ label: example, prompt: example }))} onStarter={setPrompt} showcase={null} />
          </div>
        )}

        {/* Exports gallery */}
        {exportsList.length > 0 && (
          <div className="w-full mt-8 border-t border-white/5 pt-6">
            <h4 className="text-[11px] font-bold text-white/40 uppercase tracking-wider mb-4 px-1">
              {copy.gallery.heading.replace("{count}", exportsList.length)}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {exportsList.map((entry) => (
                <div
                  key={entry.id}
                  className="relative group rounded-2xl overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-xl hover:border-[#22d3ee]/50 transition-all duration-300 flex flex-col cursor-pointer"
                  onClick={() => setFullscreenUrl(entry.url)}
                >
                  <video
                    src={entry.url}
                    className="w-full aspect-video object-contain bg-black"
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    onMouseOver={(event) => event.currentTarget.play().catch(() => {})}
                    onMouseOut={(event) => {
                      event.currentTarget.pause();
                      event.currentTarget.currentTime = 0;
                    }}
                  />
                  <div className="absolute top-2 right-2 hidden md:flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <GenerationCopyButtons prompt={entry.prompt} onCopyError={onGenerationError} />
                    <button
                      type="button"
                      title={copy.actions.download}
                      aria-label={copy.actions.download}
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadExport(entry);
                      }}
                      className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-[#22d3ee] hover:text-black transition-all border border-white/10"
                    >
                      <DownloadIcon />
                    </button>
                    <button
                      type="button"
                      title={copy.actions.delete}
                      aria-label={copy.actions.delete}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteExport(entry);
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
                      { kind: "download", label: copy.actions.download, onSelect: () => downloadExport(entry) },
                      { kind: "delete", label: copy.actions.delete, danger: true, onSelect: () => deleteExport(entry) },
                    ]}
                  />
                  <div className="p-3 bg-black/80 border-t border-white/5 flex flex-col gap-2">
                    <p className="text-white/80 text-xs font-semibold truncate" title={entry.title}>{entry.title || copy.versions.untitled}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold text-[#22d3ee] px-2 py-0.5 bg-[#22d3ee]/10 rounded border border-[#22d3ee]/20">
                        {copy.gallery.tag}
                      </span>
                      <span className="text-[10px] text-white/40">{entry.aspect} · {entry.duration}s · {extensionOf(entry.mimeType).toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── PROMPT BAR ── */}
      <PromptComposer>
        {isEditing && (
          <div className="flex items-center gap-2 px-1 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-[#22d3ee]/10 border border-[#22d3ee]/25 text-[#22d3ee] font-bold">
              {copy.composer.editing.replace("{version}", `v${activeVersion.number}`)}
            </span>
            <button type="button" onClick={startNew} disabled={Boolean(exporting)} className="text-white/40 hover:text-white font-semibold transition-colors disabled:opacity-40">
              {copy.composer.startNew}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-1">
          {image ? (
            <div className={PROMPT_MEDIA_PREVIEW_CLASS} title={image.name || copy.image.attached}>
              <img src={imageCache.current.get(image.url) || image.url} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                title={copy.image.remove}
                aria-label={copy.image.remove}
                onClick={() => setImage(null)}
                className="absolute inset-0 bg-black/60 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              title={copy.image.attach}
              aria-label={copy.image.attach}
              onClick={() => fileInputRef.current?.click()}
              className={promptMediaButtonClassName()}
            >
              <ImageIcon />
            </button>
          )}
          <div className="flex-1 flex flex-col">
            <PromptTextarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (canSubmit) handleSubmit();
                }
              }}
              placeholder={isEditing ? copy.composer.editPlaceholder : copy.composer.placeholder}
            />
          </div>
        </div>

        <PromptFooter>
          <PromptControls>
            {/* Aspect ratio */}
            <div className="relative">
              <button ref={aspectBtnRef} type="button" onClick={toggleMenu("aspect")} className={promptControlClassName({ active: openMenu === "aspect" })}>
                <PromptAspectRatioIcon />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{aspect}</span>
                <PromptChevronIcon />
              </button>
              <ControlPopover open={openMenu === "aspect"} title={copy.controls.aspectRatio} onClose={closeMenu} anchorRef={aspectBtnRef}>
                <PromptMenuList>
                  {Object.keys(ASPECT_RATIOS).map((ratio) => (
                    <PromptMenuItem
                      key={ratio}
                      selected={ratio === aspect}
                      description={copy.aspects[ratio]}
                      onClick={() => {
                        setAspect(ratio);
                        closeMenu();
                      }}
                    >
                      {ratio}
                    </PromptMenuItem>
                  ))}
                </PromptMenuList>
              </ControlPopover>
            </div>

            {/* Duration */}
            <div className="relative">
              <button ref={durationBtnRef} type="button" onClick={toggleMenu("duration")} className={promptControlClassName({ active: openMenu === "duration" })}>
                <PromptDurationIcon />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{duration}s</span>
                <PromptChevronIcon />
              </button>
              <ControlPopover open={openMenu === "duration"} title={copy.controls.duration} onClose={closeMenu} anchorRef={durationBtnRef} className="w-56">
                <div className="grid grid-cols-5 gap-1.5">
                  {DURATIONS.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      onClick={() => {
                        setDuration(seconds);
                        closeMenu();
                      }}
                      className={`h-8 rounded-lg text-xs font-semibold transition-all ${
                        seconds === duration ? "bg-[#22d3ee] text-black" : "text-white/70 bg-white/[0.04] hover:bg-[#22d3ee]/10 hover:text-[#22d3ee]"
                      }`}
                    >
                      {seconds}s
                    </button>
                  ))}
                </div>
              </ControlPopover>
            </div>

            {/* Style preset */}
            <div className="relative">
              <button ref={styleBtnRef} type="button" onClick={toggleMenu("style")} className={promptControlClassName({ active: openMenu === "style" })}>
                <SparkIcon className="text-current opacity-[0.45]" />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{copy.styles[style] || style}</span>
                <PromptChevronIcon />
              </button>
              <ControlPopover open={openMenu === "style"} title={copy.controls.style} onClose={closeMenu} anchorRef={styleBtnRef} className="w-64">
                <PromptMenuList>
                  {STYLE_IDS.map((id) => (
                    <PromptMenuItem
                      key={id}
                      selected={id === style}
                      description={copy.styleHints[id]}
                      onClick={() => {
                        setStyle(id);
                        closeMenu();
                      }}
                    >
                      {copy.styles[id] || id}
                    </PromptMenuItem>
                  ))}
                </PromptMenuList>
              </ControlPopover>
            </div>
          </PromptControls>

          <PromptAction onClick={handleSubmit} disabled={!canSubmit}>
            {isGenerating ? (
              <>
                <span className="animate-spin inline-block text-black">◌</span> {isEditing ? copy.actions.revising : copy.actions.generating}
              </>
            ) : (
              <span>{isEditing ? copy.actions.revise : copy.actions.generate}</span>
            )}
          </PromptAction>
        </PromptFooter>
      </PromptComposer>

      {/* ── FULLSCREEN VIDEO ── */}
      {fullscreenUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-fade-in" onClick={() => setFullscreenUrl(null)}>
          <button
            type="button"
            title={copy.actions.close}
            aria-label={copy.actions.close}
            className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors border border-white/10"
            onClick={(event) => {
              event.stopPropagation();
              setFullscreenUrl(null);
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <video
            src={fullscreenUrl}
            controls
            autoPlay
            loop
            className="max-w-[95vw] max-h-[95vh] rounded-2xl shadow-2xl object-contain animate-scale-up"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
      <Toaster position="top-right" containerStyle={{ zIndex: 99999 }} toastOptions={{ duration: 5000, style: { background: '#18181b', color: '#ffffff', border: '1px solid rgba(255,255,255,0.15)', fontSize: '13px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', maxWidth: '440px', wordBreak: 'break-word', whiteSpace: 'pre-wrap', padding: '12px 16px' } }} />
    </div>
  );
}
