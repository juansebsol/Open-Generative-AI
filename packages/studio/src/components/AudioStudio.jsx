"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconAdjustments, IconArrowsExchange, IconDownload, IconFileMusic, IconMicrophone, IconPlus, IconSearch, IconTrash, IconUpload, IconUserPlus, IconX,
} from "@tabler/icons-react";
import { generateAudio, uploadFile } from "../generation.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { audioModels } from "../models.js";
import { getRoutes } from "../providers/catalog/index.js";
import { isEndpointAvailable } from "../providers/client.js";
import { getProvider } from "../providers/directProviders.js";
import { subscribeProviderSettings } from "../providers/keys.js";
import { fetchMediaBlob } from "../providers/mediaStore.js";
import { quoteRun } from "../providers/pricing.js";
import {
  addEntry, addPending, addVoice, getEmptyLibrary, getLibrary, removeEntry, removePending, removeVoice, sendToAudio, subscribeLibrary, takeHandoff, updateEntry,
} from "../audioLibrary.js";
import {
  acceptsClonedVoices, audioModelsFor, carryOptions, carryScript, defaultOptions, defaultScript, dialoguePayload, dialogueShape, dialogueVoices,
  entryTitle, enumOptions, formatDuration, isSoundEffect, layoutInputs, missingInput, musicPayload, numericRange, optionLabel, remixPayload,
  scriptCharacters, scriptText, speechPayload, voiceCloneModel, voiceKey,
} from "../audioPages.js";
import {
  PROMPT_CONTROL_LABEL_CLASS,
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
  PromptTextarea,
  promptControlClassName,
} from "./prompt/PromptComposer.jsx";
import PriceChip from "./prompt/PriceChip.jsx";
import ModelRailPicker from "./prompt/ModelRailPicker.jsx";
import StudioEmptyState from "./StudioEmptyState.jsx";
import AudioPlayer, { stopAllAudio } from "./audio/AudioPlayer.jsx";
import { Entrance } from "./motion/index.js";
import en from "../messages/en/audioStudio.json";
import zh from "../messages/zh/audioStudio.json";
import { resolveCopy } from "../i18nUtils";
import { defaultModelId } from "../benchmarks.js";
import { useEditorsPickPreselect } from "./benchmarks/shared.jsx";
import { GenerationCopyButtons } from "./MobileGenerationActions.jsx";
import { LibraryActions, LibraryDetails, Lightbox, formatCost, formatWhen } from "./library/LibraryKit.jsx";

// Four pages share this component, like the Vector pages share VectorStudio:
// Text to Speech reads a text in one voice, Dialogue reads a script with a
// cast, Music writes songs, instrumentals and sound effects, Remix restyles
// or extends a track. Which model belongs where, and what each request looks
// like, is decided in audioPages.js; every page shows the same library
// (audioLibrary.js), and cloned voices live there too.

export const AUDIO_PAGES = ["speech", "dialogue", "music", "remix"];

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const SEARCHABLE_FROM = 12;
const MAX_LINES = 60;
const MAX_SPEAKERS = 8;

const isAudioFile = (file) => /^audio\/(mpeg|mp3|wav|x-wav|ogg|mp4|x-m4a|m4a|flac|aac|webm)$/i.test(file?.type || "") || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file?.name || "");
const fill = (template, values) => String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const number = (value, locale) => new Intl.NumberFormat(locale).format(value);
const VOICE_ID_OK = /^[A-Za-z][A-Za-z0-9_-]{7,}$/;
const hasLetterAndDigit = (value) => /[A-Za-z]/.test(value) && /\d/.test(value);
// The price chip debounces, but text changes every keystroke; quoting a
// length rounded up to the next hundred keeps the quote still while typing.
const padForPricing = (text) => (text.length ? text.padEnd(Math.ceil(text.length / 100) * 100, " ") : "");

function useLibrary() {
  return useSyncExternalStore(subscribeLibrary, getLibrary, getEmptyLibrary);
}

// "Speaker 1: line" text (a starter, a paste) into a script: speakers in order of appearance.
function parseScript(text, model) {
  const base = defaultScript(model);
  const voices = dialogueVoices(model);
  const cast = [];
  const lines = [];
  for (const raw of String(text || "").split("\n")) {
    const match = raw.match(/^\s*([^:]{1,40}):\s*(.+)$/);
    if (!match) continue;
    const name = match[1].trim();
    let speaker = cast.find((member) => member.name === name);
    if (!speaker) {
      const index = cast.length;
      speaker = { id: `Speaker ${index + 1}`, name, voice: base.cast[index]?.voice ?? voices[index % Math.max(1, voices.length)]?.value ?? "", profile: "" };
      cast.push(speaker);
    }
    lines.push({ speaker: speaker.id, text: match[2].trim() });
  }
  return cast.length ? { cast, lines } : base;
}

const INPUT_CLASS = "h-9 w-full min-w-0 rounded-[9px] border border-white/[0.08] bg-black/40 px-3 text-[13px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none";
const CHEVRON = (size, inset) => ({
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.45)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: `right ${inset}px center`,
  backgroundSize: `${size}px`,
});
const CHEVRON_STYLE = CHEVRON(12, 10);
const SMALL_CHEVRON_STYLE = CHEVRON(10, 8);
const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer appearance-none pr-8`;
const SMALL_SELECT_CLASS = "h-8 max-w-[150px] shrink-0 cursor-pointer appearance-none truncate rounded-[8px] border border-white/[0.08] bg-white/[0.04] pl-2.5 pr-6 text-[12px] font-medium text-white/80 focus:border-white/20 focus:outline-none";
const SIDE_TEXTAREA_CLASS = "w-full resize-y rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-white/85 placeholder:text-white/30 focus:border-white/20 focus:outline-none";
const SMALL_BUTTON_CLASS = "flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[12px] font-medium text-white hover:bg-white/[0.12]";
const TOGGLE_CLASS = (on) => `relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-white/15"}`;
const TOGGLE_KNOB_CLASS = (on) => `absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`;

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={TOGGLE_CLASS(on)}>
      <span className={TOGGLE_KNOB_CLASS(on)} />
    </button>
  );
}

// A searchable list of choices in a popover: voices, languages, anything
// longer than a short menu.
function SearchList({ title, options, value, onSelect, searchPlaceholder, emptyLabel, head = null, className = "w-[320px]" }) {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? options.filter((option) => words.every((word) => `${option.label} ${option.value}`.toLowerCase().includes(word))) : options;
  return (
    <PromptPopover className={className} fitViewport>
      <PromptPopoverHeader>{title}</PromptPopoverHeader>
      <label className="mb-1.5 flex h-[34px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-white/40 focus-within:border-primary/50">
        <IconSearch size={13} stroke={2} aria-hidden="true" />
        <input type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="h-full w-full min-w-0 bg-transparent text-xs text-white placeholder:text-white/35 focus:outline-none" />
      </label>
      {head}
      <PromptMenuList className="max-h-[32vh] overflow-y-auto custom-scrollbar pr-1">
        {shown.length === 0 && <div className="py-4 text-center text-xs text-white/30">{emptyLabel}</div>}
        {shown.slice(0, 300).map((option) => (
          <PromptMenuItem key={String(option.value)} selected={option.value === value} description={option.description} onClick={() => onSelect(option.value)}>{option.label}</PromptMenuItem>
        ))}
      </PromptMenuList>
    </PromptPopover>
  );
}

