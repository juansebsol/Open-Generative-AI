"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconDownload,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMaximize,
  IconMinus,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlus,
  IconSend,
  IconSparkles,
  IconTrash,
  IconTypography,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import {
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
  PromptTextarea,
  promptSettingClassName,
} from "./prompt/PromptComposer.jsx";
import {
  generateImage,
  generateI2I,
  upscaleImage,
  removeBackground,
  expandImage,
  uploadFile,
} from "../generation.js";
import { chatComplete, hasChatProvider, ChatSetupError, CHAT_PROVIDER_IDS } from "../providers/chat.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { formatErrorMessage } from "../utils/formatError.js";
import {
  ASPECT_RATIOS,
  DEFAULT_IMAGE_WIDTH,
  ITEM_GAP,
  LINE_HEIGHT,
  TEXT_FONTS,
  allocateId,
  arrangeItems,
  aspectToRatio,
  boardSummary,
  contentBounds,
  createSession,
  findFreeSpot,
  itemBox,
  resizeItem,
  rotatedBounds,
  sanitizeSessions,
  serializeSession,
  topZ,
  trimHistory,
} from "../designAgent/board.js";
import { COSTLY_TOOLS, DESIGN_TOOLS, systemPrompt } from "../designAgent/tools.js";
import {
  availableEditModels,
  availableImageModels,
  canExpand,
  canRemoveBackground,
  highResolutionOption,
  maxEditImages,
  pickEditModel,
  pickImageModel,
  pickUpscaler,
} from "../designAgent/agentModels.js";
import { downloadImage, imageSize, renderBoardToBlob, saveBlob } from "../designAgent/renderBoard.js";
import en from "../messages/en/designAgentStudio.json";
import zh from "../messages/zh/designAgentStudio.json";
import { resolveCopy } from "../i18nUtils";

const PERSIST_KEY = "hg_design_agent_studio_persistent";
const MAX_SESSIONS = 20;
const MAX_AGENT_STEPS = 16;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MIN_SCALE = 0.05;
const MAX_SCALE = 6;
const DEFAULT_SETTINGS = { askFirst: true, imageModelId: "", editModelId: "" };

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

function openProviderSettings(providers) {
  window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers } }));
}

