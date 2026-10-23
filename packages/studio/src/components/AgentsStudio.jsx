"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import toast, { Toaster } from "react-hot-toast";
import { uploadFile } from "../generation.js";
import { chatComplete, hasChatProvider, ChatSetupError, CHAT_PROVIDER_IDS } from "../providers/chat.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import {
  MODEL_SLOTS,
  buildToolDefinitions,
  describeToolModel,
  isModelRunnable,
  pickModel,
  runAgentTool,
  slotModels,
} from "../agentsStudioTools.js";
import { formatErrorMessage } from "../utils/formatError.js";
import en from "../messages/en/agentsStudio.json";
import zh from "../messages/zh/agentsStudio.json";
import { resolveCopy } from "../i18nUtils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PERSIST_KEY = "hg_agents_studio_persistent";
const MAX_TOOL_ROUNDS = 6;
const MAX_CALLS_PER_ROUND = 6;
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES_PER_CHAT = 80;
const HISTORY_FOR_MODEL = 24;
const MAX_ATTACHMENTS = 6;

const COLORS = {
  cyan: "#22d3ee",
  violet: "#a78bfa",
  pink: "#f472b6",
  amber: "#fbbf24",
  emerald: "#34d399",
  rose: "#fb7185",
  blue: "#60a5fa",
  orange: "#fb923c",
};
const EMOJI_CHOICES = ["🤖", "🎨", "🎬", "📸", "🎞️", "📱", "🎙️", "✨", "🧠", "🛍️", "🏷️", "🌈", "🦄", "🚀", "🎧", "🖌️"];

const BASE_PROMPT = `You are a creative agent inside Openstudio, a studio that makes images, video and audio with the user's own provider keys.

How to work:
- When the user wants visual or audio content, call the tools to actually create it. Don't just describe what you would make.
- Write rich, specific tool prompts: subject, composition, framing, lighting, style, lens, color and mood. Only ask for rendered text in an image when the user wants it.
- Media in this conversation appears as [image: URL], [video: URL] or [audio: URL]. Pass those exact URLs to tools when building on earlier results or on images the user attached. Never invent URLs.
- When the user attaches images, use them as references (generate_image with reference_image_urls, or edit_image) unless they ask otherwise.
- For variations, a set of posts or storyboard frames, call tools several times in the same turn.
- If a tool fails, explain the problem in a sentence (for example, a provider key may be missing in Settings → Providers) and suggest a next step. Don't retry the same failing call more than once.
- Generated media is shown to the user automatically, so don't repeat URLs. Keep replies short: what you made, the key creative choices, and one to three next-step ideas.
- If something essential is unclear, ask one short question; otherwise make sensible creative choices and go.
- Reply in the user's language.`;

const BUILTIN_AGENTS = [
  {
    id: "creative-director",
    emoji: "🎬",
    color: "violet",
    instructions:
      "You are a seasoned creative director. Turn briefs into distinct concepts with a clear idea, tone and visual language. Present two or three directions when the brief is open, then produce key visuals for the chosen one. Think about brand fit, audience and campaign formats (hero image, social cut-downs, short teaser videos). Give each concept a short name.",
  },
  {
    id: "product-photographer",
    emoji: "📸",
    color: "amber",
    instructions:
      "You are a commercial product photographer. Create studio and lifestyle product shots. When the user attaches a product photo, always pass it as a reference so the product stays accurate (shape, label, colors). Describe surfaces, props, lighting setup (softbox, rim light, golden hour), lens and depth of field. Offer clean e-commerce variants (white or neutral background), background removal and upscaling for final deliverables.",
  },
  {
    id: "storyboard-artist",
    emoji: "🎞️",
    color: "cyan",
    instructions:
      "You are a film storyboard artist. Break a story or ad into numbered shots with shot type, camera angle, movement and action. Generate one image per shot in a consistent style and with consistent characters: after the first frame, pass earlier frames as reference images. Default to 16:9. When asked, animate frames with generate_video using the frame as image_url and a prompt describing motion and camera.",
  },
  {
    id: "social-media-designer",
    emoji: "📱",
    color: "pink",
    instructions:
      "You are a social media designer. Create scroll-stopping posts in the right formats: 1:1 or 4:5 for feed posts, 9:16 for stories and reels, 16:9 for YouTube thumbnails. Keep layouts bold and simple, leave room for overlay text, and keep a consistent look across a set. After creating, suggest a short caption and a few hashtags.",
  },
  {
    id: "audio-producer",
    emoji: "🎙️",
    color: "emerald",
    instructions:
      "You are a voice and sound producer. Write tight scripts and record them with text_to_speech, picking a voice that suits the brand. Compose music and jingles with generate_audio, describing genre, tempo, instruments and mood. Keep voiceover scripts within the requested duration (about 2.5 words per second).",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const fill = (template, values) => String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const colorOf = (key) => COLORS[key] || COLORS.cyan;

function contentText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("").trim();
  }
  return "";
}

function titleFrom(text, fallback) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

function systemPromptFor(agent, tools) {
  const toolNames = tools.map((tool) => tool.function.name).join(", ");
  return [
    BASE_PROMPT,
    toolNames ? `Tools available right now: ${toolNames}.` : "No generation tools are available in this deployment; help with ideas and prompts only.",
    `Your role (${agent.name}):\n${agent.instructions || agent.description || "A helpful creative assistant."}`,
  ].join("\n\n");
}

// Inline (data:) results are huge; the model sees a short alias instead and
// tool arguments are mapped back before running.
const inlineMedia = new Map();
function modelUrl(url) {
  if (typeof url !== "string" || !url.startsWith("data:")) return url;
  let hash = 5381;
  for (let i = 0; i < url.length; i += 7) hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
  const alias = `media://${(hash >>> 0).toString(36)}${url.length.toString(36)}`;
  inlineMedia.set(alias, url);
  return alias;
}
function resolveModelUrls(value) {
  if (typeof value === "string") return inlineMedia.get(value) || value;
  if (Array.isArray(value)) return value.map(resolveModelUrls);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveModelUrls(entry)]));
  return value;
}

