'use client';

// The small vocabulary every Settings section is built from: a titled group
// of rows, one row (title and hint on the left, its control on the right),
// and the shared field and button classes. Keeping these in one place is
// what makes the sections read as one dialog.

export const FIELD = 'h-9 w-full min-w-0 rounded-[9px] border border-white/[0.08] bg-black/40 px-3 text-[13px] text-white placeholder:text-white/25 transition-colors focus:border-primary/50 focus:outline-none disabled:opacity-50';
export const FIELD_MONO = `${FIELD} font-mono`;
export const SELECT = `${FIELD} appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27rgba(255,255,255,0.4)%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8`;
export const BUTTON = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[9px] border border-white/[0.1] bg-white/[0.04] px-3.5 text-[12.5px] font-semibold text-white/75 transition-colors hover:border-white/[0.18] hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 active:translate-y-px';
export const BUTTON_SMALL = BUTTON.replace('h-9', 'h-7').replace('px-3.5', 'px-2.5').replace('text-[12.5px]', 'text-[11.5px]');
export const BUTTON_PRIMARY = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[9px] bg-primary px-4 text-[12.5px] font-bold text-black transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px';
export const BUTTON_DANGER = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[9px] border border-red-500/20 bg-red-500/10 px-3.5 text-[12.5px] font-semibold text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 active:translate-y-px';
export const LINK = 'inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline';

/** A titled block of rows. */
export function Group({ title, hint, action = null, children }) {
  return (
    <section className="oga-enter" data-settings-group={title}>
      <div className="mb-2 flex items-end justify-between gap-3 px-0.5">
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">{title}</h4>
          {hint && <p className="mt-1 text-[12px] leading-relaxed text-white/40">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="divide-y divide-white/[0.06] rounded-[14px] border border-white/[0.07] bg-white/[0.02] px-5">{children}</div>
    </section>
  );
}

/** One setting: its name and hint on the left, the control on the right. */
export function Row({ title, hint, children, wide = false }) {
  return (
    <div className={`flex gap-3 py-4 ${wide ? 'flex-col' : 'flex-col sm:flex-row sm:items-center sm:justify-between'}`}>
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-white/90">{title}</div>
        {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">{hint}</p>}
      </div>
      {children && <div className={wide ? 'w-full' : 'flex shrink-0 items-center gap-2 sm:max-w-[60%]'}>{children}</div>}
    </div>
  );
}

/** A small green or neutral status pill. */
export function Pill({ on, children }) {
  return (
    <span className={`inline-flex h-[20px] items-center gap-1.5 rounded-full px-2 text-[10.5px] font-semibold ${on ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.05] text-white/40'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-white/25'}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template || '');