function resultUrl(result) {
  const url = result?.url || result?.images?.[0] || result?.outputs?.[0];
  if (!url) throw new Error("The provider returned no image.");
  return url;
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// OpenAI-format history for the chat model. Tool calls that never got a
// result (reload mid-run) get a stub so the provider accepts the sequence.
function toChatMessages(messages) {
  const out = [];
  let pending = [];
  const flush = () => {
    for (const id of pending) out.push({ role: "tool", tool_call_id: id, content: JSON.stringify({ error: "Interrupted before this step ran." }) });
    pending = [];
  };
  for (const message of messages) {
    if (message.role === "tool") {
      if (pending.includes(message.tool_call_id) && message.status !== "awaiting") {
        out.push({ role: "tool", tool_call_id: message.tool_call_id, content: message.content || "{}" });
        pending = pending.filter((id) => id !== message.tool_call_id);
      }
      continue;
    }
    flush();
    if (message.uiOnly) continue;
    if (message.role === "user") {
      out.push({ role: "user", content: message.selection ? `${message.content}\n\n[Selected on the board: ${message.selection}]` : message.content });
    } else if (message.role === "assistant") {
      const calls = message.tool_calls || [];
      out.push({
        role: "assistant",
        content: message.content || (calls.length ? null : ""),
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}),
      });
      pending = calls.map((call) => call.id);
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------
const Spinner = ({ className = "w-3.5 h-3.5" }) => (
  <span className={`${className} inline-block shrink-0 rounded-full border-2 border-white/15 border-t-[#22d3ee] animate-spin`} />
);

// The floating surfaces on the board (chat, tools, export, inspector) share
// the prompt bar's material.
const FLOATING_CARD_CLASS =
  "border border-white/[0.12] bg-[#111114] shadow-[0_16px_40px_rgba(0,0,0,0.45)]";

const toolButtonClassName = ({ iconOnly = false, accent = false } = {}) =>
  `flex h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-[9px] text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 disabled:pointer-events-none disabled:opacity-35 ${
    iconOnly ? "w-8" : "px-[11px]"
  } ${accent ? "text-[#67e8f9] hover:text-[#a5f3fc]" : "text-white/70 hover:text-white"}`;

const SMALL_ICON_BUTTON_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 disabled:opacity-30";

const FIELD_CLASS =
  "h-8 w-full rounded-[9px] border border-white/[0.08] bg-white/[0.04] px-2.5 text-[12.5px] text-white transition-colors focus:border-[#22d3ee]/45 focus:outline-none";

const FIELD_LABEL_CLASS = "text-[11.5px] text-white/50";

const ALIGN_ICONS = { left: IconAlignLeft, center: IconAlignCenter, right: IconAlignRight };

// ---------------------------------------------------------------------------
// Board item
// ---------------------------------------------------------------------------
function BoardItem({ item, selected, scale, copy, onPointerDown, onHandleDown, onDoubleClick }) {
  const inverse = 1 / scale;
  const style = {
    position: "absolute",
    left: item.x,
    top: item.y,
    zIndex: item.z || 0,
    transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
    transformOrigin: "center center",
    outline: selected ? `${2 * inverse}px solid #22d3ee` : undefined,
    outlineOffset: selected ? `${2 * inverse}px` : undefined,
  };
  const handleSize = 12 * inverse;

  let body;
  if (item.kind === "image") {
    style.width = item.width;
    style.height = item.height;
    body = <img src={item.url} alt={item.label || item.id} draggable={false} className="w-full h-full select-none pointer-events-none" style={{ objectFit: "fill" }} />;
  } else if (item.kind === "text") {
    Object.assign(style, {
      width: item.maxWidth || "max-content",
      whiteSpace: item.maxWidth ? "pre-wrap" : "pre",
      fontSize: item.fontSize,
      lineHeight: LINE_HEIGHT,
      fontWeight: item.fontWeight === "bold" ? 700 : 400,
      fontFamily: TEXT_FONTS[item.fontFamily] || TEXT_FONTS.sans,
      color: item.color || "#ffffff",
      textAlign: item.align || "left",
    });
    body = item.text || " ";
  } else {
    style.width = item.width;
    style.height = item.height;
    body = (
      <div className="w-full h-full rounded-md border border-dashed border-[#22d3ee]/50 bg-[#22d3ee]/[0.04] flex flex-col items-center justify-center gap-3 overflow-hidden">
        <Spinner className="w-8 h-8" />
        <span className="text-[#22d3ee]/80 text-center px-4" style={{ fontSize: 14 * Math.max(1, inverse * 0.8) }}>{copy.canvas.generating}</span>
      </div>
    );
  }

  return (
    <div
      data-item={item.id}
      style={style}
      className={`${item.kind === "pending" ? "pointer-events-none" : "cursor-move"} select-none`}
      onPointerDown={item.kind === "pending" ? undefined : (event) => onPointerDown(event, item)}
      onDoubleClick={item.kind === "text" ? () => onDoubleClick(item) : undefined}
    >
      {body}
      {item.kind === "image" && (
        <span
          className={`absolute left-0 bottom-full mb-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono font-semibold pointer-events-none ${selected ? "bg-[#22d3ee] text-black" : "bg-black/70 text-white/80"}`}
          style={{ fontSize: 11, transform: `scale(${inverse})`, transformOrigin: "left bottom" }}
        >
          {item.id}
        </span>
      )}
      {item.kind === "text" && selected && (
        <span className="absolute left-0 bottom-full mb-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono font-semibold pointer-events-none bg-[#22d3ee] text-black" style={{ fontSize: 11, transform: `scale(${inverse})`, transformOrigin: "left bottom", lineHeight: 1.2 }}>
          {item.id}
        </span>
      )}
      {selected && item.kind !== "pending" && (
        <>
          <span
            onPointerDown={(event) => onHandleDown(event, item, "resize")}
            className="absolute bg-white border border-[#22d3ee] rounded-sm cursor-nwse-resize"
            style={{ width: handleSize, height: handleSize, right: -handleSize / 2 - 2 * inverse, bottom: -handleSize / 2 - 2 * inverse }}
          />
          <span
            onPointerDown={(event) => onHandleDown(event, item, "rotate")}
            className="absolute bg-white border border-[#22d3ee] rounded-full cursor-grab"
            style={{ width: handleSize, height: handleSize, left: "50%", marginLeft: -handleSize / 2, top: -28 * inverse }}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat pieces
// ---------------------------------------------------------------------------
function PlanCard({ message, copy, disabled, onApprove, onRevise, reviseActive }) {
  const plan = message.plan || {};
  const status = message.status;
  return (
    <div className="rounded-xl border border-[#22d3ee]/25 bg-[#22d3ee]/[0.05] p-3 text-[13px]">
      <div className="mb-1.5 flex items-center gap-[7px]">
        <IconSparkles size={13} stroke={2} aria-hidden="true" className="shrink-0 text-[#22d3ee]" />
        <span className="text-[12px] font-semibold text-[#67e8f9]">{copy.plan.title}</span>
        {plan.paid > 0 && <span className="ml-auto text-[11.5px] text-white/45">{fill(copy.plan.paid, { count: plan.paid })}</span>}
      </div>
      {plan.title && <p className="mb-1.5 font-semibold text-white">{plan.title}</p>}
      <ol className="list-decimal space-y-[3px] pl-[18px] leading-[1.45] text-white/75">
        {(plan.steps || []).map((step, index) => <li key={index}>{step}</li>)}
      </ol>
      {status === "awaiting" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onApprove}
            className="h-8 rounded-[9px] bg-[#22d3ee] px-3 text-[12.5px] font-semibold text-[#04202a] transition-[filter,transform] hover:brightness-105 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee]/40 disabled:opacity-40"
          >
            {copy.plan.approve}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onRevise}
            className={`h-8 rounded-[9px] border px-3 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 disabled:opacity-40 ${reviseActive ? "border-[#22d3ee]/50 text-[#67e8f9]" : "border-white/[0.12] text-white/80 hover:bg-white/[0.06] hover:text-white"}`}
          >
            {copy.plan.revise}
          </button>
          <span className="ml-auto text-[11.5px] text-white/45">{copy.plan.waiting}</span>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-white/50">
          {status === "revised" ? <IconX size={12} stroke={2.5} aria-hidden="true" className="shrink-0" /> : <IconCheck size={12} stroke={2.5} aria-hidden="true" className="shrink-0" />}
          {status === "approved" ? copy.plan.approved : status === "auto" ? copy.plan.autoApproved : copy.plan.revised}
          {status === "revised" && message.feedback ? <span className="truncate text-white/60">— {message.feedback}</span> : null}
        </div>
      )}
    </div>
  );
}

function ToolRow({ message, onFocusItem }) {
  const isError = message.status === "error" || message.status === "skipped";
  return (
    <div className={`flex min-h-[38px] items-center gap-[9px] rounded-[10px] border py-1 pl-2.5 pr-1 text-[12.5px] ${isError ? "border-red-500/20 bg-red-500/[0.06] text-red-300/90" : "border-white/[0.06] bg-white/[0.02] text-white/65"}`}>
      {message.status === "running" ? (
        <Spinner />
      ) : isError ? (
        <IconX size={13} stroke={2.5} aria-hidden="true" className="shrink-0 text-red-400" />
      ) : (
        <IconCheck size={13} stroke={2.5} aria-hidden="true" className="shrink-0 text-[#22d3ee]" />
      )}
      <span className="min-w-0 flex-1 truncate" title={message.summary}>{message.summary}</span>
      {message.url && message.assetId && (
        <button
          type="button"
          onClick={() => onFocusItem(message.assetId)}
          aria-label={message.assetId}
          title={message.assetId}
          className="h-[34px] w-[34px] shrink-0 overflow-hidden rounded-[7px] border border-white/[0.12] transition-colors hover:border-[#22d3ee]/60 focus:outline-none focus-visible:border-[#22d3ee]/60"
        >
          <img src={message.url} alt="" className="h-full w-full object-cover" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function DesignAgentStudio({
  locale = "en",
  droppedFiles,
  onFilesHandled,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const copy = useMemo(() => resolveCopy(en, zh, locale), [locale]);

  const [sessions, setSessions] = useState(() => [createSession()]);
  const [activeId, setActiveId] = useState(() => sessions[0].id);
  const [viewport, setViewport] = useState({ x: 80, y: 80, scale: 0.6 });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [selectedId, setSelectedId] = useState(null);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState(null);
  const [reviseTarget, setReviseTarget] = useState(null);
  const [chatReady, setChatReady] = useState(false);
  const [modelLists, setModelLists] = useState({ image: [], edit: [] });
  const [openMenu, setOpenMenu] = useState(null); // 'sessions' | 'images' | 'export' | null
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [restored, setRestored] = useState(false);

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const boardAreaRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const messagesListRef = useRef(null);
  const inspectorTextRef = useRef(null);

  const activeIdRef = useRef(activeId);
  const boardRef = useRef(sessions[0].board);
  const messagesRef = useRef(sessions[0].messages);
  const viewportRef = useRef(viewport);
  const settingsRef = useRef(settings);
  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const turnRef = useRef({ approved: false, paid: 0 });
  const interactionRef = useRef(null);
  const selectedIdRef = useRef(null);
  const addFilesRef = useRef(null);

  viewportRef.current = viewport;
  settingsRef.current = settings;
  selectedIdRef.current = selectedId;

  const activeSession = sessions.find((session) => session.id === activeId) || sessions[0];
  const board = activeSession.board;
  const messages = activeSession.messages;
  const selectedItem = board.items.find((item) => item.id === selectedId) || null;
  const sortedItems = useMemo(() => [...board.items].sort((a, b) => (a.z || 0) - (b.z || 0)), [board.items]);
  const awaitingPlan = useMemo(() => [...messages].reverse().find((message) => message.status === "awaiting") || null, [messages]);
  const imageReady = modelLists.image.length > 0 || modelLists.edit.length > 0;

  // ── Session state plumbing ──────────────────────────────────────────────
  // The refs are the source of truth while the agent runs, so tool calls see
  // each other's changes immediately; state mirrors them for rendering.
  const patchActiveSession = useCallback((patch) => {
    const id = activeIdRef.current;
    setSessions((previous) => previous.map((session) => (session.id === id ? { ...session, ...patch, updatedAt: Date.now() } : session)));
  }, []);

  const setBoard = useCallback((update) => {
    const next = typeof update === "function" ? update(boardRef.current) : update;
    boardRef.current = next;
    patchActiveSession({ board: next });
    return next;
  }, [patchActiveSession]);

  const setMessages = useCallback((update) => {
    const next = update(messagesRef.current);
    messagesRef.current = next;
    patchActiveSession({ messages: next });
    return next;
  }, [patchActiveSession]);

  const addMessage = useCallback((message) => {
    const id = uid();
    setMessages((list) => [...list, { id, createdAt: Date.now(), ...message }]);
    return id;
  }, [setMessages]);

  const updateMessage = useCallback((id, patch) => {
    setMessages((list) => list.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }, [setMessages]);

  const updateItem = useCallback((id, update) => {
    setBoard((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? (typeof update === "function" ? update(item) : { ...item, ...update }) : item)),
    }));
  }, [setBoard]);

  const removeItem = useCallback((id) => {
    setBoard((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
    setSelectedId((selected) => (selected === id ? null : selected));
  }, [setBoard]);

  const loadSession = useCallback((session) => {
    activeIdRef.current = session.id;
    boardRef.current = session.board;
    messagesRef.current = session.messages;
    setActiveId(session.id);
    setViewport(session.viewport);
    setSelectedId(null);
    setReviseTarget(null);
  }, []);

  // ── Persistence ─────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      const restoredSessions = sanitizeSessions(stored?.sessions);
      if (stored?.settings) setSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
      if (restoredSessions.length > 0) {
        setSessions(restoredSessions);
        loadSession(restoredSessions.find((session) => session.id === stored.activeId) || restoredSessions[0]);
      }
    } catch (error) {
      console.warn("Failed to load Design Agent sessions:", error);
    } finally {
      setRestored(true);
    }
  }, [loadSession]);

  useEffect(() => {
    if (!restored) return undefined;
    const timer = setTimeout(() => {
      const ordered = [...sessions]
        .map((session) => (session.id === activeId ? { ...session, viewport } : session))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_SESSIONS);
      // Over quota: first leave out big inline images, then the oldest sessions.
      for (const dropInlineOver of [0, 200_000]) {
        const stored = ordered.map((session) => serializeSession(session, { dropInlineOver }));
        for (let keep = stored.length; keep >= 1; keep -= 1) {
          try {
            localStorage.setItem(PERSIST_KEY, JSON.stringify({ activeId, settings, sessions: stored.slice(0, keep) }));
            return;
          } catch {
            // Try a smaller payload.
          }
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [sessions, activeId, viewport, settings, restored]);

  // ── Provider availability ───────────────────────────────────────────────
  useEffect(() => {
    const sync = () => {
      setChatReady(hasChatProvider());
      setModelLists({ image: availableImageModels(), edit: availableEditModels() });
    };
    sync();
    return subscribeProviderSettings(sync);
  }, []);

  const hasConversation = messages.length > 0;
  const chatOpen = hasConversation && !chatCollapsed;

  useEffect(() => {
    const list = messagesListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, activity, chatOpen]);

  // A plan waiting for approval brings the conversation back.
  useEffect(() => {
    if (awaitingPlan) setChatCollapsed(false);
  }, [awaitingPlan]);

  // A click outside a menu (menus stop their own clicks) or Escape closes it.
  useEffect(() => {
    if (!openMenu) return undefined;
    const close = () => setOpenMenu(null);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", close);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  const toggleMenu = (name) => (event) => {
    event.stopPropagation();
    setOpenMenu((current) => (current === name ? null : name));
  };

  // ── Viewport helpers ────────────────────────────────────────────────────
  // The part of the board the chat card, the tools and the prompt bar leave
  // uncovered, in canvas pixels: fitting, revealing and new items aim here.
  const openArea = () => {
    const canvas = canvasRef.current?.getBoundingClientRect();
    if (!canvas) return { x: 0, y: 0, width: 800, height: 600 };
    const area = boardAreaRef.current?.getBoundingClientRect() || canvas;
    const bar = composerRef.current?.getBoundingClientRect();
    const top = area.top - canvas.top + 64;
    const bottom = bar ? bar.top - canvas.top - 8 : area.bottom - canvas.top;
    return { x: area.left - canvas.left, y: top, width: area.width, height: Math.max(120, bottom - top) };
  };

  const fitToContent = useCallback((items = boardRef.current.items) => {
    const bounds = contentBounds(items);
    if (!bounds) return;
    const area = openArea();
    const scale = clamp(Math.min((area.width - 96) / Math.max(bounds.width, 1), (area.height - 48) / Math.max(bounds.height, 1)), MIN_SCALE, 2);
    setViewport({
      scale,
      x: area.x + (area.width - bounds.width * scale) / 2 - bounds.x * scale,
      y: area.y + (area.height - bounds.height * scale) / 2 - bounds.y * scale,
    });
  }, []);

  const zoomBy = (factor, origin) => {
    const area = openArea();
    const point = origin || { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    setViewport((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;
      return { scale, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
    });
  };

  const viewCenter = () => {
    const area = openArea();
    const { x, y, scale } = viewportRef.current;
    return { x: (area.x + area.width / 2 - x) / scale, y: (area.y + area.height / 2 - y) / scale };
  };

  // Pans so the item is in view (keeps zoom unless it doesn't fit).
  const revealItem = useCallback((id, force = false) => {
    const item = boardRef.current.items.find((entry) => entry.id === id);
    if (!item) return;
    const box = rotatedBounds(itemBox(item), item.rotation);
    const area = openArea();
    const { x, y, scale } = viewportRef.current;
    const screen = { x: box.x * scale + x, y: box.y * scale + y, width: box.width * scale, height: box.height * scale };
    const visible = screen.x >= area.x && screen.y >= area.y && screen.x + screen.width <= area.x + area.width && screen.y + screen.height <= area.y + area.height;
    if (visible && !force) return;
    const nextScale = clamp(Math.min(scale, (area.width - 96) / box.width, (area.height - 48) / box.height), MIN_SCALE, MAX_SCALE);
    setViewport({
      scale: nextScale,
      x: area.x + area.width / 2 - (box.x + box.width / 2) * nextScale,
      y: area.y + area.height / 2 - (box.y + box.height / 2) * nextScale,
    });
  }, []);

  const focusItem = (id) => {
    if (!boardRef.current.items.some((item) => item.id === id)) return;
    setSelectedId(id);
    revealItem(id, true);
  };

  // ── Board operations ────────────────────────────────────────────────────
  const addPending = (box) => {
    const id = `pending_${uid()}`;
    setBoard((current) => ({ ...current, items: [...current.items, { id, kind: "pending", ...box, z: topZ(current.items) + 1 }] }));
    // Keep the placeholder out from under the chat card and the prompt bar.
    revealItem(id);
    return id;
  };

  // Puts a finished image on the board: replaces a placeholder, replaces an
  // existing asset in place, or adds a new asset.
  const placeImage = async ({ url, pendingId, replaceId, x, y, width, ...meta }) => {
    const natural = (await imageSize(url)) || { width: 1024, height: 1024 };
    const ratio = natural.height / Math.max(natural.width, 1);
    let assetId = replaceId;
    setBoard((current) => {
      if (replaceId) {
        return {
          ...current,
          items: current.items.map((item) => (item.id === replaceId
            ? { ...item, ...meta, url, previousUrl: item.url, naturalWidth: natural.width, naturalHeight: natural.height, height: Math.round(item.width * ratio) }
            : item)),
        };
      }
      const [id, withId] = allocateId(current, "asset");
      assetId = id;
      const pending = current.items.find((item) => item.id === pendingId);
      const displayWidth = Math.round(width || pending?.width || DEFAULT_IMAGE_WIDTH);
      const item = {
        id,
        kind: "image",
        url,
        x: Math.round(finite(x) ? x : pending?.x ?? 0),
        y: Math.round(finite(y) ? y : pending?.y ?? 0),
        width: displayWidth,
        height: Math.round(displayWidth * ratio),
        rotation: 0,
        z: pending?.z ?? topZ(current.items) + 1,
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        createdAt: Date.now(),
        ...meta,
      };
      return { ...withId, items: [...withId.items.filter((entry) => entry.id !== pendingId), item] };
    });
    if (replaceId && pendingId) removeItem(pendingId);
    const placed = boardRef.current.items.find((item) => item.id === assetId);
    setTimeout(() => revealItem(assetId), 50);
    return placed;
  };

  const placementNextTo = (source, height) => {
    const candidate = { x: source.x + source.width + ITEM_GAP, y: source.y, width: source.width, height };
    const blocked = boardRef.current.items.some((item) => item.id !== source.id && boxesOverlap(candidate, rotatedBounds(itemBox(item), item.rotation)));
    return blocked ? findFreeSpot(boardRef.current.items) : { x: candidate.x, y: candidate.y };
  };

  const getImage = (id) => {
    const item = boardRef.current.items.find((entry) => entry.id === id);
    if (!item) throw new Error(`There is no ${id} on the board.`);
    if (item.kind !== "image") throw new Error(`${id} is not an image.`);
    return item;
  };

  const paid = async (run) => {
    onGenerationStart?.();
    try {
      return await run();
    } finally {
      onGenerationEnd?.();
    }
  };

  const noImageModel = () => new Error(copy.setup.imageBody);

  // Runs an image operation that produces a new asset (or replaces one).
  const runImageOperation = async ({ source, replace, aspect, label, meta, operation }) => {
    const placeholderHeight = source
      ? (aspect ? source.width * aspectToRatio(aspect) : source.height)
      : DEFAULT_IMAGE_WIDTH;
    const spot = source ? placementNextTo(source, placeholderHeight) : findFreeSpot(boardRef.current.items);
    const pendingId = replace && source
      ? null
      : addPending({ x: spot.x, y: spot.y, width: source?.width || DEFAULT_IMAGE_WIDTH, height: placeholderHeight });
    try {
      const url = resultUrl(await paid(operation));
      const placed = await placeImage({ url, pendingId, replaceId: replace ? source.id : null, label, ...meta });
      onGenerationComplete?.({ url, model: meta.model, prompt: label, type: "image" });
      return placed;
    } catch (error) {
      if (pendingId) removeItem(pendingId);
      throw error;
    }
  };

  const describe = (item, extra = {}) => ({
    asset_id: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    ...extra,
  });

  // ── Tools ───────────────────────────────────────────────────────────────
  const tools = {
    generate_image: async (args) => {
      const model = pickImageModel(settingsRef.current.imageModelId);
      if (!model) throw noImageModel();
      const prompt = String(args.prompt || "").trim();
      if (!prompt) throw new Error("A prompt is required.");
      const aspect = ASPECT_RATIOS.includes(args.aspect_ratio) ? args.aspect_ratio : "1:1";
      const width = clamp(Number(args.width) || DEFAULT_IMAGE_WIDTH, 32, 8000);
      const spot = finite(args.x) && finite(args.y) ? { x: args.x, y: args.y } : findFreeSpot(boardRef.current.items);
      const pendingId = addPending({ ...spot, width, height: width * aspectToRatio(aspect) });
      try {
        const url = resultUrl(await paid(() => generateImage({ model: model.id, prompt, aspect_ratio: aspect })));
        const item = await placeImage({ url, pendingId, ...spot, width, label: args.label || prompt, prompt, source: "generated", model: model.name });
        onGenerationComplete?.({ url, model: model.id, prompt, type: "image" });
        return { result: describe(item, { model: model.name }), assetId: item.id, url, summary: `${item.id} · ${model.name}` };
      } catch (error) {
        removeItem(pendingId);
        throw error;
      }
    },

    edit_image: async (args) => {
      const source = getImage(args.asset_id);
      const references = (args.reference_asset_ids || []).filter((id) => id !== source.id).map(getImage);
      const model = pickEditModel(settingsRef.current.editModelId);
      if (!model) throw noImageModel();
      const instruction = String(args.instruction || "").trim();
      if (!instruction) throw new Error("An instruction is required.");
      const aspect = ASPECT_RATIOS.includes(args.aspect_ratio) ? args.aspect_ratio : undefined;
      const images = [source.url, ...references.map((item) => item.url)].slice(0, maxEditImages(model));
      const item = await runImageOperation({
        source,
        replace: Boolean(args.replace),
        aspect,
        label: instruction,
        meta: { source: "edit", parentId: source.id, model: model.name, prompt: instruction },
        operation: () => generateI2I({ model: model.id, prompt: instruction, images_list: images, ...(aspect ? { aspect_ratio: aspect } : {}) }),
      });
      const dropped = references.length + 1 - images.length;
      return {
        result: describe(item, { model: model.name, ...(dropped > 0 ? { note: `${model.name} accepts ${images.length} image(s); ${dropped} reference(s) were left out.` } : {}) }),
        assetId: item.id,
        url: item.url,
        summary: `${source.id} → ${item.id} · ${model.name}`,
      };
    },

    upscale: async (args) => {
      const source = getImage(args.asset_id);
      const upscaler = pickUpscaler();
      let operation;
      let modelName = upscaler;
      if (upscaler) {
        operation = () => upscaleImage({ model: upscaler, image_url: source.url, resolution: "4k", upscale_factor: 2 });
      } else {
        const model = pickEditModel(settingsRef.current.editModelId);
        const resolution = highResolutionOption(model);
        if (!model || !resolution) throw new Error("No upscaler is available with your keys. Add a fal.ai or WaveSpeed key.");
        modelName = `${model.name} ${resolution}`;
        operation = () => generateI2I({ model: model.id, prompt: "Reproduce this exact image at higher resolution with crisp detail. Do not change anything.", images_list: [source.url], resolution });
      }
      const item = await runImageOperation({ source, replace: true, label: source.label, meta: { model: modelName, upscaled: true }, operation });
      return { result: describe(item, { replaced: true, natural_size: `${item.naturalWidth}x${item.naturalHeight}` }), assetId: item.id, url: item.url, summary: `${item.id} · ${item.naturalWidth}×${item.naturalHeight}` };
    },

    remove_background: async (args) => {
      const source = getImage(args.asset_id);
      let operation;
      let note;
      let modelName = "Background remover";
      if (canRemoveBackground()) {
        operation = () => removeBackground({ image_url: source.url });
      } else {
        const model = pickEditModel(settingsRef.current.editModelId);
        if (!model) throw noImageModel();
        modelName = model.name;
        note = "No background remover is available, so the subject was placed on plain white instead of transparency.";
        operation = () => generateI2I({ model: model.id, prompt: "Remove the background completely. Keep the subject exactly as it is, isolated on a plain pure white background.", images_list: [source.url] });
      }
      const item = await runImageOperation({
        source,
        replace: Boolean(args.replace),
        label: `${source.label || source.id} (cut out)`,
        meta: { source: "edit", parentId: source.id, model: modelName },
        operation,
      });
      return { result: describe(item, note ? { note } : { transparent: true }), assetId: item.id, url: item.url, summary: `${source.id} → ${item.id} · ${modelName}` };
    },

    expand_image: async (args) => {
      const source = getImage(args.asset_id);
      const aspect = ASPECT_RATIOS.includes(args.aspect_ratio) ? args.aspect_ratio : undefined;
      const guidance = String(args.instruction || "").trim();
      let operation;
      let modelName = "Outpaint";
      if (!aspect && !guidance && canExpand()) {
        operation = () => expandImage({ image_url: source.url });
      } else {
        const model = pickEditModel(settingsRef.current.editModelId);
        if (!model) {
          if (!canExpand()) throw noImageModel();
          operation = () => expandImage({ image_url: source.url });
        } else {
          modelName = model.name;
          const prompt = `Zoom out and extend this image beyond its borders${aspect ? ` to fill a ${aspect} frame` : ""}. Keep the original content unchanged and continue the scene seamlessly.${guidance ? ` ${guidance}` : ""}`;
          operation = () => generateI2I({ model: model.id, prompt, images_list: [source.url], ...(aspect ? { aspect_ratio: aspect } : {}) });
        }
      }
      const item = await runImageOperation({
        source,
        replace: false,
        aspect,
        label: `${source.label || source.id} (expanded)`,
        meta: { source: "edit", parentId: source.id, model: modelName },
        operation,
      });
      return { result: describe(item), assetId: item.id, url: item.url, summary: `${source.id} → ${item.id} · ${modelName}` };
    },

    place_asset: async (args) => {
      const target = boardRef.current.items.find((item) => item.id === args.asset_id);
      if (!target || target.kind === "pending") throw new Error(`There is no ${args.asset_id} on the board.`);
      updateItem(target.id, (item) => {
        let next = { ...item };
        if (finite(args.width)) next = resizeItem(next, args.width);
        if (finite(args.x)) next.x = Math.round(args.x);
        if (finite(args.y)) next.y = Math.round(args.y);
        if (finite(args.rotation)) next.rotation = ((args.rotation % 360) + 360) % 360;
        if (args.layer === "front") next.z = topZ(boardRef.current.items) + 1;
        if (args.layer === "back") next.z = Math.min(0, ...boardRef.current.items.map((entry) => entry.z || 0)) - 1;
        return next;
      });
      const placed = boardRef.current.items.find((item) => item.id === target.id);
      const box = itemBox(placed);
      return { result: { id: placed.id, ...box, rotation: placed.rotation || 0 }, summary: `${placed.id} → (${Math.round(box.x)}, ${Math.round(box.y)}) ${Math.round(box.width)}w` };
    },

    add_text: async (args) => {
      const patch = {};
      if (typeof args.text === "string") patch.text = args.text;
      if (finite(args.x)) patch.x = Math.round(args.x);
      if (finite(args.y)) patch.y = Math.round(args.y);
      if (finite(args.font_size)) patch.fontSize = clamp(Math.round(args.font_size), 6, 2000);
      if (typeof args.color === "string" && args.color.trim()) patch.color = args.color.trim();
      if (args.font_weight) patch.fontWeight = args.font_weight === "bold" ? "bold" : "normal";
      if (TEXT_FONTS[args.font_family]) patch.fontFamily = args.font_family;
      if (["left", "center", "right"].includes(args.align)) patch.align = args.align;
      if (finite(args.max_width)) patch.maxWidth = args.max_width > 0 ? Math.round(args.max_width) : undefined;

      const existing = args.text_id && boardRef.current.items.find((item) => item.id === args.text_id && item.kind === "text");
      let id;
      if (existing) {
        id = existing.id;
        updateItem(id, patch);
      } else {
        if (!patch.text) throw new Error("Text is required.");
        setBoard((current) => {
          const [nextId, withId] = allocateId(current, "text");
          id = nextId;
          const spot = finite(patch.x) && finite(patch.y) ? {} : findFreeSpot(current.items);
          const item = { id, kind: "text", fontSize: 64, color: "#ffffff", fontWeight: "bold", fontFamily: "sans", align: "left", rotation: 0, ...spot, ...patch, z: topZ(current.items) + 1, createdAt: Date.now() };
          return { ...withId, items: [...withId.items, item] };
        });
      }
      const item = boardRef.current.items.find((entry) => entry.id === id);
      const box = itemBox(item);
      return { result: { text_id: id, ...box, note: "Size is an estimate." }, summary: `${id} “${String(item.text).slice(0, 40)}”` };
    },

    arrange: async (args) => {
      const all = boardRef.current.items.filter((item) => item.kind !== "pending");
      const ids = Array.isArray(args.asset_ids) && args.asset_ids.length ? args.asset_ids : all.map((item) => item.id);
      const missing = ids.filter((id) => !all.some((item) => item.id === id));
      if (missing.length) throw new Error(`Not on the board: ${missing.join(", ")}`);
      const arranged = arrangeItems(ids.map((id) => all.find((item) => item.id === id)), args.layout, {
        gap: args.gap,
        x: args.x,
        y: args.y,
        columns: args.columns,
        itemWidth: args.item_width,
      });
      const byId = new Map(arranged.map((item) => [item.id, item]));
      setBoard((current) => ({ ...current, items: current.items.map((item) => byId.get(item.id) || item) }));
      return { result: { arranged: arranged.map((item) => ({ id: item.id, ...itemBox(item) })) }, summary: `${args.layout}: ${ids.join(", ")}` };
    },

    delete_item: async (args) => {
      if (!boardRef.current.items.some((item) => item.id === args.asset_id)) throw new Error(`There is no ${args.asset_id} on the board.`);
      removeItem(args.asset_id);
      return { result: { deleted: args.asset_id }, summary: args.asset_id };
    },

    export_board: async (args) => {
      const { width, height, filename } = await exportBoard({
        ids: Array.isArray(args.asset_ids) && args.asset_ids.length ? args.asset_ids : null,
        background: args.background,
        padding: args.padding,
        filename: args.filename,
      });
      return { result: { width, height, filename, downloaded: true }, summary: `${filename} · ${width}×${height}` };
    },
  };

  // ── Export ──────────────────────────────────────────────────────────────
  const exportBoard = async ({ ids = null, background, padding = 0, filename } = {}) => {
    const items = boardRef.current.items.filter((item) => item.kind !== "pending" && (!ids || ids.includes(item.id)));
    const fillColor = typeof background === "string" && background.trim() ? background.trim() : boardRef.current.background || "transparent";
    const safeName = String(filename || `design-board-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`).replace(/[^\w.-]+/g, "-").replace(/\.png$/i, "");
    const { blob, width, height } = await renderBoardToBlob(items, { background: fillColor, padding });
    saveBlob(blob, `${safeName}.png`);
    return { width, height, filename: `${safeName}.png` };
  };

  const handleExportClick = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { width, height } = await exportBoard();
      toast.success(fill(copy.toasts.exported, { width, height }));
    } catch (error) {
      toast.error(fill(copy.errors.exportFailed, { message: error.message }));
    } finally {
      setExporting(false);
    }
  };

  // ── Agent loop ──────────────────────────────────────────────────────────
  const addToolResult = (call, result, status, summary) => addMessage({
    role: "tool",
    tool_call_id: call.id,
    name: call.function?.name,
    status,
    summary,
    content: JSON.stringify(result),
  });

  const executeCall = async (call) => {
    const name = call.function?.name;
    const label = copy.tools[name] || name;
    let args;
    try {
      args = JSON.parse(call.function?.arguments || "{}") || {};
    } catch {
      addToolResult(call, { error: "The arguments were not valid JSON." }, "error", `${label}: invalid arguments`);
      return;
    }
    const tool = tools[name];
    if (!tool) {
      addToolResult(call, { error: `Unknown tool ${name}.` }, "error", `${name}?`);
      return;
    }
    if (COSTLY_TOOLS.has(name)) {
      const turn = turnRef.current;
      if (!turn.approved && turn.paid >= 1) {
        addToolResult(call, { error: "This request needs more than one paid image step. Call plan first and wait for the user's approval." }, "skipped", `${label}: waiting for a plan`);
        return;
      }
      turn.paid += 1;
    }
    const messageId = addMessage({ role: "tool", tool_call_id: call.id, name, status: "running", summary: label, content: "" });
    setActivity(fill(copy.chat.working, { tool: label }));
    try {
      const output = await tool(args);
      updateMessage(messageId, {
        status: "done",
        content: JSON.stringify(output.result),
        summary: `${label} · ${output.summary}`,
        assetId: output.assetId,
        url: output.url,
      });
    } catch (error) {
      const message = formatErrorMessage(error, copy.errors.generic);
      updateMessage(messageId, { status: "error", content: JSON.stringify({ error: message }), summary: `${label}: ${message}` });
      if (COSTLY_TOOLS.has(name)) onGenerationError?.(message);
    }
  };

  const handlePlanCall = (call) => {
    let args = {};
    try {
      args = JSON.parse(call.function?.arguments || "{}") || {};
    } catch {
      // Show whatever we got; the steps list just comes out empty.
    }
    const plan = {
      title: String(args.title || ""),
      steps: Array.isArray(args.steps) ? args.steps.map(String).slice(0, 12) : [],
      paid: Number(args.paid_operations) || 0,
    };
    if (!settingsRef.current.askFirst) {
      turnRef.current.approved = true;
      addMessage({ role: "tool", tool_call_id: call.id, name: "plan", plan, status: "auto", content: JSON.stringify({ approved: true, note: "Run the plan now." }) });
      return false;
    }
    addMessage({ role: "tool", tool_call_id: call.id, name: "plan", plan, status: "awaiting", content: "" });
    return true;
  };

  const runAgent = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setRunning(true);
    try {
      for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
        if (cancelRef.current) break;
        setActivity(copy.chat.thinking);
        const currentSettings = settingsRef.current;
        const imageModel = pickImageModel(currentSettings.imageModelId);
        const editModel = pickEditModel(currentSettings.editModelId);
        const capabilities = [
          `Upscaler: ${pickUpscaler() ? "yes" : "via edit model only"}.`,
          `Background remover: ${canRemoveBackground() ? "yes (transparent PNG)" : "via edit model only (white background)"}.`,
        ].join(" ");
        const system = systemPrompt({
          boardText: boardSummary(boardRef.current, selectedIdRef.current),
          imageModel: imageModel?.name,
          editModel: editModel?.name,
          capabilities,
          askFirst: currentSettings.askFirst,
        });
        const reply = await chatComplete({
          messages: [{ role: "system", content: system }, ...toChatMessages(trimHistory(messagesRef.current, 60))],
          tools: DESIGN_TOOLS,
          temperature: 0.5,
        });
        if (cancelRef.current) break;

        const calls = (reply?.tool_calls || [])
          .filter((call) => call?.function?.name)
          .map((call) => ({ ...call, type: "function", id: call.id || `call_${uid()}` }));
        addMessage({
          role: "assistant",
          content: typeof reply?.content === "string" ? reply.content : "",
          ...(calls.length ? { tool_calls: calls } : {}),
          // OpenRouter reasoning models need this echoed back with tool results.
          ...(calls.length && reply?.reasoning_details ? { reasoning_details: reply.reasoning_details } : {}),
        });
        if (calls.length === 0) break;

        const planCall = calls.find((call) => call.function.name === "plan");
        let paused = false;
        for (const call of calls) {
          if (cancelRef.current) {
            addToolResult(call, { error: "Stopped by the user." }, "skipped", copy.chat.stopped);
          } else if (planCall && call !== planCall) {
            addToolResult(call, { skipped: "Run this after the plan is approved." }, "skipped", `${copy.tools[call.function.name] || call.function.name}: ${copy.plan.waiting}`);
          } else if (call === planCall) {
            paused = handlePlanCall(call);
          } else {
            await executeCall(call);
          }
        }
        if (paused) break;
      }
    } catch (error) {
      const message = error instanceof ChatSetupError ? copy.errors.noChat : formatErrorMessage(error, copy.errors.generic);
      addMessage({ role: "assistant", uiOnly: true, error: true, content: message });
    } finally {
      runningRef.current = false;
      setRunning(false);
      setActivity(null);
    }
  };

  const approvePlan = (message) => {
    if (runningRef.current) return;
    updateMessage(message.id, { status: "approved", content: JSON.stringify({ approved: true, note: "The user approved. Run the plan now." }) });
    turnRef.current = { approved: true, paid: 0 };
    setReviseTarget(null);
    runAgent();
  };

  const revisePlan = (message, feedback) => {
    updateMessage(message.id, { status: "revised", feedback, content: JSON.stringify({ approved: false, feedback }) });
    addMessage({ role: "user", uiOnly: true, content: feedback });
    turnRef.current = { approved: false, paid: 0 };
    setReviseTarget(null);
    runAgent();
  };

  const send = (text = input) => {
    const content = String(text || "").trim();
    if (!content || runningRef.current) return;
    if (!hasChatProvider()) {
      toast.error(copy.errors.noChat);
      openProviderSettings(CHAT_PROVIDER_IDS);
      return;
    }
    setInput("");
    setChatCollapsed(false);
    if (awaitingPlan) {
      revisePlan(awaitingPlan, content);
      return;
    }
    turnRef.current = { approved: !settingsRef.current.askFirst, paid: 0 };
    addMessage({ role: "user", content, ...(selectedId ? { selection: selectedId } : {}) });
    if (!activeSession.title) patchActiveSession({ title: content.slice(0, 48) });
    runAgent();
  };

  const stop = () => {
    cancelRef.current = true;
    setActivity(copy.chat.stopped);
  };

  // ── Uploads ─────────────────────────────────────────────────────────────
  const addFiles = async (files) => {
    const images = files.filter((file) => file?.type?.startsWith("image/"));
    if (images.length < files.length) toast.error(copy.errors.notImage);
    for (const file of images) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(fill(copy.errors.tooLarge, { name: file.name }));
        continue;
      }
      const center = viewCenter();
      const occupied = boardRef.current.items.length > 0;
      const spot = occupied ? findFreeSpot(boardRef.current.items) : { x: Math.round(center.x - DEFAULT_IMAGE_WIDTH / 2), y: Math.round(center.y - DEFAULT_IMAGE_WIDTH / 2) };
      const pendingId = addPending({ ...spot, width: DEFAULT_IMAGE_WIDTH, height: DEFAULT_IMAGE_WIDTH });
      try {
        const url = await uploadFile(file);
        const item = await placeImage({ url, pendingId, label: file.name, source: "upload" });
        setSelectedId(item.id);
        toast.success(fill(copy.toasts.uploaded, { id: item.id }));
      } catch (error) {
        removeItem(pendingId);
        toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, copy.errors.generic) }));
      }
    }
  };
  addFilesRef.current = addFiles;

  useEffect(() => {
    if (!droppedFiles?.length) return;
    // The shell keeps every studio mounted; only take drops while visible.
    if (!rootRef.current || rootRef.current.offsetParent === null) return;
    addFilesRef.current(droppedFiles);
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled]);

  // ── Manual board edits ──────────────────────────────────────────────────
  const addTextLayer = () => {
    const center = viewCenter();
    let id;
    setBoard((current) => {
      const [nextId, withId] = allocateId(current, "text");
      id = nextId;
      const item = { id, kind: "text", text: copy.canvas.newText, x: Math.round(center.x - 150), y: Math.round(center.y - 40), fontSize: 64, color: current.items.length ? "#ffffff" : "#111111", fontWeight: "bold", fontFamily: "sans", align: "left", rotation: 0, z: topZ(current.items) + 1, createdAt: Date.now() };
      return { ...withId, items: [...withId.items, item] };
    });
    setSelectedId(id);
    setTimeout(() => inspectorTextRef.current?.select(), 30);
  };

  const duplicateItem = (source) => {
    let id;
    setBoard((current) => {
      const [nextId, withId] = allocateId(current, source.kind === "text" ? "text" : "asset");
      id = nextId;
      return { ...withId, items: [...withId.items, { ...source, id, x: source.x + 32, y: source.y + 32, z: topZ(current.items) + 1, parentId: source.id, createdAt: Date.now() }] };
    });
    setSelectedId(id);
  };

  const restack = (item, direction) => {
    const items = boardRef.current.items;
    updateItem(item.id, { z: direction === "front" ? topZ(items) + 1 : Math.min(0, ...items.map((entry) => entry.z || 0)) - 1 });
  };

  // ── Pointer interactions ────────────────────────────────────────────────
  const startPan = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    setOpenMenu(null);
    interactionRef.current = { mode: "pan", startX: event.clientX, startY: event.clientY, origin: viewportRef.current, moved: false };
  };

  const startItemDrag = (event, item) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setSelectedId(item.id);
    setOpenMenu(null);
    interactionRef.current = { mode: "move", id: item.id, startX: event.clientX, startY: event.clientY, itemX: item.x, itemY: item.y };
  };

  const startHandleDrag = (event, item, mode) => {
    event.stopPropagation();
    const element = event.currentTarget.closest("[data-item]");
    const rect = element.getBoundingClientRect();
    const box = itemBox(item);
    interactionRef.current = {
      mode,
      id: item.id,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: box.width,
      startFont: item.fontSize,
      startMaxWidth: item.maxWidth,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  };

  useEffect(() => {
    const onMove = (event) => {
      const active = interactionRef.current;
      if (!active) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      const scale = viewportRef.current.scale;
      if (active.mode === "pan") {
        if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
        setViewport({ ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy });
      } else if (active.mode === "move") {
        updateItem(active.id, { x: Math.round(active.itemX + dx / scale), y: Math.round(active.itemY + dy / scale) });
      } else if (active.mode === "resize") {
        const width = Math.max(16, active.startWidth + dx / scale);
        updateItem(active.id, (item) => {
          if (item.kind !== "text") return resizeItem(item, width);
          const factor = width / Math.max(active.startWidth, 1);
          return {
            ...item,
            fontSize: clamp(Math.round(active.startFont * factor), 6, 2000),
            ...(active.startMaxWidth ? { maxWidth: Math.round(active.startMaxWidth * factor) } : {}),
          };
        });
      } else if (active.mode === "rotate") {
        let angle = (Math.atan2(event.clientY - active.centerY, event.clientX - active.centerX) * 180) / Math.PI + 90;
        if (event.shiftKey) angle = Math.round(angle / 15) * 15;
        updateItem(active.id, { rotation: Math.round(((angle % 360) + 360) % 360) });
      }
    };
    const onUp = () => {
      const active = interactionRef.current;
      if (active?.mode === "pan" && !active.moved) setSelectedId(null);
      interactionRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [updateItem]);

  // Wheel: pinch / ctrl+wheel zooms around the cursor, plain wheel pans.
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        setViewport((current) => {
          const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.01), MIN_SCALE, MAX_SCALE);
          const ratio = scale / current.scale;
          return { scale, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
        });
      } else {
        setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard: Delete removes the selection, Escape clears it.
  useEffect(() => {
    const onKey = (event) => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) return;
      if (event.key === "Escape") setSelectedId(null);
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIdRef.current) {
        event.preventDefault();
        removeItem(selectedIdRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeItem]);

  // ── Sessions ────────────────────────────────────────────────────────────
  const switchSession = (session) => {
    if (runningRef.current) {
      toast(copy.sessions.lockedWhileRunning);
      return;
    }
    patchActiveSession({ viewport: viewportRef.current });
    loadSession(session);
    setOpenMenu(null);
  };

  const newSession = () => {
    if (runningRef.current) {
      toast(copy.sessions.lockedWhileRunning);
      return;
    }
    const session = createSession();
    patchActiveSession({ viewport: viewportRef.current });
    setSessions((previous) => [session, ...previous].slice(0, MAX_SESSIONS));
    loadSession(session);
    setOpenMenu(null);
  };

  const deleteSession = (session) => {
    if (runningRef.current || !confirm(copy.sessions.confirmDelete)) return;
    const remaining = sessions.filter((entry) => entry.id !== session.id);
    const next = remaining.length ? remaining : [createSession()];
    setSessions(next);
    if (session.id === activeIdRef.current) loadSession([...next].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
  };

  // ── Render helpers ──────────────────────────────────────────────────────
  const sessionList = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const visibleMessages = messages.filter((message) => message.role !== "assistant" || message.content);
  const isEmptyChat = messages.length === 0;
  const isEmptyBoard = board.items.length === 0;
  const showIntro = isEmptyChat && isEmptyBoard;
  const pct = Math.round(viewport.scale * 100);
  const placedCount = board.items.filter((item) => item.kind !== "pending").length;
  const itemsLabel = placedCount === 0 ? copy.sessions.itemsNone : placedCount === 1 ? copy.sessions.itemsOne : fill(copy.sessions.items, { count: placedCount });
  const imageModelName = modelLists.image.find((model) => model.id === settings.imageModelId)?.name || copy.settings.auto;
  const exportTransparent = board.background === "transparent";
  const inspecting = selectedItem && selectedItem.kind !== "pending" ? selectedItem : null;
  const setupNotice = !chatReady
    ? { title: copy.setup.chatTitle, body: copy.setup.chatBody, providers: CHAT_PROVIDER_IDS }
    : !imageReady
      ? { title: copy.setup.imageTitle, body: copy.setup.imageBody, providers: ["fal", "wavespeed", "openrouter", "google", "openai"] }
      : null;

  const pickModel = (key, id) => {
    setSettings((current) => ({ ...current, [key]: id }));
    setOpenMenu(null);
  };

  const modelMenu = (key, label, list) => (
    <>
      <PromptPopoverHeader>{label}</PromptPopoverHeader>
      <PromptMenuList>
        <PromptMenuItem
          selected={!settings[key]}
          description={list.length === 0 ? copy.settings.unavailable : undefined}
          onClick={() => pickModel(key, "")}
        >
          {copy.settings.auto}
        </PromptMenuItem>
        {list.map((model) => (
          <PromptMenuItem key={model.id} selected={settings[key] === model.id} onClick={() => pickModel(key, model.id)}>
            {model.name}
          </PromptMenuItem>
        ))}
      </PromptMenuList>
    </>
  );

  const textInspector = inspecting?.kind === "text" && (
    <>
      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL_CLASS}>{copy.inspector.text}</span>
        <textarea
          ref={inspectorTextRef}
          value={inspecting.text}
          onChange={(event) => updateItem(inspecting.id, { text: event.target.value })}
          rows={2}
          className={`${FIELD_CLASS} custom-scrollbar h-auto resize-none py-[7px] text-[13px] leading-[1.45]`}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASS}>{copy.inspector.fontSize}</span>
          <input type="number" min={6} max={2000} value={inspecting.fontSize} onChange={(event) => updateItem(inspecting.id, { fontSize: clamp(Number(event.target.value) || 6, 6, 2000) })} className={`${FIELD_CLASS} font-mono`} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASS}>{copy.inspector.color}</span>
          <label className={`${FIELD_CLASS} relative flex cursor-pointer items-center gap-2 font-mono uppercase text-white/80`}>
            <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded ring-1 ring-inset ring-white/20" style={{ background: inspecting.color || "#ffffff" }} />
            {inspecting.color || "#ffffff"}
            <input
              type="color"
              aria-label={copy.inspector.color}
              value={/^#[0-9a-f]{6}$/i.test(inspecting.color || "") ? inspecting.color : "#ffffff"}
              onChange={(event) => updateItem(inspecting.id, { color: event.target.value })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASS}>{copy.inspector.font}</span>
          <span className="group relative flex">
            <select value={inspecting.fontFamily || "sans"} onChange={(event) => updateItem(inspecting.id, { fontFamily: event.target.value })} className={`${FIELD_CLASS} cursor-pointer appearance-none pr-7`}>
              {Object.keys(TEXT_FONTS).map((font) => <option key={font} value={font} className="bg-[#111114]">{copy.inspector.fonts[font]}</option>)}
            </select>
            <PromptChevronIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASS}>{copy.inspector.align}</span>
          <div role="group" aria-label={copy.inspector.align} className="flex h-8 gap-0.5 rounded-[9px] border border-white/[0.07] bg-white/[0.04] p-0.5">
            <button
              type="button"
              aria-pressed={inspecting.fontWeight === "bold"}
              aria-label={copy.inspector.weight}
              title={copy.inspector.weight}
              onClick={() => updateItem(inspecting.id, { fontWeight: inspecting.fontWeight === "bold" ? "normal" : "bold" })}
              className={`flex-1 rounded-[7px] text-[12.5px] font-bold transition-colors ${inspecting.fontWeight === "bold" ? "bg-white/[0.1] text-white" : "text-white/55 hover:text-white"}`}
            >
              B
            </button>
            {["left", "center", "right"].map((align) => {
              const AlignIcon = ALIGN_ICONS[align];
              const on = (inspecting.align || "left") === align;
              return (
                <button
                  key={align}
                  type="button"
                  aria-pressed={on}
                  aria-label={copy.inspector.alignments[align]}
                  title={copy.inspector.alignments[align]}
                  onClick={() => updateItem(inspecting.id, { align })}
                  className={`flex flex-1 items-center justify-center rounded-[7px] transition-colors ${on ? "bg-white/[0.1] text-white" : "text-white/55 hover:text-white"}`}
                >
                  <AlignIcon size={13} stroke={2} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden bg-app-bg" data-design-agent>
      <Toaster position="top-center" toastOptions={{ style: { background: "#141414", color: "#fff", border: "1px solid rgba(255,255,255,0.08)" } }} />

      {/* ── Board ── */}
      <div
        ref={canvasRef}
        onPointerDown={startPan}
        className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing"
        style={{
          touchAction: "none",
          backgroundColor: "#0b0b0d",
          backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
          backgroundSize: `${24 * viewport.scale}px ${24 * viewport.scale}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      >
        <div className="absolute left-0 top-0" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`, transformOrigin: "0 0" }}>
          {sortedItems.map((item) => (
            <BoardItem
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              scale={viewport.scale}
              copy={copy}
              onPointerDown={startItemDrag}
              onHandleDown={startHandleDrag}
              onDoubleClick={() => setTimeout(() => inspectorTextRef.current?.select(), 0)}
            />
          ))}
        </div>
      </div>

      {/* ── Chat card (a session pill until the conversation starts) ── */}
      <section
        aria-label={copy.chat.label}
        className={`absolute inset-x-3 top-3 z-30 flex flex-col rounded-2xl md:left-4 md:right-auto md:top-4 ${FLOATING_CARD_CLASS} ${
          chatOpen ? "h-[min(34%,300px)] md:bottom-4 md:h-auto md:w-[320px] lg:w-[360px]" : "md:max-w-[360px]"
        }`}
        data-design-chat
      >
        <div className={`flex h-[52px] shrink-0 items-center gap-0.5 pl-1.5 pr-2 ${chatOpen ? "border-b border-white/[0.06]" : ""}`}>
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "sessions"}
              aria-label={`${copy.sessions.label}: ${activeSession.title || copy.sessions.untitled}`}
              onClick={toggleMenu("sessions")}
              className="group flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[10px] pl-[5px] pr-2.5 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
              data-design-sessions
            >
              <span aria-hidden="true" className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-[#22d3ee]/20 bg-[#22d3ee]/10 text-[#22d3ee]">
                <IconSparkles size={15} stroke={2} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13.5px] font-semibold text-white">{activeSession.title || copy.sessions.untitled}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-white/45">
                  {!chatOpen && running && activity ? <><Spinner className="h-2.5 w-2.5" /><span className="truncate">{activity}</span></> : <span className="truncate">{itemsLabel}</span>}
                </span>
              </span>
              <PromptChevronIcon className={`ml-auto ${openMenu === "sessions" ? "rotate-180" : ""}`} />
            </button>
            {openMenu === "sessions" && (
              <PromptPopover
                onClick={(event) => event.stopPropagation()}
                positionClassName="absolute left-0 top-full z-50 mt-2"
                className="w-[300px] max-w-[calc(100vw-24px)]"
                solid
                data-design-sessions-menu
              >
                <PromptPopoverHeader>{copy.sessions.label}</PromptPopoverHeader>
                <div role="menu" className="flex flex-col gap-0.5">
                  {sessionList.map((session) => {
                    const current = session.id === activeId;
                    return (
                      <div key={session.id} className={`group/session flex items-center rounded-[10px] pr-1 transition-colors ${current ? "bg-[#22d3ee]/[0.08]" : "hover:bg-white/[0.06]"}`}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={current}
                          onClick={() => switchSession(session)}
                          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1.5 text-left text-[13px] font-medium focus:outline-none"
                        >
                          <span className={`truncate ${current ? "text-[#67e8f9]" : "text-white/75 group-hover/session:text-white"}`}>{session.title || copy.sessions.untitled}</span>
                          <span className="ml-auto shrink-0 font-mono text-[11px] text-white/35">{session.board.items.length}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={copy.sessions.delete}
                          title={copy.sessions.delete}
                          onClick={() => deleteSession(session)}
                          className={`${SMALL_ICON_BUTTON_CLASS} opacity-0 hover:!text-red-400 focus-visible:opacity-100 group-hover/session:opacity-100 [@media(hover:none)]:opacity-100`}
                        >
                          <IconTrash size={14} stroke={1.75} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </PromptPopover>
            )}
          </div>
          <button type="button" onClick={newSession} aria-label={copy.sessions.new} title={copy.sessions.new} className={toolButtonClassName({ iconOnly: true })}>
            <IconPlus size={16} stroke={1.75} aria-hidden="true" />
          </button>
          {hasConversation && (
            <button
              type="button"
              onClick={() => setChatCollapsed((collapsed) => !collapsed)}
              aria-expanded={chatOpen}
              aria-label={chatOpen ? copy.chat.hide : copy.chat.show}
              title={chatOpen ? copy.chat.hide : copy.chat.show}
              className={toolButtonClassName({ iconOnly: true })}
              data-design-chat-toggle
            >
              {chatOpen ? (
                <>
                  <IconChevronUp size={16} stroke={1.75} aria-hidden="true" className="md:hidden" />
                  <IconLayoutSidebarLeftCollapse size={16} stroke={1.75} aria-hidden="true" className="hidden md:block" />
                </>
              ) : (
                <>
                  <IconChevronDown size={16} stroke={1.75} aria-hidden="true" className="md:hidden" />
                  <IconLayoutSidebarLeftExpand size={16} stroke={1.75} aria-hidden="true" className="hidden md:block" />
                </>
              )}
            </button>
          )}
        </div>

        {chatOpen && (
          <div ref={messagesListRef} className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-4" data-design-messages>
            {visibleMessages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex flex-col items-end gap-1">
                    {message.selection && (
                      <button type="button" onClick={() => focusItem(message.selection)} className="font-mono text-[11px] text-[#67e8f9]/80 transition-colors hover:text-[#67e8f9]">@{message.selection}</button>
                    )}
                    <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[#22d3ee]/20 bg-[#22d3ee]/[0.12] px-3.5 py-2 text-[13px] leading-relaxed text-white">{message.content}</div>
                  </div>
                );
              }
              if (message.role === "assistant") {
                return (
                  <div key={message.id} className={`max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border px-3.5 py-2 text-[13px] leading-relaxed ${message.error ? "border-red-500/20 bg-red-500/[0.08] text-red-200" : "border-white/[0.06] bg-white/[0.04] text-white/85"}`}>
                    {message.content}
                  </div>
                );
              }
              if (message.name === "plan") {
                return (
                  <PlanCard
                    key={message.id}
                    message={message}
                    copy={copy}
                    disabled={running}
                    reviseActive={reviseTarget === message.id}
                    onApprove={() => approvePlan(message)}
                    onRevise={() => { setReviseTarget(message.id); textareaRef.current?.focus(); }}
                  />
                );
              }
              return <ToolRow key={message.id} message={message} onFocusItem={focusItem} />;
            })}

            {running && activity && (
              <div className="flex items-center gap-2 pl-1 text-[12px] text-white/50"><Spinner /> {activity}</div>
            )}
          </div>
        )}
      </section>

      {/* ── What floats over the open board: tools, notices, the prompt bar ── */}
      <div
        ref={boardAreaRef}
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col ${openMenu === "images" || openMenu === "export" ? "z-40" : "z-20"} ${
          chatOpen ? "top-[calc(min(34%,300px)+20px)] md:top-0 md:left-[352px] lg:left-[392px]" : "top-[72px] md:top-0"
        }`}
        data-design-board-area
      >
        <div className="relative z-10 flex items-start justify-end gap-2 px-3 pt-3 md:px-4 md:pt-4 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <div role="toolbar" aria-label={copy.canvas.tools} className={`pointer-events-auto flex h-11 shrink-0 items-center gap-0.5 rounded-xl p-[3px] lg:col-start-2 ${FLOATING_CARD_CLASS}`} data-design-tools>
            <button type="button" onClick={() => fileInputRef.current?.click()} aria-label={copy.canvas.upload} title={copy.canvas.upload} className={toolButtonClassName()}>
              <IconUpload size={15} stroke={1.75} aria-hidden="true" />
              <span className="hidden xl:inline">{copy.canvas.upload}</span>
            </button>
            <button type="button" onClick={addTextLayer} aria-label={copy.canvas.addText} title={copy.canvas.addText} className={toolButtonClassName()}>
              <IconTypography size={15} stroke={1.75} aria-hidden="true" />
              <span className="hidden xl:inline">{copy.canvas.addText}</span>
            </button>
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-white/[0.08]" />
            <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label={copy.canvas.zoomOut} title={copy.canvas.zoomOut} className={toolButtonClassName({ iconOnly: true })}>
              <IconMinus size={14} stroke={2} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => zoomBy(1 / viewportRef.current.scale)} aria-label={copy.canvas.resetZoom} title={copy.canvas.resetZoom} className={`${toolButtonClassName({ iconOnly: true })} !w-11 font-mono !text-[12px]`}>
              {pct}%
            </button>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label={copy.canvas.zoomIn} title={copy.canvas.zoomIn} className={toolButtonClassName({ iconOnly: true })}>
              <IconPlus size={14} stroke={2} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => fitToContent()} disabled={isEmptyBoard} aria-label={copy.canvas.fit} title={copy.canvas.fit} className={toolButtonClassName({ iconOnly: true })}>
              <IconMaximize size={15} stroke={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className={`pointer-events-auto relative flex h-11 shrink-0 items-center gap-0.5 rounded-xl p-[3px] lg:col-start-3 lg:justify-self-end ${FLOATING_CARD_CLASS}`} data-design-export>
            <button type="button" onClick={handleExportClick} disabled={isEmptyBoard || exporting} aria-label={copy.canvas.export} title={copy.canvas.export} className={toolButtonClassName({ accent: true })}>
              {exporting ? <Spinner /> : <IconDownload size={15} stroke={1.75} aria-hidden="true" />}
              <span className="hidden lg:inline">{exporting ? copy.canvas.exporting : copy.canvas.export}</span>
            </button>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={openMenu === "export"}
              aria-label={copy.canvas.exportOptions}
              title={copy.canvas.exportOptions}
              onClick={toggleMenu("export")}
              className={`group ${toolButtonClassName({ iconOnly: true })} !w-7`}
            >
              <PromptChevronIcon className={openMenu === "export" ? "rotate-180" : ""} />
            </button>
            {openMenu === "export" && (
              <PromptPopover
                role="dialog"
                aria-label={copy.settings.background}
                onClick={(event) => event.stopPropagation()}
                positionClassName="absolute right-0 top-full z-50 mt-2"
                className="w-[240px]"
                solid
                data-design-export-menu
              >
                <PromptPopoverHeader>{copy.settings.background}</PromptPopoverHeader>
                <PromptSegmentedControl className="w-full">
                  <PromptSegmentOption className="flex-1" selected={exportTransparent} onClick={() => setBoard((current) => ({ ...current, background: "transparent" }))}>
                    {copy.settings.transparent}
                  </PromptSegmentOption>
                  <PromptSegmentOption className="flex-1" selected={!exportTransparent} onClick={() => setBoard((current) => ({ ...current, background: current.background === "transparent" ? "#ffffff" : current.background }))}>
                    {copy.canvas.color}
                  </PromptSegmentOption>
                </PromptSegmentedControl>
                {!exportTransparent && (
                  <label className="relative mt-2 flex h-9 cursor-pointer items-center gap-2.5 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-2.5 font-mono text-[12px] uppercase text-white/80 transition-colors hover:border-white/[0.14]">
                    <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded ring-1 ring-inset ring-white/20" style={{ background: board.background }} />
                    {board.background}
                    <input
                      type="color"
                      aria-label={copy.canvas.color}
                      value={/^#[0-9a-f]{6}$/i.test(board.background) ? board.background : "#ffffff"}
                      onChange={(event) => setBoard((current) => ({ ...current, background: event.target.value }))}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                )}
              </PromptPopover>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              if (files.length) addFiles(files);
            }}
          />
        </div>

        {/* Provider setup: the chat key first, then an image key. Over a
            board with work on it, the title alone. */}
        {setupNotice && (
          <div className={`pointer-events-auto mx-auto mt-2 flex w-[min(440px,calc(100%-24px))] gap-3 rounded-xl border border-amber-400/20 bg-[#141210]/95 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md ${showIntro ? "items-start p-3" : "items-center py-2 pl-3 pr-2"}`} data-design-setup>
            <IconKey size={16} stroke={1.75} aria-hidden="true" className={`shrink-0 text-amber-300 ${showIntro ? "mt-0.5" : ""}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-semibold text-amber-200 ${showIntro ? "" : "truncate"}`} title={showIntro ? undefined : setupNotice.body}>{setupNotice.title}</p>
              {showIntro && <p className="mt-0.5 text-[12px] leading-relaxed text-white/55">{setupNotice.body}</p>}
            </div>
            <button type="button" onClick={() => openProviderSettings(setupNotice.providers)} className="h-8 shrink-0 rounded-[9px] bg-amber-300 px-3 text-[12px] font-semibold text-black transition-[filter] hover:brightness-105">
              {copy.setup.openSettings}
            </button>
          </div>
        )}

        <div className={`flex min-h-0 flex-1 ${showIntro ? "no-scrollbar pointer-events-auto overflow-y-auto" : ""}`}>
          {showIntro ? (
            <div className="oga-enter m-auto flex w-full max-w-[460px] flex-col items-start px-5 py-6" data-design-intro>
              <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/10 text-[#22d3ee]">
                <IconSparkles size={20} stroke={1.75} />
              </span>
              <h2 className="mt-[18px] text-[26px] font-semibold leading-[1.12] tracking-[-0.025em] text-white/[0.92] md:text-[32px]">
                {copy.chat.emptyTitle} <span className="text-[#22d3ee]">{copy.chat.emptyAccent}</span>
              </h2>
              <p className="mt-3 text-[14px] leading-relaxed text-white/55 md:text-[15px]">{copy.chat.emptyBody}</p>
              <nav aria-label={copy.chat.starters} className="mt-[22px] w-full">
                {copy.chat.examples.map((example, index) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => { setInput(example); textareaRef.current?.focus(); }}
                    className={`group flex w-full items-center justify-between gap-4 border-t border-white/[0.08] py-3 text-left text-[14px] leading-[1.45] text-white/70 transition-colors hover:text-white focus:outline-none focus-visible:text-white ${index === copy.chat.examples.length - 1 ? "border-b" : ""}`}
                  >
                    {example}
                    <IconArrowRight size={14} stroke={1.75} aria-hidden="true" className="shrink-0 text-white/35 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-[#22d3ee]" />
                  </button>
                ))}
              </nav>
              <p className="mt-4 text-[12.5px] text-white/40">{copy.chat.dropHint}</p>
            </div>
          ) : isEmptyBoard ? (
            <div className="m-auto max-w-sm px-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/35"><IconPhoto size={22} stroke={1.75} aria-hidden="true" /></div>
              <p className="text-[15px] font-semibold text-white/80">{copy.canvas.emptyTitle}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">{copy.canvas.emptyBody}</p>
            </div>
          ) : null}
        </div>

        {/* The prompt bar talks to the agent */}
        <div ref={composerRef} className="pointer-events-auto relative z-10 mx-auto w-full max-w-[680px] px-3 pb-3 md:px-4 md:pb-5" data-design-composer>
          <PromptComposer positionClassName="relative w-full oga-enter-bar">
            <div className="flex items-start gap-2.5">
              {inspecting && (
                <span title={fill(copy.bar.selection, { id: inspecting.id })} className="mt-[5px] flex h-[30px] shrink-0 items-center gap-1.5 rounded-[9px] border border-[#22d3ee]/30 bg-[#22d3ee]/[0.06] pl-[9px] pr-1 font-mono text-[12px] text-[#a5f3fc]" data-design-selection>
                  {inspecting.kind === "text" ? <IconTypography size={13} stroke={2} aria-hidden="true" /> : <IconPhoto size={13} stroke={2} aria-hidden="true" />}
                  {inspecting.id}
                  <button type="button" onClick={() => setSelectedId(null)} aria-label={copy.bar.clearSelection} title={copy.bar.clearSelection} className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white">
                    <IconX size={10} stroke={2.5} aria-hidden="true" />
                  </button>
                </span>
              )}
              <PromptTextarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    send();
                  }
                }}
                aria-label={copy.bar.message}
                placeholder={awaitingPlan || reviseTarget ? copy.chat.revisePlaceholder : copy.chat.placeholder}
                className="min-w-0 flex-1"
              />
            </div>
            <PromptFooter>
              <PromptControls>
                <PromptSettingsGroup label={copy.bar.settings}>
                  <button
                    key="plan"
                    type="button"
                    role="switch"
                    aria-checked={settings.askFirst}
                    title={copy.settings.askFirstHint}
                    onClick={() => setSettings((current) => ({ ...current, askFirst: !current.askFirst }))}
                    className={promptSettingClassName()}
                    data-design-plan-first
                  >
                    <span aria-hidden="true" className={`relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors ${settings.askFirst ? "bg-[#22d3ee]" : "bg-white/[0.16]"}`}>
                      <span className={`absolute top-[2px] h-[11px] w-[11px] rounded-full transition-[left,background-color] ${settings.askFirst ? "left-[13px] bg-[#04202a]" : "left-[2px] bg-white/80"}`} />
                    </span>
                    {copy.bar.planFirst}
                  </button>
                  <div key="images" className="relative flex">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={openMenu === "images"}
                      onClick={toggleMenu("images")}
                      className={promptSettingClassName({ active: openMenu === "images" })}
                      data-design-images
                    >
                      <IconPhoto size={14} stroke={1.75} aria-hidden="true" className="opacity-60" />
                      <span className="max-w-[170px] truncate">{fill(copy.bar.images, { model: imageModelName })}</span>
                    </button>
                    {openMenu === "images" && (
                      <PromptPopover
                        role="dialog"
                        aria-label={copy.bar.imageModels}
                        onClick={(event) => event.stopPropagation()}
                        className="w-[260px]"
                        fitViewport
                        solid
                        data-design-images-menu
                      >
                        {modelMenu("imageModelId", copy.settings.imageModel, modelLists.image)}
                        <div className="mt-2 border-t border-white/[0.06] pt-2">
                          {modelMenu("editModelId", copy.settings.editModel, modelLists.edit)}
                        </div>
                      </PromptPopover>
                    )}
                  </div>
                </PromptSettingsGroup>
              </PromptControls>
              <PromptActionGroup>
                <span aria-hidden="true" className="hidden whitespace-nowrap font-mono text-[11px] text-white/50 md:inline">{copy.bar.enterHint}</span>
                {running ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.12] bg-white/[0.06] px-4 text-[13.5px] font-semibold text-white transition-colors hover:border-red-400/40 hover:bg-red-500/20 sm:w-auto"
                    data-design-stop
                  >
                    <IconPlayerStopFilled size={13} aria-hidden="true" />
                    {copy.chat.stop}
                  </button>
                ) : (
                  <PromptAction onClick={() => send()} disabled={!input.trim()} data-design-send>
                    <IconSend size={15} stroke={2} aria-hidden="true" />
                    {copy.chat.send}
                  </PromptAction>
                )}
              </PromptActionGroup>
            </PromptFooter>
          </PromptComposer>
        </div>

        {/* Selection inspector */}
        {inspecting && (
          <section
            aria-label={inspecting.id}
            onPointerDown={(event) => event.stopPropagation()}
            className={`custom-scrollbar oga-enter-card pointer-events-auto absolute right-3 top-[64px] flex max-h-[calc(100%-250px)] w-[min(280px,calc(100%-24px))] flex-col gap-3 overflow-y-auto rounded-2xl p-3 md:right-4 md:top-[72px] ${FLOATING_CARD_CLASS}`}
            data-design-inspector
          >
            <div className="flex items-center gap-0.5">
              <span className="mr-auto flex h-[22px] items-center rounded-md bg-[#22d3ee]/[0.12] px-[7px] font-mono text-[12px] text-[#67e8f9]">{inspecting.id}</span>
              {inspecting.kind === "image" && (
                <button type="button" onClick={() => downloadImage(inspecting.url, inspecting.id)} aria-label={copy.canvas.download} title={copy.canvas.download} className={SMALL_ICON_BUTTON_CLASS}><IconDownload size={14} stroke={1.75} aria-hidden="true" /></button>
              )}
              <button type="button" onClick={() => duplicateItem(inspecting)} aria-label={copy.canvas.duplicate} title={copy.canvas.duplicate} className={SMALL_ICON_BUTTON_CLASS}><IconCopy size={14} stroke={1.75} aria-hidden="true" /></button>
              <button type="button" onClick={() => restack(inspecting, "front")} aria-label={copy.canvas.front} title={copy.canvas.front} className={SMALL_ICON_BUTTON_CLASS}><IconArrowUp size={14} stroke={1.75} aria-hidden="true" /></button>
              <button type="button" onClick={() => restack(inspecting, "back")} aria-label={copy.canvas.back} title={copy.canvas.back} className={SMALL_ICON_BUTTON_CLASS}><IconArrowDown size={14} stroke={1.75} aria-hidden="true" /></button>
              <button type="button" onClick={() => removeItem(inspecting.id)} aria-label={copy.canvas.delete} title={copy.canvas.delete} className={`${SMALL_ICON_BUTTON_CLASS} hover:!text-red-400`}><IconTrash size={14} stroke={1.75} aria-hidden="true" /></button>
            </div>
            {inspecting.kind === "image" && inspecting.label && (
              <p className="line-clamp-3 text-[12px] leading-relaxed text-white/50" title={inspecting.label}>{inspecting.label}</p>
            )}
            {textInspector}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL_CLASS}>{copy.inspector.width}</span>
                <input
                  type="number"
                  min={16}
                  value={Math.round(itemBox(inspecting).width)}
                  onChange={(event) => updateItem(inspecting.id, (item) => resizeItem(item, Number(event.target.value) || 16))}
                  className={`${FIELD_CLASS} font-mono`}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={FIELD_LABEL_CLASS}>{copy.inspector.rotation}</span>
                <input
                  type="number"
                  value={Math.round(inspecting.rotation || 0)}
                  onChange={(event) => updateItem(inspecting.id, { rotation: ((Number(event.target.value) || 0) % 360 + 360) % 360 })}
                  className={`${FIELD_CLASS} font-mono`}
                />
              </label>
            </div>
            {inspecting.kind === "image" && inspecting.naturalWidth ? (
              <p className="font-mono text-[11px] text-white/35">{inspecting.naturalWidth}×{inspecting.naturalHeight}px{inspecting.model ? ` · ${inspecting.model}` : ""}</p>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