// Earlier turns are replayed as plain text (with media tags) so a chat can
// continue on any provider without replaying provider-specific tool calls.
function toModelHistory(messages) {
  const out = [];
  for (const message of messages.slice(-HISTORY_FOR_MODEL)) {
    if (message.role === "user") {
      const tags = (message.attachments || []).map((url) => `[image: ${modelUrl(url)}]`);
      const content = [message.text, tags.length ? `Attached:\n${tags.join("\n")}` : ""].filter(Boolean).join("\n\n");
      if (content) out.push({ role: "user", content });
    } else if (message.role === "assistant") {
      const made = [];
      for (const step of message.steps || []) {
        if (step.status === "done") {
          for (const media of step.media || []) made.push(`${step.tool} → [${media.type}: ${modelUrl(media.url)}]`);
        } else if (step.status === "error") {
          made.push(`${step.tool} failed: ${step.error}`);
        }
      }
      const content = [message.text, made.length ? `Tool results:\n${made.join("\n")}` : ""].filter(Boolean).join("\n\n");
      if (content) out.push({ role: "assistant", content });
    }
  }
  return out;
}

// Small JPEG copies of attachments so vision-capable chat models can see them.
async function toVisionDataUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

async function userTurnContent(userMessage, withVision) {
  const attachments = userMessage.attachments || [];
  const tags = attachments.map((url) => `[image: ${modelUrl(url)}]`);
  const text = [userMessage.text || "Use the attached image(s).", tags.length ? `Attached images:\n${tags.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
  if (!withVision || attachments.length === 0) return { role: "user", content: text };
  const images = (await Promise.all(attachments.slice(0, 4).map(toVisionDataUrl))).filter(Boolean);
  if (images.length === 0) return { role: "user", content: text };
  return {
    role: "user",
    content: [{ type: "text", text }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))],
  };
}

function stripVision(message) {
  if (!Array.isArray(message.content)) return message;
  return { ...message, content: contentText(message.content.filter((part) => part.type === "text")) };
}

function absoluteUrl(url) {
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

async function downloadMedia(url, type) {
  const ext = String(url).split("?")[0].match(/\.(\w{2,4})$/)?.[1] || { image: "png", video: "mp4", audio: "mp3" }[type] || "bin";
  try {
    const blob = await (await fetch(url)).blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `agent-${type || "media"}-${Date.now()}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function copyToClipboard(text) {
  return navigator.clipboard?.writeText(text);
}

// Limits saved state so localStorage stays small (URLs only, capped history).
function compactState(state) {
  const conversations = [...state.conversations]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => ({ ...conversation, messages: conversation.messages.slice(-MAX_MESSAGES_PER_CHAT) }));
  return { ...state, conversations };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
    if (!stored || typeof stored !== "object") return null;
    const conversations = (Array.isArray(stored.conversations) ? stored.conversations : []).map((conversation) => ({
      ...conversation,
      messages: (conversation.messages || []).map((message) =>
        message.role === "assistant" && ["thinking", "working"].includes(message.status)
          ? {
              ...message,
              status: "interrupted",
              steps: (message.steps || []).map((step) => (step.status === "running" ? { ...step, status: "error", error: "Interrupted" } : step)),
            }
          : message
      ),
    }));
    return {
      customAgents: Array.isArray(stored.customAgents) ? stored.customAgents : [],
      conversations,
      activeAgentId: stored.activeAgentId || BUILTIN_AGENTS[0].id,
      activeChatByAgent: stored.activeChatByAgent || {},
      pins: stored.pins || {},
    };
  } catch {
    return null;
  }
}

const EMPTY_STATE = {
  customAgents: [],
  conversations: [],
  activeAgentId: BUILTIN_AGENTS[0].id,
  activeChatByAgent: {},
  pins: {},
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const Icon = ({ d, size = 14, className = "", strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {d}
  </svg>
);
const PlusIcon = (p) => <Icon {...p} d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />;
const TrashIcon = (p) => <Icon {...p} d={<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>} />;
const EditIcon = (p) => <Icon {...p} d={<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>} />;
const CopyIcon = (p) => <Icon {...p} d={<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>} />;
const DownloadIcon = (p) => <Icon {...p} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>} />;
const LinkIcon = (p) => <Icon {...p} d={<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>} />;
const PaperclipIcon = (p) => <Icon {...p} d={<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />} />;
const SendIcon = (p) => <Icon {...p} d={<><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>} />;
const StopIcon = (p) => <Icon {...p} d={<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />} />;
const CheckIcon = (p) => <Icon {...p} d={<polyline points="20 6 9 17 4 12" />} />;
const XIcon = (p) => <Icon {...p} d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />;
const MenuIcon = (p) => <Icon {...p} d={<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>} />;
const ChevronIcon = ({ open, ...p }) => <Icon {...p} className={`transition-transform ${open ? "rotate-180" : ""}`} d={<polyline points="6 9 12 15 18 9" />} />;
const RefIcon = (p) => <Icon {...p} d={<><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></>} />;
const KeyIcon = (p) => <Icon {...p} d={<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />} />;

const Spinner = ({ className = "w-3.5 h-3.5" }) => (
  <span className={`inline-block rounded-full border-2 border-zinc-700 border-t-primary animate-spin ${className}`} />
);

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------
function AgentAvatar({ agent, size = "w-9 h-9 text-lg" }) {
  const color = colorOf(agent?.color);
  return (
    <div
      className={`${size} rounded-lg flex items-center justify-center flex-shrink-0 border`}
      style={{ backgroundColor: `${color}1f`, borderColor: `${color}55`, color }}
    >
      <span className="leading-none">{agent?.emoji || "🤖"}</span>
    </div>
  );
}

// Lightweight formatting for assistant text: paragraphs, bullet lines and **bold**.
function RichText({ text }) {
  const lines = String(text || "").split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-zinc-100 break-words">
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-1" />;
        const bullet = /^\s*([-*•]|\d+[.)])\s+/.exec(line);
        const body = bullet ? line.slice(bullet[0].length) : line.replace(/^#{1,4}\s+/, "");
        const heading = /^#{1,4}\s+/.test(line);
        const parts = body.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
          /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>
        );
        if (bullet) {
          return (
            <div key={index} className="flex gap-2 pl-1">
              <span className="text-primary flex-shrink-0">{/\d/.test(bullet[1]) ? bullet[1] : "•"}</span>
              <span>{parts}</span>
            </div>
          );
        }
        return <p key={index} className={heading ? "font-bold text-white pt-1" : ""}>{parts}</p>;
      })}
    </div>
  );
}

