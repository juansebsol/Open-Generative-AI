"use client";

// UGC Studio: short talk-to-camera videos. Cast a creator (an AI influencer
// from AI Influencer Studio, a saved character or a photo), give them a
// script and a few hooks, pick a scene, and film one take per hook. A batch
// sets the scene once (an image edit of the creator, product in hand) and
// films every take from that frame, either with a model that speaks the line
// itself or, for long scripts, a text-to-speech voice lip-synced to it
// (ugc/engines.js).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconArrowRight,
  IconArrowsLeftRight,
  IconBox,
  IconBrush,
  IconCar,
  IconDeviceMobile,
  IconDownload,
  IconMicrophone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconStar,
  IconTrash,
  IconUpload,
  IconUser,
  IconVideo,
  IconWalk,
  IconX,
} from "@tabler/icons-react";
import { generateAudio, generateI2I, generateI2V, processLipSync, uploadFile } from "../generation.js";
import { chatCompleteDetailed, hasChatProvider, parseJsonReply } from "../providers/chat.js";
import { agentModelName } from "../providers/agentModel.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { fetchMediaBlob } from "../providers/mediaStore.js";
import { formatMoney } from "../providers/pricing.js";
import { characterHandle, saveCharacter, subscribeCharacters } from "../characters.js";
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
  PromptRatioIcon,
  PromptSegmentOption,
  PromptSegmentedControl,
  PromptSettingsGroup,
  PromptTextarea,
  promptModelButtonClassName,
  promptSettingClassName,
} from "./prompt/PromptComposer.jsx";
import PriceChip from "./prompt/PriceChip.jsx";
import { formatWhen } from "./library/LibraryKit.jsx";
import { formatErrorMessage } from "../utils/formatError.js";
import { ASPECTS, MAX_TAKES, PLACEMENTS, SCENES, TONES, framePrompt, spokenSeconds, takeLines, takePrompt } from "../ugc/scenes.js";
import {
  AUTO_ENGINE,
  AVATAR_ENGINE,
  avatarModel,
  defaultVoice,
  engineLabel,
  frameModel,
  frameTakesProduct,
  longestTake,
  oneTakeModels,
  pricePayload,
  resolveEngine,
  takeRequest,
  voiceModel,
  voicesOf,
} from "../ugc/engines.js";
import {
  SCRIPT_ANGLES,
  SCRIPT_LENGTHS,
  loadCharacterCreators,
  loadInfluencers,
  loadStudio,
  parseScript,
  sanitizeDraft,
  saveStudio,
  scriptRequest,
} from "../ugc/library.js";
import en from "../messages/en/ugcStudio.json";
import zh from "../messages/zh/ugcStudio.json";
import { resolveCopy } from "../i18nUtils";

const SCENE_ICONS = {
  phone: IconDeviceMobile,
  box: IconBox,
  brush: IconBrush,
  star: IconStar,
  car: IconCar,
  walk: IconWalk,
  switch: IconArrowsLeftRight,
  mic: IconMicrophone,
};

const ASPECT_CLASS = { "9:16": "aspect-[9/16]", "1:1": "aspect-square", "16:9": "aspect-video" };

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

const SECTION_TITLE = "text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40";
const FIELD = "h-8 w-full rounded-[9px] border border-white/[0.08] bg-black/40 px-2.5 text-[12.5px] text-white placeholder:text-white/30 transition-colors focus:border-[#22d3ee]/45 focus:outline-none";
const CHIP = "flex h-10 shrink-0 items-center gap-2 rounded-xl border text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50";

async function downloadVideo(url, fileName) {
  try {
    const blob = await fetchMediaBlob(url);
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function SceneIcon({ scene, size = 17 }) {
  const Icon = SCENE_ICONS[scene.icon] || IconDeviceMobile;
  return <Icon size={size} stroke={1.75} aria-hidden="true" />;
}

// One creator in the empty state and the cast picker.
function CreatorCard({ creator, selected, copy, onPick, tall = false }) {
  const source = copy.sources[creator.source] || "";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={`group relative w-full overflow-hidden rounded-[14px] text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee]/60 ${tall ? "h-[196px]" : "h-[176px]"} ${
        selected ? "shadow-[0_0_0_2px_#22d3ee]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
      }`}
      data-ugc-creator={creator.id}
    >
      <img src={creator.image} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_22%] transition-transform duration-500 group-hover:scale-[1.03]" />
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-black/80" />
      {source && (
        <span className={`absolute left-2.5 top-2.5 flex h-5 items-center rounded-md px-1.5 text-[10.5px] font-semibold ${creator.source === "influencer" ? "bg-[#04202a]/75 text-[#67e8f9]" : "bg-black/60 text-white/75"}`}>{source}</span>
      )}
      {selected && (
        <span aria-hidden="true" className="absolute right-2.5 top-2.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#22d3ee] text-[#04202a]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10" /></svg>
        </span>
      )}
      <span className="absolute inset-x-3 bottom-2.5 flex min-w-0 flex-col">
        {creator.name && <span className="truncate text-[14px] font-semibold text-white">{creator.name}</span>}
        {creator.label && <span className="truncate text-[11.5px] text-white/70">{creator.label}</span>}
      </span>
    </button>
  );
}

// ── The intro: three floating takes ─────────────────────────────────────────
// Placed like AI Influencer Studio's fan, so the two intros read as a pair.
// The side cards keep their tag and caption on the side the middle card
// doesn't cover.
const TAKE_FAN = [
  { place: "left-[3%] top-[17%] z-10 w-[34%] -rotate-[7deg] group-hover:-translate-x-[7%] group-hover:-rotate-[10deg]", delay: "0s", hook: 0, progress: "62%", time: "0:09", chip: "left-[6%]", caption: "left-[7%] right-[30%] text-left" },
  { place: "left-1/2 top-[4%] z-20 w-[43%] -translate-x-1/2 group-hover:-translate-y-[2%]", delay: "-2.4s", hook: 1, progress: "44%", time: "0:05 / 0:11", lead: true, chip: "left-[6%]", caption: "inset-x-[7%] text-center" },
  { place: "right-[3%] top-[21%] z-10 w-[32%] rotate-[6deg] group-hover:translate-x-[7%] group-hover:rotate-[9deg]", delay: "-4.8s", hook: 2, progress: "28%", time: "0:12", chip: "right-[6%]", caption: "left-[30%] right-[7%] text-right" },
];

// Shown until the visitor has creators of their own: the AI Influencer
// Studio intro's creator, three takes of her.
const SAMPLE_CREATORS = [
  { name: "Maya", image: "/assets/influencer/feed.jpg", position: "64% 24%", flip: true },
  { name: "Maya", image: "/assets/influencer/portrait.jpg", position: "center 20%" },
  { name: "Maya", image: "/assets/influencer/feed.jpg", position: "center 30%" },
];

