"use client";

import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowUpRight,
  IconArrowsDiagonal,
  IconArrowsMaximize,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconDots,
  IconDownload,
  IconEraser,
  IconEye,
  IconEyeOff,
  IconHandStop,
  IconHighlight,
  IconLasso,
  IconLine,
  IconMarquee2,
  IconMinus,
  IconPalette,
  IconPhotoPlus,
  IconPlus,
  IconPointer,
  IconRotate3d,
  IconScissors,
  IconSparkles,
  IconSquare,
  IconStack2,
  IconSun,
  IconTrash,
  IconTriangleSquareCircle,
  IconTypography,
  IconX,
} from "@tabler/icons-react";
import {
  decomposeLayers,
  uploadFile,
  generateI2I,
  upscaleImage,
  removeBackground,
  expandImage,
} from "../generation.js";
import { getEndpointForModelId } from "../models.js";
import {
  PROMPT_REFERENCE_THUMB_CLASS,
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
  PromptSegmentOption,
  PromptSegmentedControl,
  PromptSettingsGroup,
  PromptShortcutHint,
  PromptTextarea,
  promptAddTileClassName,
  promptModelButtonClassName,
  promptSettingClassName,
} from "./prompt/PromptComposer.jsx";
import PriceChip from "./prompt/PriceChip.jsx";
import { formatErrorMessage } from "../utils/formatError.js";
import en from "../messages/en/layersStudio.json";
import zh from "../messages/zh/layersStudio.json";
import { resolveCopy } from "../i18nUtils";

// Upscale Models Definition from schema_data.json
const UPSCALE_MODELS = [
  {
    id: "topaz-image-upscale",
    name: "Topaz",
    subtitle: "The default model for general-purpose...",
  },
  {
    id: "seedvr2-image-upscale",
    name: "SeedVR2",
    subtitle: "Diffusion-transformer super-resolution (up to 8K)",
  },
  {
    id: "ai-image-upscaler",
    name: "AI Upscaler",
    subtitle: "Fast 1-click automatic super-resolution",
  },
];

// Preset colors for Marker & Shapes tool
const PRESET_COLORS = [
  "#ffffff", // White
  "#22c55e", // Green
  "#eab308", // Yellow
  "#ef4444", // Red
  "#14b8a6", // Turquoise
  "#38bdf8", // Sky Blue
  "#ec4899", // Pink
  "#000000", // Black
];

const DEFAULT_COLOR_GRADING = {
  colorCorrect: {
    temp: 0,
    hue: 0.0,
    saturation: 0,
    contrast: 0,
    splitTone: 0.0,
  },
  softenDetails: { radius: 0, detail: 0.0 },
  bloom: { radius: 0, bright: 4.0, fade: 0.0, blend: "Screen" },
  halation: { strength: 0.0, threshold: 0.0, radius: 0 },
  lensInstructions: {
    strength: 0.0,
    radius: 0,
    vignette: 0.0,
    distortion: 0.0,
  },
  exposure: { stops: 0.0 },
  filmGrain: { strength: 0.0, bias: 0.0, size: "16mm" },
};

// ─── Tools, grading controls and the studio's floating pieces ────────────────

// The first five are tabs; the rest sit under "More".
const TOOLS = [
  { id: "layer-decomposition", Icon: IconStack2 },
  { id: "upscale", Icon: IconArrowsDiagonal },
  { id: "color-grading", Icon: IconPalette },
  { id: "remove-bg", Icon: IconScissors },
  { id: "expand-crop", Icon: IconArrowsMaximize },
  { id: "edit-text", Icon: IconTypography, more: true },
  { id: "enhancer", Icon: IconSparkles, more: true },
  { id: "relight", Icon: IconSun, more: true },
  { id: "angles", Icon: IconRotate3d, more: true },
];

// Tools whose run reads what is typed in the bar.
const PROMPT_TOOLS = new Set(["layer-decomposition", "edit-text", "relight", "angles"]);

const LAYER_RESOLUTIONS = ["1K", "1.5K", "2K"];
const TOPAZ_FACTORS = [1, 2, 4, 8];
const SEEDVR_RESOLUTIONS = ["2k", "4k", "8k"];

// Every color-grading control, section by section: a slider (range and
// shown digits) or a choice between options.
const GRADE_SECTIONS = [
  {
    key: "colorCorrect",
    controls: [
      { key: "temp", min: -100, max: 100, step: 1, digits: 0 },
      { key: "hue", min: -180, max: 180, step: 0.5, digits: 1 },
      { key: "saturation", min: -100, max: 100, step: 1, digits: 0 },
      { key: "contrast", min: -100, max: 100, step: 1, digits: 0 },
      { key: "splitTone", min: 0, max: 1, step: 0.05, digits: 2 },
    ],
  },
  {
    key: "softenDetails",
    controls: [
      { key: "radius", min: 0, max: 50, step: 1, digits: 0 },
      { key: "detail", min: 0, max: 1, step: 0.05, digits: 2 },
    ],
  },
  {
    key: "bloom",
    controls: [
      { key: "radius", min: 0, max: 50, step: 1, digits: 0 },
      { key: "bright", min: 0, max: 10, step: 0.5, digits: 1 },
      { key: "fade", min: 0, max: 1, step: 0.05, digits: 2 },
      { key: "blend", options: ["Screen", "Soft Light"] },
    ],
  },
  {
    key: "halation",
    controls: [
      { key: "strength", min: 0, max: 1, step: 0.05, digits: 2 },
      { key: "threshold", min: 0, max: 1, step: 0.05, digits: 2 },
      { key: "radius", min: 0, max: 50, step: 1, digits: 0 },
    ],
  },
  {
    key: "lensInstructions",
    controls: [
      { key: "strength", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "radius", min: 0, max: 50, step: 1, digits: 0 },
      { key: "vignette", min: 0, max: 1, step: 0.05, digits: 2 },
      { key: "distortion", min: -1, max: 1, step: 0.05, digits: 2 },
    ],
  },
  {
    key: "exposure",
    controls: [{ key: "stops", min: -5, max: 5, step: 0.1, digits: 1 }],
  },
  {
    key: "filmGrain",
    controls: [
      { key: "strength", min: 0, max: 1, step: 0.05, digits: 2 },
      { key: "bias", min: 0, max: 1, step: 0.05, digits: 2 },
      { key: "size", options: ["35mm", "16mm", "8mm"] },
    ],
  },
];

const gradeChangesIn = (grading, section) =>
  section.controls.filter(
    (control) =>
      grading[section.key][control.key] !==
      DEFAULT_COLOR_GRADING[section.key][control.key],
  ).length;

// The floating surfaces on the canvas (tabs, tool rail, layers card) share
// the prompt bar's material.
const FLOATING_CARD_CLASS =
  "border border-white/[0.12] bg-[#111114] shadow-[0_16px_40px_rgba(0,0,0,0.45)]";

const toolTabClassName = (selected) =>
  `flex h-[34px] shrink-0 items-center gap-[7px] rounded-[9px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 ${
    selected
      ? "bg-white/[0.09] text-white"
      : "text-white/[0.62] hover:bg-white/[0.05] hover:text-white"
  }`;

const railButtonClassName = (active) =>
  `flex h-[38px] w-[38px] items-center justify-center rounded-[10px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 disabled:opacity-30 ${
    active
      ? "bg-[#22d3ee]/[0.12] text-[#67e8f9]"
      : "text-white/60 hover:bg-white/[0.06] hover:text-white"
  }`;

const SMALL_ICON_BUTTON_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 disabled:opacity-30";

// Transparent pixels in a layer read as transparent over this.
const CHECKERBOARD_STYLE = {
  backgroundColor: "#17171a",
  backgroundImage:
    "linear-gradient(45deg, #24242a 25%, transparent 25%), linear-gradient(-45deg, #24242a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #24242a 75%), linear-gradient(-45deg, transparent 75%, #24242a 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
};

// A slider filled from zero (the middle, for ranges that go negative).
function rangeTrack(value, min, max) {
  const span = max - min || 1;
  const zero = min < 0 ? (-min / span) * 100 : 0;
  const at = ((value - min) / span) * 100;
  const from = Math.min(zero, at);
  const to = Math.max(zero, at);
  return `linear-gradient(90deg, rgba(255,255,255,0.12) ${from}%, #22d3ee ${from}%, #22d3ee ${to}%, rgba(255,255,255,0.12) ${to}%)`;
}

function GradeSlider({ id, label, value, min, max, step, digits, changed, onChange }) {
  const shown = `${min < 0 && value > 0 ? "+" : ""}${value.toFixed(digits)}`;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-[76px] shrink-0 text-[12.5px] text-white/70">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="oga-range min-w-0 flex-1"
        style={{ background: rangeTrack(value, min, max) }}
      />
      <span
        className={`w-11 shrink-0 text-right font-mono text-[12px] tabular-nums ${
          changed ? "text-white" : "text-white/45"
        }`}
      >
        {shown}
      </span>
    </div>
  );
}