function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - (since || now)) / 1000));
  return <span className="tabular-nums text-zinc-500">{seconds}s</span>;
}

function StepRow({ step, copy }) {
  const label = copy.steps[step.tool] || fill(copy.steps.unknown, { name: step.tool });
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 flex-shrink-0">
        {step.status === "running" && <Spinner />}
        {step.status === "done" && <span className="text-emerald-400"><CheckIcon size={14} strokeWidth={3} /></span>}
        {step.status === "error" && <span className="text-red-400"><XIcon size={14} strokeWidth={3} /></span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={`font-semibold ${step.status === "error" ? "text-red-300" : "text-zinc-200"}`}>{label}</span>
          {step.model && <span className="text-zinc-500">{fill(copy.steps.with, { model: step.model })}</span>}
          {step.status === "running" && <Elapsed since={step.startedAt} />}
        </div>
        {step.args?.prompt && <p className="text-zinc-500 line-clamp-2 mt-0.5">{step.args.prompt}</p>}
        {!step.args?.prompt && step.args?.text && <p className="text-zinc-500 line-clamp-2 mt-0.5">“{step.args.text}”</p>}
        {step.status === "error" && step.error && <p className="text-red-300/80 mt-0.5">{step.error}</p>}
      </div>
    </div>
  );
}

function MediaCard({ media, copy, onAddReference, onOpen }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await copyToClipboard(absoluteUrl(media.url));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(copy.chat.genericError);
    }
  };
  return (
    <div className="group relative rounded-lg overflow-hidden border border-zinc-800 bg-black/60">
      {media.type === "image" && (
        <button type="button" onClick={() => onOpen(media)} className="block w-full" title={copy.media.open}>
          <img src={media.url} alt="" className="w-full h-auto max-h-[420px] object-contain bg-zinc-950" loading="lazy" />
        </button>
      )}
      {media.type === "video" && <video src={media.url} controls playsInline className="w-full max-h-[420px] bg-black" />}
      {media.type === "audio" && (
        <div className="p-3">
          <audio src={media.url} controls className="w-full" />
        </div>
      )}
      <div className={`flex items-center gap-1 p-1.5 ${media.type === "image" ? "absolute top-1.5 right-1.5 rounded-lg bg-black/70 backdrop-blur opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity" : "border-t border-zinc-800"}`}>
        {media.type === "image" && onAddReference && (
          <button type="button" onClick={() => onAddReference(media.url)} className="p-1.5 rounded text-zinc-200 hover:text-primary hover:bg-white/5" title={copy.media.useAsReference}>
            <RefIcon />
          </button>
        )}
        <button type="button" onClick={handleCopy} className="p-1.5 rounded text-zinc-200 hover:text-primary hover:bg-white/5" title={copied ? copy.media.linkCopied : copy.media.copyLink}>
          {copied ? <CheckIcon /> : <LinkIcon />}
        </button>
        <button type="button" onClick={() => downloadMedia(media.url, media.type)} className="p-1.5 rounded text-zinc-200 hover:text-primary hover:bg-white/5" title={copy.media.download}>
          <DownloadIcon />
        </button>
      </div>
    </div>
  );
}