// The dialog that clones a voice with MiniMax: a sample, a voice id, a
// preview sentence. The preview goes into the library like any other track.
function CloneVoiceDialog({ model, locale, copy, preset, onClose, onCloned, onGenerationError }) {
  const [sample, setSample] = useState(preset?.source || null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState(copy.clone.previewPlaceholder);
  const [noise, setNoise] = useState(false);
  const [normalize, setNormalize] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [working, setWorking] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape" && !working) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  const upload = async (file) => {
    if (!isAudioFile(file)) return toast.error(copy.errors.notAudio);
    if (file.size > MAX_UPLOAD_BYTES) return toast.error(copy.errors.tooLarge);
    setUploading({ progress: 0 });
    try {
      const url = await uploadFile(file, (progress) => setUploading({ progress }));
      setSample({ url, name: file.name });
    } catch (error) {
      toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
    } finally {
      setUploading(null);
    }
  };
  const valid = VOICE_ID_OK.test(name) && hasLetterAndDigit(name);
  const payload = { audio_url: sample?.url || "", custom_voice_id: name, prompt: preview.trim() || copy.clone.previewPlaceholder, model: model.inputs.model?.default, need_noise_reduction: noise, need_volume_normalization: normalize };
  const run = async () => {
    if (!sample) return toast.error(copy.clone.needSample);
    if (!valid) return toast.error(copy.clone.badName);
    setWorking(true);
    try {
      const result = await generateAudio({ ...payload, _modelId: model.id });
      const voice = { id: name, name, family: "minimax", sampleUrl: sample.url, previewUrl: result?.url || null, timestamp: new Date().toISOString() };
      addVoice(voice);
      if (result?.url) {
        addEntry({ id: newId(), url: result.url, page: "speech", kind: "clone", title: fill(copy.clone.previewTitle, { name }), prompt: payload.prompt, text: payload.prompt, model: model.id, modelName: model.name, vendor: model.provider_name || "", voice: name, cost: null, timestamp: new Date().toISOString() });
      }
      toast.success(fill(copy.clone.done, { name }));
      onCloned(voice);
    } catch (error) {
      const message = fill(copy.clone.failed, { message: formatErrorMessage(error, "") });
      if (onGenerationError) onGenerationError(message);
      else toast.error(message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="oga-backdrop-in fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }} role="presentation" data-clone-dialog>
      <div className="oga-dialog-in w-full max-w-[520px] rounded-[18px] border border-white/[0.1] bg-[#0e0e11] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.6)]" role="dialog" aria-modal="true" aria-label={copy.clone.title}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold text-white">{copy.clone.title}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/50">{copy.clone.hint}</p>
          </div>
          <button type="button" onClick={onClose} disabled={working} aria-label={copy.buttons.close} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><IconX size={16} stroke={2} aria-hidden="true" /></button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">{copy.clone.sample}</div>
            {sample ? (
              <div className="flex items-center gap-3 rounded-[10px] border border-primary/30 bg-primary/[0.06] px-3 py-2">
                <IconFileMusic size={18} stroke={1.75} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{sample.name}</span>
                <button type="button" onClick={() => inputRef.current?.click()} className="text-[12px] text-white/60 hover:text-white">{copy.clone.replace}</button>
              </div>
            ) : (
              <button type="button" onClick={() => inputRef.current?.click()} disabled={Boolean(uploading)} className="flex h-[76px] w-full flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-white/20 text-white/60 hover:border-white/40 hover:text-white">
                {uploading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconUpload size={18} stroke={1.75} aria-hidden="true" />}
                <span className="text-[12.5px]">{copy.clone.upload}</span>
                <span className="text-[11px] text-white/35">{copy.clone.sampleHint}</span>
              </button>
            )}
            <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a" className="hidden" onChange={(event) => { if (event.target.files?.[0]) upload(event.target.files[0]); event.target.value = ""; }} />
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">{copy.clone.name}</span>
            <input value={name} onChange={(event) => setName(event.target.value.trim())} placeholder={copy.clone.namePlaceholder} spellCheck={false} className={`${INPUT_CLASS} font-mono`} data-clone-name />
            <span className={`mt-1 block text-[11px] ${name && !valid ? "text-amber-300/90" : "text-white/40"}`}>{copy.clone.nameHint}</span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">{copy.clone.preview}</span>
            <textarea value={preview} onChange={(event) => setPreview(event.target.value)} rows={2} className={SIDE_TEXTAREA_CLASS} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.08] px-3 py-2 text-[12.5px] text-white/75"><span>{copy.clone.noise}</span><Toggle on={noise} onChange={setNoise} label={copy.clone.noise} /></label>
            <label className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.08] px-3 py-2 text-[12.5px] text-white/75"><span>{copy.clone.normalize}</span><Toggle on={normalize} onChange={setNormalize} label={copy.clone.normalize} /></label>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <PriceChip locale={locale} endpoint={model.endpoint} enabled payload={payload} />
          <PromptAction onClick={run} disabled={working || !sample} data-clone-apply>
            {working && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#04202a]/30 border-t-[#04202a]" aria-hidden="true" />}
            {working ? copy.clone.working : copy.clone.apply}
          </PromptAction>
        </div>
      </div>
    </div>
  );
}

export default function AudioStudio({ page = "speech", onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled, locale = "en" }) {
  const copy = resolveCopy(en, zh, locale);
  const pageCopy = copy.pages[page] || copy.pages.speech;
  const tabId = `audio-${page}`;
  const PERSIST_KEY = `oga_audio_${page}_v1`;
  const library = useLibrary();
  const models = useMemo(() => audioModelsFor(page, audioModels), [page]);
  const cloneModel = useMemo(() => voiceCloneModel(audioModels), []);
  const categoryId = page === "speech" || page === "dialogue" ? "text-to-speech" : "music";

  const [modelId, setModelId] = useState(() => defaultModelId(categoryId, page === "music" ? models.filter((model) => !isSoundEffect(model)) : models) || models[0]?.id || "");
  const [options, setOptions] = useState({});
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [script, setScript] = useState(null);
  const [scene, setScene] = useState({ scene: "", sample_context: "" });
  const [extendAt, setExtendAt] = useState(0);
  const [source, setSource] = useState(null); // { url, name, fromId }
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [editingSpeaker, setEditingSpeaker] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [cloning, setCloning] = useState(null); // { source? } while the clone dialog is open
  const [uploading, setUploading] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [providerReady, setProviderReady] = useState(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const hasRestored = useRef(false);

  const selectedModel = models.find((model) => model.id === modelId) || models[0] || null;
  const layout = useMemo(() => layoutInputs(selectedModel), [selectedModel]);
  const shape = dialogueShape(selectedModel);
  const voiceField = voiceKey(selectedModel);
  const clonable = page === "speech" && cloneModel && acceptsClonedVoices(selectedModel);
  const instrumental = Boolean(options.is_instrumental || options.force_instrumental);
  const instrumentalKey = selectedModel?.inputs?.is_instrumental ? "is_instrumental" : selectedModel?.inputs?.force_instrumental ? "force_instrumental" : null;
  const wantsLyrics = Boolean(selectedModel?.inputs?.lyrics) && !instrumental;

  // Options and the script follow the model; what still applies is kept.
  useEffect(() => {
    if (!selectedModel) return;
    setOptions((previous) => carryOptions(previous, selectedModel));
    if (page === "dialogue") setScript((previous) => (previous ? carryScript(previous, selectedModel) : defaultScript(selectedModel)));
  }, [selectedModel, page]);

  useEffect(() => {
    const sync = () => setProviderReady(Boolean(selectedModel) && isEndpointAvailable(selectedModel.endpoint));
    sync();
    return subscribeProviderSettings(sync);
  }, [selectedModel]);

  const providersText = useMemo(() => {
    const ids = [...new Set(models.flatMap((model) => getRoutes(model.endpoint).map((route) => route.provider)))];
    const labels = ids.map((id) => getProvider(id)?.label || id);
    return labels.length <= 1 ? labels[0] || "" : `${labels.slice(0, -1).join(", ")} ${copy.providers.or} ${labels[labels.length - 1]}`;
  }, [models, copy.providers.or]);

  const openProviderSettings = (model = selectedModel) => {
    const providers = model ? [...new Set(getRoutes(model.endpoint).map((route) => route.provider))] : [];
    window.dispatchEvent(new CustomEvent("oga:provider-setup-needed", { detail: { providers } }));
  };

  // Per-page persistence (the library persists itself).
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      if (data) {
        if (models.some((model) => model.id === data.modelId)) setModelId(data.modelId);
        if (data.options && typeof data.options === "object") setOptions(data.options);
        if (typeof data.text === "string") setText(data.text);
        if (typeof data.prompt === "string") setPrompt(data.prompt);
        if (typeof data.lyrics === "string") setLyrics(data.lyrics);
        if (data.script?.cast && data.script?.lines) setScript(data.script);
        if (data.scene && typeof data.scene === "object") setScene({ scene: data.scene.scene || "", sample_context: data.scene.sample_context || "" });
        if (Number.isFinite(data.extendAt)) setExtendAt(data.extendAt);
        if (data.source && typeof data.source.url === "string") setSource(data.source);
      }
    } catch (error) {
      console.warn("[AudioStudio] could not restore state", error);
    } finally {
      hasRestored.current = true;
    }
  }, [PERSIST_KEY, models]);

  useEffect(() => {
    if (!hasRestored.current) return undefined;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ modelId, options, text, prompt, lyrics, script, scene, extendAt, source }));
      } catch (error) {
        console.warn("[AudioStudio] could not save state", error);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [PERSIST_KEY, modelId, options, text, prompt, lyrics, script, scene, extendAt, source]);

  // A track sent to Remix from another page.
  useEffect(() => {
    if (page !== "remix" || !library.handoffs.remix) return;
    const handoff = takeHandoff("remix");
    if (!handoff?.source) return;
    setSource(handoff.source);
    setOpenDropdown(null);
    setViewer(null);
  }, [library.handoffs, page]);

  // The Benchmarks page opens a page with a model preselected.
  useEffect(() => {
    const preselect = (event) => {
      const { tabId: wantedTab, modelId: wanted } = event.detail || {};
      if (wantedTab !== tabId || !wanted) return;
      if (models.some((model) => model.id === wanted)) setModelId(wanted);
    };
    window.addEventListener("oga:open-studio", preselect);
    return () => window.removeEventListener("oga:open-studio", preselect);
  }, [tabId, models]);

  useEditorsPickPreselect({
    page: tabId,
    read: () => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null")?.modelId || null; } catch { saved = null; }
      return { categoryId, modelIds: models.map((model) => model.id), savedModelId: saved };
    },
    apply: (wanted) => setModelId(wanted),
  });

  // The viewer closing stops playback; so does leaving the page.
  useEffect(() => { if (!viewer) stopAllAudio(); }, [viewer]);

  const uploadSource = useCallback(async (file, { send = false } = {}) => {
    if (!isAudioFile(file)) return toast.error(copy.errors.notAudio);
    if (file.size > MAX_UPLOAD_BYTES) return toast.error(copy.errors.tooLarge);
    setUploading({ progress: 0 });
    try {
      const url = await uploadFile(file, (progress) => setUploading({ progress }));
      const next = { url, name: file.name, fromId: null };
      if (send) sendToAudio("remix", { source: next });
      else setSource(next);
    } catch (error) {
      toast.error(fill(copy.errors.uploadFailed, { message: formatErrorMessage(error, "") }));
    } finally {
      setUploading(null);
    }
    return undefined;
  }, [copy]);

  useEffect(() => {
    if (!droppedFiles?.length) return;
    const audio = droppedFiles.filter(isAudioFile);
    if (audio.length === 0) toast.error(copy.errors.notAudio);
    else if (page === "remix") uploadSource(audio[0]);
    else uploadSource(audio[0], { send: true });
    onFilesHandled?.();
  }, [droppedFiles, onFilesHandled, page, uploadSource, copy]);

  const report = (error) => {
    console.error("[AudioStudio]", error);
    const message = formatErrorMessage(error, copy.errors.generationFailed);
    if (onGenerationError) onGenerationError(message);
    else toast.error(message);
  };

  // One run: the request goes out, the result is filed with its expected cost.
  const run = async ({ payload, meta, promptText }) => {
    const runId = newId();
    addPending({ id: runId, label: selectedModel.name, prompt: promptText });
    onGenerationStart?.();
    const costQuote = quoteRun(selectedModel.endpoint, payload)
      .then((quote) => {
        if (quote?.kind === "free") return { amount: 0 };
        if (typeof quote?.amount !== "number") return null;
        return { amount: Math.round(quote.amount * 10000) / 10000, currency: quote.currency || "USD" };
      })
      .catch(() => null);
    try {
      const result = await generateAudio({ ...payload, _modelId: selectedModel.id });
      const url = result?.url || result?.audio?.url || result?.audio_url || null;
      if (!url) throw new Error(copy.errors.noOutput);
      const entry = { id: newId(), url, remoteUrl: result.remoteUrl || null, page, ...meta, model: selectedModel.id, modelName: selectedModel.name, vendor: selectedModel.provider_name || "", cost: await costQuote, duration: Number.isFinite(result?.duration) ? result.duration : null, timestamp: new Date().toISOString() };
      addEntry(entry);
      onGenerationComplete?.({ url, model: selectedModel.id, prompt: promptText, type: "audio" });
      return entry;
    } catch (error) {
      report(error);
      return null;
    } finally {
      removePending(runId);
      onGenerationEnd?.();
    }
  };

  const missingMessage = { model: copy.errors.generationFailed, text: copy.errors.needText, script: copy.errors.needScript, prompt: copy.errors.needPrompt, lyrics: copy.errors.needLyrics, source: copy.errors.needSource };

  const handleGenerate = async () => {
    if (!selectedModel) return;
    if (!providerReady) return openProviderSettings();
    const missing = missingInput(page, { model: selectedModel, text, script, prompt, lyrics, sourceUrl: source?.url || null, options });
    if (missing) {
      if (["text", "prompt"].includes(missing)) textareaRef.current?.focus();
      return toast.error(missingMessage[missing]);
    }
    if (page === "speech") {
      const voice = voiceField ? options[voiceField] : null;
      return run({ payload: speechPayload(selectedModel, text.trim(), options), meta: { kind: "speech", title: "", prompt: text.trim(), text: text.trim(), voice: voice || null }, promptText: text.trim() });
    }
    if (page === "dialogue") {
      const payload = dialoguePayload(selectedModel, script, { ...options, ...(shape === "cast" ? Object.fromEntries(Object.entries(scene).filter(([, value]) => value.trim())) : {}) });
      const summary = scriptText(script);
      return run({ payload, meta: { kind: "dialogue", title: "", prompt: summary, text: summary, voice: null, speakers: script.cast.filter((member) => script.lines.some((line) => line.speaker === member.id && line.text.trim())).map((member) => member.name) }, promptText: summary });
    }
    if (page === "music") {
      const payload = musicPayload(selectedModel, { prompt, lyrics }, options);
      return run({ payload, meta: { kind: isSoundEffect(selectedModel) ? "sfx" : "music", title: "", prompt: prompt.trim(), lyrics: payload.lyrics || "", voice: null }, promptText: prompt.trim() || lyrics.trim() });
    }
    const payload = remixPayload(selectedModel, { sourceUrl: source.url, prompt, lyrics, extendAtSeconds: extendAt }, options);
    return run({ payload, meta: { kind: selectedModel.inputs?.extend_at ? "extend" : "remix", title: "", prompt: prompt.trim() || lyrics.trim(), lyrics: payload.lyrics || "", voice: null, sourceUrl: source.url, sourceName: source.name || "", sourceId: source.fromId || null }, promptText: prompt.trim() || lyrics.trim() || source.name || "" });
  };

  // Library actions
  const sendToRemix = (entry) => {
    const next = { url: entry.url, name: entryTitle(entry, entry.modelName) || "track", fromId: entry.id };
    setViewer(null);
    setOpenDropdown(null);
    if (page === "remix") setSource(next);
    else sendToAudio("remix", { source: next });
  };
  const download = async (entry) => {
    try {
      const blob = await fetchMediaBlob(entry.url);
      const extension = blob.type.includes("wav") ? "wav" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("flac") ? "flac" : "mp3";
      const name = `${slug(entryTitle(entry, entry.modelName)) || "audio"}-${String(entry.id).slice(-6)}.${extension}`;
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (error) {
      toast.error(fill(copy.errors.downloadFailed, { message: formatErrorMessage(error, "") }));
    }
  };
  const deleteEntry = (id) => {
    if (!confirm(copy.confirm.deleteItem)) return;
    removeEntry(id);
    if (viewer?.id === id) setViewer(null);
  };
  const forgetVoice = (voice) => {
    if (!confirm(copy.confirm.deleteVoice)) return;
    removeVoice(voice.id);
    if (voiceField && options[voiceField] === voice.id) setOption(voiceField, selectedModel.inputs[voiceField].default);
  };

  const hasGallery = library.entries.length > 0 || library.pending.length > 0;
  const starters = (pageCopy.starters || []).map((starter) => ({ label: starter.label, prompt: starter.prompt }));
  const onStarter = (value) => {
    if (page === "speech") setText(value);
    else if (page === "dialogue") setScript(parseScript(value, selectedModel));
    else setPrompt(value);
    textareaRef.current?.focus();
  };

  // Controls
  const setOption = (key, value) => setOptions((previous) => ({ ...previous, [key]: value }));
  const toggle = (id) => setOpenDropdown(openDropdown === id ? null : id);
  const voices = useMemo(() => (voiceField && selectedModel ? enumOptions(selectedModel.inputs[voiceField]) : []), [selectedModel, voiceField]);
  const cloned = clonable ? library.voices.filter((voice) => voice.family === "minimax") : [];
  const voiceLabel = voiceField ? (cloned.find((voice) => voice.id === options[voiceField])?.name || optionLabel(selectedModel.inputs[voiceField], options[voiceField] ?? selectedModel.inputs[voiceField].default)) : "";

  const pricePayload = useMemo(() => {
    if (!selectedModel) return {};
    if (page === "speech") return speechPayload(selectedModel, padForPricing(text.trim()), options);
    if (page === "dialogue") return dialoguePayload(selectedModel, script, options);
    if (page === "music") return musicPayload(selectedModel, { prompt, lyrics }, options);
    return remixPayload(selectedModel, { sourceUrl: source?.url || "", prompt, lyrics, extendAtSeconds: extendAt }, options);
  }, [selectedModel, page, text, script, prompt, lyrics, options, source, extendAt]);
  const pickerPayload = (model) => {
    const carried = carryOptions(options, model);
    if (page === "speech") return speechPayload(model, padForPricing(text.trim()), carried);
    if (page === "dialogue") return dialoguePayload(model, carryScript(script, model), carried);
    if (page === "music") return musicPayload(model, { prompt, lyrics }, carried);
    return remixPayload(model, { sourceUrl: source?.url || "", prompt, lyrics, extendAtSeconds: extendAt }, carried);
  };
  const pickerGroups = useMemo(() => {
    if (page === "music") {
      return [
        { id: "music", label: copy.picker.musicSection, railLabel: copy.picker.musicRail, tone: "cyan", mono: "MU", models: models.filter((model) => !isSoundEffect(model)) },
        { id: "sfx", label: copy.picker.sfxSection, railLabel: copy.picker.sfxRail, tone: "violet", mono: "FX", models: models.filter(isSoundEffect) },
      ].filter((group) => group.models.length > 0);
    }
    const key = page === "speech" ? "speech" : page === "dialogue" ? "dialogue" : "remix";
    return [{ id: key, label: copy.picker[`${key}Section`], railLabel: copy.picker[`${key}Rail`], tone: "cyan", mono: key.slice(0, 2).toUpperCase(), models }];
  }, [page, models, copy.picker]);

  const actionLabel = page === "speech" ? copy.buttons.speak : page === "dialogue" ? copy.buttons.read : page === "remix" ? copy.remix.sendHere : copy.buttons.generate;
  const submitOnEnter = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleGenerate();
    }
  };

  // One footer control per primary input: a menu for short enums, a
  // searchable list for long ones, a slider popover for numbers, a toggle
  // for booleans. The voice has its own control with the cloned voices.
  const control = ({ key, input, kind }) => {
    if (key === voiceField || key === instrumentalKey) return null;
    const value = options[key] ?? input.default;
    if (kind === "enum") {
      const list = enumOptions(input);
      return (
        <div key={key} className="relative">
          <button type="button" onClick={() => toggle(key)} className={promptControlClassName({ active: openDropdown === key })} title={input.description || input.title} data-audio-control={key}>
            <span className="text-[11px] text-white/40">{input.title}</span>
            <span className={PROMPT_CONTROL_LABEL_CLASS}>{optionLabel(input, value)}</span>
            <PromptChevronIcon />
          </button>
          {openDropdown === key && (list.length >= SEARCHABLE_FROM ? (
            <SearchList title={input.title} options={list} value={value} onSelect={(next) => { setOption(key, next); setOpenDropdown(null); }} searchPlaceholder={copy.controls.voiceSearch} emptyLabel={copy.controls.noVoices} className="w-[300px]" />
          ) : (
            <PromptPopover>
              <PromptPopoverHeader>{input.title}</PromptPopoverHeader>
              <PromptMenuList>
                {list.map((option) => <PromptMenuItem key={String(option.value)} selected={value === option.value} onClick={() => { setOption(key, option.value); setOpenDropdown(null); }}>{option.label}</PromptMenuItem>)}
              </PromptMenuList>
            </PromptPopover>
          ))}
        </div>
      );
    }
    if (kind === "number") {
      const range = numericRange(input);
      const shown = key === "music_length_ms" ? fill(copy.controls.seconds, { count: Math.round((value ?? 0) / 1000) }) : key === "duration" ? fill(copy.controls.seconds, { count: value ?? 0 }) : String(value ?? "");
      return (
        <div key={key} className="relative">
          <button type="button" onClick={() => toggle(key)} className={promptControlClassName({ active: openDropdown === key })} title={input.description || input.title} data-audio-control={key}>
            <span className="text-[11px] text-white/40">{input.title}</span>
            <span className={`${PROMPT_CONTROL_LABEL_CLASS} tabular-nums`}>{shown}</span>
            <PromptChevronIcon />
          </button>
          {openDropdown === key && (
            <PromptPopover className="w-[260px]">
              <PromptPopoverHeader>{input.title}</PromptPopoverHeader>
              <div className="px-2 pb-1">
                <div className="mb-2 flex items-center justify-between text-[12px] text-white/70"><span>{input.description ? "" : input.title}</span><span className="tabular-nums text-white">{shown}</span></div>
                <input type="range" min={range.min} max={range.max} step={range.step} value={value ?? range.min} onChange={(event) => setOption(key, Number(event.target.value))} className="w-full accent-[#22d3ee]" aria-label={input.title} />
                {input.description && <p className="mt-2 text-[11px] leading-relaxed text-white/40">{input.description}</p>}
              </div>
            </PromptPopover>
          )}
        </div>
      );
    }
    if (kind === "boolean") {
      return (
        <button key={key} type="button" onClick={() => setOption(key, !value)} aria-pressed={Boolean(value)} className={promptControlClassName({ active: Boolean(value) })} title={input.description || input.title} data-audio-control={key}>
          <span className={PROMPT_CONTROL_LABEL_CLASS}>{input.title}</span>
        </button>
      );
    }
    return null;
  };

  const advancedField = ({ key, input, kind }) => {
    const value = options[key] ?? input.default;
    if (kind === "enum") {
      return (
        <label key={key} className="flex flex-col gap-1 text-[12px] text-white/70" title={input.description || ""}>
          <span>{input.title}</span>
          <select value={value ?? ""} onChange={(event) => { const raw = event.target.value; const option = enumOptions(input).find((item) => String(item.value) === raw); setOption(key, option ? option.value : raw); }} className={SELECT_CLASS} style={CHEVRON_STYLE}>
            {enumOptions(input).map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
          </select>
        </label>
      );
    }
    if (kind === "number") {
      const range = numericRange(input);
      return (
        <label key={key} className="flex flex-col gap-1 text-[12px] text-white/70" title={input.description || ""}>
          <span className="flex items-center justify-between"><span>{input.title}</span><span className="tabular-nums text-white/45">{value ?? ""}</span></span>
          <input type="range" min={range.min} max={range.max} step={range.step} value={value ?? range.min} onChange={(event) => setOption(key, Number(event.target.value))} className="w-full accent-[#22d3ee]" />
        </label>
      );
    }
    if (kind === "boolean") {
      return (
        <label key={key} className="flex items-center justify-between gap-3 text-[12px] text-white/70" title={input.description || ""}>
          <span>{input.title}</span>
          <Toggle on={Boolean(value)} onChange={(next) => setOption(key, next)} label={input.title} />
        </label>
      );
    }
    return (
      <label key={key} className="flex flex-col gap-1 text-[12px] text-white/70" title={input.description || ""}>
        <span>{input.title}</span>
        <input value={value ?? ""} onChange={(event) => setOption(key, event.target.value)} className={INPUT_CLASS} />
      </label>
    );
  };
  const advancedCount = layout.advanced.length + (shape === "cast" ? 2 : 0);

  // Dialogue: the cast and the lines.
  const updateScript = (updater) => setScript((previous) => updater(previous || defaultScript(selectedModel)));
  const castVoices = useMemo(() => (page === "dialogue" ? dialogueVoices(selectedModel) : []), [page, selectedModel]);
  const addSpeaker = () => updateScript((previous) => {
    if (previous.cast.length >= MAX_SPEAKERS) return previous;
    const index = previous.cast.length;
    const id = `Speaker ${index + 1}`;
    return { ...previous, cast: [...previous.cast, { id, name: id, voice: castVoices[index % Math.max(1, castVoices.length)]?.value ?? "", profile: "" }] };
  });
  const updateSpeaker = (id, patch) => updateScript((previous) => ({ ...previous, cast: previous.cast.map((member) => (member.id === id ? { ...member, ...patch } : member)) }));
  const removeSpeaker = (id) => updateScript((previous) => {
    if (previous.cast.length <= 1) return previous;
    const cast = previous.cast.filter((member) => member.id !== id);
    return { cast, lines: previous.lines.map((line) => (line.speaker === id ? { ...line, speaker: cast[0].id } : line)) };
  });
  const addLine = () => updateScript((previous) => {
    if (previous.lines.length >= MAX_LINES) return previous;
    const last = previous.lines[previous.lines.length - 1];
    const next = previous.cast[(previous.cast.findIndex((member) => member.id === last?.speaker) + 1) % previous.cast.length]?.id || previous.cast[0].id;
    return { ...previous, lines: [...previous.lines, { speaker: next, text: "" }] };
  });
  const updateLine = (index, patch) => updateScript((previous) => ({ ...previous, lines: previous.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
  const removeLine = (index) => updateScript((previous) => ({ ...previous, lines: previous.lines.length > 1 ? previous.lines.filter((_, i) => i !== index) : [{ speaker: previous.cast[0].id, text: "" }] }));

  const scriptEditor = page === "dialogue" && script && (
    <div className="flex flex-col gap-2.5 px-1" data-audio-script>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">{copy.script.cast}</span>
        {script.cast.map((member) => (
          <div key={member.id} className="relative">
            <button type="button" onClick={() => setEditingSpeaker(editingSpeaker === member.id ? null : member.id)} className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors ${editingSpeaker === member.id ? "border-primary/50 bg-primary/[0.08] text-white" : "border-white/[0.1] bg-white/[0.03] text-white/80 hover:border-white/25 hover:text-white"}`} data-audio-speaker={member.id}>
              <span className="font-medium">{member.name}</span>
              <span className="text-white/40">· {castVoices.find((voice) => voice.value === member.voice)?.label.split(/\s[—-]\s/)[0] || member.voice}</span>
              <PromptChevronIcon />
            </button>
            {editingSpeaker === member.id && (
              <PromptPopover className="w-[300px]" positionClassName="absolute left-0 top-full mt-2 z-50" fitViewport solid>
                <div className="flex flex-col gap-3 p-1">
                  <label className="flex flex-col gap-1 text-[12px] text-white/70">
                    <span>{copy.script.speakerName}</span>
                    <input value={member.name} onChange={(event) => updateSpeaker(member.id, { name: event.target.value })} placeholder={copy.script.speakerNamePlaceholder} className={INPUT_CLASS} autoFocus />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] text-white/70">
                    <span>{copy.script.voice}</span>
                    <select value={member.voice} onChange={(event) => updateSpeaker(member.id, { voice: event.target.value })} className={SELECT_CLASS} style={CHEVRON_STYLE}>
                      {castVoices.map((voice) => <option key={String(voice.value)} value={voice.value}>{voice.label}</option>)}
                    </select>
                  </label>
                  {shape === "cast" && (
                    <label className="flex flex-col gap-1 text-[12px] text-white/70">
                      <span>{copy.script.profile}</span>
                      <input value={member.profile} onChange={(event) => updateSpeaker(member.id, { profile: event.target.value })} placeholder={copy.script.profilePlaceholder} className={INPUT_CLASS} />
                      <span className="text-[11px] text-white/40">{copy.script.profileHint}</span>
                    </label>
                  )}
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => { removeSpeaker(member.id); setEditingSpeaker(null); }} disabled={script.cast.length <= 1} className="text-[12px] text-red-300/80 hover:text-red-300 disabled:opacity-40">{copy.script.removeSpeaker}</button>
                    <button type="button" onClick={() => setEditingSpeaker(null)} className={SMALL_BUTTON_CLASS}>{copy.buttons.close}</button>
                  </div>
                </div>
              </PromptPopover>
            )}
          </div>
        ))}
        {script.cast.length < MAX_SPEAKERS && (
          <button type="button" onClick={addSpeaker} className="flex h-8 items-center gap-1 rounded-full border border-dashed border-white/20 px-3 text-[12px] text-white/60 hover:border-white/40 hover:text-white" data-audio-add-speaker>
            <IconUserPlus size={14} stroke={1.75} aria-hidden="true" />{copy.script.addSpeaker}
          </button>
        )}
      </div>
      <div className="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto custom-scrollbar pr-1 md:max-h-[300px]">
        {script.lines.map((line, index) => (
          <div key={index} className="flex items-start gap-2" data-audio-line={index}>
            <select value={line.speaker} onChange={(event) => updateLine(index, { speaker: event.target.value })} aria-label={copy.script.cast} className={SMALL_SELECT_CLASS} style={SMALL_CHEVRON_STYLE}>
              {script.cast.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
            <PromptTextarea ref={index === 0 ? textareaRef : undefined} value={line.text} onChange={(event) => updateLine(index, { text: event.target.value })} onKeyDown={submitOnEnter} placeholder={pageCopy.placeholder} className="min-h-[32px] pt-1.5 text-[14px]" maxHeightDesktop={120} maxHeightMobile={90} />
            <button type="button" onClick={() => removeLine(index)} aria-label={copy.script.removeLine} title={copy.script.removeLine} className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 hover:bg-white/10 hover:text-white"><IconX size={14} stroke={2} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={addLine} disabled={script.lines.length >= MAX_LINES} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-white/60 hover:bg-white/[0.06] hover:text-white disabled:opacity-40" data-audio-add-line>
          <IconPlus size={14} stroke={2} aria-hidden="true" />{copy.script.addLine}
        </button>
        <span className="text-[11px] tabular-nums text-white/35">{fill(copy.script.lines, { count: script.lines.filter((line) => line.text.trim()).length, characters: number(scriptCharacters(script), locale) })}</span>
      </div>
    </div>
  );

  // Remix: the source chip, like Vectorize's image chip.
  const sourceChip = page === "remix" && (
    source ? (
      <div className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.08] pl-3 pr-3" data-audio-source>
        <IconFileMusic size={16} stroke={1.75} className="text-primary" aria-hidden="true" />
        <span className="max-w-[200px] truncate text-[12.5px] text-white/85">{source.name}</span>
        <button type="button" onClick={() => setSource(null)} aria-label={copy.remix.clear} className="text-white/40 hover:text-white"><IconX size={14} stroke={2} aria-hidden="true" /></button>
      </div>
    ) : (
      <div className="relative flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(uploading)} className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-dashed border-white/20 px-3.5 text-[12.5px] text-white/60 hover:border-white/40 hover:text-white" data-audio-upload>
          {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" /> : <IconUpload size={15} stroke={1.75} aria-hidden="true" />}
          {copy.remix.upload}
        </button>
        <button type="button" onClick={() => toggle("tracks")} className={promptControlClassName({ active: openDropdown === "tracks", compact: true })} title={copy.remix.fromLibrary}>
          <span className={PROMPT_CONTROL_LABEL_CLASS}>{copy.remix.fromLibrary}</span>
          <PromptChevronIcon />
        </button>
        {openDropdown === "tracks" && (
          <SearchList
            title={copy.remix.libraryTitle}
            options={library.entries.filter((entry) => entry.kind !== "clone").map((entry) => ({ value: entry.id, label: entryTitle(entry, entry.modelName) || copy.gallery.untitled, description: [copy.gallery.kinds[entry.kind] || copy.gallery.kinds.legacy, entry.modelName, formatDuration(entry.duration)].filter(Boolean).join(" · ") }))}
            value={null}
            onSelect={(id) => { const entry = library.entries.find((item) => item.id === id); if (entry) setSource({ url: entry.url, name: entryTitle(entry, entry.modelName) || "track", fromId: entry.id }); setOpenDropdown(null); }}
            searchPlaceholder={copy.controls.voiceSearch}
            emptyLabel={copy.remix.libraryEmpty}
            className="w-[340px]"
          />
        )}
      </div>
    )
  );

  const body = (
    <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-start">
      {sourceChip}
      {page === "speech" && <PromptTextarea ref={textareaRef} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={submitOnEnter} placeholder={pageCopy.placeholder} data-audio-text />}
      {page === "dialogue" && <div className="min-w-0 flex-1">{scriptEditor}</div>}
      {page === "music" && (
        <>
          <PromptTextarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={submitOnEnter} placeholder={pageCopy.placeholder} className="flex-1" data-audio-prompt />
          {wantsLyrics && (
            <div className="flex w-full flex-col gap-1 sm:w-[300px]">
              <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} onKeyDown={submitOnEnter} placeholder={pageCopy.lyricsPlaceholder} rows={4} aria-label={copy.controls.lyrics} className={`max-h-[220px] min-h-[96px] ${SIDE_TEXTAREA_CLASS}`} data-audio-lyrics />
              <span className="px-1 text-[11.5px] text-white/45">{copy.controls.lyrics} · {fill(copy.controls.characters, { count: number(lyrics.length, locale) })}</span>
            </div>
          )}
        </>
      )}
      {page === "remix" && (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {selectedModel?.inputs?.prompt && <PromptTextarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={submitOnEnter} placeholder={source ? pageCopy.placeholder : fill(copy.remix.readyHint, { model: selectedModel?.name || "" })} data-audio-prompt />}
          {selectedModel?.inputs?.lyrics && <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} onKeyDown={submitOnEnter} placeholder={pageCopy.lyricsPlaceholder} rows={3} aria-label={copy.controls.lyrics} className={`max-h-[200px] min-h-[76px] ${SIDE_TEXTAREA_CLASS}`} data-audio-lyrics />}
          {!selectedModel?.inputs?.prompt && !selectedModel?.inputs?.lyrics && <p className="px-1.5 pt-2.5 text-[13.5px] text-white/40">{fill(copy.remix.readyHint, { model: selectedModel?.name || "" })}</p>}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" className="hidden" onChange={(event) => { if (event.target.files?.[0]) uploadSource(event.target.files[0]); event.target.value = ""; }} />
    </div>
  );

  // The same tools on a card's hover column ("sm") and the viewer's rail ("lg").
  const entryActions = (entry, size = "sm") => {
    const iconSize = size === "lg" ? 18 : 15;
    const textOf = entry.text || entry.lyrics || entry.prompt;
    return [
      textOf ? { key: "copy", node: <GenerationCopyButtons prompt={textOf} imageUrl={null} onCopyError={onGenerationError} size={size} /> } : null,
      entry.kind !== "clone" ? { key: "remix", label: copy.remix.sendHere, icon: <IconArrowsExchange size={iconSize} stroke={2} aria-hidden="true" />, onSelect: () => sendToRemix(entry) } : null,
      { key: "download", label: copy.buttons.download, icon: <IconDownload size={iconSize} stroke={2} aria-hidden="true" />, onSelect: () => download(entry) },
      { key: "delete", label: copy.buttons.delete, danger: true, icon: <IconTrash size={iconSize} stroke={2} aria-hidden="true" />, onSelect: () => deleteEntry(entry.id) },
    ];
  };
  const kindLabel = (entry) => copy.gallery.kinds[entry.kind] || copy.gallery.kinds.legacy;
  const entryFacts = (entry) => [
    { key: "vendor", value: entry.vendor, title: copy.gallery.vendor },
    { key: "voice", value: entry.voice ? (library.voices.find((voice) => voice.id === entry.voice)?.name || (entry.model ? optionLabel(audioModels.find((model) => model.id === entry.model)?.inputs?.[voiceKey(audioModels.find((model) => model.id === entry.model))] || {}, entry.voice) : entry.voice)) : entry.speakers?.length ? entry.speakers.join(", ") : null, title: copy.gallery.voice },
    { key: "duration", value: formatDuration(entry.duration), title: copy.gallery.duration },
    { key: "cost", value: formatCost(entry.cost, locale), title: copy.gallery.cost },
  ];
  const whenFact = (entry) => ({ value: formatWhen(entry.timestamp, locale), title: copy.gallery.created });
  const onDurationFor = (entry) => (duration) => { if (!entry.duration || Math.abs(entry.duration - duration) > 0.5) updateEntry(entry.id, { duration }); };

  const card = (entry, index) => (
    <Entrance once variant="card" index={index} key={entry.id} data-audio-entry={entry.kind} className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0a] shadow-xl transition-all duration-300 hover:border-primary/50" onClick={() => setViewer(entry)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setViewer(entry); }}>
      <div className="relative bg-[radial-gradient(120%_120%_at_0%_0%,rgba(34,211,238,0.10),transparent_55%)] px-3.5 pb-3 pt-3">
        <div className="mb-2.5 flex items-center gap-2 pr-10 text-[10.5px]">
          <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-semibold uppercase tracking-wide text-white/70">{kindLabel(entry)}</span>
          {entry.sourceName && <span className="truncate text-white/40" title={fill(copy.gallery.source, { name: entry.sourceName })}>{fill(copy.gallery.source, { name: entry.sourceName })}</span>}
        </div>
        <AudioPlayer url={entry.url} size="strip" onDuration={onDurationFor(entry)} labels={{ play: copy.buttons.play, pause: copy.buttons.pause }} />
      </div>
      <LibraryActions actions={entryActions(entry, "sm")} />
      <LibraryDetails prompt={entryTitle(entry, "")} fallback={copy.gallery.untitled} model={entry.modelName || entry.model} facts={entryFacts(entry)} trailing={whenFact(entry)} />
    </Entrance>
  );

  const dropHandlers = page === "remix" ? {
    onDragOver: (event) => { event.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); if (event.dataTransfer.files?.[0]) uploadSource(event.dataTransfer.files[0]); },
  } : {};

  return (
    <div className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-app-bg ${dragging ? "ring-2 ring-inset ring-primary/60" : ""}`} {...dropHandlers} data-audio-page={page}>
      <Toaster position="top-center" toastOptions={{ style: { background: "#111114", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: "13px" } }} />

      {providerReady === false && (
        <div className="absolute left-1/2 top-4 z-40 flex w-[min(640px,calc(100%-32px))] -translate-x-1/2 items-center justify-between gap-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-100">
          <span>{fill(copy.providers.needKey, { providers: providersText })}</span>
          <button type="button" onClick={() => openProviderSettings()} className="shrink-0 rounded-lg bg-amber-300 px-3 py-1.5 text-[12px] font-semibold text-black">{copy.providers.openSettings}</button>
        </div>
      )}

      <div className="w-full flex-1 overflow-y-auto px-4 pb-72 pt-4 custom-scrollbar md:px-8">
        {hasGallery ? (
          <div className="mx-auto max-w-6xl pt-12">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/40">{fill(copy.gallery.library, { count: library.entries.length })}</div>
            </div>
            <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {library.pending.map((pending) => (
                <Entrance once variant="card" key={pending.id} className="flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-lg border border-white/10 bg-[#0a0a0a] p-6 text-center">
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
                  <div className="text-[14px] font-medium text-white/85">{fill(copy.gallery.pendingTitle, { model: pending.label })}</div>
                  <div className="text-[12px] text-white/45">{copy.gallery.pendingHint}</div>
                </Entrance>
              ))}
              {library.entries.map((entry, index) => card(entry, index))}
            </div>
          </div>
        ) : (
          <div className="h-full w-full">
            <StudioEmptyState heading={pageCopy.heading} accent={pageCopy.accent} subtitle={pageCopy.subtitle} starters={starters} onStarter={onStarter} showcase={null} />
          </div>
        )}
      </div>

      {viewer && (
        <Lightbox onClose={() => setViewer(null)} closeLabel={copy.buttons.close} tools={entryActions(viewer, "lg")} caption={<span>{[viewer.modelName, kindLabel(viewer), formatDuration(viewer.duration), formatCost(viewer.cost, locale), formatWhen(viewer.timestamp, locale)].filter(Boolean).join(" · ")}</span>}>
          <div className="flex w-[min(92vw,760px)] flex-col gap-5 rounded-2xl border border-white/[0.08] bg-[#0e0e11] p-6 shadow-2xl md:p-8" data-audio-viewer>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 font-semibold uppercase tracking-wide text-white/70">{kindLabel(viewer)}</span>
              {viewer.sourceName && <span className="truncate text-white/40">{fill(copy.gallery.source, { name: viewer.sourceName })}</span>}
            </div>
            <AudioPlayer url={viewer.url} size="full" onDuration={onDurationFor(viewer)} labels={{ play: copy.buttons.play, pause: copy.buttons.pause }} />
            {(viewer.text || viewer.lyrics || viewer.prompt) && (
              <div className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/30 px-4 py-3 text-[13.5px] leading-relaxed text-white/80 custom-scrollbar">
                {viewer.text || viewer.lyrics || viewer.prompt}
                {viewer.lyrics && viewer.prompt && viewer.prompt !== viewer.lyrics && <div className="mt-3 border-t border-white/[0.06] pt-3 text-[12.5px] text-white/50">{viewer.prompt}</div>}
              </div>
            )}
          </div>
        </Lightbox>
      )}

      {cloning && cloneModel && (
        <CloneVoiceDialog model={cloneModel} locale={locale} copy={copy} preset={cloning} onClose={() => setCloning(null)} onGenerationError={onGenerationError} onCloned={(voice) => { if (voiceField) setOption(voiceField, voice.id); setCloning(null); }} />
      )}

      <PromptComposer>
        {body}

        {showAdvanced && (layout.advanced.length > 0 || shape === "cast") && (
          <div className="grid grid-cols-1 gap-3 border-t border-white/[0.08] px-1 pt-3 sm:grid-cols-2 lg:grid-cols-3" data-audio-advanced>
            {shape === "cast" && (
              <>
                <label className="flex flex-col gap-1 text-[12px] text-white/70"><span>{copy.script.scene}</span><input value={scene.scene} onChange={(event) => setScene((previous) => ({ ...previous, scene: event.target.value }))} placeholder={copy.script.scenePlaceholder} className={INPUT_CLASS} /></label>
                <label className="flex flex-col gap-1 text-[12px] text-white/70"><span>{copy.script.tone}</span><input value={scene.sample_context} onChange={(event) => setScene((previous) => ({ ...previous, sample_context: event.target.value }))} placeholder={copy.script.tonePlaceholder} className={INPUT_CLASS} /></label>
              </>
            )}
            {layout.advanced.map(advancedField)}
          </div>
        )}

        <PromptFooter>
          <PromptControls>
            {models.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => toggle("model")} className={promptControlClassName({ active: openDropdown === "model" })} data-audio-control="model">
                  <span className="text-[11px] text-white/40">{copy.controls.model}</span>
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{selectedModel?.name}</span>
                  <PromptChevronIcon />
                </button>
                <ModelRailPicker
                  open={openDropdown === "model"}
                  onClose={() => setOpenDropdown(null)}
                  groups={pickerGroups}
                  selectedId={selectedModel?.id}
                  onSelect={(model) => setModelId(model.id)}
                  pricePayload={pickerPayload}
                  benchmarksCategory={categoryId}
                  locale={locale}
                />
              </div>
            )}

            {voiceField && selectedModel && (
              <div className="relative">
                <button type="button" onClick={() => toggle("voice")} className={promptControlClassName({ active: openDropdown === "voice" })} title={selectedModel.inputs[voiceField].description || copy.controls.voice} data-audio-control="voice">
                  <IconMicrophone size={14} stroke={1.75} aria-hidden="true" />
                  <span className={PROMPT_CONTROL_LABEL_CLASS}>{voiceLabel}</span>
                  <PromptChevronIcon />
                </button>
                {openDropdown === "voice" && (
                  <SearchList
                    title={copy.controls.voice}
                    options={voices}
                    value={options[voiceField] ?? selectedModel.inputs[voiceField].default}
                    onSelect={(value) => { setOption(voiceField, value); setOpenDropdown(null); }}
                    searchPlaceholder={copy.controls.voiceSearch}
                    emptyLabel={copy.controls.noVoices}
                    head={clonable ? (
                      <div className="mb-1 border-b border-white/[0.08] pb-1">
                        {cloned.length > 0 && <div className="px-2.5 pb-1 pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white/40">{copy.controls.clonedVoices}</div>}
                        {cloned.map((voice) => (
                          <div key={voice.id} className="flex items-center">
                            <PromptMenuItem selected={options[voiceField] === voice.id} onClick={() => { setOption(voiceField, voice.id); setOpenDropdown(null); }} className="flex-1">{voice.name}</PromptMenuItem>
                            <button type="button" onClick={() => forgetVoice(voice)} aria-label={copy.controls.removeVoice} title={copy.controls.removeVoice} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 hover:bg-white/10 hover:text-red-300"><IconTrash size={13} stroke={2} aria-hidden="true" /></button>
                          </div>
                        ))}
                        <PromptMenuItem onClick={() => { setOpenDropdown(null); setCloning({}); }} className="text-primary hover:text-primary" data-audio-clone>
                          <span className="flex items-center gap-2"><IconUserPlus size={14} stroke={2} aria-hidden="true" />{copy.controls.cloneVoice}</span>
                        </PromptMenuItem>
                      </div>
                    ) : null}
                  />
                )}
              </div>
            )}

            {instrumentalKey && (
              <button type="button" onClick={() => setOption(instrumentalKey, !instrumental)} aria-pressed={instrumental} className={promptControlClassName({ active: instrumental })} title={selectedModel.inputs[instrumentalKey].description || ""} data-audio-control="instrumental">
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{instrumental ? copy.controls.instrumental : copy.controls.withVocals}</span>
              </button>
            )}

            {page === "remix" && selectedModel?.inputs?.extend_at && (
              <label className={promptControlClassName({ active: false })} title={copy.controls.extendFromTitle}>
                <span className="text-[11px] text-white/40">{copy.controls.extendFrom}</span>
                <input type="number" min={0} step={1} value={extendAt} onChange={(event) => setExtendAt(Math.max(0, Number(event.target.value) || 0))} className="w-14 bg-transparent text-right text-[12.5px] font-medium tabular-nums text-white focus:outline-none" aria-label={copy.controls.extendFrom} data-audio-control="extend_at" />
                <span className="text-[11px] text-white/40">s</span>
              </label>
            )}

            {layout.primary.map(control)}

            {page === "speech" && text.length > 0 && <span className="px-1 text-[11px] tabular-nums text-white/35">{fill(copy.controls.characters, { count: number(text.length, locale) })}</span>}

            {advancedCount > 0 && (
              <button type="button" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced} className={promptControlClassName({ active: showAdvanced })} title={copy.controls.advancedHint} data-audio-control="more">
                <IconAdjustments size={14} stroke={1.75} aria-hidden="true" />
                <span className={PROMPT_CONTROL_LABEL_CLASS}>{showAdvanced ? copy.controls.less : fill(copy.controls.more, { count: advancedCount })}</span>
              </button>
            )}
          </PromptControls>

          <PromptActionGroup>
            <PriceChip locale={locale} endpoint={selectedModel?.endpoint} enabled={Boolean(selectedModel)} payload={pricePayload} />
            <PromptAction onClick={handleGenerate} disabled={Boolean(uploading) || !selectedModel} data-audio-action={page} className="whitespace-nowrap">
              {actionLabel}
            </PromptAction>
          </PromptActionGroup>
        </PromptFooter>
      </PromptComposer>
    </div>
  );
}