function TakeFan({ creators, copy }) {
  return (
    <div aria-hidden="true" className="flex h-full min-h-0 items-center justify-center">
      <div className="group relative aspect-[16/15] max-h-full w-full max-w-[660px]">
        <span className="absolute inset-x-[15%] bottom-[6%] h-[40%] rounded-full bg-[#22d3ee]/[0.08] blur-[80px]" />
        {TAKE_FAN.map((card, index) => {
          const creator = creators[index] || creators[0];
          return (
            <div key={index} className={`absolute flex flex-col items-center gap-3 transition-transform duration-500 ease-out ${card.place}`}>
              <div
                className={`oga-float relative aspect-[9/16] w-full overflow-hidden rounded-[24px] border bg-[#111114] shadow-[0_30px_80px_rgba(0,0,0,0.7)] ${card.lead ? "border-white/[0.18]" : "border-white/[0.14]"}`}
                style={{ animationDelay: card.delay }}
              >
                <img src={creator.image} alt="" className="h-full w-full object-cover" style={{ objectPosition: creator.position || "center 22%", transform: creator.flip ? "scaleX(-1) scale(1.15)" : undefined }} />
                {creator.name && (
                  <span className={`absolute top-[3.5%] flex h-[clamp(20px,2vw,28px)] items-center gap-1.5 rounded-full bg-black/55 pl-1 pr-2.5 text-[clamp(10px,0.85vw,12px)] font-semibold ${card.chip}`}>
                    <img src={creator.image} alt="" className="aspect-square h-[78%] rounded-full object-cover" style={{ objectPosition: creator.position || "center 22%" }} />
                    @{characterHandle(creator.name)}
                  </span>
                )}
                {card.lead && (
                  <span className="absolute right-[6%] top-[3.5%] flex h-[clamp(20px,2vw,28px)] items-center rounded-full bg-[#04202a]/75 px-2.5 text-[clamp(10px,0.8vw,11.5px)] font-semibold text-[#67e8f9]">{copy.scenes.talking.name}</span>
                )}
                <span className={`absolute top-[59%] font-extrabold leading-[1.25] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_10px_rgba(0,0,0,0.6)] ${card.caption} ${card.lead ? "text-[clamp(13px,1.25vw,18px)]" : "text-[clamp(11px,1vw,15px)]"}`}>
                  {copy.intro.hooks[card.hook]}
                </span>
                <span className="absolute inset-x-0 bottom-0 h-[16%] bg-gradient-to-b from-transparent to-black/75" />
                <span className="absolute inset-x-[6%] bottom-[3.5%] flex items-center gap-2">
                  {card.lead ? (
                    <span className="flex aspect-square h-[clamp(22px,2.1vw,30px)] items-center justify-center rounded-full bg-white/[0.92] text-black"><IconPlayerPauseFilled size={12} /></span>
                  ) : (
                    <IconPlayerPlayFilled size={12} className="shrink-0 text-white" />
                  )}
                  <span className="h-[3px] flex-1 rounded bg-white/30"><span className="block h-full rounded bg-white" style={{ width: card.progress }} /></span>
                  <span className="font-mono text-[clamp(9.5px,0.8vw,11px)] text-white">{card.time}</span>
                </span>
              </div>
              <span className={`flex h-[30px] items-center gap-1.5 rounded-[10px] border px-2.5 text-[12px] ${card.lead ? "border-[#22d3ee]/35 bg-[#04202a]/90 text-[#cffafe]" : "border-white/10 bg-[#111114]/90 text-white/75"}`}>
                <span className="font-mono text-[#67e8f9]">{index + 1}</span>
                {fill(copy.feed.takeLabel, { index: index + 1 })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One take: plays in place, the hook over it while paused.
function TakeCard({ batch, take, index, playing, copy, onPlay, onAgain }) {
  const videoRef = useRef(null);
  const [length, setLength] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.muted = false;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  const busy = take.status === "framing" || take.status === "filming" || take.status === "queued";
  const seconds = length ?? take.duration;
  const label = take.hook ? fill(copy.feed.takeLabel, { index: index + 1 }) : null;

  return (
    <article className="flex min-w-0 flex-col gap-2" data-ugc-take={take.status}>
      <div className={`relative ${ASPECT_CLASS[batch.aspect] || ASPECT_CLASS["9:16"]} overflow-hidden rounded-[14px] bg-[#0e1417] ${busy ? "shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"}`}>
        {take.status === "done" ? (
          <video
            ref={videoRef}
            src={take.url}
            poster={batch.frame || undefined}
            playsInline
            loop
            muted
            preload="metadata"
            onLoadedMetadata={(event) => Number.isFinite(event.currentTarget.duration) && setLength(Math.round(event.currentTarget.duration))}
            onClick={onPlay}
            className="h-full w-full cursor-pointer object-cover"
          />
        ) : (
          (batch.frame || batch.creator?.image) && (
            <img src={batch.frame || batch.creator?.image} alt="" className={`h-full w-full object-cover object-[center_22%] ${busy || !batch.frame ? "scale-110 opacity-50 blur-[14px] saturate-[0.7]" : "opacity-40"}`} />
          )
        )}

        {label && (
          <span className={`absolute left-2.5 top-2.5 flex h-[22px] items-center rounded-[7px] px-2 text-[11px] font-semibold ${busy ? "bg-[#04202a]/75 text-[#67e8f9]" : "bg-black/55 text-white"}`}>{label}</span>
        )}

        {take.status === "done" && !playing && take.hook && (
          <span className="pointer-events-none absolute inset-x-3.5 top-[58%] text-center text-[15px] font-extrabold leading-[1.25] tracking-[-0.01em] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_10px_rgba(0,0,0,0.6)]">{take.hook}</span>
        )}

        {take.status === "done" && (
          <>
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-black/70" />
            <button
              type="button"
              onClick={onPlay}
              aria-label={playing ? copy.feed.pause : fill(copy.feed.play, { index: index + 1 })}
              className="absolute bottom-2.5 left-2.5 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/[0.92] text-black transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee]"
            >
              {playing ? <IconPlayerPauseFilled size={14} aria-hidden="true" /> : <IconPlayerPlayFilled size={14} aria-hidden="true" />}
            </button>
            {seconds ? <span className="pointer-events-none absolute bottom-[18px] right-3 font-mono text-[11.5px] text-white/90">0:{String(seconds).padStart(2, "0")}</span> : null}
          </>
        )}

        {busy && (
          <div className="absolute inset-x-[18px] top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 text-center">
            <span className="text-[13.5px] font-semibold">{take.status === "framing" ? copy.feed.framing : fill(copy.feed.filming, { index: index + 1 })}</span>
            <span className="relative h-1 w-full overflow-hidden rounded bg-white/[0.12]">
              <span className="absolute inset-y-0 left-0 w-1/3 animate-[ugc-progress_1.6s_ease-in-out_infinite] rounded bg-[#22d3ee]" />
            </span>
            {take.hook && <span className="line-clamp-3 text-[12px] leading-[1.45] text-white/60">“{take.hook}”</span>}
          </div>
        )}

        {take.status === "error" && (
          <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2.5 text-center">
            <span className="text-[13px] font-semibold text-white/90">{take.error === "interrupted" ? copy.feed.interrupted : copy.feed.failed}</span>
            {take.error && take.error !== "interrupted" && <span className="line-clamp-3 text-[11.5px] leading-[1.45] text-red-200/80">{take.error}</span>}
            {batch.frame && (
              <button type="button" onClick={onAgain} className="mt-1 flex h-8 items-center gap-1.5 rounded-[9px] border border-white/[0.14] bg-black/40 px-3 text-[12px] font-semibold text-white hover:bg-black/60">
                <IconRefresh size={13} stroke={2} aria-hidden="true" />
                {copy.feed.again}
              </button>
            )}
          </div>
        )}
      </div>
      {take.status === "done" && (
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[12px] text-white/55">{batch.engine?.name}</span>
          <button type="button" onClick={() => downloadVideo(take.url, `ugc-${batch.id}-${index + 1}.mp4`)} aria-label={fill(copy.feed.download, { index: index + 1 })} title={fill(copy.feed.download, { index: index + 1 })} className="flex h-7 w-7 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white">
            <IconDownload size={15} stroke={1.75} aria-hidden="true" />
          </button>
          <button type="button" onClick={onAgain} aria-label={copy.feed.again} title={copy.feed.again} className="flex h-7 w-7 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white">
            <IconRefresh size={15} stroke={1.75} aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}

export default function UgcStudio({
  locale = "en",
  droppedFiles,
  onFilesHandled,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  const copy = useMemo(() => resolveCopy(en, zh, locale), [locale]);

  const [batches, setBatches] = useState([]);
  const [draft, setDraft] = useState(() => sanitizeDraft(null));
  const [hydrated, setHydrated] = useState(false);
  const [openMenu, setOpenMenu] = useState(null); // 'cast' | 'product' | 'writer' | 'scene' | 'tone' | 'aspect' | 'takes' | 'engine'
  const [influencers, setInfluencers] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [keysVersion, setKeysVersion] = useState(0);
  const [chatReady, setChatReady] = useState(false);
  const [castTab, setCastTab] = useState("influencers");
  const [castPick, setCastPick] = useState(null);
  const [castName, setCastName] = useState("");
  const [castQuery, setCastQuery] = useState("");
  const [uploading, setUploading] = useState(null); // 'creator' | 'product'
  const [writer, setWriter] = useState({ product: "", audience: "", angle: SCRIPT_ANGLES[0], seconds: SCRIPT_LENGTHS[0] });
  const [writing, setWriting] = useState(false);
  const [writtenBy, setWrittenBy] = useState(null);
  const [editingHook, setEditingHook] = useState(null); // index | 'new'
  const [playing, setPlaying] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [started, setStarted] = useState(false); // past the intro this visit

  const creatorFileRef = useRef(null);
  const productFileRef = useRef(null);
  const textareaRef = useRef(null);

  const patchDraft = useCallback((patch) => setDraft((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) })), []);
  const patchBatch = useCallback((id, update) => setBatches((list) => list.map((batch) => (batch.id === id ? (typeof update === "function" ? update(batch) : { ...batch, ...update }) : batch))), []);
  const patchTake = useCallback((batchId, takeId, patch) => patchBatch(batchId, (batch) => ({ ...batch, takes: batch.takes.map((take) => (take.id === takeId ? { ...take, ...patch } : take)) })), [patchBatch]);

  // ── Kept between visits ──────────────────────────────────────────────────
  useEffect(() => {
    const stored = loadStudio();
    setBatches(stored.batches);
    setDraft(stored.draft);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = setTimeout(() => saveStudio({ batches, draft }), 400);
    return () => clearTimeout(timer);
  }, [hydrated, batches, draft]);

  // ── Creators and keys ────────────────────────────────────────────────────
  const refreshCreators = useCallback(() => {
    setInfluencers(loadInfluencers());
    setCharacters(loadCharacterCreators());
  }, []);

  useEffect(() => {
    refreshCreators();
    const onFocus = () => refreshCreators();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeCharacters(refreshCreators);
    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refreshCreators]);

  useEffect(() => {
    const sync = () => {
      setChatReady(hasChatProvider());
      setKeysVersion((version) => version + 1);
    };
    sync();
    return subscribeProviderSettings(sync);
  }, []);

  // ── Menus close on an outside click or Escape ────────────────────────────
  useEffect(() => {
    if (!openMenu) return undefined;
    const close = () => setOpenMenu(null);
    const onKey = (event) => event.key === "Escape" && close();
    window.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  const toggleMenu = (name) => (event) => {
    event.stopPropagation();
    setOpenMenu((current) => (current === name ? null : name));
  };

  // ── The takes this script makes, and what films them ─────────────────────
  const lines = useMemo(() => takeLines(draft.hooks, draft.body, draft.takes), [draft.hooks, draft.body, draft.takes]);
  const seconds = Math.max(0, ...lines.map((take) => spokenSeconds(take.line)));
  const hasScript = lines.some((take) => take.line);
  const takeModels = useMemo(() => oneTakeModels(), [keysVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const avatar = useMemo(() => avatarModel(), [keysVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const voice = useMemo(() => voiceModel(), [keysVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const sceneModel = useMemo(() => frameModel(), [keysVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const engine = useMemo(() => resolveEngine(draft.engine, seconds), [draft.engine, seconds, keysVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const voices = useMemo(() => voicesOf(voice), [voice]);
  const voiceId = voices.some((item) => item.id === draft.voice) ? draft.voice : defaultVoice(voice);
  const engineKey = engine ? `${engine.kind}|${engine.model.id}|${engine.duration ?? ""}|${draft.aspect}` : "";
  const price = useMemo(() => pricePayload(engine, draft.aspect), [engineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const engineName = engine ? (engine.kind === "avatar" ? copy.bar.avatar : engineLabel(engine.model)) : copy.bar.noEngine;
  const creatorName = draft.creator?.name || "";

  // ── Filming ──────────────────────────────────────────────────────────────
  const filmTake = async (batchId, take, { frameUrl, engine: chosen, snapshot }) => {
    patchTake(batchId, take.id, { status: "filming", error: "" });
    try {
      const prompt = takePrompt({ scene: snapshot.scene, tone: snapshot.tone, line: take.line, placement: snapshot.product?.placement, product: snapshot.product });
      let url;
      if (chosen.kind === "avatar") {
        const speech = await generateAudio({ model: chosen.voice.id, prompt: take.line, voice_id: snapshot.voice || defaultVoice(chosen.voice) });
        const audioUrl = speech?.url || speech?.audio?.url || speech?.audio_url;
        if (!audioUrl) throw new Error(copy.errors.noAudio);
        url = (await processLipSync({ model: chosen.model.id, image_url: frameUrl, audio_url: audioUrl, prompt }))?.url;
      } else {
        url = (await generateI2V(takeRequest(chosen, { frame: frameUrl, prompt, aspect: snapshot.aspect })))?.url;
      }
      if (!url) throw new Error(copy.errors.noVideo);
      patchTake(batchId, take.id, { status: "done", url, error: "" });
      onGenerationComplete?.({ url, model: chosen.model.id, prompt: take.line, type: "video" });
    } catch (error) {
      const message = formatErrorMessage(error, copy.errors.failed);
      patchTake(batchId, take.id, { status: "error", error: message });
      onGenerationError?.(message);
    }
  };

  const film = async () => {
    if (!draft.creator) {
      toast(copy.errors.noCreator);
      return;
    }
    if (!hasScript) {
      toast(copy.errors.noScript);
      textareaRef.current?.focus();
      return;
    }
    if (!sceneModel) {
      toast.error(copy.errors.noFrame);
      return;
    }
    if (!engine) {
      toast.error(copy.errors.noEngine);
      return;
    }
    const snapshot = { ...draft, voice: voiceId };
    const chosen = engine;
    const batch = {
      id: uid(),
      createdAt: Date.now(),
      creator: snapshot.creator,
      product: snapshot.product,
      scene: snapshot.scene,
      tone: snapshot.tone,
      aspect: snapshot.aspect,
      engine: { kind: chosen.kind, model: chosen.model.id, name: chosen.kind === "avatar" ? `${engineLabel(chosen.voice)} · ${engineLabel(chosen.model)}` : engineLabel(chosen.model) },
      frame: "",
      takes: lines.map((take) => ({ id: uid(), hook: take.hook, line: take.line, status: "framing", url: "", error: "", duration: chosen.kind === "take" ? chosen.duration ?? null : null })),
    };
    setBatches((list) => [batch, ...list]);
    setPlaying(null);
    onGenerationStart?.();
    try {
      const productShown = Boolean(snapshot.product && snapshot.product.placement !== "none" && frameTakesProduct(sceneModel));
      const images = [snapshot.creator.image, ...(productShown ? [snapshot.product.image] : [])];
      const prompt = framePrompt({ scene: snapshot.scene, placement: snapshot.product?.placement, product: snapshot.product, productShown, aspect: snapshot.aspect });
      const frameUrl = (await generateI2I({ model: sceneModel.id, images_list: images, prompt, aspect_ratio: snapshot.aspect }))?.url;
      if (!frameUrl) throw new Error(copy.errors.noVideo);
      patchBatch(batch.id, { frame: frameUrl });
      await Promise.all(batch.takes.map((take) => filmTake(batch.id, take, { frameUrl, engine: chosen, snapshot })));
    } catch (error) {
      const message = formatErrorMessage(error, copy.errors.failed);
      patchBatch(batch.id, (current) => ({ ...current, takes: current.takes.map((take) => (take.status === "done" ? take : { ...take, status: "error", error: message })) }));
      onGenerationError?.(message);
    } finally {
      onGenerationEnd?.();
    }
  };

  // Films a line again from the batch's frame, as a new take.
  const filmAgain = async (batch, source) => {
    if (!batch.frame) return;
    const chosen = resolveEngine(batch.engine?.kind === "avatar" ? AVATAR_ENGINE : batch.engine?.model, spokenSeconds(source.line));
    if (!chosen) {
      toast.error(copy.errors.noEngine);
      return;
    }
    const take = { id: uid(), hook: source.hook, line: source.line, status: "filming", url: "", error: "", duration: chosen.kind === "take" ? chosen.duration ?? null : null };
    patchBatch(batch.id, (current) => ({ ...current, takes: [...current.takes, take] }));
    onGenerationStart?.();
    try {
      await filmTake(batch.id, take, { frameUrl: batch.frame, engine: chosen, snapshot: { scene: batch.scene, tone: batch.tone, aspect: batch.aspect, product: batch.product, voice: voiceId } });
    } finally {
      onGenerationEnd?.();
    }
  };

  // The next hook in the batch's rotation.
  const anotherTake = (batch) => {
    const unique = [];
    for (const take of batch.takes) if (!unique.some((item) => item.line === take.line)) unique.push(take);
    if (unique.length) filmAgain(batch, unique[batch.takes.length % unique.length]);
  };

  const deleteBatch = (batch) => {
    if (confirmDelete !== batch.id) {
      setConfirmDelete(batch.id);
      setTimeout(() => setConfirmDelete((current) => (current === batch.id ? null : current)), 3000);
      return;
    }
    setBatches((list) => list.filter((item) => item.id !== batch.id));
    setConfirmDelete(null);
  };

  // ── Uploads ──────────────────────────────────────────────────────────────
  const uploadImage = async (file, target) => {
    if (!file || !file.type?.startsWith("image/")) return;
    setUploading(target);
    try {
      const url = await uploadFile(file);
      if (target === "product") {
        patchDraft((current) => ({ product: { name: current.product?.name || "", placement: current.product?.placement || "hand", image: url } }));
      } else {
        setCastPick({ id: `upload:${uid()}`, source: "upload", name: "", image: url, label: "" });
        setCastName("");
        setCastTab("upload");
        setOpenMenu("cast");
      }
    } catch (error) {
      toast.error(formatErrorMessage(error, copy.errors.upload));
    } finally {
      setUploading(null);
    }
  };

  useEffect(() => {
    const file = droppedFiles?.find?.((item) => item.type?.startsWith("image/"));
    if (!file) return;
    uploadImage(file, draft.creator ? "product" : "creator");
    onFilesHandled?.();
    // Only a new drop starts an upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles]);

  // ── Casting ──────────────────────────────────────────────────────────────
  const openCast = (event) => {
    event?.stopPropagation();
    if (openMenu === "cast") {
      setOpenMenu(null);
      return;
    }
    refreshCreators();
    setCastPick(draft.creator);
    setCastName(draft.creator?.name || "");
    setCastQuery("");
    setCastTab(draft.creator?.source === "character" ? "characters" : draft.creator?.source === "upload" ? "upload" : "influencers");
    setOpenMenu("cast");
  };

  const pickInCast = (creator) => {
    setCastPick(creator);
    setCastName(creator.name || "");
  };

  // Naming saves them as a character, so every studio can cast them.
  const confirmCast = (event) => {
    event?.stopPropagation();
    if (!castPick) return;
    const name = castName.trim();
    let creator = { ...castPick };
    if (name && name !== castPick.name) {
      try {
        const saved = saveCharacter({ name, images: [castPick.image], description: castPick.label || "", kind: "avatar" });
        creator = { id: `character:${saved.id}`, source: "character", name: saved.name, image: castPick.image, label: castPick.label || "" };
      } catch {
        creator = { ...castPick, name };
      }
    }
    patchDraft({ creator });
    setOpenMenu(null);
    textareaRef.current?.focus();
  };

  const openInfluencerStudio = () => window.dispatchEvent(new CustomEvent("oga:open-studio", { detail: { tabId: "ai-influencer" } }));

  // ── Hooks ────────────────────────────────────────────────────────────────
  const commitHook = (index, value) => {
    const text = String(value || "").trim();
    patchDraft((current) => {
      const hooks = [...current.hooks];
      if (index === "new") {
        if (text) hooks.push(text);
      } else if (text) hooks[index] = text;
      else hooks.splice(index, 1);
      return { hooks: hooks.slice(0, 8) };
    });
    setEditingHook(null);
  };

  const removeHook = (index) => patchDraft((current) => ({ hooks: current.hooks.filter((_, position) => position !== index) }));

  // ── Write it for me ──────────────────────────────────────────────────────
  const openWriter = (event) => {
    event.stopPropagation();
    setWriter((current) => ({ ...current, product: current.product || draft.product?.name || "" }));
    setOpenMenu((current) => (current === "writer" ? null : "writer"));
  };

  const writeScript = async () => {
    if (!chatReady || writing) return;
    setWriting(true);
    try {
      const { system, user } = scriptRequest({ product: writer.product || draft.product?.name, audience: writer.audience, angle: writer.angle, seconds: writer.seconds, creator: creatorName, scene: draft.scene });
      const { message, model, cost } = await chatCompleteDetailed({
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        responseFormat: { type: "json_object" },
        temperature: 0.8,
      });
      const script = parseScript(parseJsonReply(message?.content));
      patchDraft((current) => ({ hooks: script.hooks, body: script.body || current.body, takes: script.hooks.length ? Math.min(MAX_TAKES, script.hooks.length) : current.takes }));
      setWrittenBy({ model: agentModelName(model), cost });
      setOpenMenu(null);
    } catch (error) {
      toast.error(formatErrorMessage(error, copy.errors.script));
    } finally {
      setWriting(false);
    }
  };

  // ── Derived for the render ───────────────────────────────────────────────
  const castList = castTab === "influencers" ? influencers : castTab === "characters" ? characters : castPick?.source === "upload" ? [castPick] : [];
  const query = castQuery.trim().toLowerCase();
  const castShown = query ? castList.filter((creator) => `${creator.name} ${creator.label}`.toLowerCase().includes(query)) : castList;
  const startCreators = [...influencers.slice(0, 3), ...characters].slice(0, 3);
  // The fan shows the visitor's own creators, the first one in the middle.
  const fanCreators = useMemo(() => {
    const own = [...characters, ...influencers].filter((creator) => creator.image);
    if (!own.length) return SAMPLE_CREATORS;
    const pick = (index) => own[index] || own[0];
    return [pick(1), pick(0), pick(2)].map((creator) => ({ name: creator.name, image: creator.image }));
  }, [characters, influencers]);
  const sceneCopy = (id) => copy.scenes[id] || copy.scenes.talking;
  const currentScene = SCENES.find((scene) => scene.id === draft.scene) || SCENES[0];
  const takesLabel = (count) => (count === 1 ? copy.bar.takesOne : fill(copy.bar.takesCount, { count }));
  const filmLabel = draft.takes === 1 ? copy.bar.filmOne : fill(copy.bar.film, { count: draft.takes });
  const durationHint = seconds > 0
    ? engine?.kind === "take" && !engine.fits
      ? { text: fill(copy.bar.trims, { seconds, longest: engine.longest }), warn: true }
      : { text: fill(copy.bar.seconds, { seconds }), warn: false }
    : null;
  const canFilm = Boolean(draft.creator && hasScript && engine && sceneModel && !uploading);
  const showEmpty = batches.length === 0;
  // Until anything is filmed or set up, the visit opens on the intro.
  const showIntro = hydrated && !started && showEmpty && !draft.creator && !draft.body.trim();
  const start = (scene) => {
    if (scene) patchDraft({ scene });
    setStarted(true);
  };

  const placeholder = creatorName ? fill(copy.bar.placeholder, { name: creatorName }) : copy.bar.placeholderNoCreator;

  const writerPopover = (
    <PromptPopover role="dialog" aria-label={copy.writer.title} onClick={(event) => event.stopPropagation()} positionClassName="absolute bottom-[calc(100%+12px)] right-0 z-50" className="flex w-[360px] max-w-[calc(100vw-24px)] !max-h-[min(560px,calc(100vh-180px))] flex-col gap-3 !p-3.5" fitViewport solid data-ugc-writer>
      <PromptPopoverHeader className="!mb-0 !px-0 !pb-0">{copy.writer.title}</PromptPopoverHeader>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-white/55">{copy.writer.product}</span>
        <input type="text" value={writer.product} onChange={(event) => setWriter((current) => ({ ...current, product: event.target.value }))} placeholder={copy.writer.productPlaceholder} className={FIELD} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-white/55">{copy.writer.audience}</span>
        <input type="text" value={writer.audience} onChange={(event) => setWriter((current) => ({ ...current, audience: event.target.value }))} placeholder={copy.writer.audiencePlaceholder} className={FIELD} />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-white/55">{copy.writer.angle}</span>
        <PromptSegmentedControl className="w-full">
          {SCRIPT_ANGLES.map((angle) => (
            <PromptSegmentOption key={angle} className="flex-1 !px-1.5" selected={writer.angle === angle} onClick={() => setWriter((current) => ({ ...current, angle }))}>{copy.writer.angles[angle]}</PromptSegmentOption>
          ))}
        </PromptSegmentedControl>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-white/55">{copy.writer.length}</span>
        <PromptSegmentedControl className="w-full">
          {SCRIPT_LENGTHS.map((length) => (
            <PromptSegmentOption key={length} className="flex-1" selected={writer.seconds === length} onClick={() => setWriter((current) => ({ ...current, seconds: length }))}>{length} s</PromptSegmentOption>
          ))}
        </PromptSegmentedControl>
      </div>
      {chatReady ? (
        <button type="button" onClick={writeScript} disabled={writing} className="mt-1 flex h-9 items-center justify-center gap-2 rounded-[10px] bg-[#22d3ee] text-[13px] font-bold text-[#04202a] hover:brightness-105 disabled:opacity-60" data-ugc-write-go>
          <IconSparkles size={15} stroke={2} aria-hidden="true" />
          {writing ? copy.writer.drafting : copy.writer.draft}
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-[10px] border border-amber-400/20 bg-amber-400/[0.05] p-2.5">
          <p className="text-[12px] leading-relaxed text-white/65">{copy.writer.needsAgent}</p>
          <button type="button" onClick={() => { setOpenMenu(null); window.dispatchEvent(new CustomEvent("oga:open-settings", { detail: { section: "agent" } })); }} className="h-8 self-start rounded-[9px] bg-amber-300 px-3 text-[12px] font-semibold text-black hover:brightness-105">{copy.writer.chooseAgent}</button>
        </div>
      )}
      {writtenBy && (
        <p className="font-mono text-[11px] text-white/40">
          {writtenBy.cost !== null && writtenBy.cost !== undefined ? fill(copy.writer.writtenCost, { model: writtenBy.model, cost: formatMoney(writtenBy.cost, "USD", locale) }) : fill(copy.writer.written, { model: writtenBy.model })}
        </p>
      )}
    </PromptPopover>
  );

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-app-bg text-white" data-ugc-studio>
      <Toaster position="top-center" toastOptions={{ style: { background: "#141414", color: "#fff", border: "1px solid rgba(255,255,255,0.08)" } }} />
      <style>{"@keyframes ugc-progress{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
      <input ref={creatorFileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { uploadImage(event.target.files?.[0], "creator"); event.target.value = ""; }} />
      <input ref={productFileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { uploadImage(event.target.files?.[0], "product"); event.target.value = ""; }} />

      {/* ── Start, or the takes ── */}
      <div className={`custom-scrollbar w-full flex-1 overflow-y-auto px-4 pt-6 md:px-6 ${showIntro ? "pb-6" : "pb-64"}`}>
        {!hydrated ? null : showIntro ? (
          <div className="mx-auto grid h-full w-full max-w-[1280px] grid-cols-1 items-center gap-6 md:grid-cols-[5fr_7fr] md:gap-12 md:px-8" data-ugc-intro>
            <div className="min-w-0 max-w-[470px]">
              <h1 className="oga-enter text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] text-white/[0.92] md:text-[38px]">
                {copy.intro.heading} <span className="text-[#22d3ee]">{copy.intro.accent}</span>
              </h1>
              <p className="oga-enter mt-4 max-w-[42ch] text-[15.5px] leading-relaxed text-white/55" style={{ "--i": 1 }}>{copy.intro.subtitle}</p>
              <nav aria-label={copy.intro.startersLabel} className="mt-7">
                {copy.intro.starters.map((starter, index) => (
                  <button
                    key={starter.scene}
                    type="button"
                    onClick={() => start(starter.scene)}
                    style={{ "--i": index + 2 }}
                    className="oga-enter group flex w-full items-center justify-between gap-4 border-t border-white/[0.08] py-3.5 text-left text-[14.5px] leading-snug text-white/75 transition-colors last:border-b hover:text-white"
                    data-ugc-starter={starter.scene}
                  >
                    <span>{starter.label}</span>
                    <IconArrowRight size={15} stroke={1.75} aria-hidden="true" className="shrink-0 text-white/35 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#22d3ee]" />
                  </button>
                ))}
              </nav>
              <div className="oga-enter mt-7 flex flex-wrap items-center gap-4" style={{ "--i": 5 }}>
                <button type="button" onClick={() => start()} className="flex h-[46px] items-center gap-2.5 rounded-[13px] bg-[#22d3ee] pl-[18px] pr-5 text-[15px] font-bold text-[#04202a] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[filter,transform] hover:brightness-105 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0d]" data-ugc-begin>
                  <IconPlayerPlayFilled size={16} aria-hidden="true" />
                  {copy.intro.cta}
                </button>
                <span className="max-w-[230px] text-[12.5px] leading-snug text-white/45">{copy.intro.ctaHint}</span>
              </div>
            </div>
            <div className="oga-enter-fade hidden h-full min-h-0 md:block" style={{ "--i": 2 }}>
              <TakeFan creators={fanCreators} copy={copy} />
            </div>
          </div>
        ) : showEmpty ? (
          <div className="oga-enter-fade mx-auto flex w-full max-w-4xl flex-col" data-ugc-start>
            <h1 className="text-[28px] font-semibold leading-[1.12] tracking-[-0.025em] text-white/[0.92] md:text-[32px]">
              {copy.empty.heading} <span className="text-[#22d3ee]">{copy.empty.accent}</span> {copy.empty.headingEnd}
            </h1>
            <p className="mt-2.5 max-w-[600px] text-[15px] leading-relaxed text-white/55">{copy.empty.subtitle}</p>

            <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={SECTION_TITLE}>{copy.empty.creators}</h2>
              <span className="text-[12px] text-white/45">{copy.empty.creatorsHint}</span>
            </div>
            <div role="radiogroup" aria-label={copy.empty.creators} className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {startCreators.map((creator) => (
                <CreatorCard key={creator.id} creator={creator} tall selected={draft.creator?.image === creator.image} copy={copy} onPick={() => patchDraft({ creator })} />
              ))}
              <button type="button" onClick={() => creatorFileRef.current?.click()} disabled={uploading === "creator"} className="flex h-[196px] flex-col items-center justify-center gap-2.5 rounded-[14px] border border-dashed border-white/[0.16] bg-white/[0.02] text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:opacity-60">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]"><IconUpload size={18} stroke={1.75} aria-hidden="true" /></span>
                <span className="text-[13px] font-medium">{uploading === "creator" ? copy.cast.uploading : copy.empty.upload}</span>
                <span className="-mt-1.5 text-[11.5px] text-white/45">{copy.empty.uploadHint}</span>
              </button>
              <button type="button" onClick={openInfluencerStudio} className="flex h-[196px] flex-col items-center justify-center gap-2.5 rounded-[14px] border border-dashed border-[#22d3ee]/30 bg-[#22d3ee]/[0.04] text-[#a5f3fc] transition-colors hover:border-[#22d3ee]/50">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#22d3ee]/[0.12]"><IconSparkles size={18} stroke={1.75} aria-hidden="true" /></span>
                <span className="text-[13px] font-medium">{copy.empty.create}</span>
                <span className="-mt-1.5 text-[11.5px] text-[#a5f3fc]/60">{copy.empty.createHint}</span>
              </button>
            </div>

            <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={SECTION_TITLE}>{copy.empty.scenes}</h2>
              <span className="text-[12px] text-white/45">{copy.empty.scenesHint}</span>
            </div>
            <div role="radiogroup" aria-label={copy.empty.scenes} className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {SCENES.map((scene) => {
                const on = draft.scene === scene.id;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => patchDraft({ scene: scene.id })}
                    className={`flex h-16 items-center gap-3 rounded-xl border px-3 text-left transition-colors ${on ? "border-[#22d3ee]/45 bg-[#22d3ee]/[0.06]" : "border-white/[0.08] bg-white/[0.025] hover:border-white/[0.16]"}`}
                    data-ugc-scene={scene.id}
                  >
                    <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] ${on ? "bg-[#22d3ee]/[0.12] text-[#22d3ee]" : "bg-white/[0.06] text-white/75"}`}><SceneIcon scene={scene} /></span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium">{sceneCopy(scene.id).name}</span>
                      <span className="truncate text-[11.5px] text-white/50">{sceneCopy(scene.id).hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-9" data-ugc-feed>
            {batches.map((batch) => (
              <section key={batch.id} aria-label={batch.product?.name || batch.creator?.name || copy.feed.untitled} className="oga-enter-fade flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                    <h2 className="truncate text-[16px] font-semibold">{batch.product?.name || batch.creator?.name || copy.feed.untitled}</h2>
                    <span className="text-[12.5px] text-white/50">{fill(copy.feed.meta, { creator: batch.creator?.name || copy.bar.unnamed, scene: sceneCopy(batch.scene).name, count: takesLabel(batch.takes.length) })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-white/45">{formatWhen(new Date(batch.createdAt).toISOString(), locale)}</span>
                    <button
                      type="button"
                      onClick={() => deleteBatch(batch)}
                      aria-label={copy.feed.delete}
                      title={copy.feed.delete}
                      className={`flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12px] font-semibold transition-colors ${confirmDelete === batch.id ? "bg-red-500/15 text-red-300" : "text-white/45 hover:bg-white/[0.06] hover:text-red-300"}`}
                    >
                      <IconTrash size={14} stroke={1.75} aria-hidden="true" />
                      {confirmDelete === batch.id && copy.feed.confirmDelete}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
                  {batch.takes.map((take, index) => (
                    <TakeCard
                      key={take.id}
                      batch={batch}
                      take={take}
                      index={index}
                      playing={playing === take.id}
                      copy={copy}
                      onPlay={() => setPlaying((current) => (current === take.id ? null : take.id))}
                      onAgain={() => filmAgain(batch, take)}
                    />
                  ))}
                  {batch.frame && (
                    <button
                      type="button"
                      onClick={() => anotherTake(batch)}
                      className={`flex ${ASPECT_CLASS[batch.aspect] || ASPECT_CLASS["9:16"]} flex-col items-center justify-center gap-2.5 rounded-[14px] border border-dashed border-white/[0.14] bg-white/[0.02] px-6 text-center text-white/70 transition-colors hover:border-white/30 hover:text-white`}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]"><IconPlus size={18} stroke={2} aria-hidden="true" /></span>
                      <span className="text-[13px] font-medium">{copy.feed.another}</span>
                      <span className="-mt-1 text-[11.5px] leading-[1.45] text-white/45">{copy.feed.anotherHint}</span>
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* ── The prompt bar, once past the intro ── */}
      {hydrated && !showIntro && (
      <PromptComposer>
        {(draft.hooks.length > 0 || editingHook === "new") && (
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto oga-scroll-hide" data-ugc-hooks>
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/40">{copy.bar.hooks}</span>
            {draft.hooks.map((hook, index) => (editingHook === index ? (
              <input
                key={index}
                autoFocus
                defaultValue={hook}
                aria-label={copy.bar.hooks}
                onBlur={(event) => commitHook(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitHook(index, event.currentTarget.value);
                  if (event.key === "Escape") setEditingHook(null);
                }}
                className={`${FIELD} h-7 w-64 shrink-0`}
              />
            ) : (
              <span key={index} className={`group/hook flex h-7 max-w-[260px] shrink-0 items-center rounded-lg border ${index < draft.takes ? "border-[#22d3ee]/35 bg-[#22d3ee]/[0.07] text-[#cffafe]" : "border-white/[0.1] bg-white/[0.04] text-white/70"}`}>
                <button type="button" onClick={() => setEditingHook(index)} className="flex min-w-0 items-center gap-1.5 pl-1.5 pr-1 text-[12.5px]" title={hook}>
                  <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] bg-white/[0.1] font-mono text-[10.5px]">{index + 1}</span>
                  <span className="truncate">{hook}</span>
                </button>
                <button type="button" onClick={() => removeHook(index)} aria-label={copy.bar.removeHook} title={copy.bar.removeHook} className="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white/45 hover:text-white">
                  <IconX size={11} stroke={2.5} aria-hidden="true" />
                </button>
              </span>
            )))}
            {editingHook === "new" ? (
              <input
                autoFocus
                placeholder={copy.bar.hookPlaceholder}
                aria-label={copy.bar.addHook}
                onBlur={(event) => commitHook("new", event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitHook("new", event.currentTarget.value);
                  if (event.key === "Escape") setEditingHook(null);
                }}
                className={`${FIELD} h-7 w-64 shrink-0`}
              />
            ) : (
              <button type="button" onClick={() => setEditingHook("new")} aria-label={copy.bar.addHook} title={copy.bar.addHook} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/[0.06] hover:text-white">
                <IconPlus size={14} stroke={2} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:contents">
          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:order-1">
            <div className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={openMenu === "cast"}
                onClick={openCast}
                className={`${CHIP} ${draft.creator ? "border-white/10 bg-white/[0.04] pl-[5px] pr-2.5" : "oga-pulse-ring border-[#22d3ee]/50 bg-[#22d3ee]/[0.06] pl-1.5 pr-2.5"} ${openMenu === "cast" ? "!border-[#22d3ee]/45 !bg-[#22d3ee]/[0.08]" : ""}`}
                data-ugc-cast
              >
                {draft.creator ? (
                  <img src={draft.creator.image} alt="" className="h-[30px] w-[30px] rounded-[9px] object-cover object-[center_22%]" />
                ) : (
                  <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08] text-white/70"><IconUser size={15} stroke={1.75} /></span>
                )}
                <span className="max-w-[120px] truncate">{draft.creator ? creatorName || copy.bar.unnamed : copy.bar.chooseCreator}</span>
                <PromptChevronIcon className={openMenu === "cast" ? "rotate-180" : ""} />
              </button>
              {openMenu === "cast" && (
                <PromptPopover role="dialog" aria-label={copy.cast.title} onClick={(event) => event.stopPropagation()} className="flex w-[600px] max-w-[calc(100vw-24px)] !max-h-[min(660px,calc(100vh-180px))] flex-col gap-3 !p-3.5" fitViewport solid data-ugc-cast-menu>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-[15px] font-semibold">{copy.cast.title}</h2>
                    <label className="relative block w-full sm:w-[220px]">
                      <span className="sr-only">{copy.cast.search}</span>
                      <IconSearch size={13} stroke={2} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
                      <input type="text" value={castQuery} onChange={(event) => setCastQuery(event.target.value)} placeholder={copy.cast.search} className={`${FIELD} pl-8`} />
                    </label>
                  </div>
                  <PromptSegmentedControl className="w-full">
                    <PromptSegmentOption className="flex-1" selected={castTab === "influencers"} onClick={() => setCastTab("influencers")}>
                      {copy.cast.influencers} <span className="font-mono text-[11px] text-white/45">{influencers.length}</span>
                    </PromptSegmentOption>
                    <PromptSegmentOption className="flex-1" selected={castTab === "characters"} onClick={() => setCastTab("characters")}>
                      {copy.cast.characters} <span className="font-mono text-[11px] text-white/45">{characters.length}</span>
                    </PromptSegmentOption>
                    <PromptSegmentOption className="flex-1" selected={castTab === "upload"} onClick={() => setCastTab("upload")}>{copy.cast.upload}</PromptSegmentOption>
                  </PromptSegmentedControl>
                  <p className="px-0.5 text-[12px] leading-relaxed text-white/50">
                    {castTab === "influencers" ? copy.cast.influencersHint : castTab === "characters" ? copy.cast.charactersHint : copy.cast.uploadHint}
                  </p>
                  <div role="radiogroup" aria-label={copy.cast.title} className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {castShown.map((creator) => (
                      <CreatorCard key={creator.id} creator={creator} selected={castPick?.image === creator.image} copy={copy} onPick={() => pickInCast(creator)} />
                    ))}
                    {castTab === "influencers" && (
                      <button type="button" onClick={() => { setOpenMenu(null); openInfluencerStudio(); }} className="flex h-[176px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#22d3ee]/30 bg-[#22d3ee]/[0.04] px-2.5 text-center text-[#a5f3fc] hover:border-[#22d3ee]/50">
                        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#22d3ee]/[0.12]"><IconSparkles size={17} stroke={1.75} aria-hidden="true" /></span>
                        <span className="text-[12.5px] font-medium">{copy.cast.create}</span>
                        <span className="-mt-1 text-[11px] leading-snug text-[#a5f3fc]/65">{copy.cast.createHint}</span>
                      </button>
                    )}
                    {castTab === "upload" && (
                      <button type="button" onClick={() => creatorFileRef.current?.click()} disabled={uploading === "creator"} className="flex h-[176px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.16] bg-white/[0.02] px-2.5 text-center text-white/70 hover:border-white/30 disabled:opacity-60">
                        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/[0.06]"><IconUpload size={17} stroke={1.75} aria-hidden="true" /></span>
                        <span className="text-[12.5px] font-medium">{uploading === "creator" ? copy.cast.uploading : copy.cast.uploadButton}</span>
                      </button>
                    )}
                  </div>
                  {castShown.length === 0 && castTab !== "upload" && (
                    <p className="px-0.5 text-[12px] text-white/45">{query ? fill(copy.cast.noMatch, { query: castQuery.trim() }) : castTab === "influencers" ? copy.cast.influencersEmpty : copy.cast.charactersEmpty}</p>
                  )}
                  {castPick && (
                    <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3" data-ugc-cast-footer>
                      <img src={castPick.image} alt="" className="h-10 w-10 shrink-0 rounded-[11px] object-cover object-[center_22%]" />
                      <label className="flex min-w-[140px] flex-1 flex-col gap-1">
                        <span className="text-[11.5px] text-white/50">{copy.cast.name}</span>
                        <input type="text" value={castName} onChange={(event) => setCastName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && confirmCast(event)} placeholder={copy.cast.namePlaceholder} className={FIELD} data-ugc-cast-name />
                      </label>
                      <span className="max-w-[180px] text-[11.5px] leading-snug text-white/45">
                        {castName.trim() ? fill(copy.cast.saveHint, { handle: characterHandle(castName) }) : copy.cast.saveHintEmpty}
                      </span>
                      <button type="button" onClick={confirmCast} className="h-9 shrink-0 rounded-[10px] bg-[#22d3ee] px-3.5 text-[13px] font-bold text-[#04202a] hover:brightness-105" data-ugc-cast-confirm>
                        {castName.trim() ? fill(copy.cast.cast, { name: castName.trim() }) : copy.cast.castUnnamed}
                      </button>
                    </div>
                  )}
                </PromptPopover>
              )}
            </div>

            <div className="relative">
              {draft.product ? (
                <button type="button" aria-haspopup="dialog" aria-expanded={openMenu === "product"} onClick={toggleMenu("product")} className={`${CHIP} border-white/10 bg-white/[0.04] pl-[5px] pr-2.5 ${openMenu === "product" ? "!border-[#22d3ee]/45" : ""}`} data-ugc-product>
                  <img src={draft.product.image} alt="" className="h-[30px] w-[30px] rounded-[9px] object-cover" />
                  <span className="max-w-[120px] truncate">{draft.product.name || copy.product.add}</span>
                </button>
              ) : (
                <button type="button" onClick={() => productFileRef.current?.click()} disabled={uploading === "product"} className={`${CHIP} border-dashed border-white/[0.18] pl-2.5 pr-3 text-white/70 hover:border-white/30 hover:text-white disabled:opacity-60`} data-ugc-product>
                  <IconPlus size={15} stroke={2} aria-hidden="true" />
                  {uploading === "product" ? copy.product.uploading : copy.product.add}
                </button>
              )}
              {openMenu === "product" && draft.product && (
                <PromptPopover role="dialog" aria-label={copy.product.add} onClick={(event) => event.stopPropagation()} className="flex w-[300px] flex-col gap-3 !p-3" fitViewport solid>
                  <div className="flex items-center gap-3">
                    <img src={draft.product.image} alt="" className="h-14 w-14 shrink-0 rounded-[11px] object-cover" />
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[11.5px] text-white/50">{copy.product.name}</span>
                      <input type="text" value={draft.product.name} onChange={(event) => patchDraft((current) => ({ product: { ...current.product, name: event.target.value } }))} placeholder={copy.product.namePlaceholder} className={FIELD} data-ugc-product-name />
                    </label>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11.5px] text-white/50">{copy.product.placement}</span>
                    <PromptSegmentedControl className="w-full">
                      {PLACEMENTS.map((placement) => (
                        <PromptSegmentOption key={placement} className="flex-1" selected={draft.product.placement === placement} onClick={() => patchDraft((current) => ({ product: { ...current.product, placement } }))}>
                          {copy.product.placements[placement]}
                        </PromptSegmentOption>
                      ))}
                    </PromptSegmentedControl>
                  </div>
                  {sceneModel && !frameTakesProduct(sceneModel) && <p className="text-[11.5px] leading-relaxed text-white/45">{copy.product.oneImage}</p>}
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => productFileRef.current?.click()} className="h-8 rounded-[9px] border border-white/[0.1] px-3 text-[12px] font-semibold text-white/80 hover:bg-white/[0.06]">{copy.product.replace}</button>
                    <button type="button" onClick={() => { patchDraft({ product: null }); setOpenMenu(null); }} className="h-8 rounded-[9px] px-3 text-[12px] font-semibold text-white/55 hover:text-red-300">{copy.product.remove}</button>
                  </div>
                </PromptPopover>
              )}
            </div>
          </div>

          <div className="relative shrink-0 sm:order-3 sm:self-start">
            <button type="button" aria-haspopup="dialog" aria-expanded={openMenu === "writer"} onClick={openWriter} aria-label={copy.bar.write} title={copy.bar.write} className="mt-0.5 flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2.5 text-[13px] font-medium text-[#67e8f9] transition-colors hover:bg-[#22d3ee]/[0.08]" data-ugc-write>
              <IconSparkles size={15} stroke={1.75} aria-hidden="true" />
              <span className="hidden sm:inline">{copy.bar.write}</span>
            </button>
            {openMenu === "writer" && writerPopover}
          </div>
          </div>

          <PromptTextarea
            ref={textareaRef}
            value={draft.body}
            onChange={(event) => patchDraft({ body: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                if (canFilm) film();
              }
            }}
            aria-label={copy.bar.write}
            placeholder={placeholder}
            className="min-w-0 flex-1 sm:order-2"
          />

        </div>

        <PromptFooter className="sm:flex-wrap">
          <PromptControls>
            <div className="relative flex min-w-0">
              <button type="button" aria-haspopup="dialog" aria-expanded={openMenu === "scene"} onClick={toggleMenu("scene")} title={copy.bar.scene} className={promptModelButtonClassName({ active: openMenu === "scene" })} data-ugc-scene-button>
                <span className="shrink-0 opacity-75"><SceneIcon scene={currentScene} size={15} /></span>
                <span className="max-w-[170px] truncate">{sceneCopy(currentScene.id).name}</span>
                <PromptChevronIcon className={openMenu === "scene" ? "rotate-180" : ""} />
              </button>
              {openMenu === "scene" && (
                <PromptPopover role="dialog" aria-label={copy.bar.scene} onClick={(event) => event.stopPropagation()} className="w-[290px] !max-h-[min(520px,60vh)]" fitViewport solid>
                  <PromptPopoverHeader>{copy.bar.scene}</PromptPopoverHeader>
                  <PromptMenuList>
                    {SCENES.map((scene) => (
                      <PromptMenuItem key={scene.id} selected={draft.scene === scene.id} description={sceneCopy(scene.id).hint} onClick={() => { patchDraft({ scene: scene.id }); setOpenMenu(null); }}>
                        <span className="flex items-center gap-2"><SceneIcon scene={scene} size={14} />{sceneCopy(scene.id).name}</span>
                      </PromptMenuItem>
                    ))}
                  </PromptMenuList>
                </PromptPopover>
              )}
            </div>

            <PromptSettingsGroup label={copy.bar.settings} className="max-w-full overflow-x-auto oga-scroll-hide">
              <div key="tone" className="relative flex">
                <button type="button" aria-haspopup="dialog" aria-expanded={openMenu === "tone"} onClick={toggleMenu("tone")} title={copy.bar.tone} className={promptSettingClassName({ active: openMenu === "tone" })} data-ugc-tone>
                  <IconMicrophone size={14} stroke={1.75} aria-hidden="true" className="opacity-60" />
                  {copy.tones[draft.tone]}
                </button>
                {openMenu === "tone" && (
                  <PromptPopover role="dialog" aria-label={copy.bar.tone} onClick={(event) => event.stopPropagation()} className="w-[260px] !max-h-[60vh]" fitViewport solid>
                    <PromptPopoverHeader>{copy.bar.tone}</PromptPopoverHeader>
                    <PromptMenuList>
                      {TONES.map((tone) => (
                        <PromptMenuItem key={tone.id} selected={draft.tone === tone.id} onClick={() => { patchDraft({ tone: tone.id }); if (engine?.kind !== "avatar") setOpenMenu(null); }}>{copy.tones[tone.id]}</PromptMenuItem>
                      ))}
                    </PromptMenuList>
                    {engine?.kind === "avatar" && voices.length > 0 && (
                      <div className="mt-2 border-t border-white/[0.06] pt-2">
                        <PromptPopoverHeader>{copy.bar.voice}</PromptPopoverHeader>
                        <PromptMenuList>
                          {voices.map((item) => (
                            <PromptMenuItem key={item.id} selected={voiceId === item.id} onClick={() => { patchDraft({ voice: item.id }); setOpenMenu(null); }}>{item.label}</PromptMenuItem>
                          ))}
                        </PromptMenuList>
                      </div>
                    )}
                  </PromptPopover>
                )}
              </div>
              <div key="aspect" className="relative flex">
                <button type="button" aria-haspopup="dialog" aria-expanded={openMenu === "aspect"} onClick={toggleMenu("aspect")} title={copy.bar.aspect} className={promptSettingClassName({ active: openMenu === "aspect" })} data-ugc-aspect>
                  <PromptRatioIcon ratio={draft.aspect} />
                  {draft.aspect}
                </button>
                {openMenu === "aspect" && (
                  <PromptPopover role="dialog" aria-label={copy.bar.aspect} onClick={(event) => event.stopPropagation()} className="w-[180px]" fitViewport solid>
                    <PromptPopoverHeader>{copy.bar.aspect}</PromptPopoverHeader>
                    <PromptMenuList>
                      {ASPECTS.map((aspect) => (
                        <PromptMenuItem key={aspect} selected={draft.aspect === aspect} onClick={() => { patchDraft({ aspect }); setOpenMenu(null); }}>
                          <span className="flex items-center gap-2.5"><PromptRatioIcon ratio={aspect} />{aspect}</span>
                        </PromptMenuItem>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
              <div key="takes" className="relative flex">
                <button type="button" aria-haspopup="dialog" aria-expanded={openMenu === "takes"} onClick={toggleMenu("takes")} title={copy.bar.takesHint} className={promptSettingClassName({ active: openMenu === "takes" })} data-ugc-takes>
                  {takesLabel(draft.takes)}
                </button>
                {openMenu === "takes" && (
                  <PromptPopover role="dialog" aria-label={copy.bar.takes} onClick={(event) => event.stopPropagation()} className="w-[220px]" fitViewport solid>
                    <PromptPopoverHeader>{copy.bar.takesHint}</PromptPopoverHeader>
                    <PromptMenuList>
                      {Array.from({ length: MAX_TAKES }, (_, index) => index + 1).map((count) => (
                        <PromptMenuItem key={count} selected={draft.takes === count} onClick={() => { patchDraft({ takes: count }); setOpenMenu(null); }}>{takesLabel(count)}</PromptMenuItem>
                      ))}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
              <div key="engine" className="relative flex">
                <button type="button" aria-haspopup="dialog" aria-expanded={openMenu === "engine"} onClick={toggleMenu("engine")} title={copy.bar.engine} className={promptSettingClassName({ active: openMenu === "engine" })} data-ugc-engine>
                  <IconVideo size={14} stroke={1.75} aria-hidden="true" className="opacity-60" />
                  <span className="max-w-[150px] truncate">{engineName}</span>
                  {draft.engine === AUTO_ENGINE && engine && <span className="rounded-[5px] bg-white/[0.07] px-1.5 py-px text-[10.5px] font-medium text-white/50">{copy.bar.auto}</span>}
                </button>
                {openMenu === "engine" && (
                  <PromptPopover role="dialog" aria-label={copy.bar.engine} onClick={(event) => event.stopPropagation()} className="w-[300px] !max-h-[60vh]" fitViewport solid data-ugc-engine-menu>
                    <PromptPopoverHeader>{copy.bar.engine}</PromptPopoverHeader>
                    <PromptMenuList>
                      <PromptMenuItem selected={draft.engine === AUTO_ENGINE} description={engine ? fill(copy.bar.autoUses, { model: engineName }) : copy.bar.noEngine} onClick={() => { patchDraft({ engine: AUTO_ENGINE }); setOpenMenu(null); }}>Auto</PromptMenuItem>
                      {takeModels.map((model) => {
                        const longest = longestTake(model);
                        return (
                          <PromptMenuItem key={model.id} selected={draft.engine === model.id} description={longest ? fill(copy.bar.upTo, { seconds: longest }) : undefined} onClick={() => { patchDraft({ engine: model.id }); setOpenMenu(null); }}>{engineLabel(model)}</PromptMenuItem>
                        );
                      })}
                      {avatar && voice && (
                        <PromptMenuItem selected={draft.engine === AVATAR_ENGINE} wrapDescription description={fill(copy.bar.avatarHint, { voice: engineLabel(voice), model: engineLabel(avatar) })} onClick={() => { patchDraft({ engine: AVATAR_ENGINE }); setOpenMenu(null); }}>{copy.bar.avatar}</PromptMenuItem>
                      )}
                    </PromptMenuList>
                  </PromptPopover>
                )}
              </div>
            </PromptSettingsGroup>
          </PromptControls>

          <PromptActionGroup className="sm:ml-auto">
            {durationHint && (
              <span className={`hidden whitespace-nowrap font-mono text-[11px] md:inline ${durationHint.warn ? "text-amber-300/90" : "text-white/50"}`} data-ugc-duration>{durationHint.text}</span>
            )}
            <PromptAction
              onClick={film}
              disabled={!canFilm}
              addon={price && (
                <PriceChip variant="inset" locale={locale} endpoint={price.endpoint} payload={price.payload} runs={draft.takes} note={copy.bar.priceNote} />
              )}
              data-ugc-film
            >
              <IconPlayerPlayFilled size={15} aria-hidden="true" />
              {filmLabel}
            </PromptAction>
          </PromptActionGroup>
        </PromptFooter>
      </PromptComposer>
      )}
    </div>
  );
}
