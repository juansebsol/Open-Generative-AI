'use client';

// The Library section of Settings: what this browser holds, Export library
// (one .openstudio file with every stored file and every studio's history)
// and Import library (merges a file back in). See
// packages/studio/src/library/libraryFile.js for the file itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconDownload, IconFolderOpen } from '@tabler/icons-react';
import { exportLibrary, importLibrary, libraryStats, formatLibraryBytes, LIBRARY_EXTENSION } from 'studio';

const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template || '');

function when(iso, locale) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export default function LibrarySection({ locale = 'en', copy, initialAction = null }) {
  const [stats, setStats] = useState(null);
  const [includeKeys, setIncludeKeys] = useState(false);
  const [busy, setBusy] = useState(null); // 'export' | 'import'
  const [progress, setProgress] = useState(null); // { done, total }
  const [notice, setNotice] = useState(null); // { tone: 'ok'|'warn', text }
  const fileInputRef = useRef(null);
  const sectionRef = useRef(null);
  const startedRef = useRef(false);

  const refresh = useCallback(() => {
    libraryStats().then(setStats).catch(() => setStats({ files: 0, bytes: 0, persisted: false }));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const runExport = useCallback(async () => {
    setBusy('export');
    setNotice(null);
    setProgress(null);
    try {
      const result = await exportLibrary({ includeKeys, onProgress: setProgress });
      if (result.cancelled) setNotice({ tone: 'warn', text: copy.exportCancelled });
      else setNotice({ tone: 'ok', text: fill(copy.exported, { files: result.files, size: formatLibraryBytes(result.bytes, locale) }) });
      refresh();
    } catch (error) {
      setNotice({ tone: 'warn', text: fill(copy.exportFailed, { message: error?.message || String(error) }) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [copy, includeKeys, locale, refresh]);

  const runImport = useCallback(async (file) => {
    if (!file) return;
    setBusy('import');
    setNotice(null);
    setProgress(null);
    try {
      const result = await importLibrary(file, { onProgress: setProgress });
      const lines = [fill(copy.imported, { files: result.files, histories: result.histories })];
      if (result.keysApplied) lines.push(copy.importedKeys);
      if (result.skipped > 0) lines.push(fill(copy.importSkipped, { count: result.skipped }));
      setNotice({ tone: 'ok', text: lines.join(' ') });
      refresh();
      // Studios read their history when they mount, so the page reloads.
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setNotice({ tone: 'warn', text: fill(copy.importFailed, { message: error?.message || String(error) }) });
      setBusy(null);
      setProgress(null);
    }
  }, [copy, refresh]);

  // Opened from the command palette: scroll here and start the action.
  useEffect(() => {
    if (!initialAction || startedRef.current) return;
    startedRef.current = true;
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (initialAction === 'export') runExport();
    if (initialAction === 'import') fileInputRef.current?.click();
  }, [initialAction, runExport]);

  const lastExport = stats?.exportedAt ? fill(copy.lastExport, { when: when(stats.exportedAt, locale) }) : copy.neverExported;
  const lastImport = stats?.importedAt ? fill(copy.lastImport, { when: when(stats.importedAt, locale) }) : null;
  const progressText = progress && busy ? fill(busy === 'export' ? copy.exporting : copy.importing, progress) : null;

  return (
    <section ref={sectionRef} data-library-section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-1">{copy.title}</h3>
      <p className="text-[11px] text-white/30 mb-3">{copy.hint}</p>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[13px] text-white/85" data-library-stats>
          {stats === null ? '…' : stats.files > 0 ? fill(copy.stats, { files: new Intl.NumberFormat(locale).format(stats.files), size: formatLibraryBytes(stats.bytes, locale) }) : copy.statsEmpty}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/40">
          {stats !== null && <span>{stats.persisted ? copy.persisted : copy.notPersisted}</span>}
          <span>{lastExport}</span>
          {lastImport && <span>{lastImport}</span>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runExport}
            disabled={Boolean(busy)}
            data-library-export
            className="flex h-9 items-center gap-2 rounded-md bg-[#22d3ee] px-4 text-[13px] font-bold text-black transition-colors hover:bg-[#06b6d4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconDownload size={15} stroke={2} aria-hidden="true" />
            {copy.export}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(busy)}
            data-library-import
            className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-4 text-[13px] font-semibold text-white/80 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconFolderOpen size={15} stroke={2} aria-hidden="true" />
            {copy.import}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={`${LIBRARY_EXTENSION},.zip,application/zip`}
            aria-label={copy.pickFile}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              runImport(file);
            }}
          />
          {progressText && <span className="text-[12px] text-white/50" aria-live="polite">{progressText}</span>}
        </div>

        <label className="mt-3 flex items-start gap-2 text-[12px] text-white/60">
          <input type="checkbox" checked={includeKeys} onChange={(event) => setIncludeKeys(event.target.checked)} disabled={Boolean(busy)} className="mt-0.5 accent-[#22d3ee]" />
          <span>
            {copy.includeKeys}
            <span className="block text-[11px] text-white/30">{copy.includeKeysHint}</span>
          </span>
        </label>
        <p className="mt-2 text-[11px] text-white/30">{copy.importHint}</p>

        {notice && (
          <p className={`mt-3 text-[12px] ${notice.tone === 'ok' ? 'text-emerald-300' : 'text-amber-300'}`} role="status" data-library-notice>{notice.text}</p>
        )}
      </div>
    </section>
  );
}