function ColorSwatches({ colors, value, onChange, customLabel }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
          className={`h-5 w-5 rounded-full border border-white/20 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] ${
            value === color ? "ring-2 ring-[#22d3ee] ring-offset-2 ring-offset-[#111114]" : ""
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
      {customLabel && (
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={customLabel}
          title={customLabel}
          className="h-5 w-5 cursor-pointer appearance-none overflow-hidden rounded-full border border-white/20 bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
        />
      )}
    </div>
  );
}

export default function LayersStudio({
  hasProvider,
  droppedFiles,
  onFilesHandled,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  locale = "en",
}) {
  const copy = resolveCopy(en, zh, locale);

  // Main canvas & image state
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Layer Decomposition Sidebar Settings
  const [resolution, setResolution] = useState("1K"); // '1K' | '1.5K' | '2K'
  const [layerCount, setLayerCount] = useState(8);
  const [outputFormat, setOutputFormat] = useState("png");

  // Upscale Clean Panel State
  const [upscaleModel, setUpscaleModel] = useState("topaz-image-upscale");
  const [topazFactor, setTopazFactor] = useState(1);
  const [seedvrResolution, setSeedvrResolution] = useState("4k");

  // Color Grading State (Individual Category Resets, No Toggles)
  const [colorGrading, setColorGrading] = useState(DEFAULT_COLOR_GRADING);

  // Which Adjustments sections are open
  const [openSections, setOpenSections] = useState({
    colorCorrect: true,
    softenDetails: false,
    bloom: false,
    halation: false,
    lensInstructions: false,
    exposure: false,
    filmGrain: false,
  });

  // Active Tool state: 'pointer' | 'hand' | 'lasso' | 'regional-edit' | 'draw' | 'eraser' | 'shapes'
  const [activeTool, setActiveTool] = useState("pointer");

  // Viewport Zoom & Pan
  const [zoomLevel, setZoomLevel] = useState(100);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // 1. FREEHAND LASSO EDIT STATE
  const [lassoPoints, setLassoPoints] = useState([]);
  const [isDraggingLasso, setIsDraggingLasso] = useState(false);

  // 2. RECTANGULAR REGIONAL EDIT BOX STATE
  const [regionalBox, setRegionalBox] = useState({
    x: 25,
    y: 35,
    width: 50,
    height: 30,
  });
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);
  const [dragStartRegion, setDragStartRegion] = useState(null);

  // Floating Regional/Lasso Prompt State
  const [regionalPrompt, setRegionalPrompt] = useState("");

  // 3. MARKED REGIONS STACK FOR SEEDREAM 5 PRO BBOX LAYER PROMPTING
  const [markedRegions, setMarkedRegions] = useState([]);

  // 4. SHAPES (R) TOOL STATE
  const [activeShape, setActiveShape] = useState("rect");
  const [shapeColor, setShapeColor] = useState("#ffffff");
  const [shapeSize, setShapeSize] = useState(3);
  const [isDrawingShape, setIsDrawingShape] = useState(false);
  const [shapeStart, setShapeStart] = useState({ x: 0, y: 0 });
  const tempCanvasImageData = useRef(null);

  // 5. DRAWING / MARKER PEN STATE
  const [brushColor, setBrushColor] = useState("#ef4444");
  const [brushSize, setBrushSize] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);

  // The active tool (a TOOLS id) and the bar's open popover
  const [activeSideTab, setActiveSideTab] = useState("layer-decomposition");
  const [openDropdown, setOpenDropdown] = useState(null);
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const textareaRef = useRef(null);

  // A click outside a popover (popovers stop their own clicks) or Escape closes it.
  useEffect(() => {
    if (!openDropdown) return undefined;
    const close = () => setOpenDropdown(null);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", close);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  // Tool Specific Inputs
  const [textEditPrompt, setTextEditPrompt] = useState("");

  // Upload & Decomposed Layers State
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [decomposedLayers, setDecomposedLayers] = useState([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [visibleLayers, setVisibleLayers] = useState({});
  const [isSoloMode, setIsSoloMode] = useState(false);

  // On a phone the layers card would cover the image: it arrives collapsed.
  const hasLayers = decomposedLayers.length > 0;
  useEffect(() => {
    if (hasLayers) setLayersCollapsed(window.innerWidth < 640);
  }, [hasLayers]);

  // Canvas Refs
  const fileInputRef = useRef(null);
  const drawingCanvasRef = useRef(null);
  const imageRef = useRef(null);
  const imageWrapperRef = useRef(null);
  const canvasContainerRef = useRef(null);

  // Drag & Drop Upload State
  const [isDropzoneDragging, setIsDropzoneDragging] = useState(false);
  const dropzoneDragCounterRef = useRef(0);

  // Drawing History Stack
  const [historyStack, setHistoryStack] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Handle external dropped files passed from parent shell
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      const file = droppedFiles[0];
      if (file.type.startsWith("image/")) {
        handleUploadFile(file);
        if (onFilesHandled) onFilesHandled();
      }
    }
  }, [droppedFiles, onFilesHandled]);

  // Sync drawing canvas overlay resolution with displayed image
  const syncCanvasDimensions = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    const img = imageRef.current;
    if (canvas && img && img.complete) {
      canvas.width = img.naturalWidth || img.clientWidth || 1024;
      canvas.height = img.naturalHeight || img.clientHeight || 1024;
    }
  }, []);

  useEffect(() => {
    syncCanvasDimensions();
  }, [currentImageUrl, syncCanvasDimensions]);

  // Live CSS Filter computation from Color Grading settings
  const getColorGradingCSSFilter = () => {
    let filterStr = "";
    const { colorCorrect, exposure, softenDetails, bloom, halation } =
      colorGrading;

    // Exposure (stops: -5..5 -> brightness multiplier 2^stops)
    if (exposure.stops !== 0) {
      const expBrightness = Math.max(0, Math.pow(2, exposure.stops) * 100);
      filterStr += `brightness(${expBrightness}%) `;
    }

    // Color Correct (contrast, saturation, hue, temp, splitTone)
    if (colorCorrect.contrast !== 0) {
      filterStr += `contrast(${100 + colorCorrect.contrast}%) `;
    }
    if (colorCorrect.saturation !== 0) {
      filterStr += `saturate(${100 + colorCorrect.saturation}%) `;
    }
    if (colorCorrect.hue !== 0) {
      filterStr += `hue-rotate(${colorCorrect.hue}deg) `;
    }
    if (colorCorrect.temp !== 0) {
      if (colorCorrect.temp > 0) {
        filterStr += `sepia(${colorCorrect.temp * 0.45}%) saturate(${100 + colorCorrect.temp * 0.3}%) `;
      } else {
        filterStr += `hue-rotate(${colorCorrect.temp * 0.5}deg) saturate(${100 + Math.abs(colorCorrect.temp) * 0.2}%) `;
      }
    }
    if (colorCorrect.splitTone > 0) {
      filterStr += `saturate(${100 + colorCorrect.splitTone * 40}%) contrast(${100 + colorCorrect.splitTone * 20}%) `;
    }

    // Soften Details (blur)
    if (softenDetails.radius > 0) {
      filterStr += `blur(${softenDetails.radius * 0.25}px) `;
    }

    // Bloom (glow / brightness halo)
    if (bloom.radius > 0 || bloom.bright !== 4.0) {
      const bloomOpacity = (bloom.bright / 10) * (1 - bloom.fade) * 0.45;
      if (bloomOpacity > 0) {
        filterStr += `drop-shadow(0 0 ${bloom.radius || 8}px rgba(255,255,255,${bloomOpacity})) `;
      }
    }

    // Halation (red edge glow around highlights)
    if (halation.strength > 0) {
      filterStr += `drop-shadow(0 0 ${halation.radius || 6}px rgba(255, 45, 30, ${halation.strength * 0.85})) `;
    }

    return filterStr.trim() || "none";
  };

  // Upload File Helper
  const handleUploadFile = async (file) => {
    if (!hasProvider) {
      toast.error(copy.toasts.noProvider);
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const uploadedUrl = await uploadFile(file, (pct) =>
        setUploadProgress(pct),
      );
      setCurrentImageUrl(uploadedUrl);
      setDecomposedLayers([]);
      setMarkedRegions([]);
      setCarouselIndex(0);
      setLassoPoints([]);
      clearDrawingCanvas();
      toast.success(copy.toasts.imageUploaded);
    } catch (err) {
      toast.error(copy.toasts.uploadFailed.replace('{error}', formatErrorMessage(err)));
    } finally {
      setUploading(false);
    }
  };

  // Shared entry point for both click-to-browse and drag-and-drop uploads
  const handleFiles = (files) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
    const file = fileList.find((f) => f.type.startsWith("image/")) || fileList[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(copy.toasts.uploadImageFileOnly);
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error(copy.toasts.fileTooLarge.replace('{name}', file.name));
      return;
    }

    handleUploadFile(file);
  };

  const handleFileInputChange = (e) => {
    handleFiles(e.target.files);
    e.target.value = "";
  };

  const handleDropzoneDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzoneDragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDropzoneDragging(true);
    }
  };

  const handleDropzoneDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzoneDragCounterRef.current -= 1;
    if (dropzoneDragCounterRef.current <= 0) {
      dropzoneDragCounterRef.current = 0;
      setIsDropzoneDragging(false);
    }
  };

  const handleDropzoneDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDropzoneDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzoneDragCounterRef.current = 0;
    setIsDropzoneDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  };

  // Helper to convert mouse/touch events to normalized coordinates (0 to 1000) & percentages
  const getImageNormalizedCoords = (e) => {
    const wrapper = imageWrapperRef.current || imageRef.current;
    if (!wrapper) return { x: 0, y: 0, xPct: 0, yPct: 0 };
    const rect = wrapper.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const xPx = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const yPx = Math.max(0, Math.min(rect.height, clientY - rect.top));

    return {
      x: (xPx / rect.width) * 1000,
      y: (yPx / rect.height) * 1000,
      xPct: (xPx / rect.width) * 100,
      yPct: (yPx / rect.height) * 100,
    };
  };

  // --- LASSO, REGIONAL & REAL-TIME SHAPE SELECTION DRAG LOGIC ---
  const handleImageMouseDown = (e) => {
    const coords = getImageNormalizedCoords(e);

    if (activeTool === "lasso") {
      e.stopPropagation();
      setIsDraggingLasso(true);
      setLassoPoints([{ x: coords.x, y: coords.y }]);
    } else if (activeTool === "regional-edit") {
      e.stopPropagation();
      setDragStartRegion(coords);
      setIsSelectingRegion(true);
      setRegionalBox({ x: coords.xPct, y: coords.yPct, width: 0, height: 0 });
    } else if (activeTool === "shapes") {
      e.stopPropagation();
      setIsDrawingShape(true);
      const canvasCoords = getCanvasCoords(e);
      setShapeStart(canvasCoords);

      const canvas = drawingCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        tempCanvasImageData.current = ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }
    }
  };

  const handleImageMouseMove = (e) => {
    const coords = getImageNormalizedCoords(e);

    if (activeTool === "lasso" && isDraggingLasso) {
      e.stopPropagation();
      setLassoPoints((prev) => [...prev, { x: coords.x, y: coords.y }]);
    } else if (
      activeTool === "regional-edit" &&
      isSelectingRegion &&
      dragStartRegion
    ) {
      e.stopPropagation();
      const minX = Math.min(dragStartRegion.xPct, coords.xPct);
      const minY = Math.min(dragStartRegion.yPct, coords.yPct);
      const width = Math.abs(coords.xPct - dragStartRegion.xPct);
      const height = Math.abs(coords.yPct - dragStartRegion.yPct);

      setRegionalBox({
        x: minX,
        y: minY,
        width: Math.max(2, width),
        height: Math.max(2, height),
      });
    } else if (activeTool === "shapes" && isDrawingShape) {
      e.stopPropagation();
      const endCoords = getCanvasCoords(e);
      drawLiveShapePreview(shapeStart, endCoords);
    }
  };

  const drawLiveShapePreview = (start, end) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (tempCanvasImageData.current) {
      ctx.putImageData(tempCanvasImageData.current, 0, 0);
    }

    ctx.beginPath();
    ctx.strokeStyle = shapeColor;
    ctx.fillStyle = shapeColor;
    ctx.lineWidth = shapeSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (activeShape === "line") {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else if (activeShape === "arrow") {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - 14 * Math.cos(angle - Math.PI / 6),
        end.y - 14 * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        end.x - 14 * Math.cos(angle + Math.PI / 6),
        end.y - 14 * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fill();
    } else if (activeShape === "rect") {
      const w = end.x - start.x;
      const h = end.y - start.y;
      ctx.strokeRect(start.x, start.y, w, h);
    } else if (activeShape === "circle") {
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      const cx = Math.min(start.x, end.x) + rx;
      const cy = Math.min(start.y, end.y) + ry;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
  };

  const handleImageMouseUp = (e) => {
    if (isDraggingLasso) {
      if (e) e.stopPropagation();
      setIsDraggingLasso(false);
      if (lassoPoints.length > 5) {
        const xs = lassoPoints.map((p) => p.x);
        const ys = lassoPoints.map((p) => p.y);
        const minX = Math.round(Math.min(...xs));
        const minY = Math.round(Math.min(...ys));
        const maxX = Math.round(Math.max(...xs));
        const maxY = Math.round(Math.max(...ys));
        setMarkedRegions((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: "lasso",
            label: `Layer ${prev.length + 1}`,
            bbox: { xmin: minX, ymin: minY, xmax: maxX, ymax: maxY },
          },
        ]);
      }
    }
    if (isSelectingRegion) {
      if (e) e.stopPropagation();
      setIsSelectingRegion(false);
      if (regionalBox.width > 2 && regionalBox.height > 2) {
        const xmin = Math.round(regionalBox.x * 10);
        const ymin = Math.round(regionalBox.y * 10);
        const xmax = Math.round((regionalBox.x + regionalBox.width) * 10);
        const ymax = Math.round((regionalBox.y + regionalBox.height) * 10);
        setMarkedRegions((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: "region",
            label: `Layer ${prev.length + 1}`,
            bbox: { xmin, ymin, xmax, ymax },
          },
        ]);
      }
    }
    if (isDrawingShape && activeTool === "shapes") {
      if (e) e.stopPropagation();
      setIsDrawingShape(false);
      const endCoords = getCanvasCoords(e);
      drawLiveShapePreview(shapeStart, endCoords);
      tempCanvasImageData.current = null;
      saveCanvasState();

      const canvas = drawingCanvasRef.current;
      if (canvas && canvas.width && canvas.height) {
        const xmin = Math.round(
          (Math.min(shapeStart.x, endCoords.x) / canvas.width) * 1000,
        );
        const ymin = Math.round(
          (Math.min(shapeStart.y, endCoords.y) / canvas.height) * 1000,
        );
        const xmax = Math.round(
          (Math.max(shapeStart.x, endCoords.x) / canvas.width) * 1000,
        );
        const ymax = Math.round(
          (Math.max(shapeStart.y, endCoords.y) / canvas.height) * 1000,
        );
        setMarkedRegions((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: activeShape,
            label: `Layer ${prev.length + 1}`,
            bbox: { xmin, ymin, xmax, ymax },
          },
        ]);
      }
    }
  };

  // --- DRAWING CANVAS LOGIC ---
  const saveCanvasState = () => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL();
    const newStack = historyStack.slice(0, historyIndex + 1);
    newStack.push(dataUrl);
    setHistoryStack(newStack);
    setHistoryIndex(newStack.length - 1);
  };

  const clearDrawingCanvas = () => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setMarkedRegions([]);
    saveCanvasState();
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const canvas = drawingCanvasRef.current;
      const ctx = canvas.getContext("2d");
      const img = new Image();
      img.src = historyStack[prevIndex];
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHistoryIndex(prevIndex);
      };
    } else if (historyIndex === 0) {
      const canvas = drawingCanvasRef.current;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHistoryIndex(-1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < historyStack.length - 1) {
      const nextIndex = historyIndex + 1;
      const canvas = drawingCanvasRef.current;
      const ctx = canvas.getContext("2d");
      const img = new Image();
      img.src = historyStack[nextIndex];
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHistoryIndex(nextIndex);
      };
    }
  };

  const getCanvasCoords = (e) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e) => {
    if (activeTool !== "draw" && activeTool !== "eraser") return;
    e.preventDefault();
    e.stopPropagation();
    setIsDrawing(true);
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { x, y } = getCanvasCoords(e);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;

    if (activeTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = brushColor;
    }
  };

  const drawStroke = (e) => {
    if (!isDrawing || (activeTool !== "draw" && activeTool !== "eraser"))
      return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { x, y } = getCanvasCoords(e);

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e) => {
    if (isDrawing) {
      if (e) e.stopPropagation();
      setIsDrawing(false);
      saveCanvasState();
    }
  };

  // --- PAN / HAND TOOL LOGIC ---
  const startPan = (e) => {
    if (activeTool !== "hand") return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const doPan = (e) => {
    if (!isPanning || activeTool !== "hand") return;
    setPanOffset({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    });
  };

  const stopPan = () => {
    setIsPanning(false);
  };

  const resetView = () => {
    setZoomLevel(100);
    setPanOffset({ x: 0, y: 0 });
    toast(copy.toasts.viewReset);
  };

  // --- REGIONAL & LASSO EDIT AI SUBMIT WITH <bbox> BBOX TAGS ---
  const handleRunRegionalEdit = async () => {
    if (!hasProvider) {
      toast.error(copy.toasts.noProvider);
      return;
    }
    if (!regionalPrompt) {
      toast.error(copy.toasts.enterRegionPrompt);
      return;
    }

    setIsProcessing(true);
    setProgress(20);
    onGenerationStart?.();

    try {
      let bboxTag = "";
      if (activeTool === "lasso" && lassoPoints.length > 0) {
        const xs = lassoPoints.map((p) => p.x);
        const ys = lassoPoints.map((p) => p.y);
        const minX = Math.round(Math.min(...xs));
        const minY = Math.round(Math.min(...ys));
        const maxX = Math.round(Math.max(...xs));
        const maxY = Math.round(Math.max(...ys));
        bboxTag = `<bbox>${minY} ${minX} ${maxY} ${maxX}</bbox>`;
      } else if (activeTool === "regional-edit") {
        const minX = Math.round(regionalBox.x * 10);
        const minY = Math.round(regionalBox.y * 10);
        const maxX = Math.round((regionalBox.x + regionalBox.width) * 10);
        const maxY = Math.round((regionalBox.y + regionalBox.height) * 10);
        bboxTag = `<bbox>${minY} ${minX} ${maxY} ${maxX}</bbox>`;
      }

      const formattedPrompt = bboxTag
        ? `Modify ${bboxTag}: ${regionalPrompt}`
        : regionalPrompt;

      const result = await decomposeLayers({
        image_url: currentImageUrl,
        prompt: formattedPrompt,
        resolution: resolution,
        output_format: outputFormat,
      });

      setProgress(100);
      const rawImages =
        result.images ||
        result.output?.images ||
        result.outputs ||
        (result.url ? [result.url] : []);
      const layerUrls = Array.isArray(rawImages) ? rawImages : [rawImages];

      if (layerUrls.length > 0) {
        setDecomposedLayers(layerUrls);
        setCarouselIndex(0);
        const initialVis = {};
        layerUrls.forEach((_, idx) => {
          initialVis[idx] = true;
        });
        setVisibleLayers(initialVis);
        toast.success(copy.toasts.decomposedInto.replace('{count}', layerUrls.length));
        onGenerationComplete?.(result);
      }
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(copy.toasts.editFailed.replace('{error}', errorMsg));
      onGenerationError?.(errorMsg);
    } finally {
      setIsProcessing(false);
      onGenerationEnd?.();
    }
  };

  // --- HELPER TO CONSTRUCT SEEDREAM 5.0 PRO LAYER DECOMPOSITION PROMPT WITH BBOX ---
  const buildSeedreamLayerPrompt = (rawPrompt) => {
    if (
      rawPrompt &&
      (rawPrompt.includes("<bbox>") ||
        rawPrompt.toLowerCase().includes("split the content"))
    ) {
      return rawPrompt;
    }

    if (markedRegions.length > 0) {
      const numLayers = Math.max(markedRegions.length, layerCount);
      let promptLines = [
        `Split the content in the image into ${numLayers} layers:`,
      ];
      markedRegions.forEach((item, idx) => {
        const { xmin, ymin, xmax, ymax } = item.bbox;
        const tag = rawPrompt || `Element ${idx + 1}`;
        promptLines.push(
          `Layer ${idx + 1}: ${tag} <bbox>${xmin} ${ymin} ${xmax} ${ymax}</bbox>`,
        );
      });
      return promptLines.join("\n");
    }

    return (
      rawPrompt ||
      `Split the content in the image into ${layerCount} transparent layers by separating foreground subjects, texts, and background elements cleanly.`
    );
  };

  // --- API CALL: SEEDREAM 5.0 PRO LAYER DECOMPOSITION ---
  const handleDecompose = async (overridePrompt) => {
    const rawPrompt = overridePrompt !== undefined ? overridePrompt : prompt;
    const finalSeedreamPrompt = buildSeedreamLayerPrompt(rawPrompt);

    if (!hasProvider) {
      toast.error(copy.toasts.noProvider);
      return;
    }
    if (!currentImageUrl) {
      toast.error(copy.toasts.uploadOrSelectDecompose);
      return;
    }

    setIsProcessing(true);
    setProgress(15);
    onGenerationStart?.();

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => (prev < 90 ? prev + 5 : prev));
      }, 800);

      const result = await decomposeLayers({
        image_url: currentImageUrl,
        prompt: finalSeedreamPrompt,
        resolution: resolution,
        output_format: outputFormat,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const rawImages =
        result.images ||
        result.output?.images ||
        result.outputs ||
        (result.url ? [result.url] : []);
      const layerUrls = Array.isArray(rawImages) ? rawImages : [rawImages];

      setDecomposedLayers(layerUrls);
      setCarouselIndex(0);

      const initialVis = {};
      layerUrls.forEach((_, idx) => {
        initialVis[idx] = true;
      });
      setVisibleLayers(initialVis);

      toast.success(copy.toasts.decomposedInto.replace('{count}', layerUrls.length));
      onGenerationComplete?.(result);
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(copy.toasts.decompositionFailed.replace('{error}', errorMsg));
      onGenerationError?.(errorMsg);
    } finally {
      setIsProcessing(false);
      onGenerationEnd?.();
    }
  };

  // --- API CALL: UPSCALE IMAGE (seedvr2-image-upscale, topaz-image-upscale, ai-image-upscaler) ---
  const handleRunUpscale = async () => {
    if (!hasProvider) {
      toast.error(copy.toasts.noProvider);
      return;
    }
    if (!currentImageUrl) {
      toast.error(copy.toasts.uploadOrSelectUpscale);
      return;
    }

    setIsProcessing(true);
    setProgress(15);
    onGenerationStart?.();

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => (prev < 90 ? prev + 5 : prev));
      }, 700);

      const result = await upscaleImage({
        model: upscaleModel,
        image_url: currentImageUrl,
        resolution: seedvrResolution,
        upscale_factor: topazFactor,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const outputUrl =
        result.outputs?.[0] ||
        result.url ||
        result.output?.image ||
        result.output?.images?.[0] ||
        result.output?.url;

      if (outputUrl) {
        setCurrentImageUrl(outputUrl);
        const selectedModelObj = UPSCALE_MODELS.find(
          (m) => m.id === upscaleModel,
        );
        toast.success(
          copy.toasts.upscaleSuccess.replace('{model}', selectedModelObj?.name || "AI Upscaler"),
        );
        onGenerationComplete?.(result);
      } else {
        toast.error(copy.toasts.upscaleNoOutput);
      }
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(copy.toasts.upscaleFailed.replace('{error}', errorMsg));
      onGenerationError?.(errorMsg);
    } finally {
      setIsProcessing(false);
      onGenerationEnd?.();
    }
  };

  // --- API CALL: REMOVE BACKGROUND (ai-background-remover) ---
  const handleRunRemoveBg = async () => {
    if (!hasProvider) {
      toast.error(copy.toasts.noProvider);
      return;
    }
    if (!currentImageUrl) {
      toast.error(copy.toasts.uploadOrSelectRemoveBg);
      return;
    }

    setIsProcessing(true);
    setProgress(15);
    onGenerationStart?.();

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => (prev < 90 ? prev + 5 : prev));
      }, 700);

      const result = await removeBackground({
        image_url: currentImageUrl,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const outputUrl =
        result.outputs?.[0] ||
        result.url ||
        result.output?.image ||
        result.output?.images?.[0] ||
        result.output?.url;

      if (outputUrl) {
        setCurrentImageUrl(outputUrl);
        setDecomposedLayers((prev) => [
          outputUrl,
          ...prev.filter((u) => u !== outputUrl),
        ]);
        setCarouselIndex(0);
        toast.success(copy.toasts.removeBgSuccess);
        onGenerationComplete?.(result);
      } else {
        toast.error(copy.toasts.removeBgNoOutput);
      }
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(copy.toasts.removeBgFailed.replace('{error}', errorMsg));
      onGenerationError?.(errorMsg);
    } finally {
      setIsProcessing(false);
      onGenerationEnd?.();
    }
  };

  // --- API CALL: EXPAND / OUTPAINT IMAGE (ai-image-extension) ---
  const handleRunExpand = async () => {
    if (!hasProvider) {
      toast.error(copy.toasts.noProvider);
      return;
    }
    if (!currentImageUrl) {
      toast.error(copy.toasts.uploadOrSelectExpand);
      return;
    }

    setIsProcessing(true);
    setProgress(15);
    onGenerationStart?.();

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => (prev < 90 ? prev + 5 : prev));
      }, 700);

      const result = await expandImage({
        image_url: currentImageUrl,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const outputUrl =
        result.outputs?.[0] ||
        result.url ||
        result.output?.image ||
        result.output?.images?.[0] ||
        result.output?.url;

      if (outputUrl) {
        setCurrentImageUrl(outputUrl);
        toast.success(copy.toasts.expandSuccess);
        onGenerationComplete?.(result);
      } else {
        toast.error(copy.toasts.expandNoOutput);
      }
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(copy.toasts.expandFailed.replace('{error}', errorMsg));
      onGenerationError?.(errorMsg);
    } finally {
      setIsProcessing(false);
      onGenerationEnd?.();
    }
  };

  // Reset individual Color Grading category
  const resetCategory = (catKey) => {
    setColorGrading((prev) => ({
      ...prev,
      [catKey]: { ...DEFAULT_COLOR_GRADING[catKey] },
    }));
    toast(copy.toasts.resetCategory.replace('{category}', copy.colorGrading[catKey].heading));
  };

  // Reset all Color Grading parameters
  const handleResetAllColorGrading = () => {
    setColorGrading(DEFAULT_COLOR_GRADING);
    toast(copy.toasts.colorGradingReset);
  };

  // Download Color Graded Image (Includes live filters, vignette, halation, and film grain)
  const handleDownloadGradedImage = async () => {
    if (!currentImageUrl) return;
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = currentImageUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 1024;
      canvas.height = img.naturalHeight || 1024;
      const ctx = canvas.getContext("2d");

      // 1. Draw filtered base image
      ctx.filter = getColorGradingCSSFilter();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.filter = "none";

      // 2. Add Vignette if configured
      if (colorGrading.lensInstructions.vignette > 0) {
        const vRadius = Math.max(canvas.width, canvas.height) * 0.7;
        const grad = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          vRadius * 0.35,
          canvas.width / 2,
          canvas.height / 2,
          vRadius,
        );
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(
          1,
          `rgba(0,0,0,${colorGrading.lensInstructions.vignette * 0.95})`,
        );
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // 3. Add Film Grain if configured
      if (colorGrading.filmGrain.strength > 0) {
        const grainCanvas = document.createElement("canvas");
        grainCanvas.width = 128;
        grainCanvas.height = 128;
        const gCtx = grainCanvas.getContext("2d");
        const gImgData = gCtx.createImageData(128, 128);
        const data = gImgData.data;
        const bias = colorGrading.filmGrain.bias * 50;
        for (let i = 0; i < data.length; i += 4) {
          const noise = (Math.random() - 0.5) * 255 + bias;
          data[i] = noise;
          data[i + 1] = noise;
          data[i + 2] = noise;
          data[i + 3] = 40;
        }
        gCtx.putImageData(gImgData, 0, 0);

        ctx.globalAlpha = colorGrading.filmGrain.strength * 0.5;
        ctx.globalCompositeOperation = "overlay";
        const pat = ctx.createPattern(grainCanvas, "repeat");
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = "source-over";
      }

      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "color_graded_image.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(copy.toasts.downloadedGraded);
    } catch {
      handleDownloadSingle(currentImageUrl, "color_graded_image.png");
    }
  };

  // Explicit Side Tool Execution Handler
  const handleExecuteSideTool = async (toolId) => {
    if (!hasProvider) {
      toast.error(copy.toasts.noProvider);
      return;
    }
    if (!currentImageUrl) {
      toast.error(copy.toasts.uploadImageFirst);
      return;
    }

    if (toolId === "remove-bg") {
      return handleRunRemoveBg();
    }
    if (toolId === "expand-crop") {
      return handleRunExpand();
    }

    setIsProcessing(true);
    setProgress(20);
    onGenerationStart?.();

    try {
      let result;
      if (toolId === "enhancer") {
        result = await generateI2I({
          model: "nano-banana-pro-edit",
          prompt:
            "Enhance image contrast, color balance, exposure, and sharpness.",
          image_url: currentImageUrl,
        });
      } else if (toolId === "edit-text") {
        const textPrompt =
          textEditPrompt ||
          prompt ||
          "Edit and sharpen text overlay on the image cleanly.";
        result = await generateI2I({
          model: "nano-banana-pro-edit",
          prompt: textPrompt,
          image_url: currentImageUrl,
        });
      } else {
        result = await generateI2I({
          model: "nano-banana-pro-edit",
          prompt: prompt || `Apply ${toolId} image transformation.`,
          image_url: currentImageUrl,
        });
      }

      setProgress(100);
      if (result?.url) {
        setCurrentImageUrl(result.url);
        toast.success(copy.toasts.toolCompleted.replace('{tool}', toolId));
        onGenerationComplete?.(result);
      }
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(copy.toasts.operationFailed.replace('{error}', errorMsg));
      onGenerationError?.(errorMsg);
    } finally {
      setIsProcessing(false);
      onGenerationEnd?.();
    }
  };

  const toggleLayerVisibility = (idx) => {
    setVisibleLayers((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const handleDownloadSingle = async (url, filename) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename || `layer.${outputFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleDownloadAll = () => {
    if (decomposedLayers.length === 0) {
      if (currentImageUrl) {
        handleDownloadSingle(currentImageUrl, `image.${outputFormat}`);
      }
      return;
    }
    decomposedLayers.forEach((url, i) => {
      setTimeout(() => {
        handleDownloadSingle(url, `layer_${i + 1}.${outputFormat}`);
      }, i * 300);
    });
    toast.success(copy.toasts.downloadingAll);
  };

  const getLassoPathString = () => {
    if (lassoPoints.length < 2) return "";
    return (
      lassoPoints
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        )
        .join(" ") + " Z"
    );
  };

  // ── Bar state: the active tool, its run, and the open popover ──
  const currentTool = TOOLS.find((tool) => tool.id === activeSideTab) || TOOLS[0];
  const moreTool = currentTool.more ? currentTool : null;
  const usesPrompt = PROMPT_TOOLS.has(currentTool.id);
  const promptValue = currentTool.id === "edit-text" ? textEditPrompt : prompt;
  const setPromptValue = currentTool.id === "edit-text" ? setTextEditPrompt : setPrompt;
  const promptPlaceholder = {
    "layer-decomposition":
      markedRegions.length > 0
        ? copy.bar.regionsPlaceholder.replace("{count}", markedRegions.length)
        : copy.bar.layersPlaceholder,
    "edit-text": copy.bar.editTextPlaceholder,
    relight: copy.bar.relightPlaceholder,
    angles: copy.bar.anglesPlaceholder,
  }[currentTool.id];

  const upscaleModelInfo =
    UPSCALE_MODELS.find((model) => model.id === upscaleModel) || UPSCALE_MODELS[0];

  // What the run button's price is quoted on (color grading costs nothing).
  const price = (() => {
    switch (currentTool.id) {
      case "layer-decomposition":
        return { endpoint: "bytedance-seedream-5.0-pro-layer", payload: { resolution, output_format: outputFormat } };
      case "upscale":
        if (upscaleModel === "seedvr2-image-upscale") return { endpoint: "seedvr2-image-upscale", payload: { resolution: seedvrResolution } };
        if (upscaleModel === "ai-image-upscaler") return { endpoint: "ai-image-upscale", payload: {} };
        return { endpoint: "topaz-image-upscale", payload: { upscale_factor: topazFactor } };
      case "color-grading":
        return null;
      case "remove-bg":
        return { endpoint: "ai-background-remover", payload: {} };
      case "expand-crop":
        return { endpoint: "ai-image-extension", payload: {} };
      default:
        return { endpoint: getEndpointForModelId("nano-banana-pro-edit"), payload: {} };
    }
  })();

  const gradeChanges = GRADE_SECTIONS.reduce(
    (count, section) => count + gradeChangesIn(colorGrading, section),
    0,
  );

  const runTool = () => {
    if (currentTool.id === "layer-decomposition") return handleDecompose();
    if (currentTool.id === "upscale") return handleRunUpscale();
    if (currentTool.id === "remove-bg") return handleRunRemoveBg();
    if (currentTool.id === "expand-crop") return handleRunExpand();
    if (currentTool.id === "color-grading") return handleDownloadGradedImage();
    return handleExecuteSideTool(currentTool.id);
  };

  const submitOnEnter = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!isProcessing) runTool();
    }
  };

  const pickTool = (id) => {
    setActiveSideTab(id);
    setOpenDropdown(null);
  };

  const toggleDropdown = (name) => (event) => {
    event.stopPropagation();
    setOpenDropdown((open) => (open === name ? null : name));
  };

  const updateGrade = (sectionKey, controlKey, value) =>
    setColorGrading((prev) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], [controlKey]: value },
    }));

  const railGroups = [
    [
      { id: "pointer", Icon: IconPointer, label: copy.rail.select },
      { id: "hand", Icon: IconHandStop, label: copy.rail.pan },
    ],
    [
      { id: "lasso", Icon: IconLasso, label: copy.rail.lasso },
      { id: "regional-edit", Icon: IconMarquee2, label: copy.rail.region },
    ],
    [
      { id: "draw", Icon: IconHighlight, label: copy.rail.marker },
      { id: "eraser", Icon: IconEraser, label: copy.rail.eraser },
      { id: "shapes", Icon: IconTriangleSquareCircle, label: copy.rail.shapes },
    ],
  ];

  const shapeOptions = [
    { id: "line", Icon: IconLine, label: copy.rail.line },
    { id: "arrow", Icon: IconArrowUpRight, label: copy.rail.arrow },
    { id: "rect", Icon: IconSquare, label: copy.rail.rectangle },
    { id: "circle", Icon: IconCircle, label: copy.rail.circle },
  ];

  const showToolOptions =
    activeTool === "draw" || activeTool === "eraser" || activeTool === "shapes";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white select-none">
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "#18181b",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.12)",
            fontSize: "13px",
            borderRadius: "12px",
          },
        }}
      />

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/*"
        className="hidden"
      />

      {/* Canvas: the image (or the drop zone) with its live grade and overlays */}
      <div
        ref={canvasContainerRef}
        onMouseDown={startPan}
        onMouseMove={doPan}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
        className={`absolute inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:22px_22px] pl-16 pr-4 pb-56 pt-20 sm:px-20 sm:pb-44 ${
          activeTool === "hand" ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <div
          className="relative flex items-center justify-center transition-transform duration-100 ease-out"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel / 100})`,
            filter: getColorGradingCSSFilter(),
          }}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.12] bg-[#111114] px-10 py-8">
              <span
                aria-hidden="true"
                className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#22d3ee]/20 border-t-[#22d3ee]"
              />
              <p className="text-[13px] font-medium text-white/80">
                {copy.canvas.uploading.replace("{progress}", uploadProgress)}
              </p>
            </div>
          ) : currentImageUrl ? (
            <div
              ref={imageWrapperRef}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onMouseUp={handleImageMouseUp}
              onTouchStart={handleImageMouseDown}
              onTouchMove={handleImageMouseMove}
              onTouchEnd={handleImageMouseUp}
              className={`group relative overflow-hidden rounded-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6)] ring-1 ring-white/10 ${
                activeTool === "lasso" ||
                activeTool === "regional-edit" ||
                activeTool === "shapes"
                  ? "cursor-crosshair"
                  : ""
              }`}
              style={{
                transform:
                  colorGrading.lensInstructions.distortion !== 0
                    ? `scale(${1 + Math.abs(colorGrading.lensInstructions.distortion) * 0.08})`
                    : undefined,
              }}
              data-layers-image
            >
              <img
                ref={imageRef}
                src={currentImageUrl}
                alt={copy.canvas.imageAlt}
                onLoad={syncCanvasDimensions}
                className={`pointer-events-none block max-h-[calc(100dvh-21rem)] max-w-[calc(100vw-6rem)] object-contain transition-opacity duration-300 sm:max-w-[calc(100vw-12rem)] lg:max-w-[62vw] ${
                  decomposedLayers.length > 0 ? "opacity-30 blur-[1px]" : "opacity-100"
                }`}
              />

              {/* Live vignette */}
              {colorGrading.lensInstructions.vignette > 0 && (
                <div
                  className="pointer-events-none absolute inset-0 z-20 rounded-2xl transition-opacity duration-150"
                  style={{
                    background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${colorGrading.lensInstructions.vignette * 0.95}) 100%)`,
                  }}
                />
              )}

              {/* Live film grain */}
              {colorGrading.filmGrain.strength > 0 && (
                <div
                  className="pointer-events-none absolute inset-0 z-20 rounded-2xl mix-blend-overlay transition-opacity duration-150"
                  style={{
                    opacity: colorGrading.filmGrain.strength,
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${
                      colorGrading.filmGrain.size === "35mm"
                        ? "0.85"
                        : colorGrading.filmGrain.size === "16mm"
                          ? "0.65"
                          : "0.45"
                    }' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='${
                      0.35 + colorGrading.filmGrain.bias * 0.45
                    }'/%3E%3C/svg%3E")`,
                  }}
                />
              )}

              {/* Lasso outline */}
              {activeTool === "lasso" && lassoPoints.length > 1 && (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 z-30 h-full w-full"
                  aria-hidden="true"
                >
                  <path
                    d={getLassoPathString()}
                    fill="rgba(34, 211, 238, 0.14)"
                    stroke="#22d3ee"
                    strokeWidth="3"
                    strokeDasharray="8 8"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}

              {/* Region box */}
              {activeTool === "regional-edit" &&
                regionalBox.width > 0 &&
                regionalBox.height > 0 && (
                  <div
                    className="pointer-events-auto absolute z-30 rounded-lg border-2 border-dashed border-[#22d3ee] bg-[#22d3ee]/10"
                    style={{
                      left: `${regionalBox.x}%`,
                      top: `${regionalBox.y}%`,
                      width: `${regionalBox.width}%`,
                      height: `${regionalBox.height}%`,
                    }}
                  >
                    <span className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full border border-white bg-[#22d3ee]" />
                    <span className="absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full border border-white bg-[#22d3ee]" />
                    <span className="absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-full border border-white bg-[#22d3ee]" />
                    <span className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full border border-white bg-[#22d3ee]" />
                  </div>
                )}

              {/* The edit prompt for a lasso or region selection */}
              {((activeTool === "lasso" &&
                lassoPoints.length > 2 &&
                !isDraggingLasso) ||
                (activeTool === "regional-edit" &&
                  regionalBox.width > 2 &&
                  !isSelectingRegion)) && (
                <div
                  onMouseDown={(event) => event.stopPropagation()}
                  className="absolute bottom-4 left-1/2 z-50 flex w-[280px] -translate-x-1/2 items-center gap-2 rounded-xl border border-white/[0.12] bg-[#111114] p-1.5 pl-3 shadow-[0_20px_40px_rgba(0,0,0,0.6)] sm:w-[340px]"
                >
                  <input
                    type="text"
                    value={regionalPrompt}
                    onChange={(event) => setRegionalPrompt(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && handleRunRegionalEdit()}
                    placeholder={copy.canvas.regionPlaceholder}
                    aria-label={copy.canvas.regionPlaceholder}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-white/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleRunRegionalEdit}
                    disabled={isProcessing}
                    className="h-8 shrink-0 rounded-lg bg-[#22d3ee] px-3 text-[12.5px] font-semibold text-[#04202a] transition hover:brightness-105 disabled:opacity-50"
                  >
                    {copy.canvas.regionRun}
                  </button>
                </div>
              )}

              {/* Drawing and shapes overlay */}
              <canvas
                ref={drawingCanvasRef}
                onMouseDown={startDrawing}
                onMouseMove={drawStroke}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={drawStroke}
                onTouchEnd={stopDrawing}
                className={`absolute inset-0 h-full w-full touch-none ${
                  activeTool === "draw" ||
                  activeTool === "eraser" ||
                  activeTool === "shapes"
                    ? "pointer-events-auto z-30 cursor-crosshair"
                    : "pointer-events-none z-10"
                }`}
              />

              {/* The split layers, stacked (or the picked one alone) */}
              {decomposedLayers.length > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  {decomposedLayers.map((layerUrl, idx) => {
                    const isVisible = isSoloMode
                      ? carouselIndex === idx
                      : visibleLayers[idx];
                    if (!isVisible) return null;
                    return (
                      <img
                        key={idx}
                        src={layerUrl}
                        alt={copy.canvas.layerAlt.replace("{n}", idx + 1)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setCarouselIndex(idx);
                        }}
                        className={`pointer-events-auto absolute inset-0 h-full w-full cursor-pointer object-contain transition-[filter] duration-200 ${
                          carouselIndex === idx
                            ? "drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]"
                            : ""
                        }`}
                      />
                    );
                  })}
                </div>
              )}

              {/* Working */}
              {isProcessing && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
                  <span
                    aria-hidden="true"
                    className="h-12 w-12 animate-spin rounded-full border-[3px] border-[#22d3ee]/20 border-t-[#22d3ee]"
                  />
                  <p className="mt-4 text-[13.5px] font-medium text-white">
                    {copy.canvas.processing}
                  </p>
                  <div className="mt-3 h-1 w-44 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-[#22d3ee] transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleDropzoneDragEnter}
              onDragLeave={handleDropzoneDragLeave}
              onDragOver={handleDropzoneDragOver}
              onDrop={handleDropzoneDrop}
              className={`flex w-[min(420px,calc(100vw-8rem))] flex-col items-center gap-3 rounded-2xl border border-dashed px-8 py-12 text-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/60 ${
                isDropzoneDragging
                  ? "border-[#22d3ee] bg-[#22d3ee]/[0.06]"
                  : "border-white/15 bg-[#111114]/70 hover:border-[#22d3ee]/50"
              }`}
              data-layers-dropzone
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.05] text-[#67e8f9]">
                <IconPhotoPlus size={22} stroke={1.75} aria-hidden="true" />
              </span>
              <span className="text-[15px] font-medium text-white">{copy.canvas.dropTitle}</span>
              <span className="text-[12.5px] text-white/50">{copy.canvas.dropHint}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tool tabs */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-3">
        <div className="pointer-events-auto relative max-w-full">
          <div
            role="tablist"
            aria-label={copy.toolTabs.label}
            className={`no-scrollbar flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl p-[3px] ${FLOATING_CARD_CLASS}`}
            data-layers-tabs
          >
            {TOOLS.filter((tool) => !tool.more).map((tool) => {
              const selected = tool.id === currentTool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={copy.toolTabs[tool.id]}
                  onClick={() => pickTool(tool.id)}
                  className={toolTabClassName(selected)}
                  data-layers-tab={tool.id}
                >
                  <tool.Icon
                    size={16}
                    stroke={1.75}
                    aria-hidden="true"
                    className={selected ? "text-[#67e8f9]" : ""}
                  />
                  <span className={selected ? "" : "hidden sm:inline"}>
                    {copy.toolTabs[tool.id]}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              role="tab"
              aria-selected={Boolean(moreTool)}
              aria-haspopup="menu"
              aria-expanded={openDropdown === "more"}
              aria-label={moreTool ? copy.menuItems[moreTool.id] : copy.toolTabs.more}
              onClick={toggleDropdown("more")}
              className={`group ${toolTabClassName(Boolean(moreTool))}`}
              data-layers-tab="more"
            >
              {moreTool ? (
                <moreTool.Icon size={16} stroke={1.75} aria-hidden="true" className="text-[#67e8f9]" />
              ) : (
                <IconDots size={16} stroke={1.75} aria-hidden="true" />
              )}
              <span className={moreTool ? "" : "hidden sm:inline"}>
                {moreTool ? copy.menuItems[moreTool.id] : copy.toolTabs.more}
              </span>
              <PromptChevronIcon className={openDropdown === "more" ? "rotate-180" : ""} />
            </button>
          </div>

          {openDropdown === "more" && (
            <PromptPopover
              onClick={(event) => event.stopPropagation()}
              positionClassName="absolute right-0 top-full z-50 mt-2"
              className="w-[220px]"
              solid
              data-layers-more-menu
            >
              <PromptMenuList>
                {TOOLS.filter((tool) => tool.more).map((tool) => (
                  <PromptMenuItem
                    key={tool.id}
                    selected={tool.id === currentTool.id}
                    onClick={() => pickTool(tool.id)}
                  >
                    <span className="flex items-center gap-2.5">
                      <tool.Icon size={15} stroke={1.75} aria-hidden="true" className="opacity-70" />
                      {copy.menuItems[tool.id]}
                    </span>
                  </PromptMenuItem>
                ))}
              </PromptMenuList>
            </PromptPopover>
          )}
        </div>
      </div>

      {/* Canvas tools and zoom */}
      <div className="absolute left-3 top-[124px] z-30 sm:left-5 sm:top-1/2 sm:-translate-y-1/2">
        <div
          role="toolbar"
          aria-label={copy.rail.label}
          aria-orientation="vertical"
          className={`flex flex-col gap-0.5 rounded-[14px] p-[5px] ${FLOATING_CARD_CLASS}`}
          data-layers-rail
        >
          {railGroups.map((group, groupIndex) => (
            <Fragment key={groupIndex}>
              {groupIndex > 0 && (
                <span aria-hidden="true" className="mx-1.5 my-1 h-px bg-white/[0.08]" />
              )}
              {group.map((tool) => {
                const active = activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    aria-label={tool.label}
                    aria-pressed={active}
                    title={tool.label}
                    onClick={() =>
                      setActiveTool(
                        tool.id === "pointer" || tool.id === "hand"
                          ? tool.id
                          : active
                            ? "pointer"
                            : tool.id,
                      )
                    }
                    className={railButtonClassName(active)}
                    data-layers-canvas-tool={tool.id}
                  >
                    <tool.Icon size={18} stroke={1.75} aria-hidden="true" />
                  </button>
                );
              })}
            </Fragment>
          ))}
          <span aria-hidden="true" className="mx-1.5 my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            aria-label={copy.rail.zoomIn}
            title={copy.rail.zoomIn}
            onClick={() => setZoomLevel((zoom) => Math.min(200, zoom + 10))}
            className={railButtonClassName(false)}
          >
            <IconPlus size={16} stroke={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={copy.rail.resetZoom}
            title={copy.rail.resetZoom}
            onClick={resetView}
            className="flex h-7 w-[38px] items-center justify-center rounded-lg font-mono text-[10.5px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
            data-layers-zoom
          >
            {zoomLevel}%
          </button>
          <button
            type="button"
            aria-label={copy.rail.zoomOut}
            title={copy.rail.zoomOut}
            onClick={() => setZoomLevel((zoom) => Math.max(50, zoom - 10))}
            className={railButtonClassName(false)}
          >
            <IconMinus size={16} stroke={1.75} aria-hidden="true" />
          </button>
        </div>

        {/* The marker, eraser or shapes options, beside the rail */}
        {showToolOptions && (
          <div
            className={`absolute left-full top-0 ml-2 flex w-[212px] flex-col gap-3 rounded-[14px] p-3 ${FLOATING_CARD_CLASS}`}
            data-layers-tool-options
          >
            <span className="text-[12px] font-medium text-white/60">
              {activeTool === "draw"
                ? copy.rail.marker
                : activeTool === "eraser"
                  ? copy.rail.eraser
                  : copy.rail.shapes}
            </span>

            {activeTool === "shapes" && (
              <PromptSegmentedControl className="w-full">
                {shapeOptions.map((shape) => (
                  <PromptSegmentOption
                    key={shape.id}
                    selected={activeShape === shape.id}
                    onClick={() => setActiveShape(shape.id)}
                    aria-label={shape.label}
                    title={shape.label}
                    className="flex-1 !px-0"
                  >
                    <shape.Icon size={15} stroke={1.75} aria-hidden="true" />
                  </PromptSegmentOption>
                ))}
              </PromptSegmentedControl>
            )}

            {activeTool === "draw" && (
              <ColorSwatches
                colors={PRESET_COLORS}
                value={brushColor}
                onChange={setBrushColor}
                customLabel={copy.rail.customColor}
              />
            )}
            {activeTool === "shapes" && (
              <ColorSwatches colors={PRESET_COLORS} value={shapeColor} onChange={setShapeColor} />
            )}

            {(activeTool === "draw" || activeTool === "eraser") && (
              <div className="flex items-center gap-2.5">
                <label htmlFor="layers-brush-size" className="text-[12px] text-white/60">
                  {copy.rail.size}
                </label>
                <input
                  id="layers-brush-size"
                  type="range"
                  min="2"
                  max="40"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                  className="oga-range min-w-0 flex-1"
                  style={{ background: rangeTrack(brushSize, 2, 40) }}
                />
                <span className="w-9 text-right font-mono text-[11.5px] text-white/80">
                  {brushSize}px
                </span>
              </div>
            )}

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleUndo}
                disabled={historyIndex < 0}
                aria-label={copy.rail.undo}
                title={copy.rail.undo}
                className={SMALL_ICON_BUTTON_CLASS}
              >
                <IconArrowBackUp size={15} stroke={1.75} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={historyIndex >= historyStack.length - 1}
                aria-label={copy.rail.redo}
                title={copy.rail.redo}
                className={SMALL_ICON_BUTTON_CLASS}
              >
                <IconArrowForwardUp size={15} stroke={1.75} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={clearDrawingCanvas}
                className="ml-auto flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-rose-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
              >
                <IconTrash size={13} stroke={1.75} aria-hidden="true" />
                {copy.rail.clear}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The split layers */}
      {decomposedLayers.length > 0 && (
        <section
          aria-label={copy.layersCard.title}
          className={`absolute right-3 top-[72px] z-30 flex max-h-[calc(100%-18rem)] w-[248px] flex-col gap-2 rounded-2xl p-2.5 sm:right-5 sm:max-h-[calc(100%-15rem)] sm:w-[252px] ${FLOATING_CARD_CLASS}`}
          data-layers-card
        >
          <div className="flex items-center justify-between gap-1.5 pl-1">
            <button
              type="button"
              aria-expanded={!layersCollapsed}
              aria-label={layersCollapsed ? copy.layersCard.expand : copy.layersCard.collapse}
              title={layersCollapsed ? copy.layersCard.expand : copy.layersCard.collapse}
              onClick={() => setLayersCollapsed((collapsed) => !collapsed)}
              className="flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
            >
              {copy.layersCard.title}
              <span className="flex h-[18px] items-center rounded-md bg-white/[0.06] px-1.5 font-mono text-[11px] font-normal text-white/70">
                {decomposedLayers.length}
              </span>
              <IconChevronDown
                size={12}
                stroke={2.5}
                aria-hidden="true"
                className={`text-white/45 transition-transform ${layersCollapsed ? "-rotate-90" : ""}`}
              />
            </button>
            <div className="flex items-center gap-1">
              {!layersCollapsed && (
                <PromptSegmentedControl className="!p-[2px]">
                  <PromptSegmentOption
                    selected={!isSoloMode}
                    onClick={() => setIsSoloMode(false)}
                    title={copy.layersCard.showAll}
                    className="!min-h-[22px] !px-2 !py-0 !text-[11.5px]"
                  >
                    {copy.layersCard.stack}
                  </PromptSegmentOption>
                  <PromptSegmentOption
                    selected={isSoloMode}
                    onClick={() => setIsSoloMode(true)}
                    title={copy.layersCard.showOne}
                    className="!min-h-[22px] !px-2 !py-0 !text-[11.5px]"
                  >
                    {copy.layersCard.solo}
                  </PromptSegmentOption>
                </PromptSegmentedControl>
              )}
              <button
                type="button"
                onClick={handleDownloadAll}
                aria-label={copy.layersCard.downloadAll}
                title={copy.layersCard.downloadAll}
                className={SMALL_ICON_BUTTON_CLASS}
              >
                <IconDownload size={14} stroke={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>

          {!layersCollapsed && (
            <div className="custom-scrollbar -mx-0.5 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-0.5">
              {decomposedLayers.map((layerUrl, idx) => {
                const name = copy.carousel.layerLabel.replace("{n}", idx + 1);
                const selected = carouselIndex === idx;
                const shown = isSoloMode ? selected : Boolean(visibleLayers[idx]);
                const visibilityLabel = (shown ? copy.layersCard.hide : copy.layersCard.show).replace("{name}", name);
                const downloadLabel = copy.layersCard.download.replace("{name}", name);
                return (
                  <div
                    key={`${layerUrl}-${idx}`}
                    className={`group flex h-[46px] shrink-0 items-center gap-0.5 rounded-[10px] border pl-1 pr-[3px] transition-colors ${
                      selected
                        ? "border-[#22d3ee]/40 bg-[#22d3ee]/[0.07]"
                        : "border-transparent hover:bg-white/[0.04]"
                    }`}
                    data-layers-row={idx}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setCarouselIndex(idx)}
                      className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
                    >
                      <span
                        aria-hidden="true"
                        className="h-[33px] w-11 shrink-0 overflow-hidden rounded-[7px] border border-white/[0.08]"
                        style={CHECKERBOARD_STYLE}
                      >
                        <img
                          src={layerUrl}
                          alt=""
                          className={`h-full w-full object-contain ${shown ? "" : "opacity-35"}`}
                        />
                      </span>
                      <span
                        className={`truncate text-[12.5px] font-medium ${
                          selected
                            ? "text-[#a5f3fc]"
                            : shown
                              ? "text-white/[0.86]"
                              : "text-white/40"
                        }`}
                      >
                        {name}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadSingle(layerUrl, `layer_${idx + 1}.${outputFormat}`)
                      }
                      aria-label={downloadLabel}
                      title={downloadLabel}
                      className={`${SMALL_ICON_BUTTON_CLASS} group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${
                        selected ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      <IconDownload size={14} stroke={1.75} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLayerVisibility(idx)}
                      disabled={isSoloMode}
                      aria-label={visibilityLabel}
                      title={visibilityLabel}
                      className={`${SMALL_ICON_BUTTON_CLASS} ${shown ? "" : "!text-white/35"}`}
                    >
                      {shown ? (
                        <IconEye size={14} stroke={1.75} aria-hidden="true" />
                      ) : (
                        <IconEyeOff size={14} stroke={1.75} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── BOTTOM PROMPT BAR ── */}
      <PromptComposer positionClassName="absolute inset-x-3 bottom-3 z-30 mx-auto sm:bottom-5 sm:max-w-[760px] oga-enter-bar">
          {/* Top row: the image being edited beside the prompt (or the tool) */}
          <div className="flex items-start gap-3">
            <div
              className="flex shrink-0"
              onDragEnter={handleDropzoneDragEnter}
              onDragLeave={handleDropzoneDragLeave}
              onDragOver={handleDropzoneDragOver}
              onDrop={handleDropzoneDrop}
              data-layers-source
            >
              {currentImageUrl && !uploading ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={copy.bar.changeImage}
                  title={copy.bar.changeImage}
                  className={`${PROMPT_REFERENCE_THUMB_CLASS} overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/60`}
                >
                  <img src={currentImageUrl} alt="" className="h-full w-full rounded-xl object-cover" />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 rounded-xl ring-inset ${
                      isDropzoneDragging ? "ring-2 ring-[#22d3ee]" : "ring-1 ring-white/10"
                    }`}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  aria-label={
                    uploading
                      ? copy.bar.uploading.replace("{progress}", uploadProgress)
                      : copy.bar.addImage
                  }
                  title={copy.bar.addImage}
                  className={promptAddTileClassName({ dragging: isDropzoneDragging })}
                >
                  {uploading ? (
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
                        strokeDashoffset={69.1 * (1 - uploadProgress / 100)}
                        className="text-[#22d3ee] transition-[stroke-dashoffset] duration-300"
                      />
                    </svg>
                  ) : (
                    <IconPhotoPlus size={18} stroke={1.75} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>

            {usesPrompt ? (
              <PromptTextarea
                ref={textareaRef}
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder={promptPlaceholder}
                className="min-w-0 flex-1 !min-h-[44px] !pt-[10px]"
              />
            ) : (
              <div className="min-w-0 flex-1 pt-[3px]">
                <p className="text-[14px] font-medium text-white">{copy.menuItems[currentTool.id]}</p>
                <p className="mt-0.5 text-[12.5px] text-white/50">{copy.bar.hints[currentTool.id]}</p>
              </div>
            )}
          </div>

          {/* Bottom row: the tool's settings | its run */}
          <PromptFooter>
            <PromptControls>
              {currentTool.id === "layer-decomposition" && (
                <>
                  <PromptSettingsGroup label={copy.bar.settings}>
                    <div key="resolution" className="relative flex">
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={openDropdown === "resolution"}
                        aria-label={`${copy.bar.resolution}: ${resolution}`}
                        onClick={toggleDropdown("resolution")}
                        className={promptSettingClassName({ active: openDropdown === "resolution" })}
                        data-layers-setting="resolution"
                      >
                        {resolution}
                      </button>
                      {openDropdown === "resolution" && (
                        <PromptPopover
                          role="dialog"
                          aria-label={copy.bar.resolution}
                          onClick={(event) => event.stopPropagation()}
                          className="w-[220px]"
                          data-layers-resolution-picker
                        >
                          <PromptPopoverHeader>{copy.bar.resolution}</PromptPopoverHeader>
                          <PromptSegmentedControl className="w-full">
                            {LAYER_RESOLUTIONS.map((option) => (
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

                    <div key="count" className="relative flex">
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={openDropdown === "count"}
                        aria-label={`${copy.bar.layers}: ${layerCount}`}
                        onClick={toggleDropdown("count")}
                        className={promptSettingClassName({ active: openDropdown === "count" })}
                        data-layers-setting="count"
                      >
                        <IconStack2 size={14} stroke={1.75} className="opacity-60" aria-hidden="true" />
                        {copy.bar.layerCount.replace("{count}", layerCount)}
                      </button>
                      {openDropdown === "count" && (
                        <PromptPopover
                          role="dialog"
                          aria-label={copy.bar.layers}
                          onClick={(event) => event.stopPropagation()}
                          className="w-[260px]"
                          data-layers-count-picker
                        >
                          <div className="flex items-baseline justify-between px-2 pb-2.5">
                            <label htmlFor="layers-count" className="text-[11px] font-medium text-white/40">
                              {copy.bar.layers}
                            </label>
                            <span className="font-mono text-[12px] text-white">{layerCount}</span>
                          </div>
                          <div className="px-2 pb-1">
                            <input
                              id="layers-count"
                              type="range"
                              min="2"
                              max="16"
                              value={layerCount}
                              onChange={(event) => setLayerCount(Number(event.target.value))}
                              className="oga-range w-full"
                              style={{ background: rangeTrack(layerCount, 2, 16) }}
                            />
                            <div aria-hidden="true" className="mt-1.5 flex justify-between font-mono text-[10.5px] text-white/40">
                              <span>2</span>
                              <span>16</span>
                            </div>
                          </div>
                        </PromptPopover>
                      )}
                    </div>
                  </PromptSettingsGroup>

                  {markedRegions.length > 0 && (
                    <span
                      className="flex h-9 items-center gap-1 rounded-[10px] border border-[#22d3ee]/30 bg-[#22d3ee]/[0.06] pl-3 pr-1 text-[12.5px] font-medium text-[#a5f3fc]"
                      data-layers-regions
                    >
                      {copy.bar.regions.replace("{count}", markedRegions.length)}
                      <button
                        type="button"
                        onClick={() => setMarkedRegions([])}
                        aria-label={copy.bar.clearRegions}
                        title={copy.bar.clearRegions}
                        className={SMALL_ICON_BUTTON_CLASS}
                      >
                        <IconX size={12} stroke={2.5} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </>
              )}

              {currentTool.id === "upscale" && (
                <>
                  <div className="relative min-w-0">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={openDropdown === "upscale-model"}
                      aria-label={`${copy.bar.model}: ${upscaleModelInfo.name}`}
                      onClick={toggleDropdown("upscale-model")}
                      className={promptModelButtonClassName({ active: openDropdown === "upscale-model" })}
                      data-layers-upscale-model
                    >
                      <IconArrowsDiagonal size={15} stroke={1.75} className="text-[#67e8f9]" aria-hidden="true" />
                      <span className="truncate">{upscaleModelInfo.name}</span>
                      <PromptChevronIcon />
                    </button>
                    {openDropdown === "upscale-model" && (
                      <PromptPopover
                        role="dialog"
                        aria-label={copy.bar.model}
                        onClick={(event) => event.stopPropagation()}
                        className="w-[300px] max-w-[calc(100vw-2rem)]"
                        solid
                      >
                        <PromptPopoverHeader>{copy.bar.model}</PromptPopoverHeader>
                        <PromptMenuList>
                          {UPSCALE_MODELS.map((model) => (
                            <PromptMenuItem
                              key={model.id}
                              selected={model.id === upscaleModel}
                              description={copy.upscaleModels[model.id]}
                              wrapDescription
                              onClick={() => {
                                setUpscaleModel(model.id);
                                setOpenDropdown(null);
                              }}
                            >
                              {model.name}
                            </PromptMenuItem>
                          ))}
                        </PromptMenuList>
                      </PromptPopover>
                    )}
                  </div>

                  {upscaleModel !== "ai-image-upscaler" && (
                    <PromptSettingsGroup label={copy.bar.settings}>
                      <div key="option" className="relative flex">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          aria-expanded={openDropdown === "upscale-option"}
                          aria-label={
                            upscaleModel === "topaz-image-upscale"
                              ? `${copy.bar.factor}: ${topazFactor}×`
                              : `${copy.bar.outputSize}: ${seedvrResolution.toUpperCase()}`
                          }
                          onClick={toggleDropdown("upscale-option")}
                          className={promptSettingClassName({ active: openDropdown === "upscale-option" })}
                          data-layers-setting="upscale"
                        >
                          {upscaleModel === "topaz-image-upscale"
                            ? `${topazFactor}×`
                            : seedvrResolution.toUpperCase()}
                        </button>
                        {openDropdown === "upscale-option" && (
                          <PromptPopover
                            role="dialog"
                            aria-label={upscaleModel === "topaz-image-upscale" ? copy.bar.factor : copy.bar.outputSize}
                            onClick={(event) => event.stopPropagation()}
                            className="w-[240px]"
                          >
                            <PromptPopoverHeader>
                              {upscaleModel === "topaz-image-upscale" ? copy.bar.factor : copy.bar.outputSize}
                            </PromptPopoverHeader>
                            <PromptSegmentedControl className="w-full">
                              {upscaleModel === "topaz-image-upscale"
                                ? TOPAZ_FACTORS.map((factor) => (
                                    <PromptSegmentOption
                                      key={factor}
                                      selected={topazFactor === factor}
                                      onClick={() => {
                                        setTopazFactor(factor);
                                        setOpenDropdown(null);
                                      }}
                                      className="flex-1 font-mono"
                                    >
                                      {factor}×
                                    </PromptSegmentOption>
                                  ))
                                : SEEDVR_RESOLUTIONS.map((option) => (
                                    <PromptSegmentOption
                                      key={option}
                                      selected={seedvrResolution === option}
                                      onClick={() => {
                                        setSeedvrResolution(option);
                                        setOpenDropdown(null);
                                      }}
                                      className="flex-1 font-mono"
                                    >
                                      {option.toUpperCase()}
                                    </PromptSegmentOption>
                                  ))}
                            </PromptSegmentedControl>
                          </PromptPopover>
                        )}
                      </div>
                    </PromptSettingsGroup>
                  )}
                </>
              )}

              {currentTool.id === "color-grading" && (
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={openDropdown === "adjustments"}
                    onClick={toggleDropdown("adjustments")}
                    className={promptModelButtonClassName({ active: openDropdown === "adjustments" })}
                    data-layers-adjustments
                  >
                    <IconAdjustmentsHorizontal size={16} stroke={1.75} className="text-[#67e8f9]" aria-hidden="true" />
                    {copy.bar.adjustments}
                    {gradeChanges > 0 && (
                      <span
                        title={copy.bar.changes.replace("{count}", gradeChanges)}
                        className="flex h-[18px] items-center rounded-md bg-[#22d3ee]/[0.14] px-1.5 font-mono text-[11px] text-[#a5f3fc]"
                      >
                        {gradeChanges}
                      </span>
                    )}
                    <PromptChevronIcon className={openDropdown === "adjustments" ? "rotate-180" : ""} />
                  </button>

                  {openDropdown === "adjustments" && (
                    <PromptPopover
                      role="dialog"
                      aria-label={copy.bar.adjustments}
                      onClick={(event) => event.stopPropagation()}
                      className="w-[372px] max-w-[calc(100vw-2rem)] max-h-[62vh] !p-2"
                      fitViewport
                      solid
                      data-layers-adjustments-panel
                    >
                      <PromptPopoverHeader className="!mb-0">{copy.bar.adjustments}</PromptPopoverHeader>
                      {GRADE_SECTIONS.map((section) => {
                        const sectionCopy = copy.colorGrading[section.key];
                        const open = Boolean(openSections[section.key]);
                        const changed = gradeChangesIn(colorGrading, section) > 0;
                        return (
                          <section
                            key={section.key}
                            className="border-b border-white/[0.06] last:border-b-0"
                            data-layers-grade={section.key}
                          >
                            <div className="flex h-10 items-center justify-between gap-2 px-2">
                              <button
                                type="button"
                                aria-expanded={open}
                                onClick={() =>
                                  setOpenSections((prev) => ({ ...prev, [section.key]: !prev[section.key] }))
                                }
                                title={sectionCopy.info}
                                className="flex min-w-0 items-center gap-2 rounded-md text-[13.5px] font-medium text-white/[0.86] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
                              >
                                <IconChevronRight
                                  size={12}
                                  stroke={2.5}
                                  aria-hidden="true"
                                  className={`shrink-0 text-white/45 transition-transform ${open ? "rotate-90" : ""}`}
                                />
                                {sectionCopy.heading}
                                {changed && (
                                  <span
                                    role="img"
                                    aria-label={copy.colorGrading.changed}
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#22d3ee]"
                                  />
                                )}
                              </button>
                              {changed && (
                                <button
                                  type="button"
                                  onClick={() => resetCategory(section.key)}
                                  title={sectionCopy.reset}
                                  className="h-[26px] shrink-0 rounded-[7px] px-2 text-[12px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
                                >
                                  {copy.common.reset}
                                </button>
                              )}
                            </div>
                            {open && (
                              <div className="flex flex-col gap-3 pb-3.5 pl-7 pr-2">
                                {section.controls.map((control) => {
                                  const value = colorGrading[section.key][control.key];
                                  const label = copy.colorGrading.controls[control.key];
                                  if (control.options) {
                                    return (
                                      <div key={control.key} className="flex items-center gap-3">
                                        <span className="w-[76px] shrink-0 text-[12.5px] text-white/70">{label}</span>
                                        <PromptSegmentedControl className="min-w-0 flex-1">
                                          {control.options.map((option) => (
                                            <PromptSegmentOption
                                              key={option}
                                              selected={value === option}
                                              onClick={() => updateGrade(section.key, control.key, option)}
                                              className="flex-1"
                                            >
                                              {copy.colorGrading.options[option] || option}
                                            </PromptSegmentOption>
                                          ))}
                                        </PromptSegmentedControl>
                                      </div>
                                    );
                                  }
                                  return (
                                    <GradeSlider
                                      key={control.key}
                                      id={`layers-grade-${section.key}-${control.key}`}
                                      label={label}
                                      value={value}
                                      min={control.min}
                                      max={control.max}
                                      step={control.step}
                                      digits={control.digits}
                                      changed={value !== DEFAULT_COLOR_GRADING[section.key][control.key]}
                                      onChange={(next) => updateGrade(section.key, control.key, next)}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </PromptPopover>
                  )}
                </div>
              )}
            </PromptControls>

            <PromptActionGroup>
              {currentTool.id === "color-grading" ? (
                <>
                  <button
                    type="button"
                    onClick={handleResetAllColorGrading}
                    disabled={gradeChanges === 0}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-[13.5px] font-medium text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <IconArrowBackUp size={15} stroke={1.75} aria-hidden="true" />
                    {copy.bar.resetAll}
                  </button>
                  <PromptAction
                    onClick={handleDownloadGradedImage}
                    disabled={!currentImageUrl}
                    className="!h-10 !rounded-xl !text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                    data-layers-run
                  >
                    <IconDownload size={16} stroke={2} aria-hidden="true" />
                    {copy.bar.download}
                  </PromptAction>
                </>
              ) : (
                <>
                  {usesPrompt && <PromptShortcutHint />}
                  <PromptAction
                    onClick={runTool}
                    disabled={isProcessing}
                    addon={
                      price && (
                        <PriceChip
                          variant="inset"
                          locale={locale}
                          endpoint={price.endpoint}
                          payload={price.payload}
                        />
                      )
                    }
                    data-layers-run
                  >
                    {isProcessing ? (
                      <>
                        <span className="animate-spin inline-block">◌</span>
                        {copy.bar.working.replace("{progress}", progress)}
                      </>
                    ) : (
                      copy.bar.actions[currentTool.id]
                    )}
                  </PromptAction>
                </>
              )}
            </PromptActionGroup>
          </PromptFooter>
      </PromptComposer>
    </div>
  );
}