function AssistantMessage({ message, agent, copy, onAddReference, onOpenMedia, onRetry }) {
  const [copied, setCopied] = useState(false);
  const media = (message.steps || []).flatMap((step) => (step.status === "done" ? step.media || [] : []));
  const busy = message.status === "thinking" || message.status === "working";
  return (
    <div className="flex gap-3">
      <AgentAvatar agent={agent} size="w-8 h-8 text-base" />
      <div className="min-w-0 flex-1 space-y-3 pt-1">
        {message.steps?.length > 0 && (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
            {message.steps.map((step) => <StepRow key={step.id} step={step} copy={copy} />)}
          </div>
        )}
        {media.length > 0 && (
          <div className={`grid gap-2 ${media.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 max-w-xl"}`}>
            {media.map((item, index) => (
              <MediaCard key={`${item.url}-${index}`} media={item} copy={copy} onAddReference={onAddReference} onOpen={onOpenMedia} />
            ))}
          </div>
        )}
        {message.text && <RichText text={message.text} />}
        {busy && (
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Spinner />
            <span className="animate-pulse">{message.status === "thinking" ? copy.chat.thinking : copy.chat.working}</span>
          </div>
        )}
        {message.status === "stopped" && <p className="text-xs text-zinc-500">{copy.chat.stopped}</p>}
        {message.status === "interrupted" && <p className="text-xs text-zinc-500">{copy.chat.interrupted}</p>}
        {message.status === "limit" && <p className="text-xs text-amber-300/80">{copy.chat.toolLimit}</p>}
        {message.status === "error" && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">
            <span className="flex-1 min-w-0">{message.error || copy.chat.genericError}</span>
            {onRetry && (
              <button type="button" onClick={onRetry} className="font-bold text-white hover:text-primary">
                {copy.chat.retry}
              </button>
            )}
          </div>
        )}
        {message.text && !busy && (
          <button
            type="button"
            onClick={async () => {
              try {
                await copyToClipboard(message.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // clipboard unavailable
              }
            }}
            className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            {copied ? copy.chat.copied : copy.chat.copyText}
          </button>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message, onOpenMedia }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2">
        {message.attachments?.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((url) => (
              <button key={url} type="button" onClick={() => onOpenMedia({ url, type: "image" })} className="block">
                <img src={url} alt="" className="h-20 w-20 rounded-lg object-cover border border-zinc-700" />
              </button>
            ))}
          </div>
        )}
        {message.text && (
          <div className="rounded-2xl rounded-tr-sm bg-primary/10 border border-primary/20 px-4 py-2.5 text-sm text-white whitespace-pre-wrap break-words">
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Lightbox({ media, copy, onClose }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute top-4 right-4 flex gap-2" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => downloadMedia(media.url, media.type)} className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white hover:text-primary" title={copy.media.download}>
          <DownloadIcon size={16} />
        </button>
        <button type="button" onClick={onClose} className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white hover:text-primary" title={copy.media.close}>
          <XIcon size={16} />
        </button>
      </div>
      <img src={media.url} alt="" className="max-w-full max-h-full object-contain rounded-lg" onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

function AgentEditor({ initial, copy, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || "",
    description: initial?.description || "",
    emoji: initial?.emoji || "🤖",
    color: initial?.color || "cyan",
    instructions: initial?.instructions || "",
    starters: (initial?.starters || []).join("\n"),
  }));
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError(copy.editor.nameRequired);
      return;
    }
    onSave({
      name: form.name.trim().slice(0, 60),
      description: form.description.trim().slice(0, 200),
      emoji: [...form.emoji.trim()].slice(0, 2).join("") || "🤖",
      color: COLORS[form.color] ? form.color : "cyan",
      instructions: form.instructions.trim().slice(0, 6000),
      starters: form.starters.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6),
    });
  };

  const inputClass = "w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-primary/60";
  const labelClass = "text-xs font-bold text-zinc-300 uppercase tracking-wider block mb-1.5";

  return (
    <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={onCancel}>
      <form
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-lg max-h-full overflow-y-auto custom-scrollbar bg-[#0d0d0f] border border-zinc-800 rounded-xl shadow-3xl p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-white">{initial?.id ? copy.editor.editTitle : copy.editor.createTitle}</h2>
          <button type="button" onClick={onCancel} className="p-1.5 text-zinc-400 hover:text-white"><XIcon size={16} /></button>
        </div>

        <div className="flex items-center gap-3">
          <AgentAvatar agent={form} size="w-14 h-14 text-2xl" />
          <div className="flex-1 min-w-0">
            <label className={labelClass}>{copy.editor.name}</label>
            <input value={form.name} onChange={set("name")} placeholder={copy.editor.namePlaceholder} className={inputClass} maxLength={60} autoFocus />
          </div>
        </div>

        <div>
          <label className={labelClass}>{copy.editor.avatar}</label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setForm((previous) => ({ ...previous, emoji }))}
                className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center border transition-all ${form.emoji === emoji ? "border-primary bg-primary/10" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"}`}
              >
                {emoji}
              </button>
            ))}
            <input value={form.emoji} onChange={set("emoji")} className="w-14 h-9 bg-zinc-900 border border-zinc-700 rounded-lg text-center text-lg text-white focus:outline-none focus:border-primary/60" maxLength={8} aria-label={copy.editor.avatar} />
          </div>
        </div>

        <div>
          <label className={labelClass}>{copy.editor.color}</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(COLORS).map(([key, hex]) => (
              <button
                key={key}
                type="button"
                onClick={() => setForm((previous) => ({ ...previous, color: key }))}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${form.color === key ? "border-white scale-110" : "border-transparent hover:scale-105"}`}
                style={{ backgroundColor: hex }}
                aria-label={key}
              />
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>{copy.editor.description}</label>
          <input value={form.description} onChange={set("description")} placeholder={copy.editor.descriptionPlaceholder} className={inputClass} maxLength={200} />
        </div>

        <div>
          <label className={labelClass}>{copy.editor.instructions}</label>
          <textarea value={form.instructions} onChange={set("instructions")} placeholder={copy.editor.instructionsPlaceholder} rows={6} className={`${inputClass} resize-y custom-scrollbar`} />
        </div>

        <div>
          <label className={labelClass}>
            {copy.editor.starters} <span className="normal-case font-semibold text-zinc-500 tracking-normal">· {copy.editor.startersHint}</span>
          </label>
          <textarea value={form.starters} onChange={set("starters")} rows={3} className={`${inputClass} resize-y custom-scrollbar`} />
        </div>

        {error && <p className="text-xs text-red-300">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded text-sm font-bold text-zinc-300 hover:text-white">
            {copy.editor.cancel}
          </button>
          <button type="submit" className="px-5 py-2 rounded bg-primary text-black text-sm font-black hover:bg-white transition-colors">
            {copy.editor.save}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModelSettings({ pins, onChange, copy }) {
  const [open, setOpen] = useState(false);
  const slots = MODEL_SLOTS.filter((slot) => slotModels(slot).length > 0);
  if (slots.length === 0) return null;
  return (
    <div className="border-t border-zinc-900 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-1 text-xs font-bold text-zinc-300 uppercase tracking-wider hover:text-white">
        <span>{copy.sidebar.models}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="mt-3 space-y-2.5 px-1">
          <p className="text-[11px] text-zinc-500 leading-snug">{copy.sidebar.modelsHint}</p>
          {slots.map((slot) => {
            const models = slotModels(slot);
            const auto = pickModel(slot);
            return (
              <label key={slot} className="block">
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{copy.slots[slot] || slot}</span>
                <select
                  value={pins[slot] || ""}
                  onChange={(event) => onChange(slot, event.target.value)}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-primary/60"
                >
                  <option value="">{fill(copy.sidebar.autoWith, { name: auto?.name || "—" })}</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}{isModelRunnable(slot, model) ? "" : ` (${copy.sidebar.noKey})`}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AgentsStudio({
  locale = "en",
  droppedFiles,
  onFilesHandled,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const copy = resolveCopy(en, zh, locale);
  const [state, setState] = useState(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]); // { id, url, preview, uploading }
  const [busyConversationId, setBusyConversationId] = useState(null);
  const [editor, setEditor] = useState(null); // { agent?, copyOf? }
  const [lightbox, setLightbox] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);

  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const cancelRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Persistence ──────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = loadState();
    if (stored) setState(stored);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return undefined;
    const timer = setTimeout(() => {
      let next = compactState(state);
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          localStorage.setItem(PERSIST_KEY, JSON.stringify(next));
          return;
        } catch {
          // Quota exceeded: drop the oldest half of the chats and try again.
          next = { ...next, conversations: next.conversations.slice(0, Math.floor(next.conversations.length / 2)) };
        }
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [state, loaded]);

  // ── Chat provider availability ─────────────────────────────────────────
  useEffect(() => {
    setChatReady(hasChatProvider());
    return subscribeProviderSettings(() => setChatReady(hasChatProvider()));
  }, []);

  const openSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers: CHAT_PROVIDER_IDS } }));
  }, []);

  // ── Agents ───────────────────────────────────────────────────────────────
  const builtinAgents = useMemo(
    () =>
      BUILTIN_AGENTS.map((agent) => ({
        ...agent,
        builtin: true,
        name: copy.builtinAgents?.[agent.id]?.name || agent.id,
        description: copy.builtinAgents?.[agent.id]?.description || "",
        starters: copy.builtinAgents?.[agent.id]?.starters || [],
      })),
    [copy]
  );
  const allAgents = useMemo(() => [...builtinAgents, ...state.customAgents], [builtinAgents, state.customAgents]);
  const activeAgent = allAgents.find((agent) => agent.id === state.activeAgentId) || allAgents[0];

  const agentConversations = useMemo(
    () => state.conversations.filter((conversation) => conversation.agentId === activeAgent.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [state.conversations, activeAgent.id]
  );
  const activeConversationId = state.activeChatByAgent[activeAgent.id];
  const activeConversation = agentConversations.find((conversation) => conversation.id === activeConversationId) || null;
  const busy = Boolean(busyConversationId);
  const conversationBusy = busyConversationId && busyConversationId === activeConversation?.id;

  const selectAgent = (agentId) => {
    setState((previous) => ({ ...previous, activeAgentId: agentId }));
    setMobileMenu(false);
  };

  const selectConversation = (conversationId) => {
    setState((previous) => ({ ...previous, activeChatByAgent: { ...previous.activeChatByAgent, [activeAgent.id]: conversationId } }));
    setMobileMenu(false);
  };

  const newChat = () => {
    setState((previous) => ({ ...previous, activeChatByAgent: { ...previous.activeChatByAgent, [activeAgent.id]: null } }));
    setDraft("");
    setMobileMenu(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const deleteConversation = (conversationId) => {
    if (busyConversationId === conversationId) return;
    if (!window.confirm(copy.sidebar.deleteChatConfirm)) return;
    setState((previous) => ({
      ...previous,
      conversations: previous.conversations.filter((conversation) => conversation.id !== conversationId),
    }));
  };

  const saveAgent = (values) => {
    const target = editor?.agent;
    if (target?.id && !target.builtin) {
      setState((previous) => ({
        ...previous,
        customAgents: previous.customAgents.map((agent) => (agent.id === target.id ? { ...agent, ...values, updatedAt: Date.now() } : agent)),
      }));
    } else {
      const id = `custom-${uid()}`;
      setState((previous) => ({
        ...previous,
        customAgents: [...previous.customAgents, { id, ...values, createdAt: Date.now() }],
        activeAgentId: id,
      }));
    }
    setEditor(null);
  };

  const deleteAgent = (agent) => {
    if (agent.builtin) return;
    if (state.conversations.some((conversation) => conversation.agentId === agent.id && conversation.id === busyConversationId)) return;
    if (!window.confirm(fill(copy.sidebar.deleteAgentConfirm, { name: agent.name }))) return;
    setState((previous) => ({
      ...previous,
      customAgents: previous.customAgents.filter((entry) => entry.id !== agent.id),
      conversations: previous.conversations.filter((conversation) => conversation.agentId !== agent.id),
      activeAgentId: previous.activeAgentId === agent.id ? BUILTIN_AGENTS[0].id : previous.activeAgentId,
    }));
  };

  const setPin = (slot, modelId) => {
    setState((previous) => {
      const pins = { ...previous.pins };
      if (modelId) pins[slot] = modelId;
      else delete pins[slot];
      return { ...previous, pins };
    });
  };

  // ── Conversation updates ───────────────────────────────────────────────
  const updateConversation = useCallback((conversationId, update) => {
    setState((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) =>
        conversation.id === conversationId ? { ...update(conversation), updatedAt: Date.now() } : conversation
      ),
    }));
  }, []);

  const patchMessage = useCallback(
    (conversationId, messageId, update) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => (message.id === messageId ? { ...message, ...update(message) } : message)),
      }));
    },
    [updateConversation]
  );

  const patchStep = useCallback(
    (conversationId, messageId, stepId, patch) => {
      patchMessage(conversationId, messageId, (message) => ({
        steps: message.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      }));
    },
    [patchMessage]
  );

  // ── Attachments ─────────────────────────────────────────────────────────
  const addFiles = useCallback(
    async (files) => {
      const images = Array.from(files || []).filter((file) => file.type?.startsWith("image/"));
      if (images.length === 0) {
        if (files?.length) toast.error(copy.chat.onlyImages);
        return;
      }
      const room = Math.max(0, MAX_ATTACHMENTS - attachments.length);
      for (const file of images.slice(0, room)) {
        const id = uid();
        const preview = URL.createObjectURL(file);
        setAttachments((previous) => [...previous, { id, preview, url: null, uploading: true }]);
        try {
          const url = await uploadFile(file);
          setAttachments((previous) => previous.map((item) => (item.id === id ? { ...item, url, uploading: false } : item)));
        } catch (error) {
          setAttachments((previous) => previous.filter((item) => item.id !== id));
          URL.revokeObjectURL(preview);
          toast.error(fill(copy.chat.uploadFailed, { message: formatErrorMessage(error) }));
        }
      }
    },
    [attachments.length, copy]
  );

  const removeAttachment = (id) => {
    setAttachments((previous) => {
      const item = previous.find((entry) => entry.id === id);
      if (item?.preview?.startsWith("blob:")) URL.revokeObjectURL(item.preview);
      return previous.filter((entry) => entry.id !== id);
    });
  };

  const addReference = useCallback((url) => {
    setAttachments((previous) =>
      previous.some((item) => item.url === url) || previous.length >= MAX_ATTACHMENTS
        ? previous
        : [...previous, { id: uid(), url, preview: url, uploading: false }]
    );
    textareaRef.current?.focus();
  }, []);

  // Files dropped on the shell: only take them while this studio is on screen.
  useEffect(() => {
    if (!droppedFiles?.length) return;
    if (!rootRef.current || rootRef.current.offsetParent === null) return;
    addFiles(droppedFiles);
    onFilesHandled?.();
  }, [droppedFiles]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  const messageCount = activeConversation?.messages.length || 0;
  const lastMessage = activeConversation?.messages[messageCount - 1];
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeConversation?.id, messageCount, lastMessage?.steps?.length, lastMessage?.status, lastMessage?.text]);

  // ── The agent loop ──────────────────────────────────────────────────────
  const runTurn = async ({ conversationId, agent, priorMessages, userMessage, assistantId }) => {
    const tools = buildToolDefinitions();
    const pins = stateRef.current.pins || {};
    const patch = (update) => patchMessage(conversationId, assistantId, update);

    const userTurn = await userTurnContent(userMessage, true);
    let visionAttached = Array.isArray(userTurn.content);
    const messages = [{ role: "system", content: systemPromptFor(agent, tools) }, ...toModelHistory(priorMessages), userTurn];
    const userIndex = messages.length - 1;
    const produced = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      if (cancelRef.current) {
        patch(() => ({ status: "stopped" }));
        return produced;
      }
      patch(() => ({ status: "thinking" }));
      const allowTools = tools.length > 0 && round < MAX_TOOL_ROUNDS;
      let reply;
      try {
        reply = await chatComplete({
          messages,
          ...(tools.length > 0 ? { tools, toolChoice: allowTools ? "auto" : "none" } : {}),
        });
      } catch (error) {
        // Some chat models reject image input: retry once with text only.
        if (visionAttached && !(error instanceof ChatSetupError)) {
          visionAttached = false;
          messages[userIndex] = stripVision(messages[userIndex]);
          round -= 1;
          continue;
        }
        throw error;
      }
      if (cancelRef.current) {
        patch(() => ({ status: "stopped" }));
        return produced;
      }

      const text = contentText(reply?.content);
      if (text) patch((message) => ({ text: message.text ? `${message.text}\n\n${text}` : text }));

      const calls = allowTools ? (reply?.tool_calls || []).filter((call) => call?.function?.name).slice(0, MAX_CALLS_PER_ROUND) : [];
      if (calls.length === 0) {
        patch(() => ({ status: round === MAX_TOOL_ROUNDS && !text ? "limit" : "done" }));
        return produced;
      }

      const toolCalls = calls.map((call, index) => ({ ...call, id: call.id || `call_${round}_${index}`, type: "function" }));
      messages.push({ role: "assistant", content: reply.content || null, tool_calls: toolCalls });

      const parsed = toolCalls.map((call) => {
        try {
          return JSON.parse(call.function.arguments || "{}") || {};
        } catch {
          return null;
        }
      });
      const startedAt = Date.now();
      patch((message) => ({
        status: "working",
        steps: [
          ...(message.steps || []),
          ...toolCalls.map((call, index) => ({
            id: `${assistantId}-${call.id}-${round}`,
            tool: call.function.name,
            args: parsed[index] ? { prompt: parsed[index].prompt, text: parsed[index].text } : {},
            model: parsed[index] ? describeToolModel(call.function.name, parsed[index], pins) : "",
            status: "running",
            startedAt,
          })),
        ],
      }));

      const results = await Promise.all(
        toolCalls.map(async (call, index) => {
          const stepId = `${assistantId}-${call.id}-${round}`;
          const args = parsed[index];
          if (!args) {
            const error = "The tool arguments were not valid JSON.";
            patchStep(conversationId, assistantId, stepId, { status: "error", error });
            return { ok: false, error };
          }
          try {
            const result = await runAgentTool(call.function.name, resolveModelUrls(args), { pins });
            patchStep(conversationId, assistantId, stepId, { status: "done", media: result.media, model: result.model || undefined });
            produced.push(...result.media);
            return { ok: true, type: result.type, model: result.model, urls: result.media.map((item) => modelUrl(item.url)) };
          } catch (error) {
            const message = formatErrorMessage(error, copy.chat.genericError);
            patchStep(conversationId, assistantId, stepId, { status: "error", error: message });
            return { ok: false, error: message };
          }
        })
      );

      toolCalls.forEach((call, index) => {
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(results[index]) });
      });
    }
    patch(() => ({ status: "limit" }));
    return produced;
  };

  const sendMessage = async (textOverride, { retryOf } = {}) => {
    const text = String(textOverride ?? draft).trim();
    const ready = retryOf ? retryOf.attachments || [] : attachments.filter((item) => item.url && !item.uploading).map((item) => item.url);
    if (busy || (!text && ready.length === 0)) return;
    if (!retryOf && attachments.some((item) => item.uploading)) return;
    if (!hasChatProvider()) {
      setChatReady(false);
      openSettings();
      return;
    }

    const agent = activeAgent;
    const userMessage = { id: uid(), role: "user", text, attachments: ready, createdAt: Date.now() };
    const assistantId = uid();
    const assistantMessage = { id: assistantId, role: "assistant", text: "", steps: [], status: "thinking", createdAt: Date.now() };

    let conversationId = activeConversation?.id;
    let priorMessages = activeConversation?.messages || [];
    if (retryOf) {
      // Drop the failed reply and its prompt; they're re-sent below.
      const index = priorMessages.findIndex((message) => message.id === retryOf.id);
      priorMessages = index >= 0 ? priorMessages.slice(0, index) : priorMessages;
    }

    if (!conversationId) {
      conversationId = `chat-${uid()}`;
      const conversation = {
        id: conversationId,
        agentId: agent.id,
        title: titleFrom(text, copy.chat.newChatTitle),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [userMessage, assistantMessage],
      };
      setState((previous) => ({
        ...previous,
        conversations: [conversation, ...previous.conversations],
        activeChatByAgent: { ...previous.activeChatByAgent, [agent.id]: conversationId },
      }));
    } else {
      const kept = priorMessages;
      updateConversation(conversationId, (conversation) => ({ ...conversation, messages: [...kept, userMessage, assistantMessage] }));
    }

    if (!retryOf) {
      setDraft("");
      setAttachments([]);
    }
    cancelRef.current = false;
    setBusyConversationId(conversationId);
    onGenerationStart?.();
    try {
      const produced = await runTurn({ conversationId, agent, priorMessages, userMessage, assistantId });
      if (produced.length > 0) {
        onGenerationComplete?.({ url: produced[0].url, type: produced[0].type, prompt: text });
      }
    } catch (error) {
      const message = error instanceof ChatSetupError ? copy.setup.title : formatErrorMessage(error, copy.chat.genericError);
      patchMessage(conversationId, assistantId, () => ({ status: "error", error: message }));
      if (!(error instanceof ChatSetupError)) onGenerationError?.(message);
    } finally {
      setBusyConversationId(null);
      onGenerationEnd?.();
    }
  };

  const retryLast = () => {
    const messages = activeConversation?.messages || [];
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser) sendMessage(lastUser.text, { retryOf: lastUser });
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  };

  // Auto-grow the composer.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [draft]);

  const uploading = attachments.some((item) => item.uploading);
  const canSend = chatReady && !busy && !uploading && (draft.trim() || attachments.length > 0);
  const lastAssistant = [...(activeConversation?.messages || [])].reverse().find((message) => message.role === "assistant");

  // ── Render ──────────────────────────────────────────────────────────────
  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="p-4 overflow-y-auto flex-1 custom-scrollbar space-y-5">
        <div>
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{copy.sidebar.agents}</span>
            <button type="button" onClick={() => setEditor({ agent: null })} className="flex items-center gap-1 text-[11px] font-bold text-primary hover:text-white">
              <PlusIcon size={12} strokeWidth={3} /> {copy.sidebar.newAgent}
            </button>
          </div>
          <div className="space-y-1">
            {allAgents.map((agent, index) => {
              const active = agent.id === activeAgent.id;
              const showHeading = index === builtinAgents.length && state.customAgents.length > 0;
              return (
                <div key={agent.id}>
                  {showHeading && <div className="px-1 pt-3 pb-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{copy.sidebar.yourAgents}</div>}
                  <div
                    className={`group flex items-center gap-2.5 rounded-lg px-2 py-2 cursor-pointer border transition-all ${active ? "bg-primary/10 border-primary/25" : "border-transparent hover:bg-zinc-900"}`}
                    onClick={() => selectAgent(agent.id)}
                  >
                    <AgentAvatar agent={agent} size="w-8 h-8 text-base" />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-bold truncate ${active ? "text-white" : "text-zinc-200"}`}>{agent.name}</div>
                      {agent.description && <div className="text-[11px] text-zinc-500 truncate">{agent.description}</div>}
                    </div>
                    <div className="flex items-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditor(agent.builtin
                            ? { agent: { ...agent, id: null, builtin: false, name: `${agent.name} ${copy.editor.copySuffix}` } }
                            : { agent });
                        }}
                        className="p-1.5 rounded text-zinc-400 hover:text-primary"
                        title={agent.builtin ? copy.sidebar.customizeAgent : copy.sidebar.editAgent}
                      >
                        {agent.builtin ? <CopyIcon size={13} /> : <EditIcon size={13} />}
                      </button>
                      {!agent.builtin && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteAgent(agent);
                          }}
                          className="p-1.5 rounded text-zinc-400 hover:text-red-400"
                          title={copy.sidebar.deleteAgent}
                        >
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-zinc-900 pt-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{copy.sidebar.chats}</span>
            <button type="button" onClick={newChat} className="flex items-center gap-1 text-[11px] font-bold text-primary hover:text-white">
              <PlusIcon size={12} strokeWidth={3} /> {copy.sidebar.newChat}
            </button>
          </div>
          {agentConversations.length === 0 ? (
            <p className="px-1 text-xs text-zinc-500">{copy.sidebar.noChats}</p>
          ) : (
            <div className="space-y-0.5">
              {agentConversations.map((conversation) => {
                const active = conversation.id === activeConversation?.id;
                return (
                  <div
                    key={conversation.id}
                    onClick={() => selectConversation(conversation.id)}
                    className={`group flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer ${active ? "bg-zinc-800/80 text-white" : "text-zinc-300 hover:bg-zinc-900"}`}
                  >
                    {busyConversationId === conversation.id && <Spinner className="w-3 h-3 flex-shrink-0" />}
                    <span className="flex-1 min-w-0 truncate text-xs font-semibold">{conversation.title}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteConversation(conversation.id);
                      }}
                      className="p-1 rounded text-zinc-500 hover:text-red-400 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                      title={copy.sidebar.deleteChat}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <ModelSettings pins={state.pins} onChange={setPin} copy={copy} />
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="w-full h-full flex bg-app-bg text-white overflow-hidden relative">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex w-[300px] border-r border-zinc-900 bg-zinc-950/40 backdrop-blur-lg flex-shrink-0 flex-col">{sidebar}</aside>

      {/* Sidebar (mobile drawer) */}
      {mobileMenu && (
        <div className="lg:hidden fixed inset-0 z-[80] flex">
          <div className="w-[85%] max-w-[320px] h-full bg-[#0a0a0b] border-r border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-zinc-900">
              <span className="text-sm font-black">{copy.sidebar.openMenu}</span>
              <button type="button" onClick={() => setMobileMenu(false)} className="p-1.5 text-zinc-400 hover:text-white" title={copy.sidebar.closeMenu}>
                <XIcon size={16} />
              </button>
            </div>
            <div className="flex-1 min-h-0">{sidebar}</div>
          </div>
          <div className="flex-1 bg-black/70" onClick={() => setMobileMenu(false)} />
        </div>
      )}

      {/* Chat */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-4 lg:px-6 py-3 border-b border-zinc-900 bg-zinc-950/30">
          <button type="button" onClick={() => setMobileMenu(true)} className="lg:hidden p-2 -ml-2 text-zinc-300 hover:text-white" title={copy.sidebar.openMenu}>
            <MenuIcon size={18} />
          </button>
          <AgentAvatar agent={activeAgent} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-white truncate">{activeAgent.name}</div>
            <div className="text-[11px] text-zinc-400 truncate">{activeConversation?.title || activeAgent.description}</div>
          </div>
          <button
            type="button"
            onClick={newChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-700 text-xs font-bold text-zinc-200 hover:border-primary/40 hover:text-primary transition-all"
          >
            <PlusIcon size={12} strokeWidth={3} />
            <span className="hidden sm:inline">{copy.sidebar.newChat}</span>
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6 space-y-6">
            {!chatReady && loaded && (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
                <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                  <KeyIcon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-black text-white">{copy.setup.title}</h3>
                  <p className="text-xs text-zinc-300 leading-relaxed mt-1">{copy.setup.body}</p>
                </div>
                <button type="button" onClick={openSettings} className="px-4 py-2 rounded bg-primary text-black text-xs font-black hover:bg-white transition-colors flex-shrink-0">
                  {copy.setup.button}
                </button>
              </div>
            )}

            {!activeConversation && (
              <div className="flex flex-col items-center text-center pt-6 lg:pt-12 gap-4">
                <AgentAvatar agent={activeAgent} size="w-16 h-16 text-3xl" />
                <div>
                  <h2 className="text-xl font-black text-white tracking-tight">{activeAgent.name}</h2>
                  {activeAgent.description && <p className="text-sm text-zinc-400 mt-1.5 max-w-md">{activeAgent.description}</p>}
                </div>
                {activeAgent.starters?.length > 0 && (
                  <div className="w-full max-w-xl pt-2 space-y-2">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{copy.chat.tryStarter}</div>
                    {activeAgent.starters.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        disabled={!chatReady || busy}
                        onClick={() => sendMessage(starter)}
                        className="w-full text-left px-4 py-3 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-zinc-200 hover:border-primary/40 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeConversation?.messages.map((message) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} onOpenMedia={setLightbox} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  agent={activeAgent}
                  copy={copy}
                  onAddReference={addReference}
                  onOpenMedia={setLightbox}
                  onRetry={message.id === lastAssistant?.id && !busy && chatReady ? retryLast : null}
                />
              )
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-zinc-900 bg-zinc-950/40 px-4 lg:px-6 py-3">
          <div className="max-w-3xl mx-auto">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((item) => (
                  <div key={item.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-700">
                    <img src={item.preview || item.url} alt="" className="w-full h-full object-cover" />
                    {item.uploading && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center" title={copy.chat.uploading}>
                        <Spinner />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(item.id)}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center hover:bg-red-500"
                      title={copy.chat.removeAttachment}
                    >
                      <XIcon size={10} strokeWidth={3} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={`flex items-end gap-2 rounded-xl border bg-zinc-900/80 px-2 py-2 transition-colors ${chatReady ? "border-zinc-700 focus-within:border-primary/50" : "border-zinc-800 opacity-70"}`}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attachments.length >= MAX_ATTACHMENTS}
                className="p-2 rounded-lg text-zinc-400 hover:text-primary hover:bg-white/5 disabled:opacity-40"
                title={copy.chat.attach}
              >
                <PaperclipIcon size={18} />
              </button>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
                  if (files.length > 0) {
                    event.preventDefault();
                    addFiles(files);
                  }
                }}
                rows={1}
                placeholder={chatReady ? fill(copy.chat.placeholder, { name: activeAgent.name }) : copy.chat.placeholderDisabled}
                className="flex-1 min-w-0 resize-none bg-transparent text-sm text-white placeholder:text-zinc-500 focus:outline-none py-2 max-h-[200px] custom-scrollbar"
              />
              {conversationBusy ? (
                <button
                  type="button"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-600 text-xs font-bold text-white hover:border-red-400/60"
                  title={copy.chat.stop}
                >
                  <StopIcon size={12} /> {copy.chat.stop}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => (chatReady ? sendMessage() : openSettings())}
                  disabled={chatReady && !canSend}
                  className="p-2.5 rounded-lg bg-primary text-black hover:bg-white transition-colors disabled:bg-zinc-800 disabled:text-zinc-500"
                  title={copy.chat.send}
                >
                  <SendIcon size={16} />
                </button>
              )}
            </div>
            <p className="hidden sm:block text-[10px] text-zinc-600 mt-1.5 px-1">{copy.chat.enterHint}</p>
          </div>
        </div>
      </main>

      {editor && <AgentEditor initial={editor.agent} copy={copy} onCancel={() => setEditor(null)} onSave={saveAgent} />}
      {lightbox && <Lightbox media={lightbox} copy={copy} onClose={() => setLightbox(null)} />}
      <Toaster position="top-right" containerStyle={{ zIndex: 99999 }} toastOptions={{ duration: 5000, style: { background: "#18181b", color: "#ffffff", border: "1px solid rgba(255,255,255,0.15)", fontSize: "13px", borderRadius: "12px" } }} />
    </div>
  );
}
