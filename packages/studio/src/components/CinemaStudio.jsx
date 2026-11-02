"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { generateImage, uploadFile } from "../generation.js";
import { getEndpointForModelId } from "../models.js";
import MobileGenerationActions, {
  CopyContentIcon,
} from "./MobileGenerationActions.jsx";
import {
  PROMPT_REFERENCE_REMOVE_CLASS,
  PROMPT_REFERENCE_THUMB_CLASS,
  PromptAction,
  PromptActionGroup,
  PromptChevronIcon,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptPopover,
  PromptPopoverHeader,
  PromptRatioGrid,
  PromptRatioIcon,
  PromptSegmentOption,
  PromptSegmentedControl,
  PromptSettingsGroup,
  PromptShortcutHint,
  PromptTextarea,
  promptAddTileClassName,
  promptModelButtonClassName,
  promptSettingClassName,
} from "./prompt/PromptComposer.jsx";
import { IconChevronLeft, IconChevronRight, IconPhotoPlus, IconX } from "@tabler/icons-react";
import PriceChip from "./prompt/PriceChip.jsx";
import en from "../messages/en/cinemaStudio.json";
import zh from "../messages/zh/cinemaStudio.json";
import { resolveCopy } from "../i18nUtils";
import StudioEmptyState from "./StudioEmptyState.jsx";

// ─── Constants (inlined from promptUtils) ───────────────────────────────────

const CAMERA_MAP = {
  "Modular 8K Digital": "modular 8K digital cinema camera",
  "Full-Frame Cine Digital": "full-frame digital cinema camera",
  "Grand Format 70mm Film": "grand format 70mm film camera",
  "Studio Digital S35": "Super 35 studio digital camera",
  "Classic 16mm Film": "classic 16mm film camera",
  "Premium Large Format Digital": "premium large-format digital cinema camera",
};

const LENS_MAP = {
  "Creative Tilt Lens": "creative tilt lens effect",
  "Compact Anamorphic": "compact anamorphic lens",
  "Extreme Macro": "extreme macro lens",
  "70s Cinema Prime": "1970s cinema prime lens",
  "Classic Anamorphic": "classic anamorphic lens",
  "Premium Modern Prime": "premium modern prime lens",
  "Warm Cinema Prime": "warm-toned cinema prime lens",
  "Swirl Bokeh Portrait": "swirl bokeh portrait lens",
  "Vintage Prime": "vintage prime lens",
  "Halation Diffusion": "halation diffusion filter",
  "Clinical Sharp Prime": "ultra-sharp clinical prime lens",
};

