"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import toast, { Toaster } from "react-hot-toast";
import { generateVideo, generateI2V, processV2V, uploadFile } from "../generation.js";
import { isEndpointAvailable } from "../providers/client.js";
import { formatErrorMessage } from "../utils/formatError.js";
import DrawModal from "./DrawModal.jsx";
import ModelParameterControls from "./ModelParameterControls.jsx";
import VendorRail from "./VendorRail.jsx";
import { vendorById } from "../vendors.js";
import { VideoOptionControl, VideoSettingsControl } from "./VideoModelControls.jsx";
import WatermarkDialog from "./WatermarkDialog.jsx";
import CharactersMenu from "./CharactersMenu.jsx";
import { characterHandle } from "../characters.js";
import MobileGenerationActions, {
  GenerationCopyButtons,
} from "./MobileGenerationActions.jsx";
import {
  t2vModels,
  getAspectRatiosForVideoModel,
  getDurationsForModel,
  getResolutionsForVideoModel,
  getAspectRatiosForI2VModel,
  getDurationsForI2VModel,
  getResolutionsForI2VModel,
} from "../models.js";
import {
  getFamilyVariant,
  videoModelCatalog,
  videoModelMenuEntries as videoModelPickerEntries,
  videoModelMenuEntryByVariantId as videoModelPickerEntryByVariantId,
} from "../modelFamilies.js";
import { getSeedanceEndpointResolution } from "../seedanceModels.js";
import { getGroupedVideoConfiguration, getGroupedVideoCopyKey, getGroupedVideoVariantOptions } from "../groupedVideoModels.js";
import {
  getVideoCommonOptions,
  getVideoCommonValues,
  buildVideoCommonPayload,
} from "../videoModelParameters.js";
import {
  getGroupedVideoResolutionOptions,
  planGroupedVideoSelection,
  getGroupedVideoSelectionAdjustments,
} from "../groupedVideoParameters.js";
import { getVideoAspectRatioLabel, getVideoDurationLabel, getVideoModeDescription } from "../videoModelCopy.js";
import {
  buildReferenceParams,
  getModelMediaCapabilities,
  shouldDisableVideoPrompt,
} from "../modelCapabilities.js";
import {
  buildSupplementalInputPayload,
  createModelParameterValues,
  getSupplementalModelInputs,
  mergeModelParameterValues,
} from "../modelParameters.js";
import {
  appendVideoWorkflowMedia,
  buildVideoWorkflowMediaParams,
  getVideoWorkflowControlLabel,
  getVideoWorkflowControlState,
  getVideoWorkflowDraftKey,
  getVideoWorkflowFamily,
  getVideoWorkflowMediaConfig,
  getVideoWorkflowMediaSlots,
  migrateVideoWorkflowMediaDrafts,
  getVideoWorkflowSlotRemaining,
  inferVideoWorkflowId,
  legacyVideoMediaToWorkflowDraft,
  projectVideoWorkflowMedia,
  removeVideoWorkflowMedia,
  resolvePersistedVideoWorkflowSelection,
  resolveVideoBaseVariant,
  resolveVideoWorkflowVariant,
  validateVideoWorkflowMedia,
} from "../videoWorkflows.js";
import {
  PROMPT_CONTROL_LABEL_CLASS,
  PROMPT_MEDIA_PREVIEW_CLASS,
  PromptAspectRatioIcon,
  PromptAction,
  PromptChevronIcon,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptMenuItem,
  PromptMenuList,
  PromptPopover,
  PromptPopoverHeader,
  PromptDurationIcon,
  PromptQualityIcon,
  PromptTextarea,
  promptControlClassName,
  promptMediaButtonClassName,
  PromptActionGroup,
} from "./prompt/PromptComposer.jsx";
import PriceChip, { PriceHint } from "./prompt/PriceChip.jsx";
import usePromptMenu from "./prompt/usePromptMenu.js";
import en from "../messages/en/videoStudio.json";
import zh from "../messages/zh/videoStudio.json";
import { resolveCopy } from "../i18nUtils";
import StudioEmptyState from "./StudioEmptyState.jsx";

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

function mergeReferenceUrls(current, incoming, limit) {
  return [...new Set([...current, ...incoming])].slice(0, limit);
}

const EMPTY_WORKFLOW_MEDIA_DRAFT = Object.freeze({});

const EXTEND_WORKFLOW_ID = "extend_uploaded_video";
// Extenders that accept any video, tried after the source model's own family.
// (Veo 3.1 extend only accepts Veo 3.1 output, so it is never used here.)
const GENERAL_EXTEND_MODEL_IDS = Object.freeze([
  "seedance-2.0-video-extend",
  "kling-v4.0-video-extend",
  "wan3.0-video-extend",
  "seedance-2.5-video-extend",
  "happy-horse-1.1-video-extend",
  "grok-imagine-video-extend",
]);

// Reframe models in preference order (all accept any video).
const REFRAME_MODEL_IDS = Object.freeze([
  "luma-ray-3.2-reframe",
  "minimax-h3-max-reframe",
  "ltx-2.3-reframe",
  "wavespeed-video-outpainter",
]);

// Video upscalers in preference order (all take a single video).
const UPSCALE_MODEL_IDS = Object.freeze([
  "topaz-video-upscale",
  "ai-video-upscaler-pro",
  "flux-3-video-upscaler",
  "ai-video-upscaler",
]);

// First catalog model the visitor's providers can run, else the first listed.
function pickRunnableModelId(modelIds) {
  const candidates = [...new Set(modelIds)].filter((id) => videoModelCatalog.variantById.has(id));
  return candidates.find((id) => isEndpointAvailable(videoModelCatalog.variantById.get(id).model.endpoint || id))
    || candidates[0]
    || null;
}

// Picks the extend model for a finished video: same family first, then a
// general extender, preferring models the visitor's providers can run.
function findExtendModelId(sourceModelId) {
  const familyId = videoModelCatalog.familyByVariantId.get(sourceModelId)?.id;
  const familyExtenders = getVideoWorkflowFamily(familyId)
    ?.workflowById.get(EXTEND_WORKFLOW_ID)?.variants.map((variant) => variant.model.id) || [];
  return pickRunnableModelId([...familyExtenders, ...GENERAL_EXTEND_MODEL_IDS]);
}

function findReframeModelId() {
  return pickRunnableModelId(REFRAME_MODEL_IDS);
}

function findUpscaleModelId() {
  return pickRunnableModelId(UPSCALE_MODEL_IDS);
}

function workflowContextKey(familyId, workflowId) {
  return `${familyId}:${workflowId || "base"}`;
}

function isSameSelection(left, right) {
  return (
    left?.selectedFamilyId === right?.selectedFamilyId &&
    left?.selectedModel === right?.selectedModel &&
    left?.selectedWorkflowId === right?.selectedWorkflowId
  );
}

function ReferenceMediaLabel({ label, required = false }) {
  if (!label) return null;
  return (
    <span
      className={`flex min-h-6 max-w-[88px] items-start justify-center text-balance text-center text-[10px] font-semibold leading-3 ${
        required ? "text-white/60" : "text-white/45"
      }`}
    >
      {label}
      {required && (
        <span className="ml-0.5 text-[#22d3ee]" aria-hidden="true">
          *
        </span>
      )}
    </span>
  );
}

function ReferencePreview({
  type,
  url,
  index,
  onRemove,
  label = null,
  description = null,
  copy = en,
}) {
  const mediaLabel = label || (type === "image" ? copy.media.image : type === "video" ? copy.media.video : copy.media.audio);
  const actionLabel = description || mediaLabel;
  return (
    <div className="flex min-w-[60px] flex-col items-center gap-1.5">
      <div className={PROMPT_MEDIA_PREVIEW_CLASS}>
        {type === "image" ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : type === "video" ? (
          <video src={url} className="w-full h-full object-cover" muted />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-white/5 text-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18V5l10-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="16" cy="16" r="3" />
            </svg>
          </div>
        )}
        <button
          type="button"
          aria-label={`${copy.media.removePrefix} ${actionLabel}`}
          title={`${copy.media.removePrefix} ${actionLabel}`}
          onClick={() => onRemove(index)}
          className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 hover:bg-black rounded-full flex items-center justify-center text-white/85 hover:text-white text-[8px] border border-white/5"
        >
          ×
        </button>
      </div>
      <ReferenceMediaLabel label={mediaLabel} />
    </div>
  );
}

function ReferenceUploadButton({
  inputRef,
  accept,
  multiple,
  onChange,
  onClick,
  title,
  uploading,
  progress,
  type,
  label = null,
  required = false,
  disabled = false,
  copy = en,
}) {
  const localInputRef = useRef(null);
  const resolvedInputRef = inputRef || localInputRef;
  const announcedProgress = Math.min(
    100,
    Math.max(0, Math.floor(progress / 10) * 10),
  );
  const [isUploadDragging, setIsUploadDragging] = useState(false);
  const uploadDragCounterRef = useRef(0);

  const acceptPrefixes = (accept || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const fileMatchesAccept = (file) => {
    if (acceptPrefixes.length === 0) return true;
    return acceptPrefixes.some((token) => {
      if (token.endsWith("/*")) {
        return file.type?.startsWith(token.slice(0, -1));
      }
      if (token.startsWith(".")) {
        return file.name?.toLowerCase().endsWith(token.toLowerCase());
      }
      return file.type === token;
    });
  };

  const handleUploadDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || uploading) return;
    uploadDragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsUploadDragging(true);
    }
  };

  const handleUploadDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadDragCounterRef.current -= 1;
    if (uploadDragCounterRef.current <= 0) {
      uploadDragCounterRef.current = 0;
      setIsUploadDragging(false);
    }
  };

  const handleUploadDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleUploadDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadDragCounterRef.current = 0;
    setIsUploadDragging(false);
    if (disabled || uploading) return;
    const droppedFiles = Array.from(e.dataTransfer?.files || []).filter(
      fileMatchesAccept,
    );
    if (droppedFiles.length === 0) return;
    const filesToUse = multiple ? droppedFiles : [droppedFiles[0]];
    onChange?.({ target: { files: filesToUse, value: "" } });
  };

  return (
    <div
      className={
        label
          ? "relative flex min-w-[60px] flex-col items-center gap-1.5"
          : "relative"
      }
    >
      <input
        ref={resolvedInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={onChange}
      />
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-busy={uploading || undefined}
        disabled={disabled}
        onClick={onClick || (() => resolvedInputRef.current?.click())}
        onDragEnter={handleUploadDragEnter}
        onDragLeave={handleUploadDragLeave}
        onDragOver={handleUploadDragOver}
        onDrop={handleUploadDrop}
        className={`${promptMediaButtonClassName()} disabled:cursor-not-allowed disabled:opacity-50${
          isUploadDragging ? " ring-2 ring-primary border-primary bg-primary/10" : ""
        }`}
      >
        {uploading ? (
          <div className="flex flex-col items-center justify-center w-full h-full absolute inset-0 bg-black/80 z-20 backdrop-blur-[2px]">
            <svg className="w-8 h-8 -rotate-90">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" fill="transparent" className="text-white/10" />
              <circle
                cx="16"
                cy="16"
                r="14"
                stroke="currentColor"
                strokeWidth="2"
                fill="transparent"
                strokeDasharray={88}
                strokeDashoffset={88 - (88 * progress) / 100}
                className="text-[#22d3ee] transition-all duration-300"
              />
            </svg>
            <span className="absolute text-[9px] font-black text-[#22d3ee] leading-none">{progress}%</span>
          </div>
        ) : type === "video" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-white/40 group-hover:text-[#22d3ee] transition-colors">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        ) : type === "audio" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white/40 group-hover:text-[#22d3ee] transition-colors">
            <path d="M9 18V5l10-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="16" cy="16" r="3" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white/40 group-hover:text-[#22d3ee] transition-colors">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        )}
      </button>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {uploading ? copy.upload.uploadingProgress.replace('{title}', title).replace('{progress}', announcedProgress) : ""}
      </span>
      <ReferenceMediaLabel label={label} required={required} />
    </div>
  );
}

// ── SVG icons (kept inline to avoid extra deps) ───────────────────────────────

const CheckSvg = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#22d3ee"
    strokeWidth="4"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const VideoIconSvg = ({ className }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={className}
  >
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const VideoReadySvg = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="text-primary"
  >
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    <polyline points="7 10 10 13 15 8" stroke="#22d3ee" strokeWidth="2.5" />
  </svg>
);

// ── Dropdown components ───────────────────────────────────────────────────────

// Small vendor badge for the selected model: monogram and colour from the registry.
function getProviderStyle(provider) {
  const vendor = vendorById(provider);
  return { text: vendor.mono, bg: `bg-white/[0.06] ${vendor.color} border-white/10` };
}

