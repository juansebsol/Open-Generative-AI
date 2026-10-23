"use client";

import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../generation.js";
import {
  MAX_CHARACTER_IMAGES,
  characterHandle,
  deleteCharacter,
  loadCharacters,
  saveCharacter,
  subscribeCharacters,
} from "../characters.js";
import en from "../messages/en/characters.json";
import zh from "../messages/zh/characters.json";
import { resolveCopy } from "../i18nUtils";

/**
 * Prompt-bar button that lists saved characters (or avatars) and creates new
 * ones. onUse(character) is called when the visitor picks one.
 */
export default function CharactersMenu({ locale = "en", kind = "character", onUse, align = "left", copyOverrides = null, buttonClassName = null, labelClassName = "" }) {
  const copy = { ...resolveCopy(en, zh, locale), ...(copyOverrides || {}) };
  const [open, setOpen] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", images: [] });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const refresh = () => setCharacters(loadCharacters());
    refresh();
    return subscribeCharacters(refresh);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const resetDraft = () => {
    setCreating(false);
    setDraft({ name: "", description: "", images: [] });
    setError("");
  };

  const addPhotos = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, MAX_CHARACTER_IMAGES - draft.images.length);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      const urls = await Promise.all(files.map((file) => uploadFile(file)));
      setDraft((current) => ({ ...current, images: [...current.images, ...urls].slice(0, MAX_CHARACTER_IMAGES) }));
    } catch (uploadError) {
      setError(copy.uploadFailed.replace("{message}", uploadError.message));
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    if (!characterHandle(draft.name)) return setError(copy.needsName);
    if (!draft.images.length) return setError(copy.needsPhotos);
    const character = saveCharacter({ ...draft, kind });
    resetDraft();
    onUse?.(character);
    setOpen(false);
  };

  const visible = characters.filter((item) => (item.kind || "character") === kind || kind === "any");
  const field = "w-full h-8 rounded-md bg-black/40 border border-white/10 px-2.5 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={copy.buttonTitle}
        onClick={() => setOpen((current) => !current)}
        className={buttonClassName || `h-9 px-3 flex items-center gap-1.5 rounded-xl border text-[11px] font-semibold transition-colors ${open ? "bg-primary/15 border-primary/40 text-primary" : "bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10"}`}
      >
        <span className={`font-black ${buttonClassName ? "opacity-40 text-white group-hover:text-[#22d3ee] transition-colors" : ""}`}>@</span>
        <span className={labelClassName}>{copy.button}</span>
      </button>

      {open && (
        <div className={`absolute bottom-full mb-2 ${align === "right" ? "right-0" : "left-0"} z-50 w-[300px] max-w-[calc(100vw-32px)] rounded-xl border border-white/10 bg-[#0d0d0d] shadow-2xl p-3`}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-2">{copy.title}</div>

          {!creating && (
            <>
              {visible.length === 0 && <p className="text-[12px] text-white/45 mb-3 leading-relaxed">{copy.empty}</p>}
              <div className="max-h-64 overflow-y-auto space-y-1.5 mb-2">
                {visible.map((character) => (
                  <div key={character.id} className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/5">
                    <img src={character.images[0]} alt="" className="w-10 h-10 rounded-md object-cover bg-white/5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-white truncate">{character.name}</div>
                      <div className="text-[11px] text-white/40 truncate">@{characterHandle(character.name)} · {character.images.length}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onUse?.(character);
                        setOpen(false);
                      }}
                      className="h-7 px-2.5 rounded-md bg-primary text-black text-[11px] font-bold hover:opacity-90"
                    >
                      {copy.use}
                    </button>
                    <button
                      type="button"
                      aria-label={`${copy.delete} ${character.name}`}
                      title={copy.delete}
                      onClick={() => confirm(copy.confirmDelete.replace("{name}", character.name)) && deleteCharacter(character.id)}
                      className="w-7 h-7 rounded-md text-white/35 hover:text-red-300 hover:bg-red-500/10"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setCreating(true)} className="w-full h-8 rounded-md border border-dashed border-white/15 text-[12px] font-semibold text-white/60 hover:text-white hover:border-white/30">
                + {copy.newCharacter}
              </button>
            </>
          )}

          {creating && (
            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-white/45 mb-1" htmlFor={`character-name-${kind}`}>{copy.name}</label>
                <input id={`character-name-${kind}`} value={draft.name} maxLength={40} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={copy.namePlaceholder} className={field} />
                {characterHandle(draft.name) && <p className="mt-1 text-[10px] text-white/35">{copy.hint.replace("{handle}", `@${characterHandle(draft.name)}`)}</p>}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-white/45 mb-1" htmlFor={`character-description-${kind}`}>{copy.description}</label>
                <input id={`character-description-${kind}`} value={draft.description} maxLength={160} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder={copy.descriptionPlaceholder} className={field} />
              </div>
              <div>
                <span className="block text-[11px] font-semibold text-white/45 mb-1">{copy.photos}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {draft.images.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      title={copy.delete}
                      onClick={() => setDraft({ ...draft, images: draft.images.filter((_, i) => i !== index) })}
                      className="relative w-12 h-12 rounded-md overflow-hidden border border-white/10 group"
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <span className="absolute inset-0 bg-black/60 text-white text-sm opacity-0 group-hover:opacity-100 flex items-center justify-center">×</span>
                    </button>
                  ))}
                  {draft.images.length < MAX_CHARACTER_IMAGES && (
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                      className="w-12 h-12 rounded-md border border-dashed border-white/20 text-white/50 hover:text-white text-[10px] font-semibold disabled:opacity-50"
                    >
                      {uploading ? "…" : "+"}
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
              </div>
              {error && <p className="text-[11px] text-red-300">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={resetDraft} className="flex-1 h-8 rounded-md border border-white/10 bg-white/5 text-[12px] font-semibold text-white/60 hover:text-white">
                  {copy.cancel}
                </button>
                <button type="button" disabled={uploading} onClick={save} className="flex-1 h-8 rounded-md bg-primary text-black text-[12px] font-bold hover:opacity-90 disabled:opacity-50">
                  {uploading ? copy.uploading : copy.save}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