async function fetchImageAsPngBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}.`);
  }

  const sourceBlob = await response.blob();
  if (sourceBlob.type === "image/png") return sourceBlob;

  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not decode the image."));
      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create an image clipboard canvas.");
    }

    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not convert the image to PNG.")),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const FOCAL_PERSPECTIVE = {
  8: "ultra-wide perspective",
  14: "wide-angle perspective",
  24: "wide-angle dynamic perspective",
  35: "natural cinematic perspective",
  50: "standard portrait perspective",
  85: "classic portrait perspective",
};

const APERTURE_EFFECT = {
  "f/1.4": "shallow depth of field, creamy bokeh",
  "f/4": "balanced depth of field",
  "f/11": "deep focus clarity, sharp foreground to background",
};

const ASSET_URLS = {
  "Modular 8K Digital": "/assets/cinema/modular_8k_digital.webp",
  "Full-Frame Cine Digital": "/assets/cinema/full_frame_cine_digital.webp",
  "Grand Format 70mm Film": "/assets/cinema/grand_format_70mm_film.webp",
  "Studio Digital S35": "/assets/cinema/studio_digital_s35.webp",
  "Classic 16mm Film": "/assets/cinema/classic_16mm_film.webp",
  "Premium Large Format Digital":
    "/assets/cinema/premium_large_format_digital.webp",
  "Creative Tilt Lens": "/assets/cinema/creative_tilt_lens.webp",
  "Compact Anamorphic": "/assets/cinema/compact_anamorphic.webp",
  "Extreme Macro": "/assets/cinema/extreme_macro.webp",
  "70s Cinema Prime": "/assets/cinema/70s_cinema_prime.webp",
  "Classic Anamorphic": "/assets/cinema/classic_anamorphic.webp",
  "Premium Modern Prime": "/assets/cinema/premium_modern_prime.webp",
  "Warm Cinema Prime": "/assets/cinema/warm_cinema_prime.webp",
  "Swirl Bokeh Portrait": "/assets/cinema/swirl_bokeh_portrait.webp",
  "Vintage Prime": "/assets/cinema/vintage_prime.webp",
  "Halation Diffusion": "/assets/cinema/halation_diffusion.webp",
  "Clinical Sharp Prime": "/assets/cinema/clinical_sharp_prime.webp",
  "f/1.4": "/assets/cinema/f_1_4.webp",
  "f/4": "/assets/cinema/f_4.webp",
  "f/11": "/assets/cinema/f_11.webp",
};

const ASPECT_RATIOS = ["16:9", "21:9", "9:16", "1:1", "4:5"];
const RESOLUTIONS = ["1K", "2K", "4K"];
const CAMERAS = Object.keys(CAMERA_MAP);
const LENSES = Object.keys(LENS_MAP);
const FOCAL_LENGTHS = Object.keys(FOCAL_PERSPECTIVE).map((k) => parseInt(k));
const APERTURES = Object.keys(APERTURE_EFFECT);

function buildNanoBananaPrompt(
  basePrompt,
  camera,
  lens,
  focalLength,
  aperture,
) {
  const cameraDesc = CAMERA_MAP[camera] || camera;
  const lensDesc = LENS_MAP[lens] || lens;
  const perspective = FOCAL_PERSPECTIVE[focalLength] || "";
  const depthEffect = APERTURE_EFFECT[aperture] || "";
  const qualityTags = [
    "professional photography",
    "ultra-detailed",
    "8K resolution",
  ];
  const parts = [
    basePrompt,
    `shot on a ${cameraDesc}`,
    `using a ${lensDesc} at ${focalLength}mm ${perspective ? `(${perspective})` : ""}`,
    `aperture ${aperture}`,
    depthEffect,
    "cinematic lighting",
    "natural color science",
    "high dynamic range",
    qualityTags.join(", "),
  ];
  return parts.filter((p) => p && p.trim() !== "").join(", ");
}

// ─── Camera rig picker ───────────────────────────────────────────────────────

// Camera or lens art (transparent) in a dark well: "sm" on the bar's rig
// button, "lg" on the picker's rows.
function GearThumb({ name, size = "sm" }) {
  const large = size === "lg";
  return (
    <span
      aria-hidden="true"
      className={
        large
          ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] bg-[#18181d]"
          : "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-white/[0.08] bg-[#1b1b20]"
      }
    >
      {ASSET_URLS[name] && (
        <img
          src={ASSET_URLS[name]}
          alt=""
          className={large ? "h-[38px] w-[38px] object-contain" : "h-6 w-6 object-contain"}
        />
      )}
    </span>
  );
}

// Every camera or lens as a picture tile.
function GearGrid({ items, selected, onSelect }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((item) => {
        const on = item === selected;
        return (
          <button
            key={item}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(item)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-1.5 pb-2 pt-2 text-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 ${
              on
                ? "border-[#22d3ee]/55 bg-[#22d3ee]/[0.08]"
                : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.06]"
            }`}
            data-cinema-gear={item}
          >
            <img src={ASSET_URLS[item]} alt="" className="h-12 w-12 object-contain" />
            <span
              className={`line-clamp-2 text-[11px] font-medium leading-tight ${
                on ? "text-[#a5f3fc]" : "text-white/70"
              }`}
            >
              {item}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The rig button's popover: camera and lens rows that open their picture
