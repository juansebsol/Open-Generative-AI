'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch } from '@tabler/icons-react';

// ⌘K palette: type to filter, arrows to move, Enter to pick, Esc to close.
// `items` are { id, group, label, hint?, icon?, onSelect }.
export default function CommandPalette({ open, onClose, items, copy }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = term
      ? items.filter((item) => `${item.label} ${item.group} ${item.keywords || ''}`.toLowerCase().includes(term))
      : items;
    return matches.slice(0, 16);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const selected = listRef.current?.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [cursor, results]);

  if (!open) return null;

  const pick = (item) => {
    onClose();
    item.onSelect();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((current) => Math.min(results.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && results[cursor]) {
      event.preventDefault();
      pick(results[cursor]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  };

  let lastGroup = null;

  return (
    <div
      className="oga-backdrop-in fixed inset-0 z-[300] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.placeholder}
        className="oga-dialog-in oga-origin-top w-full max-w-[560px] overflow-hidden rounded-[14px] border border-white/[0.12] bg-[#111114] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <IconSearch size={16} stroke={1.75} className="shrink-0 text-white/40" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={copy.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="h-[52px] w-full bg-transparent text-[15px] text-white placeholder:text-white/35 focus:outline-none"
          />
          <kbd className="hidden sm:inline rounded-[5px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-white/35">esc</kbd>
        </div>
        <ul ref={listRef} role="listbox" className="max-h-[360px] overflow-y-auto p-1.5 custom-scrollbar">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-white/40">{copy.noResults}</li>
          )}
          {results.map((item, index) => {
            const Icon = item.icon;
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {showGroup && <div className="px-3 pb-1 pt-2 text-[11px] text-white/35">{item.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  data-selected={index === cursor ? 'true' : 'false'}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => pick(item)}
                  className={`flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] text-white/85 ${index === cursor ? 'bg-white/[0.06]' : ''}`}
                >
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] border border-white/[0.07] bg-white/[0.04] text-white/60">
                    {Icon ? <Icon size={15} stroke={1.75} aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-[12px] text-white/35">{item.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
