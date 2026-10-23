"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import toast, { Toaster } from "react-hot-toast";
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
// Icons
// ---------------------------------------------------------------------------
const Icon = ({ d, size = 16, className = "", strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {(Array.isArray(d) ? d : [d]).map((path) => <path key={path} d={path} />)}
  </svg>
);
const ICONS = {
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
  stop: "M6 6h12v12H6z",
  plus: ["M12 5v14", "M5 12h14"],
  minus: "M5 12h14",
  upload: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
  download: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  text: ["M4 7V4h16v3", "M9 20h6", "M12 4v16"],
  fit: ["M8 3H5a2 2 0 00-2 2v3", "M21 8V5a2 2 0 00-2-2h-3", "M3 16v3a2 2 0 002 2h3", "M16 21h3a2 2 0 002-2v-3"],
  image: ["M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2z", "M21 15l-5-5L5 21"],
  trash: ["M3 6h18", "M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"],
  copy: ["M8 8h12v12H8z", "M16 8V4H4v12h4"],
  front: ["M12 19V5", "M5 12l7-7 7 7"],
  back: ["M12 5v14", "M19 12l-7 7-7-7"],
  settings: ["M12 15a3 3 0 100-6 3 3 0 000 6z", "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"],
  check: "M20 6L9 17l-5-5",
  x: ["M18 6L6 18", "M6 6l12 12"],
  sparkle: ["M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z", "M19 3v4", "M21 5h-4"],
  chevron: "M6 9l6 6 6-6",
  key: ["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"],
};

const Spinner = ({ className = "w-3.5 h-3.5" }) => (
  <span className={`${className} inline-block rounded-full border-2 border-white/15 border-t-[#22d3ee] animate-spin`} />
);

const toolbarButton = "h-8 min-w-8 px-2 inline-flex items-center justify-center gap-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors text-xs disabled:opacity-40 disabled:pointer-events-none";

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
      <div className="flex items-center gap-2 text-[#22d3ee] text-[11px] font-bold uppercase tracking-wider mb-1">
        <Icon d={ICONS.sparkle} size={13} /> {copy.plan.title}
        {plan.paid > 0 && <span className="ml-auto text-white/40 normal-case tracking-normal font-medium">{fill(copy.plan.paid, { count: plan.paid })}</span>}
      </div>
      {plan.title && <p className="text-white font-semibold mb-2">{plan.title}</p>}
      <ol className="list-decimal pl-5 space-y-1 text-white/75">
        {(plan.steps || []).map((step, index) => <li key={index}>{step}</li>)}
      </ol>
      {status === "awaiting" ? (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" disabled={disabled} onClick={onApprove} className="px-3 py-1.5 rounded-lg bg-[#22d3ee] text-black font-bold text-xs hover:opacity-90 disabled:opacity-40">
            {copy.plan.approve}
          </button>
          <button type="button" disabled={disabled} onClick={onRevise} className={`px-3 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 ${reviseActive ? "border-[#22d3ee]/60 text-[#22d3ee]" : "border-white/15 text-white/80 hover:bg-white/[0.06]"}`}>
            {copy.plan.revise}
          </button>
          <span className="ml-auto text-[11px] text-white/40">{copy.plan.waiting}</span>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-white/45 flex items-center gap-1.5">
          <Icon d={status === "revised" ? ICONS.x : ICONS.check} size={12} />
          {status === "approved" ? copy.plan.approved : status === "auto" ? copy.plan.autoApproved : copy.plan.revised}
          {status === "revised" && message.feedback ? <span className="text-white/60 truncate">— {message.feedback}</span> : null}
        </div>
      )}
    </div>
  );
}