// grids, focal length and aperture as segmented picks, and a way into the
// full camera settings.
function CameraRigPicker({ settings, onChange, onOpenFull, copy }) {
  const [view, setView] = useState("rig"); // 'rig' | 'camera' | 'lens'
  const labels = copy.cameraOverlay.columns;

  if (view !== "rig") {
    return (
      <>
        <div className="flex items-center gap-1 pb-2.5">
          <button
            type="button"
            onClick={() => setView("rig")}
            aria-label={copy.rig.back}
            title={copy.rig.back}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
          >
            <IconChevronLeft size={14} stroke={2} aria-hidden="true" />
          </button>
          <span className="text-[12px] font-semibold text-white/[0.78]">{labels[view]}</span>
        </div>
        <GearGrid
          items={view === "camera" ? CAMERAS : LENSES}
          selected={settings[view]}
          onSelect={(item) => {
            onChange(view, item);
            setView("rig");
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between px-0.5 pb-2.5">
        <span className="text-[12px] font-semibold text-white/[0.78]">{copy.rig.title}</span>
        <button
          type="button"
          onClick={onOpenFull}
          className="rounded text-[12px] font-medium text-[#67e8f9] transition-colors hover:text-[#a5f3fc] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
          data-cinema-open-full
        >
          {copy.rig.openFull}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {["camera", "lens"].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className="flex h-14 items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.035] pl-1.5 pr-3 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
            data-cinema-rig-row={key}
          >
            <GearThumb name={settings[key]} size="lg" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[11px] text-white/50">{labels[key]}</span>
              <span className="truncate text-[13px] font-medium text-white">{settings[key]}</span>
            </span>
            <IconChevronRight size={13} stroke={2} className="shrink-0 text-white/50" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div role="group" aria-label={labels.focalLength} className="mt-3 flex flex-col gap-1.5">
        <span className="px-0.5 text-[11.5px] text-white/55">{labels.focalLength}</span>
        <PromptSegmentedControl className="w-full">
          {FOCAL_LENGTHS.map((focal) => (
            <PromptSegmentOption
              key={focal}
              selected={settings.focal === focal}
              onClick={() => onChange("focal", focal)}
              aria-label={`${focal}mm`}
              className="flex-1 font-mono"
            >
              {focal}
            </PromptSegmentOption>
          ))}
        </PromptSegmentedControl>
      </div>

      <div role="group" aria-label={labels.aperture} className="mt-3 flex flex-col gap-1.5">
        <span className="px-0.5 text-[11.5px] text-white/55">{labels.aperture}</span>
        <PromptSegmentedControl className="w-full">
          {APERTURES.map((aperture) => (
            <PromptSegmentOption
              key={aperture}
              selected={settings.aperture === aperture}
              onClick={() => onChange("aperture", aperture)}
              className="flex-1 font-mono"
            >
              {aperture}
            </PromptSegmentOption>
          ))}
        </PromptSegmentedControl>
      </div>
    </>
  );
}

// Camera configuration controls

function ScrollColumn({ title, items, columnKey, value, onChange }) {
  const listRef = useRef(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const scrollTopStart = useRef(0);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    const timer = setTimeout(() => {
      const target = Array.from(list.children).find(
        (child) => child.dataset.value === String(value),
      );
      if (target) target.scrollIntoView({ block: "center" });
    }, 100);

    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const centerY = list.scrollTop + list.clientHeight / 2;
    const children = Array.from(list.children).filter(
      (child) => child.dataset.value,
    );
    let closest = null;
    let minimumDistance = Infinity;

    children.forEach((child) => {
      const childCenter = child.offsetTop + child.offsetHeight / 2;
      const distance = Math.abs(centerY - childCenter);
      if (distance < minimumDistance) {
        minimumDistance = distance;
        closest = child;
      }
    });

    children.forEach((child) => {
      const selected = child === closest;
      child.dataset.selected = String(selected);
      child.setAttribute("aria-selected", String(selected));
    });

    if (closest) {
      const nextValue =
        columnKey === "focal"
          ? parseInt(closest.dataset.value, 10)
          : closest.dataset.value;
      if (String(nextValue) !== String(value)) onChange(nextValue);
    }
  }, [columnKey, onChange, value]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    list.addEventListener("scroll", handleScroll);
    const timer = setTimeout(handleScroll, 150);

    return () => {
      list.removeEventListener("scroll", handleScroll);
      clearTimeout(timer);
    };
  }, [handleScroll]);

  const handleMouseDown = (event) => {
    const list = listRef.current;
    if (!list) return;

    isDragging.current = true;
    list.classList.add("cursor-grabbing");
    list.classList.remove("snap-y");
    startY.current = event.pageY - list.offsetTop;
    scrollTopStart.current = list.scrollTop;
    event.preventDefault();
  };

  const stopDragging = () => {
    const list = listRef.current;
    isDragging.current = false;
    if (!list) return;
    list.classList.remove("cursor-grabbing");
    list.classList.add("snap-y");
  };

  const handleMouseMove = (event) => {
    const list = listRef.current;
    if (!isDragging.current || !list) return;

    event.preventDefault();
    const y = event.pageY - list.offsetTop;
    list.scrollTop = scrollTopStart.current - (y - startY.current) * 1.5;
  };

  const handleItemClick = (item) => {
    const list = listRef.current;
    if (!list) return;

    const target = Array.from(list.children).find(
      (child) => child.dataset.value === String(item),
    );
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section className="flex w-[170px] shrink-0 snap-center flex-col md:w-[190px]">
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-white/75">{title}</h3>
        <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-b from-[#22d3ee] to-[#a855f7] shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
      </div>

      <div className="relative h-[320px] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#030303] shadow-inner">
        <div className="pointer-events-none absolute inset-x-2 top-1/2 z-0 h-[82px] -translate-y-1/2 rounded-xl border border-[#22d3ee]/20 bg-gradient-to-r from-[#22d3ee]/15 to-purple-500/10 shadow-[0_0_15px_rgba(34,211,238,0.1)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-20 bg-gradient-to-b from-[#030303] via-[#030303]/85 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-20 bg-gradient-to-t from-[#030303] via-[#030303]/85 to-transparent" />

        <div
          ref={listRef}
          role="listbox"
          aria-label={title}
          className="relative z-10 h-full cursor-grab snap-y snap-mandatory overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onMouseDown={handleMouseDown}
          onMouseLeave={stopDragging}
          onMouseUp={stopDragging}
          onMouseMove={handleMouseMove}
        >
          <div aria-hidden="true" style={{ height: "calc(50% - 41px)" }} />
          {items.map((item) => {
            const imageUrl = ASSET_URLS[item];
            const selected = String(item) === String(value);

            return (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={selected}
                data-value={item}
                data-selected={selected}
                onClick={() => handleItemClick(item)}
                className="group flex h-[82px] w-full snap-center select-none items-center justify-center gap-2.5 px-4 text-left opacity-30 transition-all duration-200 data-[selected=true]:opacity-100"
              >
                <span
                  className={`flex shrink-0 items-center justify-center font-semibold transition-colors ${
                    imageUrl
                      ? "h-10 w-10"
                      : "text-base text-white/55 group-data-[selected=true]:text-[#22d3ee]"
                  }`}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <>
                      {item}
                      {columnKey === "focal" ? "mm" : ""}
                    </>
                  )}
                </span>
                {columnKey !== "focal" && (
                  <span className="line-clamp-2 min-w-0 text-[10px] font-medium leading-snug text-white/60 transition-colors group-data-[selected=true]:text-white">
                    {item}
                  </span>
                )}
              </button>
            );
          })}
          <div aria-hidden="true" style={{ height: "calc(50% - 41px)" }} />
        </div>
      </div>

    </section>
  );
}

function CameraControlsOverlay({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  copy,
}) {
  const backdropRef = useRef(null);

  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) onClose();
  };

  const updateSetting = (key) => (val) => {
    onSettingsChange((prev) => ({ ...prev, [key]: val }));
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xl animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-config-title"
        aria-describedby="camera-config-description"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0a0a0b]/95 shadow-[0_24px_100px_rgba(0,0,0,0.75)] backdrop-blur-2xl animate-scale-up"
      >
        <div className="flex items-start justify-between border-b border-white/[0.05] px-5 py-5 md:px-7 md:py-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#22d3ee]">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14.5 4H9.5L8 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3Z" />
                <circle cx="12" cy="12.5" r="3.5" />
              </svg>
              {copy.cameraOverlay.eyebrow}
            </div>
            <h2
              id="camera-config-title"
              className="text-xl font-semibold tracking-tight text-white md:text-2xl"
            >
              {copy.cameraOverlay.title}
            </h2>
            <p
              id="camera-config-description"
              className="mt-1.5 max-w-2xl text-xs leading-relaxed text-white/45 md:text-sm"
            >
              {copy.cameraOverlay.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.cameraOverlay.closeAria}
            title={copy.cameraOverlay.close}
            className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.03] text-white/40 transition-all hover:border-white/15 hover:bg-white/[0.07] hover:text-white"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-x-auto px-5 py-6 no-scrollbar md:px-7 md:py-7">
          <div className="mx-auto flex w-max min-w-full justify-start gap-3 sm:justify-center md:gap-5">
            <ScrollColumn
              title={copy.cameraOverlay.columns.camera}
              items={CAMERAS}
              columnKey="camera"
              value={settings.camera}
              onChange={updateSetting("camera")}
            />
            <ScrollColumn
              title={copy.cameraOverlay.columns.lens}
              items={LENSES}
              columnKey="lens"
              value={settings.lens}
              onChange={updateSetting("lens")}
            />
            <ScrollColumn
              title={copy.cameraOverlay.columns.focalLength}
              items={FOCAL_LENGTHS}
              columnKey="focal"
              value={settings.focal}
              onChange={updateSetting("focal")}
            />
            <ScrollColumn
              title={copy.cameraOverlay.columns.aperture}
              items={APERTURES}
              columnKey="aperture"
              value={settings.aperture}
              onChange={updateSetting("aperture")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PERSIST_KEY = "hg_cinema_studio_persistent";

export default function CinemaStudio({
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  locale = "en",
}) {
  const copy = resolveCopy(en, zh, locale);
  // ── Settings state ──
  const [settings, setSettings] = useState({
    prompt: "",
    aspect_ratio: "16:9",
    camera: CAMERAS[0],
    lens: LENSES[0],
    focal: 35,
    aperture: "f/1.4",
  });
  const [resolution, setResolution] = useState("2K");

  // ── UI state ──
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState(null); // null = prompt view
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const imageInputRef = useRef(null);
  const [activeHistoryIndex, setactiveHistoryIndex] = useState(null);
  const [copiedPromptIndex, setCopiedPromptIndex] = useState(null);
  const [copiedImageIndex, setCopiedImageIndex] = useState(null);

  // ── History state ──
  const [internalHistory, setInternalHistory] = useState([]);

  // ── Popover state ──
  const [openDropdown, setOpenDropdown] = useState(null); // 'rig' | 'ar' | 'res' | null
  const controlsRef = useRef(null);
  const toggleDropdown = (name) =>
    setOpenDropdown((open) => (open === name ? null : name));

  useEffect(() => {
    if (!openDropdown) return undefined;
    const handleClick = (event) => {
      if (controlsRef.current && !controlsRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpenDropdown(null);
    };
    window.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  // ── Textarea auto-grow ──
  const textareaRef = useRef(null);
  const resultImgRef = useRef(null);

  const handleImageFiles = async (files) => {
    const file = files?.[0];
    if (!file) return;

    setIsUploadingImage(true);
    setImageUploadProgress(0);

    try {
      const url = await uploadFile(file, (progress) => {
        setImageUploadProgress(progress);
      });
      if (url) setUploadedImage(url);
    } catch (err) {
      console.error("Image upload failed:", err);
    } finally {
      setIsUploadingImage(false);
      setImageUploadProgress(0);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleImageUpload = async (e) => {
    await handleImageFiles(Array.from(e.target.files || []));
  };

  const removeImage = () => {
    setUploadedImage(null);
  };

  // ── Image drag-and-drop ─────────────────────────────────────────────────
  const [isImageDragging, setIsImageDragging] = useState(false);
  const imageDragCounterRef = useRef(0);

  const handleImageDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    imageDragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsImageDragging(true);
    }
  };

  const handleImageDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    imageDragCounterRef.current -= 1;
    if (imageDragCounterRef.current <= 0) {
      imageDragCounterRef.current = 0;
      setIsImageDragging(false);
    }
  };

  const handleImageDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleImageDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    imageDragCounterRef.current = 0;
    setIsImageDragging(false);
    if (isUploadingImage) return;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleImageFiles(Array.from(files));
    }
  };

  // ── Persistence: Load ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PERSIST_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.settings) setSettings(data.settings);
        if (data.resolution) setResolution(data.resolution);
        if (data.internalHistory) setInternalHistory(data.internalHistory);
        if (data.uploadedImage) setUploadedImage(data.uploadedImage);
      }
    } catch (err) {
      console.warn("Failed to load CinemaStudio persistence:", err);
    }
  }, []);

  // ── Adjust height on load ────────────────────────────────────────────────
  // ── Persistence: Save ────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const state = {
          settings,
          resolution,
          internalHistory,
          uploadedImage,
        };
        localStorage.setItem(PERSIST_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("Failed to save CinemaStudio persistence:", err);
      }
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [settings, resolution, internalHistory, uploadedImage]);

  const history = internalHistory;

  const rigSummary = copy.rig.summary
    .replace("{camera}", settings.camera)
    .replace("{lens}", settings.lens)
    .replace("{focal}", settings.focal)
    .replace("{aperture}", settings.aperture);

  // ── Textarea auto-height ──
  // ── Generate ──
  const handleGenerate = useCallback(async () => {
    const basePrompt = settings.prompt.trim();
    if (!basePrompt || isGenerating) return;

    onGenerationStart?.();
    setIsGenerating(true);

    const finalPrompt = buildNanoBananaPrompt(
      basePrompt,
      settings.camera,
      settings.lens,
      settings.focal,
      settings.aperture,
    );

    try {
      const res = await generateImage({
        model: uploadedImage ? "nano-banana-pro-edit" : "nano-banana-pro",
        prompt: finalPrompt,
        aspect_ratio: settings.aspect_ratio,
        resolution: resolution.toLowerCase(),
        negative_prompt: "blurry, low quality, distortion, bad composition",
        images_list: uploadedImage ? [uploadedImage] : [],
      });

      if (res && res.url) {
        const entry = {
          url: res.url,
          timestamp: Date.now(),
          settings: {
            prompt: basePrompt,
            camera: settings.camera,
            lens: settings.lens,
            focal: settings.focal,
            aperture: settings.aperture,
            aspect_ratio: settings.aspect_ratio,
            resolution,
          },
        };

        setInternalHistory((prev) => [entry, ...prev].slice(0, 50));

        setCanvasUrl(res.url);

        if (onGenerationComplete) {
          onGenerationComplete({
            url: res.url,
            model: "nano-banana-pro",
            prompt: basePrompt,
            type: "cinema",
          });
        }
      } else {
        throw new Error("No data returned");
      }
    } catch (e) {
      console.error(e);
      onGenerationError?.(e.message?.slice(0, 120) || "Cinema generation failed");
    } finally {
      setIsGenerating(false);
      onGenerationEnd?.();
    }
  }, [
    settings,
    resolution,
    isGenerating,
    onGenerationComplete,
    onGenerationEnd,
    onGenerationError,
    onGenerationStart,
  ]);

  // Shoot with no scene yet puts the cursor in the prompt instead.
  const handleShoot = () => {
    if (!settings.prompt.trim()) {
      textareaRef.current?.focus();
      return;
    }
    handleGenerate();
  };

  const submitOnEnter = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleShoot();
    }
  };

  // ── Regenerate ──
  const handleRegenerate = useCallback(() => {
    setCanvasUrl(null);
    // Small delay then generate
    setTimeout(() => handleGenerate(), 300);
  }, [handleGenerate]);

  // ── Download ──
  const handleDownload = useCallback(async () => {
    if (!canvasUrl) return;
    try {
      const response = await fetch(canvasUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `cinema-shot-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(canvasUrl, "_blank");
    }
  }, [canvasUrl]);

  const handleCopyPrompt = useCallback(
    async (prompt, index) => {
      if (!prompt) return;

      try {
        await navigator.clipboard.writeText(prompt);
        setCopiedPromptIndex(index);
        window.setTimeout(() => {
          setCopiedPromptIndex((current) => (current === index ? null : current));
        }, 1600);
      } catch (error) {
        console.error("Failed to copy the prompt:", error);
        onGenerationError?.("Could not copy the prompt to the clipboard.");
      }
    },
    [onGenerationError],
  );

  const handleCopyImage = useCallback(
    async (url, index) => {
      if (!url) return;

      try {
        if (
          !window.isSecureContext ||
          !navigator.clipboard?.write ||
          typeof window.ClipboardItem === "undefined"
        ) {
          throw new Error("Image clipboard access requires HTTPS or localhost.");
        }

        await navigator.clipboard.write([
          new window.ClipboardItem({
            "image/png": fetchImageAsPngBlob(url),
          }),
        ]);
        setCopiedImageIndex(index);
        window.setTimeout(() => {
          setCopiedImageIndex((current) => (current === index ? null : current));
        }, 1600);
      } catch (error) {
        console.error("Failed to copy the image:", error);
        onGenerationError?.(
          "Could not copy the image. Image copy requires HTTPS or localhost.",
        );
      }
    },
    [onGenerationError],
  );

  const resetToPrompt = () => {
    setCanvasUrl(null);
    setSettings((prev) => ({ ...prev, prompt: "" }));
    if (textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-black relative overflow-hidden">
      
      {/* ── CENTRAL GALLERY AREA ── */}
      <div className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto custom-scrollbar pb-40 lg:pb-32 px-2">
        {history.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full pt-4 oga-enter-fade">
            {history.map((entry, idx) => (
              <div
                key={entry.timestamp ?? idx}
                className="relative group rounded-lg overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-xl hover:border-[#22d3ee]/50 transition-all duration-300 flex flex-col cursor-pointer"
                onClick={() => setFullscreenUrl(entry.url)}
              >
                <img
                  src={entry.url}
                  alt={copy.card.historyItemAlt.replace("{index}", idx + 1)}
                  className="w-full aspect-[4/3] object-cover bg-black/40"
                />
                
                {/* Overlay actions */}
                <div className="absolute top-2 right-2 hidden md:flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    title={copiedPromptIndex === idx ? copy.actions.promptCopied : copy.actions.copyPrompt}
                    aria-label={copiedPromptIndex === idx ? copy.actions.promptCopied : copy.actions.copyPrompt}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCopyPrompt(entry.settings?.prompt, idx);
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 font-black backdrop-blur-md transition-all hover:bg-[#22d3ee] hover:text-black ${
                      copiedPromptIndex === idx ? "text-[#22d3ee]" : "text-white"
                    }`}
                  >
                    {copiedPromptIndex === idx ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M5 12l4 4L19 6" />
                      </svg>
                    ) : (
                      <CopyContentIcon kind="text" size={17} />
                    )}
                  </button>
                  <button
                    type="button"
                    title={copiedImageIndex === idx ? copy.actions.imageCopied : copy.actions.copyImage}
                    aria-label={copiedImageIndex === idx ? copy.actions.imageCopied : copy.actions.copyImage}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCopyImage(entry.url, idx);
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 backdrop-blur-md transition-all hover:bg-[#22d3ee] hover:text-black ${
                      copiedImageIndex === idx ? "text-[#22d3ee]" : "text-white"
                    }`}
                  >
                    {copiedImageIndex === idx ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M5 12l4 4L19 6" />
                      </svg>
                    ) : (
                      <CopyContentIcon kind="image" size={17} />
                    )}
                  </button>
                  <button
                    type="button"
                    title={copy.actions.download}
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const response = await fetch(entry.url);
                        const blob = await response.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = blobUrl;
                        a.download = `cinema-shot-${entry.id || idx}.jpg`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(blobUrl);
                      } catch {
                        window.open(entry.url, "_blank");
                      }
                    }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-full text-white hover:bg-[#22d3ee] hover:text-black transition-all border border-white/10"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title={copy.actions.delete}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(copy.actions.deleteConfirm)) {
                        setInternalHistory(prev => prev.filter((_, i) => i !== idx));
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
                  actions={[
                    {
                      kind: "text",
                      label: copy.actions.copyPrompt,
                      onSelect: () =>
                        handleCopyPrompt(entry.settings?.prompt, idx),
                    },
                    {
                      kind: "image",
                      label: copy.actions.copyImage,
                      onSelect: () => handleCopyImage(entry.url, idx),
                    },
                    {
                      kind: "download",
                      label: copy.actions.download,
                      onSelect: async () => {
                        try {
                          const response = await fetch(entry.url);
                          const blob = await response.blob();
                          const blobUrl = URL.createObjectURL(blob);
                          const anchor = document.createElement("a");
                          anchor.href = blobUrl;
                          anchor.download = `cinema-shot-${entry.id || idx}.jpg`;
                          document.body.appendChild(anchor);
                          anchor.click();
                          document.body.removeChild(anchor);
                          URL.revokeObjectURL(blobUrl);
                        } catch {
                          window.open(entry.url, "_blank");
                        }
                      },
                    },
                    {
                      kind: "delete",
                      label: copy.actions.delete,
                      danger: true,
                      onSelect: () => {
                        if (confirm(copy.actions.deleteConfirm)) {
                          setInternalHistory((prev) => prev.filter((_, i) => i !== idx));
                        }
                      },
                    },
                  ]}
                />

                {/* Details */}
                <div className="p-3 bg-black/80 backdrop-blur-sm border-t border-white/5 flex-1 flex flex-col justify-between gap-2">
                  <p
                    className="w-full text-left text-xs line-clamp-3 leading-relaxed text-white/70"
                    title={entry.settings?.prompt || copy.card.noPrompt}
                  >
                    {entry.settings?.prompt || copy.card.noPrompt}
                  </p>
                  <span className="sr-only" aria-live="polite">
                    {copiedPromptIndex === idx
                      ? copy.actions.promptCopied
                      : copiedImageIndex === idx
                        ? copy.actions.imageCopied
                        : ""}
                  </span>
                  <div className="flex items-center mt-1 flex-wrap gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-[#22d3ee] px-2 py-0.5 bg-[#22d3ee]/10 rounded border border-[#22d3ee]/20">
                        {copy.card.badge}
                      </span>
                      {entry.settings?.camera && (
                        <span className="text-[10px] text-white/40">{entry.settings.camera}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full w-full">
            <StudioEmptyState heading={copy.empty.kicker} accent={copy.empty.title} subtitle={copy.empty.description} starters={copy.empty.starters} onStarter={(prompt) => setSettings((prev) => ({ ...prev, prompt }))} showcase="image" copy={copy.empty} />
          </div>
        )}
      </div>

      {/* ── BOTTOM PROMPT BAR ── */}
      <PromptComposer
        positionClassName="absolute bottom-4 left-4 right-4 md:left-0 md:right-0 md:mx-auto md:max-w-[95%] lg:max-w-4xl z-30 transition-all duration-700 oga-enter-bar"
      >
          {/* Top row: the reference beside the prompt */}
          <div className="flex items-start gap-3">
            <div
              className="flex shrink-0 items-center"
              onDragEnter={handleImageDragEnter}
              onDragLeave={handleImageDragLeave}
              onDragOver={handleImageDragOver}
              onDrop={handleImageDrop}
              data-cinema-reference
            >
              <input
                type="file"
                ref={imageInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleImageUpload}
              />

              {uploadedImage && !isUploadingImage ? (
                <div className={PROMPT_REFERENCE_THUMB_CLASS}>
                  <img
                    src={uploadedImage}
                    alt={copy.referenceImage.alt}
                    className="h-full w-full rounded-xl object-cover"
                  />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 rounded-xl ring-inset ${
                      isImageDragging ? "ring-2 ring-[#22d3ee]" : "ring-1 ring-white/10"
                    }`}
                  />
                  <button
                    type="button"
                    aria-label={copy.reference.remove}
                    title={copy.reference.remove}
                    onClick={removeImage}
                    className={PROMPT_REFERENCE_REMOVE_CLASS}
                  >
                    <IconX size={9} stroke={3} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={
                    isUploadingImage
                      ? copy.reference.uploading.replace("{progress}", imageUploadProgress)
                      : copy.reference.add
                  }
                  title={copy.reference.add}
                  disabled={isUploadingImage}
                  onClick={() => imageInputRef.current?.click()}
                  className={promptAddTileClassName({ dragging: isImageDragging })}
                >
                  {isUploadingImage ? (
                    <svg width="26" height="26" viewBox="0 0 26 26" className="-rotate-90" aria-hidden="true">
                      <circle cx="13" cy="13" r="11" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/10" />
                      <circle
                        cx="13"
                        cy="13"
                        r="11"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray={69.1}
                        strokeDashoffset={69.1 * (1 - imageUploadProgress / 100)}
                        className="text-[#22d3ee] transition-[stroke-dashoffset] duration-300"
                      />
                    </svg>
                  ) : (
                    <IconPhotoPlus size={18} stroke={1.75} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>

            <PromptTextarea
              ref={textareaRef}
              value={settings.prompt}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, prompt: e.target.value }))
              }
              onKeyDown={submitOnEnter}
              placeholder={copy.prompt.placeholder}
              className="min-w-0 flex-1 !min-h-[44px] !pt-[10px]"
            />
          </div>

          {/* Bottom row: camera rig, output settings | shoot */}
          <PromptFooter>
            <PromptControls ref={controlsRef}>
              <div className="relative min-w-0">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={openDropdown === "rig"}
                  aria-label={rigSummary}
                  title={rigSummary}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDropdown("rig");
                  }}
                  className={promptModelButtonClassName({
                    active: openDropdown === "rig",
                    className: "max-w-full !pl-1",
                  })}
                  data-cinema-rig
                >
                  <GearThumb name={settings.camera} />
                  <span className="min-w-0 max-w-[9rem] truncate sm:max-w-[12rem]">{settings.camera}</span>
                  <span aria-hidden="true" className="hidden h-3.5 w-px shrink-0 bg-white/[0.12] lg:block" />
                  <span className="hidden max-w-[10rem] truncate text-white/[0.64] lg:block">{settings.lens}</span>
                  <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-white/[0.12]" />
                  <span className="shrink-0 font-mono text-[12px] text-white/[0.64]">
                    {settings.focal}mm {settings.aperture}
                  </span>
                  <PromptChevronIcon className={openDropdown === "rig" ? "rotate-180" : ""} />
                </button>

                {openDropdown === "rig" && (
                  <PromptPopover
                    role="dialog"
                    aria-label={copy.rig.title}
                    onClick={(e) => e.stopPropagation()}
                    className="w-[384px] max-w-[calc(100vw-2rem)] max-h-[70vh] !p-3"
                    fitViewport
                    solid
                    data-cinema-rig-picker
                  >
                    <CameraRigPicker
                      settings={settings}
                      onChange={(key, value) =>
                        setSettings((prev) => ({ ...prev, [key]: value }))
                      }
                      onOpenFull={() => {
                        setOpenDropdown(null);
                        setIsOverlayOpen(true);
                      }}
                      copy={copy}
                    />
                  </PromptPopover>
                )}
              </div>

              <PromptSettingsGroup label={copy.dropdowns.outputSettings}>
                <div key="ratio" className="relative flex">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={openDropdown === "ar"}
                    aria-label={`${copy.dropdowns.aspectRatio}: ${settings.aspect_ratio}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDropdown("ar");
                    }}
                    className={promptSettingClassName({ active: openDropdown === "ar" })}
                    data-cinema-setting="ratio"
                  >
                    <PromptRatioIcon ratio={settings.aspect_ratio} active={openDropdown === "ar"} />
                    {settings.aspect_ratio}
                  </button>

                  {openDropdown === "ar" && (
                    <PromptPopover
                      role="dialog"
                      aria-label={copy.dropdowns.aspectRatio}
                      onClick={(e) => e.stopPropagation()}
                      className="w-[340px] max-w-[calc(100vw-2rem)] max-h-[60vh]"
                      fitViewport
                      data-cinema-ratio-picker
                    >
                      <PromptPopoverHeader>{copy.dropdowns.aspectRatio}</PromptPopoverHeader>
                      <PromptRatioGrid
                        options={ASPECT_RATIOS}
                        selected={settings.aspect_ratio}
                        onSelect={(val) => {
                          setSettings((prev) => ({ ...prev, aspect_ratio: val }));
                          setOpenDropdown(null);
                        }}
                      />
                    </PromptPopover>
                  )}
                </div>

                <div key="resolution" className="relative flex">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={openDropdown === "res"}
                    aria-label={`${copy.dropdowns.resolution}: ${resolution}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDropdown("res");
                    }}
                    className={promptSettingClassName({ active: openDropdown === "res" })}
                    data-cinema-setting="resolution"
                  >
                    {resolution}
                  </button>

                  {openDropdown === "res" && (
                    <PromptPopover
                      role="dialog"
                      aria-label={copy.dropdowns.resolution}
                      onClick={(e) => e.stopPropagation()}
                      className="w-[220px]"
                      data-cinema-resolution-picker
                    >
                      <PromptPopoverHeader>{copy.dropdowns.resolution}</PromptPopoverHeader>
                      <PromptSegmentedControl className="w-full">
                        {RESOLUTIONS.map((option) => (
                          <PromptSegmentOption
                            key={option}
                            selected={resolution === option}
                            onClick={() => {
                              setResolution(option);
                              setOpenDropdown(null);
                            }}
                            className="flex-1 font-mono"
                          >
                            {option}
                          </PromptSegmentOption>
                        ))}
                      </PromptSegmentedControl>
                    </PromptPopover>
                  )}
                </div>
              </PromptSettingsGroup>
            </PromptControls>

            <PromptActionGroup>
              <PromptShortcutHint />
              <PromptAction
                onClick={handleShoot}
                disabled={isGenerating}
                addon={
                  <PriceChip
                    variant="inset"
                    locale={locale}
                    endpoint={getEndpointForModelId(uploadedImage ? "nano-banana-pro-edit" : "nano-banana-pro")}
                    payload={{ aspect_ratio: settings.aspect_ratio, resolution: resolution.toLowerCase() }}
                  />
                }
                data-cinema-shoot
              >
                {isGenerating ? (
                  <>
                    <span className="animate-spin inline-block">◌</span>
                    {copy.prompt.generating}
                  </>
                ) : (
                  copy.prompt.generate
                )}
              </PromptAction>
            </PromptActionGroup>
          </PromptFooter>
      </PromptComposer>
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
          <img
            src={fullscreenUrl}
            alt={copy.fullscreen.alt}
            className="max-w-[95vw] max-h-[95vh] rounded-2xl shadow-2xl object-contain animate-scale-up" 
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}  
      {/* ── Camera Controls Overlay ── */}
      <CameraControlsOverlay
        isOpen={isOverlayOpen}
        onClose={() => setIsOverlayOpen(false)}
        settings={settings}
        onSettingsChange={setSettings}
        copy={copy}
      />
    </div>
  );
}
