"use client";

import { useRef, useState } from "react";
import { TEMPLATE_IDS } from "../../workflows/templates.js";
import { format, NodeIcon } from "./WorkflowNodes.jsx";

const ICON_BUTTON =
  "rounded-md p-1.5 text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#22d3ee]";

function Icon({ children }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function WorkflowRow({ workflow, active, copy, onOpen, onRename, onDuplicate, onExport, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workflow.name);
  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== workflow.name) onRename(name);
    else setDraft(workflow.name);
  };
  return (
    <li
      className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${
        active ? "border-[#22d3ee]/30 bg-[#22d3ee]/[0.07]" : "border-transparent hover:bg-white/[0.04]"
      }`}
    >
      {editing ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-[#22d3ee]/40 bg-black/40 px-2 py-1 text-xs text-white outline-none"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(workflow.name);
              setEditing(false);
            }
          }}
          aria-label={copy.library.rename}
        />
      ) : (
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" aria-current={active ? "true" : undefined}>
          <span className={`block truncate text-xs font-semibold ${active ? "text-[#22d3ee]" : "text-white/80"}`}>{workflow.name}</span>
          <span className="block text-[10px] text-white/30">{format(copy.library.nodeCount, { count: workflow.nodes.length })}</span>
        </button>
      )}
      {!editing && (
        <div className="flex shrink-0 items-center opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
          <button type="button" className={ICON_BUTTON} onClick={() => { setDraft(workflow.name); setEditing(true); }} title={copy.library.rename} aria-label={copy.library.rename}>
            <Icon><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>
          </button>
          <button type="button" className={ICON_BUTTON} onClick={onDuplicate} title={copy.library.duplicate} aria-label={copy.library.duplicate}>
            <Icon><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>
          </button>
          <button type="button" className={ICON_BUTTON} onClick={onExport} title={copy.library.export} aria-label={copy.library.export}>
            <Icon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></Icon>
          </button>
          <button type="button" className={`${ICON_BUTTON} hover:text-red-300`} onClick={onDelete} title={copy.library.delete} aria-label={copy.library.delete}>
            <Icon><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>
          </button>
        </div>
      )}
    </li>
  );
}

export default function WorkflowLibrary({
  copy,
  workflows,
  activeId,
  onOpen,
  onNew,
  onImport,
  onTemplate,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
  onClose,
}) {
  const importRef = useRef(null);
  return (
    <div className="flex h-full w-full flex-col bg-[#0a0a0a]">
      <div className="flex items-start gap-2 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-white">{copy.library.heading}</h2>
          <p className="text-[11px] text-white/40">{copy.library.subheading}</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className={ICON_BUTTON} aria-label={copy.library.close}>
            <Icon><path d="M18 6 6 18M6 6l12 12" /></Icon>
          </button>
        )}
      </div>
      <div className="flex gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={onNew}
          className="flex-1 rounded-lg bg-[#22d3ee] px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-[#06b6d4]"
        >
          + {copy.library.new}
        </button>
        <button
          type="button"
          onClick={() => importRef.current?.click()}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          {copy.library.import}
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = "";
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <h3 className="px-1 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-white/35">{copy.library.mine}</h3>
        {workflows.length === 0 ? (
          <p className="px-1 text-[11px] text-white/30">{copy.library.empty}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {workflows.map((workflow) => (
              <WorkflowRow
                key={workflow.id}
                workflow={workflow}
                active={workflow.id === activeId}
                copy={copy}
                onOpen={() => onOpen(workflow.id)}
                onRename={(name) => onRename(workflow.id, name)}
                onDuplicate={() => onDuplicate(workflow.id)}
                onExport={() => onExport(workflow.id)}
                onDelete={() => onDelete(workflow.id)}
              />
            ))}
          </ul>
        )}

        <h3 className="px-1 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-wider text-white/35">{copy.library.templates}</h3>
        <ul className="flex flex-col gap-1.5">
          {TEMPLATE_IDS.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onTemplate(id)}
                className="flex w-full gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition-colors hover:border-[#22d3ee]/30 hover:bg-[#22d3ee]/[0.04]"
              >
                <span className="mt-0.5 text-[#22d3ee]/80">
                  <NodeIcon type="combiner" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-white/85">{copy.templates[id]?.name || id}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-white/40">{copy.templates[id]?.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="px-1 pt-4 text-[10px] text-white/25">{copy.library.savedLocally}</p>
      </div>
    </div>
  );
}