function ToolRow({ message, onFocusItem }) {
  const isError = message.status === "error" || message.status === "skipped";
  return (
    <div className={`flex items-center gap-2 text-[12px] rounded-lg px-2.5 py-1.5 border ${isError ? "border-red-500/20 bg-red-500/[0.06] text-red-300/90" : "border-white/[0.06] bg-white/[0.02] text-white/60"}`}>
      {message.status === "running" ? <Spinner /> : <Icon d={isError ? ICONS.x : ICONS.check} size={13} className={isError ? "text-red-400" : "text-[#22d3ee]"} />}
      <span className="flex-1 min-w-0 truncate" title={message.summary}>{message.summary}</span>
      {message.url && message.assetId && (
        <button type="button" onClick={() => onFocusItem(message.assetId)} className="shrink-0 w-9 h-9 rounded-md overflow-hidden border border-white/10 hover:border-[#22d3ee]/60">
          <img src={message.url} alt={message.assetId} className="w-full h-full object-cover" />
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
  const [openMenu, setOpenMenu] = useState(null); // 'sessions' | 'settings' | null
  const [exporting, setExporting] = useState(false);
  const [restored, setRestored] = useState(false);

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activity]);

  // ── Viewport helpers ────────────────────────────────────────────────────
  const canvasSize = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top } : { width: 800, height: 600, left: 0, top: 0 };
  };

  const fitToContent = useCallback((items = boardRef.current.items) => {
    const bounds = contentBounds(items);
    if (!bounds) return;
    const { width, height } = canvasSize();
    const scale = clamp(Math.min((width - 120) / Math.max(bounds.width, 1), (height - 140) / Math.max(bounds.height, 1)), MIN_SCALE, 2);
    setViewport({
      scale,
      x: (width - bounds.width * scale) / 2 - bounds.x * scale,
      y: (height - bounds.height * scale) / 2 - bounds.y * scale + 20,
    });
  }, []);

  const zoomBy = (factor, origin) => {
    const { width, height } = canvasSize();
    const point = origin || { x: width / 2, y: height / 2 };
    setViewport((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;
      return { scale, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
    });
  };

  const viewCenter = () => {
    const { width, height } = canvasSize();
    const { x, y, scale } = viewportRef.current;
    return { x: (width / 2 - x) / scale, y: (height / 2 - y) / scale };
  };

  // Pans so the item is in view (keeps zoom unless it doesn't fit).
  const revealItem = useCallback((id, force = false) => {
    const item = boardRef.current.items.find((entry) => entry.id === id);
    if (!item) return;
    const box = rotatedBounds(itemBox(item), item.rotation);
    const { width, height } = canvasSize();
    const { x, y, scale } = viewportRef.current;
    const screen = { x: box.x * scale + x, y: box.y * scale + y, width: box.width * scale, height: box.height * scale };
    const visible = screen.x >= 0 && screen.y >= 0 && screen.x + screen.width <= width && screen.y + screen.height <= height;
    if (visible && !force) return;
    const nextScale = clamp(Math.min(scale, (width - 120) / box.width, (height - 140) / box.height), MIN_SCALE, MAX_SCALE);
    setViewport({
      scale: nextScale,
      x: width / 2 - (box.x + box.width / 2) * nextScale,
      y: height / 2 - (box.y + box.height / 2) * nextScale,
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
  const pct = Math.round(viewport.scale * 100);

  const textInspector = selectedItem?.kind === "text" && (
    <div className="grid grid-cols-2 gap-2">
      <label className="col-span-2 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.inspector.text}</span>
        <textarea
          ref={inspectorTextRef}
          value={selectedItem.text}
          onChange={(event) => updateItem(selectedItem.id, { text: event.target.value })}
          rows={2}
          className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#22d3ee]/50 resize-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.inspector.fontSize}</span>
        <input type="number" min={6} max={2000} value={selectedItem.fontSize} onChange={(event) => updateItem(selectedItem.id, { fontSize: clamp(Number(event.target.value) || 6, 6, 2000) })} className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.inspector.color}</span>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(selectedItem.color || "") ? selectedItem.color : "#ffffff"} onChange={(event) => updateItem(selectedItem.id, { color: event.target.value })} className="w-full h-[30px] bg-black/40 border border-white/10 rounded-lg cursor-pointer" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.inspector.font}</span>
        <select value={selectedItem.fontFamily || "sans"} onChange={(event) => updateItem(selectedItem.id, { fontFamily: event.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none">
          {Object.keys(TEXT_FONTS).map((font) => <option key={font} value={font}>{copy.inspector.fonts[font]}</option>)}
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.inspector.align}</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => updateItem(selectedItem.id, { fontWeight: selectedItem.fontWeight === "bold" ? "normal" : "bold" })} className={`flex-1 h-[30px] rounded-lg text-sm font-bold border ${selectedItem.fontWeight === "bold" ? "border-[#22d3ee]/50 text-[#22d3ee]" : "border-white/10 text-white/60"}`} title={copy.inspector.weight}>B</button>
          {["left", "center", "right"].map((align) => (
            <button key={align} type="button" title={align} onClick={() => updateItem(selectedItem.id, { align })} className={`flex-1 h-[30px] rounded-lg border flex items-center justify-center ${(selectedItem.align || "left") === align ? "border-[#22d3ee]/50 text-[#22d3ee]" : "border-white/10 text-white/60"}`}>
              <Icon size={13} d={align === "left" ? ["M4 6h16", "M4 12h10", "M4 18h13"] : align === "center" ? ["M4 6h16", "M7 12h10", "M5 18h14"] : ["M4 6h16", "M10 12h10", "M7 18h13"]} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="w-full h-full flex flex-col-reverse md:flex-row bg-app-bg relative overflow-hidden">
      <Toaster position="top-center" toastOptions={{ style: { background: "#141414", color: "#fff", border: "1px solid rgba(255,255,255,0.08)" } }} />

      {/* ── Chat panel ── */}
      <aside className="w-full md:w-[380px] h-[46%] md:h-full shrink-0 flex flex-col border-t md:border-t-0 md:border-r border-white/[0.06] bg-[#08080a] relative z-20">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-white/[0.06] shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#22d3ee]/10 border border-[#22d3ee]/20 flex items-center justify-center text-[#22d3ee]">
            <Icon d={ICONS.sparkle} size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => setOpenMenu(openMenu === "sessions" ? null : "sessions")} className="flex items-center gap-1 max-w-full text-left">
              <span className="text-sm font-bold text-white truncate">{activeSession.title || copy.sessions.untitled}</span>
              <Icon d={ICONS.chevron} size={14} className="text-white/40 shrink-0" />
            </button>
            <p className="text-[11px] text-white/35 truncate">{copy.title}</p>
          </div>
          <button type="button" onClick={newSession} title={copy.sessions.new} className={toolbarButton}><Icon d={ICONS.plus} /></button>
          <button type="button" onClick={() => setOpenMenu(openMenu === "settings" ? null : "settings")} title={copy.settings.title} className={`${toolbarButton} ${openMenu === "settings" ? "text-[#22d3ee]" : ""}`}><Icon d={ICONS.settings} /></button>

          {openMenu === "sessions" && (
            <div className="absolute left-3 right-3 top-14 z-40 rounded-xl border border-white/[0.08] bg-[#111114] shadow-2xl p-1.5 max-h-[50vh] overflow-y-auto custom-scrollbar">
              <p className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/35">{copy.sessions.label}</p>
              {sessionList.map((session) => (
                <div key={session.id} className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer ${session.id === activeId ? "bg-[#22d3ee]/10 text-[#22d3ee]" : "text-white/75 hover:bg-white/[0.05]"}`} onClick={() => switchSession(session)}>
                  <span className="flex-1 truncate text-[13px]">{session.title || copy.sessions.untitled}</span>
                  <span className="text-[10px] text-white/30 shrink-0">{session.board.items.length}</span>
                  <button type="button" title={copy.sessions.delete} onClick={(event) => { event.stopPropagation(); deleteSession(session); }} className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400">
                    <Icon d={ICONS.trash} size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {openMenu === "settings" && (
            <div className="absolute left-3 right-3 top-14 z-40 rounded-xl border border-white/[0.08] bg-[#111114] shadow-2xl p-3.5 space-y-3 text-[13px]">
              <p className="text-[10px] uppercase tracking-wider text-white/35">{copy.settings.title}</p>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={settings.askFirst} onChange={(event) => setSettings((current) => ({ ...current, askFirst: event.target.checked }))} className="mt-0.5 accent-[#22d3ee]" />
                <span>
                  <span className="text-white font-medium block">{copy.settings.askFirst}</span>
                  <span className="text-white/40 text-[11px]">{copy.settings.askFirstHint}</span>
                </span>
              </label>
              {[["imageModelId", copy.settings.imageModel, modelLists.image], ["editModelId", copy.settings.editModel, modelLists.edit]].map(([key, label, list]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-white/50 text-[11px]">{label}</span>
                  <select value={settings[key]} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value }))} className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none">
                    <option value="">{copy.settings.auto}{list.length === 0 ? ` (${copy.settings.unavailable})` : ""}</option>
                    {list.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>
                </label>
              ))}
              <div className="flex flex-col gap-1">
                <span className="text-white/50 text-[11px]">{copy.settings.background}</span>
                <div className="flex items-center gap-3">
                  <input type="color" disabled={board.background === "transparent"} value={board.background === "transparent" ? "#ffffff" : board.background} onChange={(event) => setBoard((current) => ({ ...current, background: event.target.value }))} className="w-10 h-7 bg-transparent border border-white/10 rounded cursor-pointer disabled:opacity-30" />
                  <label className="flex items-center gap-1.5 text-white/70 cursor-pointer">
                    <input type="checkbox" checked={board.background === "transparent"} onChange={(event) => setBoard((current) => ({ ...current, background: event.target.checked ? "transparent" : "#ffffff" }))} className="accent-[#22d3ee]" />
                    {copy.settings.transparent}
                  </label>
                </div>
              </div>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3" onClick={() => setOpenMenu(null)}>
          {!chatReady && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3.5">
              <p className="text-amber-200 font-semibold text-[13px] flex items-center gap-2"><Icon d={ICONS.key} size={14} /> {copy.setup.chatTitle}</p>
              <p className="text-white/55 text-[12px] mt-1.5 leading-relaxed">{copy.setup.chatBody}</p>
              <button type="button" onClick={() => openProviderSettings(CHAT_PROVIDER_IDS)} className="mt-2.5 px-3 py-1.5 rounded-lg bg-amber-300 text-black text-xs font-bold hover:opacity-90">{copy.setup.openSettings}</button>
            </div>
          )}

          {isEmptyChat && (
            <div className="pt-2">
              <h3 className="text-white font-bold text-base">{copy.chat.emptyTitle}</h3>
              <p className="text-white/45 text-[13px] mt-1.5 leading-relaxed">{copy.chat.emptyBody}</p>
              <div className="mt-4 flex flex-col gap-2">
                {copy.chat.examples.map((example) => (
                  <button key={example} type="button" onClick={() => { setInput(example); textareaRef.current?.focus(); }} className="text-left text-[12px] text-white/70 rounded-lg border border-white/[0.07] bg-white/[0.02] hover:border-[#22d3ee]/30 hover:text-white px-3 py-2 transition-colors">
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {visibleMessages.map((message) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className="flex flex-col items-end gap-1">
                  {message.selection && (
                    <button type="button" onClick={() => focusItem(message.selection)} className="text-[10px] font-mono text-[#22d3ee]/80 hover:text-[#22d3ee]">@{message.selection}</button>
                  )}
                  <div className="max-w-[88%] rounded-2xl rounded-br-md bg-[#22d3ee]/12 border border-[#22d3ee]/20 px-3.5 py-2 text-[13px] text-white whitespace-pre-wrap break-words">{message.content}</div>
                </div>
              );
            }
            if (message.role === "assistant") {
              return (
                <div key={message.id} className={`max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2 text-[13px] whitespace-pre-wrap break-words ${message.error ? "bg-red-500/[0.08] border border-red-500/20 text-red-200" : "bg-white/[0.04] border border-white/[0.06] text-white/85"}`}>
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
            <div className="flex items-center gap-2 text-[12px] text-white/50 pl-1"><Spinner /> {activity}</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 border-t border-white/[0.06] shrink-0">
          {selectedItem && selectedItem.kind !== "pending" && (
            <div className="flex items-center gap-2 mb-2 text-[11px] text-white/45">
              {copy.chat.selected}
              <span className="font-mono text-[#22d3ee] bg-[#22d3ee]/10 rounded px-1.5 py-0.5">{selectedItem.id}</span>
              <button type="button" onClick={() => setSelectedId(null)} className="hover:text-white">{copy.chat.clearSelection}</button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-[#111114] p-2 focus-within:border-[#22d3ee]/40">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder={awaitingPlan || reviseTarget ? copy.chat.revisePlaceholder : copy.chat.placeholder}
              className="flex-1 bg-transparent resize-none text-[13px] text-white placeholder:text-white/25 focus:outline-none max-h-40 min-h-[40px] px-1.5 py-1 custom-scrollbar"
            />
            {running ? (
              <button type="button" onClick={stop} title={copy.chat.stop} className="w-9 h-9 shrink-0 rounded-xl bg-white/10 text-white hover:bg-red-500/80 flex items-center justify-center">
                <Icon d={ICONS.stop} size={14} />
              </button>
            ) : (
              <button type="button" onClick={() => send()} disabled={!input.trim()} title={copy.chat.send} className="w-9 h-9 shrink-0 rounded-xl bg-[#22d3ee] text-black flex items-center justify-center disabled:opacity-30 hover:opacity-90">
                <Icon d={ICONS.send} size={15} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Canvas board ── */}
      <main className="flex-1 min-h-0 relative overflow-hidden">
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

        {/* Toolbar */}
        <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center gap-2 pointer-events-none z-10">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-white/[0.08] bg-[#111114]/90 backdrop-blur-md p-1 shadow-xl">
            <button type="button" onClick={() => fileInputRef.current?.click()} className={toolbarButton} title={copy.canvas.upload}><Icon d={ICONS.upload} /><span className="hidden lg:inline">{copy.canvas.upload}</span></button>
            <button type="button" onClick={addTextLayer} className={toolbarButton} title={copy.canvas.addText}><Icon d={ICONS.text} /><span className="hidden lg:inline">{copy.canvas.addText}</span></button>
            <span className="w-px h-5 bg-white/10 mx-1" />
            <button type="button" onClick={() => zoomBy(1 / 1.25)} className={toolbarButton} title={copy.canvas.zoomOut}><Icon d={ICONS.minus} /></button>
            <button type="button" onClick={() => setViewport((current) => ({ ...current, scale: 1 }))} className={`${toolbarButton} font-mono w-12`}>{pct}%</button>
            <button type="button" onClick={() => zoomBy(1.25)} className={toolbarButton} title={copy.canvas.zoomIn}><Icon d={ICONS.plus} /></button>
            <button type="button" onClick={() => fitToContent()} disabled={isEmptyBoard} className={toolbarButton} title={copy.canvas.fit}><Icon d={ICONS.fit} /></button>
          </div>
          <div className="pointer-events-auto ml-auto flex items-center gap-0.5 rounded-xl border border-white/[0.08] bg-[#111114]/90 backdrop-blur-md p-1 shadow-xl">
            <button type="button" onClick={handleExportClick} disabled={isEmptyBoard || exporting} className={`${toolbarButton} text-[#22d3ee] hover:text-[#22d3ee]`}>
              {exporting ? <Spinner /> : <Icon d={ICONS.download} />}
              <span>{exporting ? copy.canvas.exporting : copy.canvas.export}</span>
            </button>
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

        {/* Image provider prompt */}
        {!imageReady && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 w-[min(440px,calc(100%-24px))] rounded-xl border border-amber-400/20 bg-[#141210]/95 backdrop-blur-md p-3 flex items-start gap-3 shadow-xl">
            <Icon d={ICONS.key} size={16} className="text-amber-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-amber-200 text-[13px] font-semibold">{copy.setup.imageTitle}</p>
              <p className="text-white/50 text-[12px] mt-0.5">{copy.setup.imageBody}</p>
            </div>
            <button type="button" onClick={() => openProviderSettings(["fal", "wavespeed", "openrouter", "google", "openai"])} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-300 text-black text-[11px] font-bold">{copy.setup.openSettings}</button>
          </div>
        )}

        {/* Empty board */}
        {isEmptyBoard && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center max-w-sm px-6">
              <div className="w-14 h-14 mx-auto rounded-2xl border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/30 mb-4"><Icon d={ICONS.image} size={24} /></div>
              <p className="text-white/70 font-semibold">{copy.canvas.emptyTitle}</p>
              <p className="text-white/35 text-[13px] mt-1.5 leading-relaxed">{copy.canvas.emptyBody}</p>
            </div>
          </div>
        )}

        {/* Selection inspector */}
        {selectedItem && selectedItem.kind !== "pending" && (
          <div className="absolute bottom-3 right-3 z-10 w-[min(300px,calc(100%-24px))] rounded-xl border border-white/[0.08] bg-[#111114]/95 backdrop-blur-md shadow-2xl p-3 space-y-3" onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[12px] font-bold text-[#22d3ee] mr-auto">{selectedItem.id}</span>
              {selectedItem.kind === "image" && (
                <button type="button" onClick={() => downloadImage(selectedItem.url, selectedItem.id)} className={toolbarButton} title={copy.canvas.download}><Icon d={ICONS.download} size={14} /></button>
              )}
              <button type="button" onClick={() => duplicateItem(selectedItem)} className={toolbarButton} title={copy.canvas.duplicate}><Icon d={ICONS.copy} size={14} /></button>
              <button type="button" onClick={() => restack(selectedItem, "front")} className={toolbarButton} title={copy.canvas.front}><Icon d={ICONS.front} size={14} /></button>
              <button type="button" onClick={() => restack(selectedItem, "back")} className={toolbarButton} title={copy.canvas.back}><Icon d={ICONS.back} size={14} /></button>
              <button type="button" onClick={() => removeItem(selectedItem.id)} className={`${toolbarButton} hover:text-red-400`} title={copy.canvas.delete}><Icon d={ICONS.trash} size={14} /></button>
            </div>
            {selectedItem.kind === "image" && selectedItem.label && (
              <p className="text-[11px] text-white/45 line-clamp-3" title={selectedItem.label}>{selectedItem.label}</p>
            )}
            {textInspector}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.inspector.width}</span>
                <input
                  type="number"
                  min={16}
                  value={Math.round(itemBox(selectedItem).width)}
                  onChange={(event) => updateItem(selectedItem.id, (item) => resizeItem(item, Number(event.target.value) || 16))}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.inspector.rotation}</span>
                <input
                  type="number"
                  value={Math.round(selectedItem.rotation || 0)}
                  onChange={(event) => updateItem(selectedItem.id, { rotation: ((Number(event.target.value) || 0) % 360 + 360) % 360 })}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none"
                />
              </label>
            </div>
            {selectedItem.kind === "image" && selectedItem.naturalWidth ? (
              <p className="text-[10px] text-white/30 font-mono">{selectedItem.naturalWidth}×{selectedItem.naturalHeight}px{selectedItem.model ? ` · ${selectedItem.model}` : ""}</p>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