function ModelDropdown({ selectedModel, onSelect, onClose, copy = en, locale = "en", pricePayload, priceMode }) {
  const [search, setSearch] = useState("");
  // Only the hovered row is priced (see PriceHint).
  const [hoveredId, setHoveredId] = useState(null);
  const selectedEntry = videoModelPickerEntryByVariantId.get(selectedModel);
  const selectedModelProvider = selectedEntry?.family.provider || "all";
  const modelCategories = [
    {
      id: "all",
      label: copy.categories.all,
      entries: videoModelPickerEntries,
    },
    {
      id: "t2v",
      label: copy.categories.t2v,
      entries: videoModelPickerEntries.filter((entry) => entry.variantsByMode.t2v),
    },
    {
      id: "i2v",
      label: copy.categories.i2v,
      entries: videoModelPickerEntries.filter((entry) => entry.variantsByMode.i2v),
    },
    {
      id: "v2v",
      label: copy.categories.v2v,
      entries: videoModelPickerEntries.filter((entry) => entry.variantsByMode.v2v),
    },
  ];
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState(
    () => selectedModelProvider,
  );
  const activeCategory = modelCategories.find((category) => category.id === selectedCategory) || modelCategories[0];
  const modelEntries = activeCategory.entries;

  const activeItemRef = useRef(null);

  useEffect(() => {
    // Automatically scroll the active model into view when opening
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: "nearest" });
    }
  }, []);

  // Dynamically compute list of providers from the input models lists
  const vendorCounts = new Map();
  modelEntries.forEach(({ family }) => {
    const id = family.provider || 'other';
    const current = vendorCounts.get(id) || { id, name: family.provider_name || 'Other', count: 0 };
    current.count += 1;
    vendorCounts.set(id, current);
  });
  const availableProviders = [...vendorCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const lf = search.toLowerCase();

  const filtered = modelEntries.filter((entry) => {
    const { family } = entry;
    // 1. Filter by provider tab
    if (selectedProvider !== "all") {
      const pId = family.provider || 'other';
      if (pId !== selectedProvider) return false;
    }
    // 2. Filter by search query
    return entry.searchText.includes(lf);
  });
  const getIconColor = (family) => {
    if (family.id.includes("kling")) return "bg-blue-500/10 text-blue-400 border-blue-500/10";
    if (family.id.includes("veo")) return "bg-purple-500/10 text-purple-400 border-purple-500/10";
    return "bg-primary/10 text-primary border-primary/10";
  };

  const renderItem = (entry) => {
    const { family } = entry;
    const isSelected = selectedEntry === entry;
    // The variant a click would pick, so the hover price matches.
    const mode = activeCategory.id !== "all" ? activeCategory.id : priceMode;
    const priceVariant = entry.variantsByMode[mode] || entry.defaultVariant || Object.values(entry.variantsByMode)[0];
    return (
    <button
      type="button"
      key={entry.id}
      aria-pressed={isSelected}
      ref={isSelected ? activeItemRef : null}
      className={`flex w-full text-left items-center justify-between gap-3 p-3.5 hover:bg-white/5 rounded-2xl cursor-pointer transition-all border border-transparent hover:border-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${isSelected ? "bg-white/5 border-white/5" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(entry, activeCategory.id);
        onClose();
      }}
      onMouseEnter={() => setHoveredId(entry.id)}
      onMouseLeave={() => setHoveredId((id) => (id === entry.id ? null : id))}
      onFocus={() => setHoveredId(entry.id)}
      onBlur={() => setHoveredId((id) => (id === entry.id ? null : id))}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <div
          className={`w-9 h-9 shrink-0 ${getIconColor(family)} border rounded-xl flex items-center justify-center font-black text-xs shadow-inner uppercase`}
        >
          {entry.name.charAt(0)}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span title={entry.name} className="text-xs font-bold text-white tracking-tight truncate">
            {entry.name}
          </span>
          <div className="flex items-center gap-1.5">
            {selectedProvider === "all" && family.provider_name && (
              <span className="text-[9px] text-white/40">
                {family.provider_name}
              </span>
            )}
          </div>
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <PriceHint locale={locale} endpoint={priceVariant?.model?.endpoint || priceVariant?.model?.id} payload={pricePayload} hovered={hoveredId === entry.id} />
        {isSelected && <CheckSvg />}
      </span>
    </button>
    );
  };

  return (
    <div className="flex gap-4 h-full max-h-[70vh] min-h-[350px]">
      <VendorRail
        vendors={availableProviders}
        selected={selectedProvider}
        onSelect={setSelectedProvider}
        allLabel={copy.providers.allProviders}
        allCount={modelEntries.length}
      />

      {/* Right Pane: Search + Lists */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <div className="px-1 pb-2 border-b border-white/5 shrink-0 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-0.5">
            {modelCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  setSelectedCategory(category.id);
                  setSelectedProvider("all");
                }}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition-colors border ${
                  selectedCategory === category.id
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-white/[0.02] text-white/50 border-white/[0.04] hover:bg-white/5 hover:text-white"
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-2 border border-white/5 focus-within:border-primary/50 transition-colors">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-muted"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder={copy.search.placeholder}
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                setSearch(value);
                if (value.trim()) setSelectedProvider("all");
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-transparent border-none text-xs text-white focus:ring-0 w-full p-0 outline-none"
            />
          </div>
        </div>
        
        <div className="text-xs font-bold text-secondary px-2 py-1 shrink-0 flex items-center justify-between">
          <span>{activeCategory.label} models</span>
          {selectedProvider !== "all" && (
            <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-white/60">
              {availableProviders.find(p => p.id === selectedProvider)?.name || selectedProvider}
            </span>
          )}
        </div>
        
        <div className="flex flex-col gap-1.5 overflow-y-auto custom-scrollbar pr-1 pb-2 flex-1">
          {filtered.length === 0 ? (
            <div className="text-xs text-white/30 text-center py-6">
              No models found
            </div>
          ) : (
            filtered.map((entry) => renderItem(entry))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Control button ────────────────────────────────────────────────────────────

// ── Dropdown panel ─────────────────────────────────────────────────────────────
// Rendered inside a `relative` wrapper div; floats above the anchor button.

// ── Main component ────────────────────────────────────────────────────────────

const PERSIST_KEY = "hg_video_studio_persistent";

export default function VideoStudio({
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  droppedFiles,
  onFilesHandled,
  locale = "en",
}) {
  const copy = useMemo(() => resolveCopy(en, zh, locale), [locale]);
  // ── generation state ──
  const [imageMode, setImageMode] = useState(false); // i2v
  const [v2vMode, setV2vMode] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(null);

  // ── model / params ──
  const defaultModel = t2vModels[0];
  const defaultFamily = videoModelCatalog.familyByVariantId.get(defaultModel.id);
  const [selectedModel, setSelectedModel] = useState(defaultModel.id);
  const [selectedFamilyId, setSelectedFamilyId] = useState(defaultFamily.id);
  const [selectedAr, setSelectedAr] = useState(
    defaultModel.inputs?.aspect_ratio?.default || "16:9",
  );
  const [selectedDuration, setSelectedDuration] = useState(
    defaultModel.inputs?.duration?.default || 5,
  );
  const [selectedResolution, setSelectedResolution] = useState(
    defaultModel.inputs?.resolution?.default || "",
  );
  const [selectedQuality, setSelectedQuality] = useState(
    defaultModel.inputs?.quality?.default || "",
  );
  const [modelParameterValues, setModelParameterValues] = useState(() =>
    createModelParameterValues(defaultModel),
  );

  // ── upload progress ──
  const [imageProgress, setImageProgress] = useState(0);
  const [videoProgress, setVideoProgress] = useState(0);

  // ── control visibility ──
  const [showAr, setShowAr] = useState(true);
  const [showDuration, setShowDuration] = useState(true);
  const [showResolution, setShowResolution] = useState(false);
  const [showQuality, setShowQuality] = useState(false);

  // ── uploads ──
  const [uploadedImageUrls, setUploadedImageUrls] = useState([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [uploadedEndImageUrl, setUploadedEndImageUrl] = useState(null);
  const [endImageUploading, setEndImageUploading] = useState(false);
  const [endImageProgress, setEndImageProgress] = useState(0);
  const [uploadedVideoUrls, setUploadedVideoUrls] = useState([]);
  const [videoUploading, setVideoUploading] = useState(false);
  const [uploadedAudioUrls, setUploadedAudioUrls] = useState([]);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [workflowMediaDrafts, setWorkflowMediaDrafts] = useState({});
  const [workflowUploadSlotId, setWorkflowUploadSlotId] = useState(null);
  const mediaUploading = imageUploading || endImageUploading || videoUploading ||
    audioUploading || Boolean(workflowUploadSlotId);
  const uploadedImageUrl = uploadedImageUrls[0] || null;
  const uploadedVideoUrl = uploadedVideoUrls[0] || null;

  // ── generation / canvas ──
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const [canvasUrl, setCanvasUrl] = useState(null);
  const [canvasModel, setCanvasModel] = useState(null);
  const [showCanvas, setShowCanvas] = useState(false);
  const [isDrawModalOpen, setIsDrawModalOpen] = useState(false);

  // ── history ──
  const [localHistory, setLocalHistory] = useState([]);
  const [watermarkEntry, setWatermarkEntry] = useState(null);
  const [activeHistoryIdx, setActiveHistoryIdx] = useState(0);

  // ── dropdown ──
  const [openDropdown, setOpenDropdown] = useState(null);

  // ── prompt ──
  const [prompt, setPrompt] = useState("");

  // ── refs ──
  const containerRef = useRef(null);
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);
  const imageFileInputRef = useRef(null);
  const endImageFileInputRef = useRef(null);
  const videoFileInputRef = useRef(null);
  const audioFileInputRef = useRef(null);
  const resultVideoRef = useRef(null);
  const workflowControlId = useId();
  const workflowMenuId = `${workflowControlId}-menu`;
  const hasRestored = useRef(false);
  const selectionRef = useRef(null);
  selectionRef.current = {
    selectedFamilyId,
    selectedModel,
    selectedWorkflowId,
    imageMode,
    v2vMode,
  };
  const workflowVariantPreferencesRef = useRef(new Map());
  const workflowUploadSlotRef = useRef(null);
  const workflowDraftSessionRef = useRef(0);
  const mediaRef = useRef(null);
  mediaRef.current = {
    imageUrls: uploadedImageUrls,
    endImageUrl: uploadedEndImageUrl,
    videoUrls: uploadedVideoUrls,
    audioUrls: uploadedAudioUrls,
  };
  const workflowMediaDraftsRef = useRef(workflowMediaDrafts);
  workflowMediaDraftsRef.current = workflowMediaDrafts;
  const commonParameterValuesRef = useRef(null);
  commonParameterValuesRef.current = {
    ...modelParameterValues,
    aspectRatio: selectedAr,
    duration: selectedDuration,
    resolution: selectedResolution,
    quality: selectedQuality,
  };

  // ── derived data ──
  const history = localHistory;

  const handleDeleteEntry = useCallback((idx) => {
    setLocalHistory((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const getCurrentAspectRatios = useCallback(
    (id) =>
      imageMode
        ? getAspectRatiosForI2VModel(id)
        : getAspectRatiosForVideoModel(id),
    [imageMode],
  );

  const getCurrentDurations = useCallback(
    (id) =>
      imageMode ? getDurationsForI2VModel(id) : getDurationsForModel(id),
    [imageMode],
  );

  const getCurrentResolutions = useCallback(
    (id) =>
      imageMode
        ? getResolutionsForI2VModel(id)
        : getResolutionsForVideoModel(id),
    [imageMode],
  );

  const getCurrentModel = useCallback(
    () => videoModelCatalog.variantById.get(selectedModel)?.model,
    [selectedModel],
  );

  const isMotionControlSelection = useCallback(
    (modelId, isV2v) => {
      if (!isV2v) return false;
      const m = videoModelCatalog.variantById.get(modelId)?.model;
      return !!m?.imageField;
    },
    [],
  );

  // ── update controls when the selected model changes ─────────────────────
  const applyControlsForModel = useCallback(
    (modelId, isImageMode, isV2vMode) => {
      if (getGroupedVideoConfiguration(modelId)) {
        const model = videoModelCatalog.variantById.get(modelId)?.model;
        const options = getVideoCommonOptions(model, commonParameterValuesRef.current);
        const values = getVideoCommonValues(model, commonParameterValuesRef.current);
        setShowAr(options.aspectRatios.length > 0);
        setShowDuration(options.durations.length > 0);
        setShowResolution(options.resolutions.length > 0);
        setShowQuality(options.qualities.length > 0);
        if (values.aspectRatio !== undefined) setSelectedAr(values.aspectRatio);
        if (values.duration !== undefined) setSelectedDuration(values.duration);
        const resolution = values.resolution ?? getSeedanceEndpointResolution(modelId);
        if (resolution !== undefined) setSelectedResolution(resolution);
        if (values.quality !== undefined) setSelectedQuality(values.quality);
        return;
      }
      if (isV2vMode) {
        setShowAr(false);
        setShowDuration(false);
        setShowResolution(false);
        setShowQuality(false);
        return;
      }

      const model = videoModelCatalog.variantById.get(modelId)?.model;

      const ars = isImageMode
        ? getAspectRatiosForI2VModel(modelId)
        : getAspectRatiosForVideoModel(modelId);
      if (ars.length > 0) {
        setSelectedAr(ars[0]);
        setShowAr(true);
      } else {
        setShowAr(false);
      }

      const durations = isImageMode
        ? getDurationsForI2VModel(modelId)
        : getDurationsForModel(modelId);
      if (durations.length > 0) {
        setSelectedDuration(model?.inputs?.duration?.default ?? durations[0]);
        setShowDuration(true);
      } else {
        setShowDuration(false);
      }

      const resolutions = isImageMode
        ? getResolutionsForI2VModel(modelId)
        : getResolutionsForVideoModel(modelId);
      if (resolutions.length > 0) {
        setSelectedResolution(resolutions[0]);
        setShowResolution(true);
      } else {
        setShowResolution(false);
      }

      const qualities = model?.inputs?.quality?.enum || [];
      if (qualities.length > 0) {
        setSelectedQuality(model?.inputs?.quality?.default || qualities[0]);
        setShowQuality(true);
      } else {
        setSelectedQuality("");
        setShowQuality(false);
      }
    },
    [],
  );

  const selectedFamily =
    videoModelCatalog.familyById.get(selectedFamilyId) || defaultFamily;
  const currentFamilyMode = v2vMode ? "v2v" : imageMode ? "i2v" : "t2v";
  // Shared by the price chip and the model picker's hover prices.
  const pricePayload = useMemo(
    () => ({ aspect_ratio: selectedAr, duration: selectedDuration, resolution: selectedResolution, quality: selectedQuality, ...modelParameterValues }),
    [selectedAr, selectedDuration, selectedResolution, selectedQuality, modelParameterValues],
  );
  const workflowFamily = getVideoWorkflowFamily(selectedFamilyId);
  const selectedWorkflow = selectedWorkflowId
    ? workflowFamily?.workflowById.get(selectedWorkflowId) || null
    : null;
  const groupedConfiguration = getGroupedVideoConfiguration(selectedModel);
  const groupCopyKey = getGroupedVideoCopyKey(selectedFamilyId);
  const providerCopy = copy[groupCopyKey] || copy.seedance;
  const groupCopy = useMemo(() => ({
    ...copy.modelControls,
    ...providerCopy,
    fields: { ...copy.modelControls.fields, ...providerCopy.fields },
    adjustments: { ...copy.modelControls.adjustments, ...providerCopy.adjustments },
  }), [copy, providerCopy]);
  const workflowControlState = groupedConfiguration && workflowFamily
    ? { kind: "menu", workflow: null }
    : getVideoWorkflowControlState(
    workflowFamily,
    selectedModel,
  );
  const workflowMediaDraftKey = selectedWorkflowId
    ? getVideoWorkflowDraftKey(selectedFamilyId, selectedWorkflowId)
    : null;
  const selectedVariant = videoModelCatalog.variantById.get(selectedModel);
  const activeWorkflowMediaDraft = useMemo(
    () => workflowMediaDraftKey
      ? projectVideoWorkflowMedia(
          selectedVariant?.model,
          selectedWorkflowId,
          workflowMediaDrafts[workflowMediaDraftKey] || EMPTY_WORKFLOW_MEDIA_DRAFT,
        )
      : null,
    [
      selectedVariant,
      selectedWorkflowId,
      workflowMediaDraftKey,
      workflowMediaDrafts,
    ],
  );
  const selectedPickerEntry = videoModelPickerEntryByVariantId.get(selectedModel);
  const selectedPickerLabel = selectedPickerEntry?.name || selectedFamily.name;
  const getSelectionPlan = useCallback((options = {}) => planGroupedVideoSelection({
    familyId: selectedFamilyId,
    workflowId: selectedWorkflowId,
    currentWorkflowId: selectedWorkflowId,
    media: activeWorkflowMediaDraft,
    currentModelId: selectedModel,
    nativeResolution: selectedResolution,
    commonValues: {
      ...modelParameterValues,
      aspectRatio: selectedAr, duration: selectedDuration,
      quality: selectedQuality,
    },
    ...options,
  }), [selectedFamilyId, selectedWorkflowId, selectedModel, selectedResolution, selectedAr, selectedDuration, selectedQuality, modelParameterValues, activeWorkflowMediaDraft]);
  const describeSelectionAdjustments = useCallback((adjustments) => {
    const valueLabel = (key, value) => {
      if (key === "duration") return getVideoDurationLabel(value, groupCopy);
      if (key === "aspectRatio") return getVideoAspectRatioLabel(value, groupCopy);
      if (key === "profile") return groupCopy.profiles[value]?.label || value;
      if (key === "speed") return groupCopy.speeds[value] || value;
      if (key === "resolution" && value === "default") return groupCopy.defaultResolution;
      return String(value).toLowerCase() === "4k" ? "4K" : value;
    };
    return adjustments.map(({ key, to }) =>
      groupCopy.adjustments[key].replace("{value}", valueLabel(key, to))).join(" · ");
  }, [groupCopy]);
  const groupedVariantOptions = useMemo(() => groupedConfiguration
    ? getGroupedVideoVariantOptions(selectedFamilyId, selectedWorkflowId, selectedModel)
      .filter((field) => field.key !== "resolution")
      .map((field) => ({
        ...field,
        options: field.options.map((option) => {
          const plan = getSelectionPlan({ changes: { [field.key]: option.value } });
          return {
            ...option,
            description: groupCopy.speedDescriptions?.[option.value],
            disabled: !plan,
            adjustmentDescription: plan ? describeSelectionAdjustments(plan.adjustments) : "",
          };
        }),
      }))
    : [], [groupedConfiguration, selectedFamilyId, selectedWorkflowId, selectedModel, getSelectionPlan, describeSelectionAdjustments, groupCopy]);
  const groupedProfile = groupedVariantOptions.find((field) => field.key === "profile");
  const groupedSpeed = groupedVariantOptions.find((field) => field.key === "speed");
  const groupedResolution = useMemo(() => {
    if (!groupedConfiguration) return null;
    const field = getGroupedVideoResolutionOptions(selectedFamilyId, selectedWorkflowId, selectedModel, selectedResolution, {
      aspectRatio: selectedAr, duration: selectedDuration, quality: selectedQuality,
    });
    return {
      ...field,
      key: "resolution",
      ...(groupCopyKey === "seedance" && !field.value && selectedWorkflowId !== "extend_uploaded_video"
        ? { label: groupCopy.defaultResolution } : {}),
      options: field.options.map((option) => {
        const adjustments = option.disabled ? [] : getGroupedVideoSelectionAdjustments({
          currentModelId: selectedModel, nativeResolution: selectedResolution,
          currentWorkflowId: selectedWorkflowId, media: activeWorkflowMediaDraft,
          commonValues: { ...modelParameterValues, aspectRatio: selectedAr, duration: selectedDuration, quality: selectedQuality },
          selection: option, changes: { resolution: option.value },
        });
        return { ...option, adjustmentDescription: describeSelectionAdjustments(adjustments) };
      }),
    };
  }, [groupedConfiguration, selectedFamilyId, selectedWorkflowId, selectedModel, selectedResolution, selectedAr, selectedDuration, selectedQuality, modelParameterValues, describeSelectionAdjustments, groupCopy, groupCopyKey, activeWorkflowMediaDraft]);
  const commonOptions = useMemo(
    () => getVideoCommonOptions(selectedVariant?.model, {
      ...modelParameterValues, aspectRatio: selectedAr, duration: selectedDuration,
      resolution: selectedResolution, quality: selectedQuality,
    }), [selectedVariant, modelParameterValues, selectedAr, selectedDuration, selectedResolution, selectedQuality],
  );
  const aspectRatioHelp = groupCopy[selectedVariant?.model.inputs?.aspect_ratio?.descriptionKey];
  const groupedModes = useMemo(() => groupedConfiguration && workflowFamily
    ? [...(workflowFamily.hasBase ? [{ id: null }] : []), ...workflowFamily.workflows].map((workflow) => {
        const plan = getSelectionPlan({ workflowId: workflow.id });
        return {
          id: workflow.id,
          label: groupCopy.modes[workflow.id || "text"],
          description: getVideoModeDescription(
            videoModelCatalog.variantById.get(plan?.selection.modelId)?.model,
            workflow.id, groupCopy,
          ),
          adjustmentDescription: plan ? describeSelectionAdjustments(plan.adjustments) : "",
          disabled: !plan,
        };
      })
    : [], [groupedConfiguration, workflowFamily, getSelectionPlan, describeSelectionAdjustments, groupCopy]);
  const promptDisabled = shouldDisableVideoPrompt(
    selectedVariant?.model,
    currentFamilyMode,
  );
  const workflowMediaSlots = useMemo(
    () => selectedWorkflowId
      ? getVideoWorkflowMediaSlots(selectedVariant?.model, selectedWorkflowId)
      : [],
    [selectedVariant, selectedWorkflowId],
  );
  const currentModelCapabilities = getModelMediaCapabilities(selectedVariant?.model);
  const supplementalInputs = useMemo(
    () => {
      const inputs = getSupplementalModelInputs(selectedVariant?.model);
      return groupedConfiguration
        ? inputs.filter(({ key }) => key !== "omni_reference_task_type").map(({ key, schema }) => ({
            key, schema: {
              ...schema, ...groupCopy.fields[key],
              ...(schema.descriptionKey ? { description: groupCopy[schema.descriptionKey] } : {}),
              ...(key === "generate_audio" && selectedWorkflowId === "edit_video" ? groupCopy.editAudio : {}),
            },
          }))
        : inputs;
    }, [selectedVariant, groupedConfiguration, selectedWorkflowId, groupCopy],
  );
  const handleModelParameterChange = useCallback((key, value) => {
    setModelParameterValues((values) => ({ ...values, [key]: value }));
    if (selectedVariant?.model.commonParameterRules) {
      commonParameterValuesRef.current = { ...commonParameterValuesRef.current, [key]: value };
      applyControlsForModel(selectedModel, imageMode, v2vMode);
    }
  }, [selectedVariant, selectedModel, imageMode, v2vMode, applyControlsForModel]);

  const applySelectedVariant = useCallback(
    (variant, mode, family, workflowId = null) => {
      const model = variant.model;
      const nextV2VMode = mode === "v2v";
      const nextImageMode = mode === "i2v";

      const previous = selectionRef.current;
      if (previous?.selectedFamilyId && previous?.selectedModel) {
        workflowVariantPreferencesRef.current.set(
          workflowContextKey(previous.selectedFamilyId, previous.selectedWorkflowId),
          previous.selectedModel,
        );
      }
      workflowVariantPreferencesRef.current.set(
        workflowContextKey(family.id, workflowId),
        model.id,
      );

      selectionRef.current = {
        selectedFamilyId: family.id,
        selectedModel: model.id,
        selectedWorkflowId: workflowId,
        imageMode: nextImageMode,
        v2vMode: nextV2VMode,
      };
      setSelectedFamilyId(family.id);
      setSelectedModel(model.id);
      setSelectedWorkflowId(workflowId);
      setModelParameterValues((values) =>
        mergeModelParameterValues(model, values),
      );
      setV2vMode(nextV2VMode);
      setImageMode(nextImageMode);
      applyControlsForModel(model.id, nextImageMode, nextV2VMode);
    },
    [applyControlsForModel],
  );

  const reconcileReferencesForModel = useCallback((model) => {
    const capabilities = getModelMediaCapabilities(model);
    setUploadedImageUrls((urls) => urls.slice(0, capabilities.image.maxItems));
    setUploadedVideoUrls((urls) => urls.slice(0, capabilities.video.maxItems));
    setUploadedAudioUrls((urls) => urls.slice(0, capabilities.audio.maxItems));
    if (!capabilities.image.separateLastItem) setUploadedEndImageUrl(null);
  }, []);

  const applyUserSelectedVariant = useCallback(
    (variant, mode, family, workflowId = null) => {
      if (workflowId) {
        const draftKey = getVideoWorkflowDraftKey(family.id, workflowId);
        const previous = selectionRef.current;
        const sourceWorkflowId = previous?.selectedFamilyId === family.id
          ? previous.selectedWorkflowId : null;
        const sourceDraftKey = sourceWorkflowId
          ? getVideoWorkflowDraftKey(family.id, sourceWorkflowId) : null;
        const sourceModel = sourceDraftKey
          ? videoModelCatalog.variantById.get(previous.selectedModel)?.model : null;
        const legacyMedia = mediaRef.current;
        setWorkflowMediaDrafts((drafts) => {
          if (drafts[draftKey]) return drafts;
          // Seed a new mode from matching active slots; keep existing drafts intact.
          const media = sourceDraftKey
            ? projectVideoWorkflowMedia(sourceModel, sourceWorkflowId, drafts[sourceDraftKey])
            : legacyMedia;
          return {
            ...drafts,
            [draftKey]: projectVideoWorkflowMedia(
              variant.model,
              workflowId,
              media,
            ),
          };
        });
      } else {
        reconcileReferencesForModel(variant.model);
      }
      if (shouldDisableVideoPrompt(variant.model, mode)) {
        setPrompt("");
      }
      applySelectedVariant(variant, mode, family, workflowId);
    },
    [applySelectedVariant, reconcileReferencesForModel],
  );

  // ── Persistence: Load ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PERSIST_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        let restoredMode = data.v2vMode ? "v2v" : data.imageMode ? "i2v" : "t2v";
        let restoredModelId = data.selectedModel || defaultModel.id;
        let restoredWorkflowId = null;
        let restoredModel = defaultModel;
        let restoredFamilyId = defaultFamily.id;
        let restoredResolution = data.selectedResolution;
        if (data.selectedModel) {
          const restored = resolvePersistedVideoWorkflowSelection(
            data.selectedModel,
            data.selectedWorkflowId || null,
            { hasEndFrame: Boolean(data.uploadedEndImageUrl || data.uploadedImageUrls?.[1]) },
          );
          if (restored.family && restored.variant) {
            restoredModelId = restored.variant.model.id;
            restoredMode = restored.variant.mode;
            restoredWorkflowId = restored.workflowId;
            restoredModel = restored.variant.model;
            restoredFamilyId = restored.family.id;
            const resolutionField = getGroupedVideoResolutionOptions(
              restoredFamilyId, restoredWorkflowId, restoredModelId, restoredResolution,
            );
            // Restore the exact endpoint while respecting the workflow's allowed resolutions.
            restoredResolution = resolutionField.options.find((option) =>
              option.modelId === restoredModelId && option.value === resolutionField.value,
            )?.resolution ?? restoredResolution;
            setSelectedModel(restoredModelId);
            setSelectedFamilyId(restored.family.id);
            setSelectedWorkflowId(restored.workflowId);
            setModelParameterValues(
              mergeModelParameterValues(
                restoredModel,
                data.modelParameterValues || {},
              ),
            );
          }
        }
        setImageMode(restoredMode === "i2v");
        setV2vMode(restoredMode === "v2v");
        if (data.selectedAr) setSelectedAr(data.selectedAr);
        if (data.selectedDuration) setSelectedDuration(data.selectedDuration);
        if (restoredResolution) setSelectedResolution(restoredResolution);
        if (data.selectedQuality) setSelectedQuality(data.selectedQuality);
        if (data.uploadedImageUrls) {
          setUploadedImageUrls(data.uploadedImageUrls);
        } else if (data.uploadedImageUrl) {
          setUploadedImageUrls([data.uploadedImageUrl]);
        }
        if (data.uploadedEndImageUrl) setUploadedEndImageUrl(data.uploadedEndImageUrl);
        if (data.uploadedVideoUrls) {
          setUploadedVideoUrls(data.uploadedVideoUrls);
        } else if (data.uploadedVideoUrl) {
          setUploadedVideoUrls([data.uploadedVideoUrl]);
        }
        if (data.uploadedAudioUrls) setUploadedAudioUrls(data.uploadedAudioUrls);
        const persistedDrafts =
          data.workflowMediaDrafts && typeof data.workflowMediaDrafts === "object"
            ? migrateVideoWorkflowMediaDrafts(data.workflowMediaDrafts)
            : {};
        if (restoredWorkflowId) {
          const draftKey = getVideoWorkflowDraftKey(
            restoredFamilyId,
            restoredWorkflowId,
          );
          if (!data.selectedWorkflowId || !persistedDrafts[draftKey]) {
            persistedDrafts[draftKey] = legacyVideoMediaToWorkflowDraft(
              restoredModel,
              restoredWorkflowId,
              {
                imageUrls: data.uploadedImageUrls ||
                  (data.uploadedImageUrl ? [data.uploadedImageUrl] : []),
                endImageUrl: data.uploadedEndImageUrl ||
                  (restoredWorkflowId === "keyframes" ? data.uploadedImageUrls?.[1] : null),
                videoUrls: data.uploadedVideoUrls ||
                  (data.uploadedVideoUrl ? [data.uploadedVideoUrl] : []),
                audioUrls: data.uploadedAudioUrls || [],
              },
            );
          }
        }
        setWorkflowMediaDrafts(persistedDrafts);
        if (data.prompt) setPrompt(data.prompt);
        if (data.localHistory) setLocalHistory(data.localHistory);

        // Update control visibility based on restored model/mode
        commonParameterValuesRef.current = {
          ...data.modelParameterValues,
          aspectRatio: data.selectedAr,
          duration: data.selectedDuration,
          resolution: restoredResolution,
          quality: data.selectedQuality,
        };
        applyControlsForModel(
          restoredModelId,
          restoredMode === "i2v",
          restoredMode === "v2v",
        );
      }
    } catch (err) {
      console.warn("Failed to load VideoStudio persistence:", err);
    } finally {
      hasRestored.current = true;
    }
  }, [applyControlsForModel, defaultModel.id]);

  // ── Persistence: Save ────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const state = {
          imageMode,
          v2vMode,
          selectedWorkflowId,
          selectedModel,
          selectedFamilyId,
          selectedAr,
          selectedDuration,
          selectedResolution,
          selectedQuality,
          modelParameterValues,
          uploadedImageUrls,
          uploadedEndImageUrl,
          uploadedVideoUrls,
          uploadedAudioUrls,
          workflowMediaDrafts,
          prompt,
          localHistory,
        };
        localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("Failed to save VideoStudio persistence:", err);
      }
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [
    imageMode,
    v2vMode,
    selectedWorkflowId,
    selectedModel,
    selectedFamilyId,
    selectedAr,
    selectedDuration,
    selectedResolution,
    selectedQuality,
    modelParameterValues,
    uploadedImageUrls,
    uploadedEndImageUrl,
    uploadedVideoUrls,
    uploadedAudioUrls,
    workflowMediaDrafts,
    prompt,
    localHistory,
  ]);

  // ── Derived UI values ────────────────────────────────────────────────────

  const resolveMediaTarget = useCallback((mediaType) => {
    const selection = selectionRef.current;
    const family = videoModelCatalog.familyById.get(selection.selectedFamilyId);
    const currentVariant = videoModelCatalog.variantById.get(selection.selectedModel);
    const currentCapabilities = getModelMediaCapabilities(currentVariant?.model);
    if (currentCapabilities[mediaType].maxItems > 0) {
      return {
        family,
        mode: selection.v2vMode ? "v2v" : selection.imageMode ? "i2v" : "t2v",
        variant: currentVariant,
      };
    }

    // Families with explicit workflows never switch endpoints because a file
    // was uploaded. The user chooses the workflow first.
    if (getVideoWorkflowFamily(family?.id)) return null;

    const targetMode = mediaType === "image" ? "i2v" : mediaType === "video" ? "v2v" : null;
    if (!targetMode || !family?.supports[targetMode]) return null;
    const variant = getFamilyVariant(
      videoModelCatalog,
      family,
      targetMode,
      selection.selectedModel,
    );
    return variant ? { family, mode: targetMode, variant } : null;
  }, []);

  const applyReferenceUrls = useCallback(
    (mediaType, urls, target = null, selectionAtStart = null) => {
      const validUrls = urls.filter(Boolean);
      if (validUrls.length === 0) return;
      if (selectionAtStart && !isSameSelection(selectionAtStart, selectionRef.current)) {
        toast.error(copy.errors.modelChangedDuringUpload);
        return;
      }
      const resolvedTarget = target || resolveMediaTarget(mediaType);
      if (!resolvedTarget) {
        const family = videoModelCatalog.familyById.get(selectionRef.current.selectedFamilyId);
        toast.error(copy.errors.modelDoesNotSupportReference.replace('{family}', family.name).replace('{mediaType}', mediaType));
        return;
      }

      const isCurrentVariant =
        resolvedTarget.variant.model.id === selectionRef.current.selectedModel;
      if (!isCurrentVariant) {
        reconcileReferencesForModel(resolvedTarget.variant.model);
        applySelectedVariant(
          resolvedTarget.variant,
          resolvedTarget.mode,
          resolvedTarget.family,
        );
      }

      const activeWorkflowId = selectionRef.current.selectedWorkflowId;
      const workflowConfig = activeWorkflowId
        ? getVideoWorkflowMediaConfig(resolvedTarget.variant.model, activeWorkflowId)
        : null;
      const limit = workflowConfig
        ? mediaType === "image"
          ? workflowConfig.imageLimit
          : mediaType === "video"
            ? workflowConfig.videoLimit
            : workflowConfig.audioLimit
        : getModelMediaCapabilities(resolvedTarget.variant.model)[mediaType].maxItems;
      const setter = mediaType === "image"
        ? setUploadedImageUrls
        : mediaType === "video"
          ? setUploadedVideoUrls
          : setUploadedAudioUrls;
      setter((current) => mergeReferenceUrls(current, validUrls, limit));
    },
    [applySelectedVariant, reconcileReferencesForModel, resolveMediaTarget],
  );

  // Attaches a saved character's photos as references and mentions it.
  const handleUseCharacter = useCallback((character) => {
    applyReferenceUrls("image", character.images);
    const mention = `@${characterHandle(character.name)}`;
    setPrompt((current) => (current.includes(mention) ? current : `${current.trim()} ${mention} `.trimStart()));
  }, [applyReferenceUrls]);

  const handleDrawReference = useCallback(
    (entry) => {
      if (!selectedWorkflowId) {
        applyReferenceUrls("image", [entry?.url]);
        return;
      }
      const slot = workflowMediaSlots.find((item) => {
        return (
          item.mediaType === "image" &&
          item.acceptDrop !== false &&
          getVideoWorkflowSlotRemaining(item, activeWorkflowMediaDraft) > 0
        );
      });
      if (!slot || !workflowMediaDraftKey || !entry?.url) {
        toast.error(copy.errors.sourceDoesNotAcceptImages);
        return;
      }
      setWorkflowMediaDrafts((drafts) => {
        const draft = drafts[workflowMediaDraftKey] || {};
        const activeDraft = projectVideoWorkflowMedia(
          selectedVariant?.model,
          selectedWorkflowId,
          draft,
        );
        return appendVideoWorkflowMedia(
          drafts,
          workflowMediaDraftKey,
          slot,
          [entry.url],
          activeDraft,
        );
      });
    },
    [
      activeWorkflowMediaDraft,
      applyReferenceUrls,
      selectedWorkflowId,
      selectedVariant,
      workflowMediaDraftKey,
      workflowMediaSlots,
    ],
  );

  const uploadFiles = useCallback(
    async (files, { label, maxBytes, setUploading, setProgress }) => {
      const selectedFiles = Array.from(files);
      const tooLarge = selectedFiles.find((file) => file.size > maxBytes);
      if (tooLarge) {
        alert(copy.errors.labelExceedsLimit.replace('{label}', label).replace('{limit}', Math.round(maxBytes / 1024 / 1024)));
        return [];
      }
      setUploading(true);
      setProgress(0);
      try {
        const progress = new Array(selectedFiles.length).fill(0);
        const results = await Promise.allSettled(
          selectedFiles.map((file, index) =>
            uploadFile(file, (value) => {
              progress[index] = value;
              setProgress(
                Math.round(progress.reduce((sum, item) => sum + item, 0) / progress.length),
              );
            }),
          ),
        );
        const failures = results.flatMap((result, index) =>
          result.status === "rejected"
            ? [`${selectedFiles[index].name}: ${result.reason?.message || result.reason}`]
            : [],
        );
        if (failures.length > 0) {
          alert(copy.errors.labelUploadFailed
            .replace('{label}', label)
            .replace('{message}', failures.join('\n')));
        }
        return results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
      } catch (err) {
        console.error(`[VideoStudio] ${label} upload failed:`, err);
        alert(copy.errors.labelUploadFailed.replace('{label}', label).replace('{message}', err.message));
        return [];
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [copy.errors.labelExceedsLimit, copy.errors.labelUploadFailed],
  );

  const uploadWorkflowSlotFiles = useCallback(
    async (draftKey, slot, files, context = null) => {
      if (!draftKey || !slot || workflowUploadSlotRef.current) return;
      const selectionAtStart = context?.selection || { ...selectionRef.current };
      const targetModel = videoModelCatalog.variantById.get(
        selectionAtStart.selectedModel,
      )?.model;
      const workflowIdAtStart = selectionAtStart.selectedWorkflowId;
      const draftSession = context?.session ?? workflowDraftSessionRef.current;
      const currentDraft = workflowMediaDraftsRef.current[draftKey] || {};
      const activeDraft = projectVideoWorkflowMedia(
        targetModel,
        workflowIdAtStart,
        currentDraft,
      );
      const remaining = getVideoWorkflowSlotRemaining(slot, activeDraft);
      if (remaining === 0) return;

      const selectedFiles = Array.from(files).slice(0, remaining);
      if (selectedFiles.length === 0) return;
      const options = slot.mediaType === "image"
        ? { label: slot.label, maxBytes: 10 * 1024 * 1024, setUploading: setImageUploading, setProgress: setImageProgress }
        : slot.mediaType === "video"
          ? { label: slot.label, maxBytes: 50 * 1024 * 1024, setUploading: setVideoUploading, setProgress: setVideoProgress }
          : { label: slot.label, maxBytes: 50 * 1024 * 1024, setUploading: setAudioUploading, setProgress: setAudioProgress };

      const uploadKey = `${draftKey}:${slot.id}`;
      workflowUploadSlotRef.current = uploadKey;
      setWorkflowUploadSlotId(uploadKey);
      try {
        const urls = await uploadFiles(selectedFiles, options);
        if (
          urls.length > 0 &&
          draftSession === workflowDraftSessionRef.current
        ) {
          const appendUploads = (drafts) => appendVideoWorkflowMedia(
            drafts, draftKey, slot, urls,
            projectVideoWorkflowMedia(targetModel, workflowIdAtStart, drafts[draftKey] || {}),
          );
          // Keep upload capacity current without overwriting queued draft edits.
          workflowMediaDraftsRef.current = appendUploads(workflowMediaDraftsRef.current);
          setWorkflowMediaDrafts(appendUploads);
        }
      } finally {
        workflowUploadSlotRef.current = null;
        setWorkflowUploadSlotId(null);
      }
    },
    [uploadFiles],
  );

  const uploadDroppedWorkflowFiles = useCallback(
    async (files) => {
      if (!workflowMediaDraftKey) return;
      const dropSession = workflowDraftSessionRef.current;
      const dropSelection = { ...selectionRef.current };
      const dropModel = videoModelCatalog.variantById.get(
        dropSelection.selectedModel,
      )?.model;
      const remainingFiles = Array.from(files);
      for (const slot of workflowMediaSlots) {
        if (dropSession !== workflowDraftSessionRef.current) break;
        if (slot.acceptDrop === false) continue;
        const matching = remainingFiles.filter((file) =>
          file.type.startsWith(`${slot.mediaType}/`),
        );
        if (matching.length === 0) continue;
        const currentDraft = workflowMediaDraftsRef.current[workflowMediaDraftKey] || {};
        const activeDraft = projectVideoWorkflowMedia(
          dropModel,
          dropSelection.selectedWorkflowId,
          currentDraft,
        );
        const capacity = getVideoWorkflowSlotRemaining(slot, activeDraft);
        if (capacity === 0) continue;
        const batch = matching.slice(0, capacity);
        await uploadWorkflowSlotFiles(workflowMediaDraftKey, slot, batch, {
          selection: dropSelection,
          session: dropSession,
        });
        if (dropSession !== workflowDraftSessionRef.current) break;
        for (const file of batch) {
          const index = remainingFiles.indexOf(file);
          if (index >= 0) remainingFiles.splice(index, 1);
        }
      }
    },
    [uploadWorkflowSlotFiles, workflowMediaDraftKey, workflowMediaSlots],
  );

  const removeWorkflowMedia = useCallback((slotId, index) => {
    if (!workflowMediaDraftKey) return;
    setWorkflowMediaDrafts((drafts) =>
      removeVideoWorkflowMedia(
        drafts,
        workflowMediaDraftKey,
        slotId,
        index,
      ),
    );
  }, [workflowMediaDraftKey]);

  const uploadReferences = useCallback(
    async (mediaType, files) => {
      const selectionAtStart = { ...selectionRef.current };
      const target = resolveMediaTarget(mediaType);
      if (!target) {
        const family = videoModelCatalog.familyById.get(selectionRef.current.selectedFamilyId);
        toast.error(`${family.name} does not support ${mediaType} references.`);
        return;
      }
      const capability = getModelMediaCapabilities(target.variant.model)[mediaType];
      const workflowConfig = selectionAtStart.selectedWorkflowId
        ? getVideoWorkflowMediaConfig(
            target.variant.model,
            selectionAtStart.selectedWorkflowId,
          )
        : null;
      const currentUrls = mediaType === "image"
        ? mediaRef.current.imageUrls
        : mediaType === "video"
          ? mediaRef.current.videoUrls
          : mediaRef.current.audioUrls;
      const configuredLimit = workflowConfig
        ? mediaType === "image"
          ? workflowConfig.imageLimit
          : mediaType === "video"
            ? workflowConfig.videoLimit
            : workflowConfig.audioLimit
        : capability.maxItems;
      const mainLimit =
        mediaType === "image" &&
        (capability.separateLastItem || workflowConfig?.separateEndImage)
          ? Math.min(configuredLimit, 1)
          : configuredLimit;
      const remaining = Math.max(mainLimit - currentUrls.length, 0);
      if (remaining === 0) return;

      const options = mediaType === "image"
        ? { label: copy.media.image, maxBytes: 10 * 1024 * 1024, setUploading: setImageUploading, setProgress: setImageProgress }
        : mediaType === "video"
          ? { label: copy.media.video, maxBytes: 50 * 1024 * 1024, setUploading: setVideoUploading, setProgress: setVideoProgress }
          : { label: copy.media.audio, maxBytes: 50 * 1024 * 1024, setUploading: setAudioUploading, setProgress: setAudioProgress };
      const urls = await uploadFiles(Array.from(files).slice(0, remaining), options);
      applyReferenceUrls(mediaType, urls, target, selectionAtStart);
    },
    [applyReferenceUrls, resolveMediaTarget, uploadFiles],
  );

  // ── Handle Dropped Files ────────────────────────────────────────────────
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      if (selectedWorkflowId) {
        if (workflowUploadSlotRef.current) {
          toast.error(copy.errors.waitForCurrentUpload);
          onFilesHandled?.();
          return;
        }
        void uploadDroppedWorkflowFiles(droppedFiles);
        onFilesHandled?.();
        return;
      }
      const imageFiles = droppedFiles.filter(f => f.type.startsWith('image/'));
      const videoFiles = droppedFiles.filter(f => f.type.startsWith('video/'));
      const audioFiles = droppedFiles.filter(f => f.type.startsWith('audio/'));
      
      if (videoFiles.length > 0) {
        uploadReferences("video", videoFiles);
      } else if (imageFiles.length > 0) {
        uploadReferences("image", imageFiles);
      } else if (audioFiles.length > 0) {
        uploadReferences("audio", audioFiles);
      }
      onFilesHandled?.();
    }
  }, [
    droppedFiles,
    onFilesHandled,
    selectedWorkflowId,
    uploadDroppedWorkflowFiles,
    uploadReferences,
  ]);

  // Initialise controls for default model on mount
  useEffect(() => {
    if (hasRestored.current) return;
    applyControlsForModel(defaultModel.id, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── close dropdown on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [openDropdown]);

  const handlePromptInput = (e) => {
    setPrompt(e.target.value);
  };

  // ── image upload ─────────────────────────────────────────────────────────
  const handleImageFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    try {
      await uploadReferences("image", files);
    } finally {
      if (imageFileInputRef.current) imageFileInputRef.current.value = "";
    }
  };

  const removeImageAtIndex = (idx) => {
    const nextUrls = uploadedImageUrls.filter((_, i) => i !== idx);
    setUploadedImageUrls(nextUrls);
    if (nextUrls.length === 0) {
      if (workflowFamily) return;
      if (isMotionControlSelection(selectedModel, v2vMode)) return;
      if (currentFamilyMode === "t2v" && currentModelCapabilities.image.maxItems > 0) return;
      const family = videoModelCatalog.familyById.get(selectedFamilyId);
      const target = getFamilyVariant(videoModelCatalog, family, "t2v", selectedModel);
      if (target) applyUserSelectedVariant(target, "t2v", family);
    }
  };

  // ── end-frame upload (FLF i2v models) ──────────────────────────────────────
  const handleEndImageFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert(copy.errors.imageExceeds10MB);
      return;
    }
    setEndImageUploading(true);
    setEndImageProgress(0);
    const selectionAtStart = { ...selectionRef.current };
    try {
      const url = await uploadFile(file, (pct) => {
        setEndImageProgress(pct);
      });
      const latestModel = videoModelCatalog.variantById.get(
        selectionRef.current.selectedModel,
      )?.model;
      if (
        isSameSelection(selectionAtStart, selectionRef.current) &&
        (selectionRef.current.selectedWorkflowId === "keyframes" ||
          getModelMediaCapabilities(latestModel).image.separateLastItem)
      ) {
        setUploadedEndImageUrl(url);
      }
    } catch (err) {
      alert(`End frame upload failed: ${err.message}`);
    } finally {
      setEndImageUploading(false);
      setEndImageProgress(0);
      if (endImageFileInputRef.current) endImageFileInputRef.current.value = "";
    }
  };

  const clearEndImage = () => setUploadedEndImageUrl(null);

  // ── video upload ─────────────────────────────────────────────────────────
  const handleVideoFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    try {
      await uploadReferences("video", files);
    } finally {
      if (videoFileInputRef.current) videoFileInputRef.current.value = "";
    }
  };

  const removeVideoAtIndex = (index) => {
    const nextUrls = uploadedVideoUrls.filter((_, itemIndex) => itemIndex !== index);
    setUploadedVideoUrls(nextUrls);
    if (workflowFamily) return;
    if (nextUrls.length > 0 || currentFamilyMode !== "v2v") return;
    const family = videoModelCatalog.familyById.get(selectedFamilyId);
    const target = getFamilyVariant(videoModelCatalog, family, "t2v", selectedModel);
    if (target) applyUserSelectedVariant(target, "t2v", family);
  };

  const handleAudioFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    try {
      await uploadReferences("audio", files);
    } finally {
      if (audioFileInputRef.current) audioFileInputRef.current.value = "";
    }
  };

  const removeAudioAtIndex = (index) => {
    setUploadedAudioUrls((urls) => urls.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleGroupedSelection = useCallback((plan, family, workflowId) => {
    if (!plan) {
      toast.error(groupCopy.incompatible);
      return;
    }
    const { selection, adjustments } = plan;
    const target = videoModelCatalog.variantById.get(selection.modelId);
    if (selection.resolution !== undefined) {
      commonParameterValuesRef.current = { ...commonParameterValuesRef.current, resolution: selection.resolution };
    }
    applyUserSelectedVariant(target, target.mode, family, workflowId);
    if (selection.resolution !== undefined) setSelectedResolution(selection.resolution);
    if (adjustments.length) {
      toast(describeSelectionAdjustments(adjustments));
    }
  }, [applyUserSelectedVariant, describeSelectionAdjustments, groupCopy]);

  // ── model selection from dropdown ─────────────────────────────────────────
  const handleModelSelect = useCallback(
    (pickerEntry, category = "all") => {
      const { family, variantsByMode, defaultVariant } = pickerEntry;
      if (pickerEntry.groupedVideo) {
        // Reopening the model picker must not reset a configured version.
        if (family.id === selectedFamilyId &&
            (category === "all" || (category === currentFamilyMode &&
              (category !== "t2v" || !selectedWorkflowId))) &&
            pickerEntry.variantIds.has(selectedModel)) return;
        const candidate = category !== "all"
          ? variantsByMode[category]
          : variantsByMode[currentFamilyMode] || defaultVariant;
        if (!candidate) return;
        const targetFamily = getVideoWorkflowFamily(family.id);
        const workflowId = category === "all" && selectedWorkflowId &&
          targetFamily?.workflowById.has(selectedWorkflowId)
          ? selectedWorkflowId
          : inferVideoWorkflowId(family.id, candidate.model.id);
        const remembered = workflowVariantPreferencesRef.current.get(
          workflowContextKey(family.id, workflowId),
        );
        const plan = getSelectionPlan({
          familyId: family.id,
          workflowId,
          currentModelId: family.id === selectedFamilyId ? selectedModel : remembered,
          nativeResolution: family.id === selectedFamilyId ? selectedResolution : undefined,
        });
        handleGroupedSelection(plan, family, workflowId);
        return;
      }
      const target = category !== "all"
        ? variantsByMode[category]
        : variantsByMode[currentFamilyMode] || defaultVariant;
      if (!target) return;

      const targetWorkflowFamily = getVideoWorkflowFamily(family.id);
      if (targetWorkflowFamily) {
        const workflowId = targetWorkflowFamily.base.variantIds.has(target.model.id) ||
          targetWorkflowFamily.unmanagedVariantIds.has(target.model.id)
          ? null
          : inferVideoWorkflowId(family.id, target.model.id, {
              preferredWorkflowId: family.id === selectedFamilyId
                ? selectedWorkflowId
                : null,
            });
        applyUserSelectedVariant(target, target.mode, family, workflowId);
        return;
      }

      applyUserSelectedVariant(target, target.mode, family);
    },
    [
      applyUserSelectedVariant,
      handleGroupedSelection,
      getSelectionPlan,
      currentFamilyMode,
      selectedFamilyId,
      selectedWorkflowId,
      selectedModel,
      selectedResolution,
    ],
  );

  const handleWorkflowSelect = useCallback((workflowId) => {
    if (getGroupedVideoConfiguration(selectedModel)) {
      handleGroupedSelection(getSelectionPlan({ workflowId }), selectedFamily, workflowId);
      return;
    }
    const preferred = workflowVariantPreferencesRef.current.get(
      workflowContextKey(selectedFamilyId, workflowId),
    );
    const target = resolveVideoWorkflowVariant(
      selectedFamilyId,
      workflowId,
      selectedModel,
      preferred,
    );
    if (target) {
      applyUserSelectedVariant(target, target.mode, selectedFamily, workflowId);
    }
  }, [applyUserSelectedVariant, selectedFamily, selectedFamilyId, selectedModel, getSelectionPlan, handleGroupedSelection]);

  const clearWorkflow = useCallback(() => {
    if (getGroupedVideoConfiguration(selectedModel)) {
      handleGroupedSelection(getSelectionPlan({ workflowId: null }), selectedFamily, null);
      return;
    }
    const preferred = workflowVariantPreferencesRef.current.get(
      workflowContextKey(selectedFamilyId, null),
    );
    const target = resolveVideoBaseVariant(
      selectedFamilyId,
      selectedModel,
      preferred,
    );
    if (target) applyUserSelectedVariant(target, target.mode, selectedFamily, null);
  }, [applyUserSelectedVariant, selectedFamily, selectedFamilyId, selectedModel, getSelectionPlan, handleGroupedSelection]);

  const handleGroupedOptionChange = useCallback((key, value) => {
    handleGroupedSelection(getSelectionPlan({ changes: { [key]: value } }), selectedFamily, selectedWorkflowId);
  }, [selectedFamily, selectedWorkflowId, getSelectionPlan, handleGroupedSelection]);

  const handleGroupedResolutionChange = useCallback((option) => {
    if (option.disabled) return;
    const adjustments = getGroupedVideoSelectionAdjustments({
      currentModelId: selectedModel,
      currentWorkflowId: selectedWorkflowId,
      media: activeWorkflowMediaDraft,
      nativeResolution: selectedResolution,
      commonValues: commonParameterValuesRef.current,
      selection: option,
      changes: { resolution: option.value },
    });
    handleGroupedSelection({ selection: option, adjustments }, selectedFamily, selectedWorkflowId);
    setOpenDropdown(null);
  }, [handleGroupedSelection, selectedFamily, selectedWorkflowId, selectedModel, selectedResolution, activeWorkflowMediaDraft]);

  // ── add to local history ──────────────────────────────────────────────────
  const addToLocalHistory = useCallback((entry) => {
    setLocalHistory((prev) => [entry, ...prev].slice(0, 30));
    setActiveHistoryIdx(0);
  }, []);

  // ── show result in canvas ─────────────────────────────────────────────────
  const showVideoInCanvas = useCallback((url, model) => {
    setCanvasUrl(url);
    setCanvasModel(model);
    setShowCanvas(true);
  }, []);

  // ── generate ──────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (mediaUploading || workflowUploadSlotRef.current) {
      toast.error(copy.errors.waitForCurrentUpload);
      return;
    }
    const currentModel = getCurrentModel();
    const grouped = getGroupedVideoConfiguration(selectedModel);
    const activeParameterValues = createModelParameterValues(currentModel, modelParameterValues);
    const generationParameterValues = grouped && currentModel.inputs?.omni_reference_task_type
      ? { ...activeParameterValues, omni_reference_task_type: "auto" }
      : activeParameterValues;
    const commonParams = grouped
      ? buildVideoCommonPayload(currentModel, {
          ...generationParameterValues,
          aspectRatio: selectedAr, duration: selectedDuration,
          resolution: selectedResolution, quality: selectedQuality,
        })
      : {};
    const groupedHistorySettings = grouped ? {
      ...currentModel.fixedParameters,
      ...commonParams,
      workflowId: selectedWorkflowId,
      modelParameterValues: { ...generationParameterValues },
    } : {};
    const capabilities = getModelMediaCapabilities(currentModel);
    const trimmedPrompt = promptDisabled ? "" : prompt.trim();
    const workflowMedia = selectedWorkflowId
      ? activeWorkflowMediaDraft || {}
      : {
          imageUrls: uploadedImageUrls,
          endImageUrl: uploadedEndImageUrl,
          videoUrls: uploadedVideoUrls,
          audioUrls: uploadedAudioUrls,
        };

    if (!selectedWorkflowId && uploadedVideoUrls.length > 0 && capabilities.video.maxItems === 0) {
      alert(`${selectedFamily.name} does not support video references.`);
      return;
    }
    if (!selectedWorkflowId && uploadedImageUrls.length > 0 && capabilities.image.maxItems === 0) {
      alert(`${selectedFamily.name} does not support image references.`);
      return;
    }
    if (!selectedWorkflowId && uploadedAudioUrls.length > 0 && capabilities.audio.maxItems === 0) {
      alert(`${selectedFamily.name} does not support audio references.`);
      return;
    }
    if (currentModel?.promptRequired && !trimmedPrompt) {
      alert(copy.errors.noPromptForModel);
      return;
    }

    if (selectedWorkflowId) {
      const validation = validateVideoWorkflowMedia(
        selectedWorkflowId,
        workflowMedia,
        currentModel,
      );
      if (!validation.valid) {
        alert(validation.message);
        return;
      }
    } else if (v2vMode) {
      if (!uploadedVideoUrl) {
        alert(copy.errors.uploadVideoFirst);
        return;
      }
      if (currentModel?.imageField && !currentModel?.imageOptional && !uploadedImageUrl) {
        alert(copy.errors.uploadReferenceImageForMotion);
        return;
      }
    } else if (imageMode) {
      const requiresImage =
        currentModel?.imageField && !currentModel?.imageOptional;
      if (requiresImage && uploadedImageUrls.length === 0) {
        alert(copy.errors.uploadAtLeastOneReferenceImage);
        return;
      }
    } else {
      if (!trimmedPrompt) {
        alert(copy.errors.enterPromptToGenerate);
        return;
      }
    }

    onGenerationStart?.();
    setGenerating(true);
    setGenerateError(null);

    try {
      let res;
      const referenceParams = selectedWorkflowId
        ? buildVideoWorkflowMediaParams(
            currentModel,
            selectedWorkflowId,
            workflowMedia,
          )
        : buildReferenceParams(currentModel, workflowMedia);

      if (v2vMode) {
        // V2V: dedicated processV2V handles single-input tools (e.g. watermark
        // remover) and motion-control models (which take video + image + prompt)
        const v2vParams = {
          model: selectedModel,
          ...buildSupplementalInputPayload(currentModel, generationParameterValues),
          ...commonParams,
          ...referenceParams,
        };
        if (currentModel?.hasPrompt && trimmedPrompt) {
          v2vParams.prompt = trimmedPrompt;
        }
        res = await processV2V(v2vParams);
        if (!res?.url) throw new Error(copy.errors.noVideoUrlReturned);

        const genId = res.id || Date.now().toString();
        const entry = {
          id: genId,
          url: res.url,
          prompt: currentModel?.hasPrompt ? trimmedPrompt : "",
          model: selectedModel,
          ...groupedHistorySettings,
          timestamp: new Date().toISOString(),
        };
        addToLocalHistory(entry);
        showVideoInCanvas(res.url, selectedModel);
        if (onGenerationComplete)
          onGenerationComplete({
            url: res.url,
            model: selectedModel,
            prompt: currentModel?.hasPrompt ? trimmedPrompt : "",
            type: "video",
          });
      } else if (imageMode) {
        const i2vParams = {
          model: selectedModel,
          ...buildSupplementalInputPayload(currentModel, generationParameterValues),
          ...commonParams,
          ...referenceParams,
        };
        if (trimmedPrompt) i2vParams.prompt = trimmedPrompt;
        const aspectRatios = getAspectRatiosForI2VModel(selectedModel);
        if (!grouped && aspectRatios.length > 0) i2vParams.aspect_ratio = selectedAr;
        const durations = getDurationsForI2VModel(selectedModel);
        if (!grouped && durations.length > 0) i2vParams.duration = selectedDuration;
        const resolutions = getResolutionsForI2VModel(selectedModel);
        if (!grouped && resolutions.length > 0) i2vParams.resolution = selectedResolution;
        if (!grouped && selectedQuality) i2vParams.quality = selectedQuality;

        res = await generateI2V(i2vParams);
        if (!res?.url) throw new Error(copy.errors.noVideoUrlReturned);

        const genId = res.id || Date.now().toString();
        const entry = {
          id: genId,
          url: res.url,
          prompt: trimmedPrompt,
          model: selectedModel,
          ...(!grouped ? {
            ...(aspectRatios.length > 0 ? { aspect_ratio: selectedAr } : {}),
            duration: selectedDuration,
          } : {}),
          ...groupedHistorySettings,
          timestamp: new Date().toISOString(),
        };
        addToLocalHistory(entry);
        showVideoInCanvas(res.url, selectedModel);
        if (onGenerationComplete)
          onGenerationComplete({
            url: res.url,
            model: selectedModel,
            prompt: trimmedPrompt,
            type: "video",
          });
      } else {
        // T2V
        const params = {
          model: selectedModel,
          ...buildSupplementalInputPayload(currentModel, generationParameterValues),
          ...commonParams,
          ...referenceParams,
        };
        if (trimmedPrompt) params.prompt = trimmedPrompt;

        if (!grouped) params.aspect_ratio = selectedAr;

        const durations = getDurationsForModel(selectedModel);
        if (!grouped && durations.length > 0) params.duration = selectedDuration;
        const resolutions = getResolutionsForVideoModel(selectedModel);
        if (!grouped && resolutions.length > 0) params.resolution = selectedResolution;
        if (!grouped && selectedQuality) params.quality = selectedQuality;

        res = await generateVideo(params);
        if (!res?.url) throw new Error(copy.errors.noVideoUrlReturned);

        const genId = res.id || Date.now().toString();
        const entry = {
          id: genId,
          url: res.url,
          prompt: trimmedPrompt,
          model: selectedModel,
          ...(!grouped ? {
            aspect_ratio: selectedAr,
            duration: selectedDuration,
          } : {}),
          ...groupedHistorySettings,
          timestamp: new Date().toISOString(),
        };
        addToLocalHistory(entry);
        showVideoInCanvas(res.url, selectedModel);
        if (onGenerationComplete)
          onGenerationComplete({
            url: res.url,
            model: selectedModel,
            prompt: trimmedPrompt,
            type: "video",
          });
      }
    } catch (e) {
      console.error("[VideoStudio]", e);
      const errMsg = formatErrorMessage(e, copy.errors.videoGenerationFailed);
      if (onGenerationError) onGenerationError(errMsg);
      else toast.error(errMsg);
    } finally {
      setGenerating(false);
      onGenerationEnd?.();
    }
  }, [
    copy,
    prompt,
    promptDisabled,
    v2vMode,
    imageMode,
    selectedWorkflowId,
    selectedModel,
    selectedFamily,
    selectedAr,
    selectedDuration,
    selectedResolution,
    selectedQuality,
    modelParameterValues,
    uploadedImageUrls,
    uploadedEndImageUrl,
    uploadedVideoUrls,
    uploadedAudioUrls,
    activeWorkflowMediaDraft,
    mediaUploading,
    getCurrentModel,
    addToLocalHistory,
    showVideoInCanvas,
    onGenerationComplete,
    onGenerationEnd,
    onGenerationError,
    onGenerationStart,
  ]);

  // ── reset to prompt bar ───────────────────────────────────────────────────
  const resetToPromptBar = useCallback(() => {
    setShowCanvas(false);
  }, []);

  const handleNewPrompt = useCallback(() => {
    resetToPromptBar();
    setPrompt("");
    setUploadedImageUrls([]);
    setUploadedEndImageUrl(null);
    setUploadedVideoUrls([]);
    setUploadedAudioUrls([]);
    workflowDraftSessionRef.current += 1;
    setWorkflowMediaDrafts({});
    const first = t2vModels[0];
    const family = videoModelCatalog.familyByVariantId.get(first.id);
    const variant = videoModelCatalog.variantById.get(first.id);
    applyUserSelectedVariant(variant, "t2v", family);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [applyUserSelectedVariant, resetToPromptBar]);

  // One-click follow-ups (Extend, Reframe): load a finished video into a
  // video-to-video model and let the user adjust settings before generating.
  const loadVideoIntoModel = useCallback((targetId, videoUrl) => {
    if (!targetId || !videoUrl) return;
    const variant = videoModelCatalog.variantById.get(targetId);
    const family = videoModelCatalog.familyByVariantId.get(targetId);
    const workflowId = getVideoWorkflowFamily(family.id)?.workflowById.get(EXTEND_WORKFLOW_ID)
      ?.variantIds.has(targetId)
      ? EXTEND_WORKFLOW_ID
      : null;

    resetToPromptBar();
    setPrompt("");
    applyUserSelectedVariant(variant, "v2v", family, workflowId);
    if (workflowId) {
      const draftKey = getVideoWorkflowDraftKey(family.id, workflowId);
      setWorkflowMediaDrafts((drafts) => ({ ...drafts, [draftKey]: { sourceVideo: [videoUrl] } }));
    } else {
      setUploadedVideoUrls([videoUrl]);
    }
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [applyUserSelectedVariant, resetToPromptBar]);

  const handleExtend = useCallback((entry) => {
    loadVideoIntoModel(findExtendModelId(entry.model), entry.url);
  }, [loadVideoIntoModel]);

  const handleReframe = useCallback((entry) => {
    loadVideoIntoModel(findReframeModelId(), entry.url);
  }, [loadVideoIntoModel]);

  const handleUpscale = useCallback((entry) => {
    loadVideoIntoModel(findUpscaleModelId(), entry.url);
  }, [loadVideoIntoModel]);

  // ── derived UI values ────────────────────────────────────────────────────
  const currentModelObj = selectedVariant?.model;
  const isMotionControlModel = isMotionControlSelection(selectedModel, v2vMode);
  const workflowMediaConfig = selectedWorkflowId
    ? getVideoWorkflowMediaConfig(currentModelObj, selectedWorkflowId)
    : null;
  const canUploadImageReference = workflowMediaConfig
    ? workflowMediaConfig.imageLimit > 0
    : workflowFamily
      ? currentModelCapabilities.image.maxItems > 0
    : currentModelCapabilities.image.maxItems > 0 ||
      (!v2vMode && selectedFamily.supports.i2v);
  const imageTargetVariant = workflowFamily
    ? selectedVariant
    : currentModelCapabilities.image.maxItems > 0
      ? selectedVariant
      : getFamilyVariant(videoModelCatalog, selectedFamily, "i2v", selectedModel);
  const imageUploadCapability = getModelMediaCapabilities(imageTargetVariant?.model).image;
  const imageUploadLimit = workflowMediaConfig
    ? workflowMediaConfig.imageLimit
    : imageUploadCapability.separateLastItem
      ? 1
      : imageUploadCapability.maxItems;
  const videoTargetVariant = workflowFamily
    ? selectedVariant
    : currentModelCapabilities.video.maxItems > 0
      ? selectedVariant
      : getFamilyVariant(videoModelCatalog, selectedFamily, "v2v", selectedModel);
  const videoUploadLimit = workflowMediaConfig
    ? workflowMediaConfig.videoLimit
    : getModelMediaCapabilities(videoTargetVariant?.model).video.maxItems;
  const audioUploadLimit = workflowMediaConfig
    ? workflowMediaConfig.audioLimit
    : currentModelCapabilities.audio.maxItems;
  const showEndImageUpload = workflowMediaConfig
    ? workflowMediaConfig.separateEndImage
    : imageUploadCapability.separateLastItem;

  const promptPlaceholder = selectedWorkflowId === "edit_video"
    ? copy.placeholders.editVideo
    : selectedWorkflowId === "extend_uploaded_video"
      ? copy.placeholders.continueVideo
      : selectedWorkflowId === "motion_transfer"
        ? currentModelObj?.promptRequired
          ? copy.placeholders.motion
          : copy.placeholders.motionOptional
        : v2vMode
          ? currentModelObj?.imageField
            ? currentModelObj?.promptRequired
              ? copy.placeholders.motion
              : copy.placeholders.motionOptional
            : /extend/.test(currentModelObj?.id || "")
              ? copy.placeholders.continueVideo
              : currentModelObj?.hasPrompt
                ? currentModelObj.promptRequired
                  ? copy.placeholders.editVideo
                  : copy.placeholders.describeResultOptional
                : copy.placeholders.videoReady
          : imageMode
            ? currentModelObj?.promptRequired
              ? copy.placeholders.motionOrEffect
              : copy.placeholders.motionOrEffectOptional
            : copy.placeholders.describeVideo;

  const {
    triggerRef: workflowTriggerRef,
    menuRef: workflowMenuRef,
    focusTargetRef: workflowMenuFocusTargetRef,
    onTriggerKeyDown: handleWorkflowTriggerKeyDown,
    onMenuKeyDown: handleWorkflowMenuKeyDown,
    closeMenu: closeWorkflowMenu,
  } = usePromptMenu({
    open: openDropdown === "workflow",
    onOpen: () => setOpenDropdown("workflow"),
    onClose: () => setOpenDropdown(null),
    selectionKey: selectedWorkflowId,
  });

  const toggleDropdown = (type) => (e) => {
    e.stopPropagation();
    setOpenDropdown((prev) => (prev === type ? null : type));
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col items-center justify-center bg-app-bg relative overflow-hidden"
    >
      {watermarkEntry && (
        <WatermarkDialog
          mediaUrl={watermarkEntry.url}
          kind="video"
          copy={copy.watermark}
          onClose={() => setWatermarkEntry(null)}
          onDone={(url) => {
            addToLocalHistory({ ...watermarkEntry, id: `wm-${Date.now()}`, url, timestamp: new Date().toISOString() });
            setWatermarkEntry(null);
          }}
        />
      )}
      {/* ── CENTRAL GALLERY AREA ── */}
      <div className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto custom-scrollbar pb-40 lg:pb-32 px-2">
        {history.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full pt-4 animate-fade-in-up">
            {history.map((entry, idx) => {
              return (
                <div
                  key={entry.id || idx}
                  className="relative group rounded-lg overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-xl hover:border-primary/50 transition-all duration-300 flex flex-col cursor-pointer"
                  onClick={() => setFullscreenUrl(entry.url)}
                >
                  <video
                    src={entry.url}
                    className="w-full aspect-video object-cover bg-black/40 hover:opacity-80 transition-opacity"
                    controls={false}
                    loop
                    muted
                    playsInline
                    onMouseOver={(e) => e.target.play()}
                    onMouseOut={(e) => {
                      e.target.pause();
                      e.target.currentTime = 0;
                    }}
                  />
                  
                  {/* Overlay actions */}
                  <div className="absolute top-2 right-2 hidden md:flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <GenerationCopyButtons
                      prompt={entry.prompt}
                      onCopyError={onGenerationError}
                    />
                    {findExtendModelId(entry.model) && (
                      <button
                        type="button"
                        title={copy.gallery.extend}
                        aria-label={copy.gallery.extend}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExtend(entry);
                        }}
                        className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12h12M12 6l6 6-6 6M20 5v14" />
                        </svg>
                      </button>
                    )}
                    {findReframeModelId() && (
                      <button
                        type="button"
                        title={copy.gallery.reframe}
                        aria-label={copy.gallery.reframe}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReframe(entry);
                        }}
                        className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="7" y="4" width="10" height="16" rx="1.5" />
                          <path d="M3 9v6M21 9v6" />
                        </svg>
                      </button>
                    )}
                    {findUpscaleModelId() && (
                      <button
                        type="button"
                        title={copy.gallery.upscale}
                        aria-label={copy.gallery.upscale}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpscale(entry);
                        }}
                        className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      title={copy.gallery.watermark}
                      aria-label={copy.gallery.watermark}
                      onClick={(e) => {
                        e.stopPropagation();
                        setWatermarkEntry(entry);
                      }}
                      className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 20h16" /><path d="M7 16l3.5-9h3L17 16" /><path d="M8.5 12.5h7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title={copy.gallery.download}
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadFile(entry.url, `video-${entry.id || idx}.mp4`);
                      }}
                      className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-primary hover:text-black transition-all border border-white/10"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title={copy.gallery.delete}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(copy.gallery.confirmDelete)) {
                          handleDeleteEntry(idx);
                        }
                      }}
                      className="p-2 bg-black/60 backdrop-blur-md rounded-full text-red-400 hover:bg-red-500 hover:text-white transition-all border border-white/10"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                  <MobileGenerationActions
                    prompt={entry.prompt}
                    onCopyError={onGenerationError}
                    actions={[
                      findExtendModelId(entry.model) && {
                        kind: "extend",
                        label: copy.gallery.extend,
                        onSelect: () => handleExtend(entry),
                      },
                      findReframeModelId() && {
                        kind: "reframe",
                        label: copy.gallery.reframe,
                        onSelect: () => handleReframe(entry),
                      },
                      findUpscaleModelId() && {
                        kind: "upscale",
                        label: copy.gallery.upscale,
                        onSelect: () => handleUpscale(entry),
                      },
                      {
                        kind: "watermark",
                        label: copy.gallery.watermark,
                        onSelect: () => setWatermarkEntry(entry),
                      },
                      {
                        kind: "download",
                        label: copy.gallery.download,
                        onSelect: () =>
                          downloadFile(entry.url, `video-${entry.id || idx}.mp4`),
                      },
                      {
                        kind: "delete",
                        label: copy.gallery.delete,
                        danger: true,
                        onSelect: () => {
                          if (confirm(copy.gallery.confirmDelete)) {
                            handleDeleteEntry(idx);
                          }
                        },
                      },
                    ]}
                  />

                  {/* Prompt & Details */}
                  <div className="p-3 bg-black/80 backdrop-blur-sm border-t border-white/5 flex-1 flex flex-col justify-between gap-2">
                    <p className="text-white/70 text-xs line-clamp-3 leading-relaxed" title={entry.prompt}>
                      {entry.prompt || copy.gallery.noPromptProvided}
                    </p>
                    <div className="flex items-center justify-between mt-1 flex-wrap gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded border border-primary/20 whitespace-nowrap capitalize">
                          {entry.model?.replace("-", " ") || copy.gallery.fallbackTitle}
                        </span>
                        <div className="flex gap-2">
                          {entry.resolution && (
                            <span className="text-[10px] text-white/40">{entry.resolution}</span>
                          )}
                          {entry.duration && (
                            <span className="text-[10px] text-white/40">{entry.duration}s</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full w-full animate-fade-in-up">
            <StudioEmptyState heading={copy.empty.heading} accent={selectedPickerEntry?.groupedVideo ? selectedPickerLabel : selectedFamily.name} subtitle={groupedConfiguration ? getVideoModeDescription(selectedVariant.model, selectedWorkflowId, groupCopy) : copy.empty.subtitle} starters={copy.empty.starters} onStarter={setPrompt} showcase="video" copy={copy.empty} />
          </div>
        )}
      </div>

      {/* ── BOTTOM PROMPT BAR ── */}
      <PromptComposer>
          <div className="flex flex-col gap-3">
            {/* Inline list of uploaded media files */}
            <div className="flex items-start gap-2.5 flex-wrap">
              {selectedWorkflowId ? (
                <>
                  {workflowMediaSlots.flatMap((slot) => {
                    const values = activeWorkflowMediaDraft?.[slot.id] || [];
                    return values.map((url, index) => (
                      <ReferencePreview
                        copy={copy}
                        key={`${slot.id}:${index}:${url}`}
                        type={slot.mediaType}
                        url={url}
                        index={index}
                        onRemove={(itemIndex) =>
                          removeWorkflowMedia(slot.id, itemIndex)
                        }
                        label={
                          values.length > 1
                            ? `${slot.label} · ${index + 1}`
                            : slot.label
                        }
                        description={
                          values.length > 1
                            ? `${slot.description} ${index + 1}`
                            : slot.description
                        }
                      />
                    ));
                  })}

                  {workflowMediaSlots.map((slot) => {
                    const values = activeWorkflowMediaDraft?.[slot.id] || [];
                    const remaining = getVideoWorkflowSlotRemaining(
                      slot,
                      activeWorkflowMediaDraft,
                    );
                    if (remaining <= 0) return null;
                    const uploadKey = `${workflowMediaDraftKey}:${slot.id}`;
                    const uploading = workflowUploadSlotId === uploadKey;
                    const progress = slot.mediaType === "image"
                      ? imageProgress
                      : slot.mediaType === "video"
                        ? videoProgress
                        : audioProgress;
                    return (
                      <ReferenceUploadButton
                  copy={copy}
                        key={slot.id}
                        accept={`${slot.mediaType}/*`}
                        multiple={remaining > 1}
                        onChange={async (event) => {
                          const files = Array.from(event.target.files || []);
                          event.target.value = "";
                          await uploadWorkflowSlotFiles(
                            workflowMediaDraftKey,
                            slot,
                            files,
                          );
                        }}
                        title={`${slot.description || slot.label}${slot.required ? " (required)" : " (optional)"}`}
                        uploading={uploading}
                        progress={progress}
                        type={slot.mediaType}
                        label={slot.label}
                        required={slot.required}
                        disabled={Boolean(workflowUploadSlotId)}
                      />
                    );
                  })}
                </>
              ) : (
                <>
              {uploadedImageUrls.map((url, index) => (
                <ReferencePreview
                        copy={copy}
                  key={url}
                  type="image"
                  url={url}
                  index={index}
                  onRemove={removeImageAtIndex}
                  label={
                    uploadedImageUrls.length > 1
                      ? `${copy.media.image} · ${index + 1}`
                      : copy.media.image
                  }
                />
              ))}

              {uploadedEndImageUrl && (
                <ReferencePreview
                        copy={copy}
                  type="image"
                  url={uploadedEndImageUrl}
                  index={0}
                  onRemove={clearEndImage}
                  label={copy.media.endFrame}
                />
              )}

              {uploadedVideoUrls.map((url, index) => (
                <ReferencePreview
                        copy={copy}
                  key={url}
                  type="video"
                  url={url}
                  index={index}
                  onRemove={removeVideoAtIndex}
                  label={
                    uploadedVideoUrls.length > 1
                      ? `${copy.media.video} · ${index + 1}`
                      : copy.media.video
                  }
                />
              ))}

              {uploadedAudioUrls.map((url, index) => (
                <ReferencePreview
                        copy={copy}
                  key={url}
                  type="audio"
                  url={url}
                  index={index}
                  onRemove={removeAudioAtIndex}
                  label={
                    uploadedAudioUrls.length > 1
                      ? `${copy.media.audio} · ${index + 1}`
                      : copy.media.audio
                  }
                />
              ))}

              {/* Upload trigger buttons */}
              {canUploadImageReference && uploadedImageUrls.length < imageUploadLimit && (
                <ReferenceUploadButton
                  copy={copy}
                  inputRef={imageFileInputRef}
                  accept="image/*"
                  multiple={imageUploadLimit - uploadedImageUrls.length > 1}
                  onChange={handleImageFileChange}
                  onClick={() => imageFileInputRef.current?.click()}
                  title={
                    selectedWorkflowId === "keyframes"
                      ? copy.upload.uploadStartFrame
                      : copy.upload.uploadUpToReferenceImages.replace('{count}', imageUploadLimit)
                  }
                  uploading={imageUploading}
                  progress={imageProgress}
                  type="image"
                />
              )}

              {showEndImageUpload && !uploadedEndImageUrl && (
                <ReferenceUploadButton
                  copy={copy}
                  inputRef={endImageFileInputRef}
                  accept="image/*"
                  multiple={false}
                  onChange={handleEndImageFileChange}
                  onClick={() => endImageFileInputRef.current?.click()}
                  title={copy.upload.uploadEndFrame}
                  uploading={endImageUploading}
                  progress={endImageProgress}
                  type="image"
                />
              )}

              {videoUploadLimit > 0 && uploadedVideoUrls.length < videoUploadLimit && (
                <ReferenceUploadButton
                  copy={copy}
                  inputRef={videoFileInputRef}
                  accept="video/*"
                  multiple={videoUploadLimit - uploadedVideoUrls.length > 1}
                  onChange={handleVideoFileChange}
                  onClick={() => videoFileInputRef.current?.click()}
                  title={`Upload up to ${videoUploadLimit} reference videos`}
                  uploading={videoUploading}
                  progress={videoProgress}
                  type="video"
                />
              )}

              {audioUploadLimit > 0 && uploadedAudioUrls.length < audioUploadLimit && (
                <ReferenceUploadButton
                  copy={copy}
                  inputRef={audioFileInputRef}
                  accept="audio/*"
                  multiple={audioUploadLimit - uploadedAudioUrls.length > 1}
                  onChange={handleAudioFileChange}
                  onClick={() => audioFileInputRef.current?.click()}
                  title={`Upload up to ${audioUploadLimit} reference audio files`}
                  uploading={audioUploading}
                  progress={audioProgress}
                  type="audio"
                />
              )}
                </>
              )}
            </div>

            {/* Prompt textarea */}
            <div className="flex-1 flex flex-col gap-1">
              <PromptTextarea
                ref={textareaRef}
                value={prompt}
                onChange={handlePromptInput}
                placeholder={promptPlaceholder}
                disabled={promptDisabled}
              />
            </div>
          </div>

          {groupedConfiguration && selectedVariant.model.aspectRatioMode === "inherited" && (
            <p className="px-2 text-[10px] text-white/40">{groupCopy.inheritedFormat}</p>
          )}
          {groupedConfiguration && selectedWorkflowId === "extend_uploaded_video" && groupedResolution.options.length === 0 && (
            <p className="px-2 text-[10px] text-white/40">{groupCopy.inheritedVideoResolution}</p>
          )}
          {groupedResolution?.label && (
            <p className="px-2 text-[10px] text-white/40">{groupCopy.resolutionUnknown}</p>
          )}

          {/* Bottom row: controls + generate */}
          <PromptFooter>
            <PromptControls ref={dropdownRef}>
              {/* Model btn */}
              <div className="relative">
                <button
                  type="button"
                  onClick={toggleDropdown("model")}
                  className={promptControlClassName({
                    active: openDropdown === "model",
                  })}
                >
                  {(() => {
                    const providerStyle = getProviderStyle(selectedFamily.provider);
                    return (
                      <div
                        aria-hidden="true"
                        className={`w-4 h-4 rounded shrink-0 flex items-center justify-center border text-[7px] font-black leading-none ${providerStyle.bg}`}
                      >
                        {providerStyle.text}
                      </div>
                    );
                  })()}
                <span className={PROMPT_CONTROL_LABEL_CLASS}>
                    {selectedPickerLabel}
                  </span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === "model" && (
                  <PromptPopover
                    onClick={(e) => e.stopPropagation()}
                    className="w-[calc(100vw-2rem)] md:w-[560px] max-w-md md:max-w-[calc(100vw-2rem)] max-h-[70vh]"
                    fitViewport={Boolean(groupedConfiguration)}
                    solid={Boolean(groupedConfiguration)}
                  >
                    <PromptPopoverHeader>{copy.dropdowns.model}</PromptPopoverHeader>
                    <ModelDropdown
                      selectedModel={selectedModel}
                      onSelect={handleModelSelect}
                      onClose={() => setOpenDropdown(null)}
                      copy={copy}
                      locale={locale}
                      priceMode={currentFamilyMode}
                      pricePayload={pricePayload}
                    />
                  </PromptPopover>
                )}
              </div>

              {workflowControlState.kind !== "hidden" && (
                <div className="relative flex items-center gap-1">
                  <button
                    type="button"
                    ref={workflowTriggerRef}
                    id={workflowControlId}
                    aria-haspopup={
                      workflowControlState.kind === "menu" ? "menu" : undefined
                    }
                    aria-controls={
                      workflowControlState.kind === "menu" ? workflowMenuId : undefined
                    }
                    aria-expanded={
                      workflowControlState.kind === "menu"
                        ? openDropdown === "workflow"
                        : undefined
                    }
                    aria-pressed={
                      workflowControlState.kind === "direct"
                        ? Boolean(selectedWorkflowId)
                        : undefined
                    }
                    onClick={(event) => {
                      if (workflowControlState.kind === "direct") {
                        event.stopPropagation();
                        if (selectedWorkflowId) {
                          clearWorkflow();
                        } else if (workflowControlState.workflow) {
                          handleWorkflowSelect(workflowControlState.workflow.id);
                        }
                        setOpenDropdown(null);
                        return;
                      }
                      event.stopPropagation();
                      if (openDropdown === "workflow") {
                        setOpenDropdown(null);
                        return;
                      }
                      workflowMenuFocusTargetRef.current = "selected";
                      setOpenDropdown("workflow");
                    }}
                    onKeyDown={
                      workflowControlState.kind === "menu"
                        ? handleWorkflowTriggerKeyDown
                        : undefined
                    }
                    className={promptControlClassName({
                      active: openDropdown === "workflow",
                    })}
                  >
                    <span className={PROMPT_CONTROL_LABEL_CLASS}>
                      {groupedConfiguration
                        ? groupCopy.modes[selectedWorkflowId || "text"]
                        : getVideoWorkflowControlLabel(selectedWorkflow)}
                    </span>
                    {workflowControlState.kind === "menu" && <PromptChevronIcon />}
                  </button>
                  {workflowControlState.kind === "menu" && openDropdown === "workflow" && (
                    <PromptPopover
                      className={groupedConfiguration ? "w-[300px] max-w-[calc(100vw-32px)]" : "min-w-[210px]"}
                      fitViewport={Boolean(groupedConfiguration)}
                      solid={Boolean(groupedConfiguration)}
                      style={{ maxHeight: groupedConfiguration ? "65vh" : "55vh" }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <PromptPopoverHeader>{copy.dropdowns.source}</PromptPopoverHeader>
                      <div
                        ref={workflowMenuRef}
                        id={workflowMenuId}
                        role="menu"
                        aria-labelledby={workflowControlId}
                        onKeyDown={handleWorkflowMenuKeyDown}
                        className="flex flex-col gap-1"
                      >
                        {(groupedConfiguration ? groupedModes : workflowFamily.workflows).map((workflow) => (
                          <PromptMenuItem
                            key={workflow.id || "text"}
                            selected={selectedWorkflowId === workflow.id}
                            disabled={workflow.disabled}
                            wrapDescription={Boolean(groupedConfiguration)}
                            description={groupedConfiguration && (
                              <>
                                {workflow.description}
                                {workflow.adjustmentDescription && (
                                  <span className="mt-1 block text-amber-200/85">{workflow.adjustmentDescription}</span>
                                )}
                              </>
                            )}
                            className="disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (workflow.id === null) clearWorkflow();
                              else handleWorkflowSelect(workflow.id);
                              closeWorkflowMenu(true);
                            }}
                          >
                            {workflow.label}
                          </PromptMenuItem>
                        ))}
                        {!groupedConfiguration && selectedWorkflow && workflowFamily?.hasBase && (
                          <div className="mt-2 border-t border-white/[0.05] pt-2">
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={false}
                              onClick={(event) => {
                                event.stopPropagation();
                                clearWorkflow();
                                closeWorkflowMenu(true);
                              }}
                              className="flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[11px] font-semibold text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/70 focus:outline-none focus-visible:bg-white/[0.04] focus-visible:text-white/70"
                            >
                              <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                                <path d="M3 3v5h5" />
                              </svg>
                              <span>{copy.dropdowns.baseGeneration}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </PromptPopover>
                  )}
                </div>
              )}

              <VideoOptionControl
                label={groupCopy.speed}
                field={groupedSpeed}
                open={openDropdown === "generation-speed"}
                onToggle={toggleDropdown("generation-speed")}
                onSelect={(option) => {
                  handleGroupedOptionChange("speed", option.value);
                  setOpenDropdown(null);
                }}
                copy={groupCopy}
              />

              {groupedConfiguration ? (
                <VideoSettingsControl
                  profile={groupedProfile}
                  onDefaultResolution={groupedConfiguration.profile === "legacy" && groupedConfiguration.resolution !== "default"
                    ? () => handleGroupedOptionChange("resolution", "default") : undefined}
                  qualities={commonOptions.qualities}
                  quality={selectedQuality}
                  onProfileChange={(value) => handleGroupedOptionChange("profile", value)}
                  onQualityChange={setSelectedQuality}
                  inputs={supplementalInputs}
                  values={modelParameterValues}
                  onChange={handleModelParameterChange}
                  open={openDropdown === "parameters"}
                  onToggle={toggleDropdown("parameters")}
                  copy={groupCopy}
                />
              ) : (
                <ModelParameterControls
                  inputs={supplementalInputs}
                  values={modelParameterValues}
                  onChange={handleModelParameterChange}
                  open={openDropdown === "parameters"}
                  onToggle={toggleDropdown("parameters")}
                />
              )}

              {/* Aspect ratio btn */}
              {showAr && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={toggleDropdown("ar")}
                    className={promptControlClassName({
                      active: openDropdown === "ar",
                    })}
                  >
                    <PromptAspectRatioIcon />
                    <span className={PROMPT_CONTROL_LABEL_CLASS}>
                      {getVideoAspectRatioLabel(selectedAr, groupCopy)}
                    </span>
                  </button>
                  {openDropdown === "ar" && (
                    <PromptPopover
                      onClick={(e) => e.stopPropagation()}
                    >
                      <PromptPopoverHeader>
                        {copy.dropdowns.aspectRatio}
                      </PromptPopoverHeader>
                      {aspectRatioHelp && (
                        <p className="px-3 pb-2 text-[11px] text-white/45">{aspectRatioHelp}</p>
                      )}
                      <PromptMenuList>
                        {(groupedConfiguration ? commonOptions.aspectRatios : getCurrentAspectRatios(selectedModel)).map((r) => (
                          <PromptMenuItem
                            key={r}
                            selected={selectedAr === r}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAr(r);
                              setOpenDropdown(null);
                            }}
                          >
                            {getVideoAspectRatioLabel(r, groupCopy)}
                          </PromptMenuItem>
                        ))}
                      </PromptMenuList>
                    </PromptPopover>
                  )}
                </div>
              )}

              {/* Duration btn */}
              {groupedConfiguration && (
                <VideoOptionControl
                  label={selectedWorkflowId === "extend_uploaded_video" ? groupCopy.extensionDuration : copy.dropdowns.duration}
                  field={{
                    key: "duration",
                    value: selectedDuration,
                    options: commonOptions.durations.map((value) => ({ value, label: getVideoDurationLabel(value, groupCopy) })),
                  }}
                  icon={<PromptDurationIcon />}
                  open={openDropdown === "duration"}
                  onToggle={toggleDropdown("duration")}
                  onSelect={(option) => {
                    setSelectedDuration(option.value);
                    setOpenDropdown(null);
                  }}
                  copy={groupCopy}
                />
              )}
              {!groupedConfiguration && showDuration && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={toggleDropdown("duration")}
                    className={promptControlClassName({
                      active: openDropdown === "duration",
                    })}
                  >
                    <PromptDurationIcon />
                    <span className={PROMPT_CONTROL_LABEL_CLASS}>
                      {selectedDuration}s
                    </span>
                  </button>
                  {openDropdown === "duration" && (
                    <PromptPopover
                      onClick={(e) => e.stopPropagation()}
                    >
                      <PromptPopoverHeader>
                        {copy.dropdowns.duration}
                      </PromptPopoverHeader>
                      <PromptMenuList>
                        {getCurrentDurations(selectedModel).map((d) => (
                          <PromptMenuItem
                            key={d}
                            selected={selectedDuration === d}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDuration(d);
                              setOpenDropdown(null);
                            }}
                          >
                            {d}s
                          </PromptMenuItem>
                        ))}
                      </PromptMenuList>
                    </PromptPopover>
                  )}
                </div>
              )}

              {/* Resolution btn */}
              <VideoOptionControl
                label={copy.dropdowns.resolution}
                field={groupedResolution}
                icon={<PromptQualityIcon />}
                open={openDropdown === "resolution"}
                onToggle={toggleDropdown("resolution")}
                onSelect={handleGroupedResolutionChange}
                copy={groupCopy}
              />
              {!groupedConfiguration && showResolution && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={toggleDropdown("resolution")}
                    className={promptControlClassName({
                      active: openDropdown === "resolution",
                    })}
                  >
                    <PromptQualityIcon />
                    <span className={PROMPT_CONTROL_LABEL_CLASS}>
                      {selectedResolution || "720p"}
                    </span>
                  </button>
                  {openDropdown === "resolution" && (
                    <PromptPopover
                      onClick={(e) => e.stopPropagation()}
                    >
                      <PromptPopoverHeader>
                        {copy.dropdowns.resolution}
                      </PromptPopoverHeader>
                      <PromptMenuList>
                        {getCurrentResolutions(selectedModel).map((r) => (
                          <PromptMenuItem
                            key={r}
                            selected={selectedResolution === r}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedResolution(r);
                              setOpenDropdown(null);
                            }}
                          >
                            {r}
                          </PromptMenuItem>
                        ))}
                      </PromptMenuList>
                    </PromptPopover>
                  )}
                </div>
              )}

              {canUploadImageReference && (
                <button
                  type="button"
                  className={promptControlClassName()}
                  onClick={() => setIsDrawModalOpen(true)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="opacity-40 text-white group-hover:text-[#22d3ee] transition-colors"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{copy.controls.draw}</span>
                </button>
              )}
              {!selectedWorkflowId && (
                <CharactersMenu
                  locale={locale}
                  onUse={handleUseCharacter}
                  buttonClassName={promptControlClassName()}
                  labelClassName={PROMPT_CONTROL_LABEL_CLASS}
                />
              )}
            </PromptControls>

<PromptActionGroup>
<PriceChip locale={locale} endpoint={selectedVariant?.model?.endpoint || selectedModel} payload={pricePayload} />
            {/* Generate button */}
            <PromptAction
              onClick={handleGenerate}
              disabled={generating || mediaUploading}
            >
              {generating ? (
                <>
                  <span className="animate-spin inline-block text-black">
                    ◌
                  </span>{" "}
                  {copy.controls.generating}
                </>
              ) : (
                <>
                  <span>{copy.controls.generate}</span>
                </>
              )}
            </PromptAction>
</PromptActionGroup>
          </PromptFooter>
      </PromptComposer>

      {/* ── FULLSCREEN VIDEO MODAL ── */}
      {fullscreenUrl && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-fade-in"
          onClick={() => setFullscreenUrl(null)}
        >
          <button
            type="button"
            className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors border border-white/10"
            onClick={(e) => {
              e.stopPropagation();
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
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <DrawModal
        isOpen={isDrawModalOpen}
        onClose={() => setIsDrawModalOpen(false)}
        batchSize={1}
        onAddHistoryItem={handleDrawReference}
      />
      <Toaster position="top-right" containerStyle={{ zIndex: 99999 }} toastOptions={{ duration: 5000, style: { background: '#18181b', color: '#ffffff', border: '1px solid rgba(255,255,255,0.15)', fontSize: '13px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', maxWidth: '440px', wordBreak: 'break-word', whiteSpace: 'pre-wrap', padding: '12px 16px' } }} />
    </div>
  );
}
