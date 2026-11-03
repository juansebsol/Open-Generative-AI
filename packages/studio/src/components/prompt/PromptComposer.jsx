"use client";

import {
  Children,
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ghostExit } from "../motion/index.js";

const DEFAULT_POSITION_CLASS =
  "absolute bottom-4 w-full max-w-[95%] lg:max-w-4xl z-30 oga-enter-bar";

const DEFAULT_PANEL_CLASS =
  "w-full bg-[#111114] rounded-2xl border border-white/[0.12] p-3.5 flex flex-col gap-2.5 shadow-[0_24px_60px_rgba(0,0,0,0.45)]";

const DEFAULT_TEXTAREA_CLASS =
  "w-full bg-transparent border-none text-white text-[15px] placeholder:text-white/35 focus:outline-none resize-none px-1.5 pt-1.5 leading-relaxed min-h-[40px] max-h-[150px] md:max-h-[250px] overflow-y-auto custom-scrollbar disabled:opacity-40";

const DEFAULT_ACTION_CLASS =
  "bg-[#22d3ee] text-[#04202a] h-9 px-4 rounded-[10px] font-semibold text-[13.5px] hover:brightness-105 active:scale-[0.98] transition-all flex items-center justify-center gap-2 w-full sm:w-auto z-10 disabled:opacity-50 disabled:cursor-not-allowed";

// The action with something riding inside it (the price): one cyan pill
// holding the button and the addon side by side.
const ADDON_ACTION_CLASS =
  "h-10 flex items-center rounded-xl bg-[#22d3ee] text-[#04202a] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] hover:brightness-105 transition-[filter,opacity] w-full sm:w-auto z-10";

const ADDON_ACTION_BUTTON_CLASS =
  "h-full flex-1 sm:flex-none px-4 rounded-xl flex items-center justify-center gap-2 font-semibold text-[14px] active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#04202a]/40 disabled:cursor-not-allowed";

const CONTROL_LAYOUT_CLASS =
  "h-[34px] flex items-center gap-1.5 rounded-[10px] transition-colors border group whitespace-nowrap focus:outline-none focus-visible:border-[#22d3ee]/45 focus-visible:ring-1 focus-visible:ring-[#22d3ee]/30";

const CONTROL_IDLE_CLASS =
  "text-white/60 hover:text-white bg-transparent hover:bg-white/[0.05] border-transparent";

const CONTROL_ACTIVE_CLASS =
  "text-white bg-white/[0.06] border-white/[0.1]";

const MODEL_CONTROL_LAYOUT_CLASS =
  "h-9 min-w-0 pl-2 pr-2.5 flex items-center gap-2 rounded-[10px] border text-[13px] font-medium text-white whitespace-nowrap transition-colors group focus:outline-none focus-visible:border-[#22d3ee]/45 focus-visible:ring-1 focus-visible:ring-[#22d3ee]/30";

const SETTING_LAYOUT_CLASS =
  "h-full px-[11px] flex items-center gap-[7px] rounded-[8px] text-[13px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/40";

const ADD_TILE_LAYOUT_CLASS =
  "w-11 h-11 shrink-0 rounded-xl border border-dashed flex items-center justify-center relative overflow-hidden transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50";

const MEDIA_CONTROL_LAYOUT_CLASS =
  "w-10 h-10 shrink-0 rounded-full border transition-all flex items-center justify-center relative overflow-hidden group focus:outline-none focus-visible:border-[#22d3ee]/45 focus-visible:ring-1 focus-visible:ring-[#22d3ee]/30";

const DEFAULT_POPOVER_POSITION_CLASS =
  "absolute bottom-[calc(100%+12px)] left-0 z-50";

const POPOVER_ENTER_CLASS = "oga-pop-in";
const POPOVER_EXIT_CLASS = "oga-pop-out";

const DEFAULT_POPOVER_CLASS =
  "rounded-[14px] p-2 shadow-[0_20px_60px_rgba(0,0,0,0.55)] border border-white/[0.12] bg-[#111114] min-w-[160px] max-h-[40vh] overflow-y-auto custom-scrollbar";

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function promptControlClassName({
  active = false,
  compact = false,
  iconOnly = false,
  className = "",
} = {}) {
  return joinClasses(
    CONTROL_LAYOUT_CLASS,
    iconOnly
      ? "w-[38px] px-0 justify-center"
      : compact
        ? "px-3"
        : "px-4",
    active ? CONTROL_ACTIVE_CLASS : CONTROL_IDLE_CLASS,
    className,
  );
}

export function promptMediaButtonClassName({
  active = false,
  className = "",
} = {}) {
  return joinClasses(
    MEDIA_CONTROL_LAYOUT_CLASS,
    active
      ? "border-[#22d3ee]/60 bg-[#22d3ee]/5 hover:border-[#22d3ee]/70"
      : "border-white/[0.03] bg-white/[0.03] hover:bg-white/[0.06] hover:border-[#22d3ee]/40",
    className,
  );
}

// The bar's most important pick (the model): a filled button, a step above
// the settings beside it.
export function promptModelButtonClassName({
  active = false,
  className = "",
} = {}) {
  return joinClasses(
    MODEL_CONTROL_LAYOUT_CLASS,
    active
      ? "bg-white/[0.09] border-white/[0.14]"
      : "bg-white/[0.05] border-white/[0.08] hover:bg-white/[0.08]",
    className,
  );
}

// One cell of a PromptSettingsGroup.
export function promptSettingClassName({
  active = false,
  className = "",
} = {}) {
  return joinClasses(
    SETTING_LAYOUT_CLASS,
    active
      ? "bg-white/[0.08] text-white"
      : "text-white/[0.86] hover:bg-white/[0.05] hover:text-white",
    className,
  );
}

// The dashed tile that adds reference images, beside the prompt.
export function promptAddTileClassName({
  active = false,
  dragging = false,
  className = "",
} = {}) {
  return joinClasses(
    ADD_TILE_LAYOUT_CLASS,
    dragging
      ? "border-[#22d3ee] bg-[#22d3ee]/10 text-[#22d3ee]"
      : active
        ? "border-[#22d3ee]/50 bg-[#22d3ee]/[0.06] text-[#67e8f9] hover:border-[#22d3ee]/70"
        : "border-white/20 bg-white/[0.03] text-white/70 hover:border-[#22d3ee]/50 hover:text-white",
    className,
  );
}

// A reference image beside the add tile; its remove button shows on hover
// (always on touch screens).
export const PROMPT_REFERENCE_THUMB_CLASS =
  "relative w-11 h-11 shrink-0 rounded-xl group";

export const PROMPT_REFERENCE_REMOVE_CLASS =
  "absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-[#26262b] border border-white/15 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/60";

export const PROMPT_MEDIA_PREVIEW_CLASS =
  "relative w-10 h-10 shrink-0 rounded-full border border-white/10 overflow-hidden shadow-md group";

export const PROMPT_CONTROL_LABEL_CLASS =
  "text-[12.5px] font-medium text-current transition-colors";

export function PromptChevronIcon({ className = "" }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={joinClasses(
        "text-current opacity-[0.45] group-hover:opacity-100 flex-shrink-0 transition-opacity",
        className,
      )}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function PromptAspectRatioIcon({ className = "" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={joinClasses("text-current opacity-[0.45] flex-shrink-0", className)}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  );
}

export function PromptDurationIcon({ className = "" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={joinClasses("text-current opacity-[0.45] flex-shrink-0", className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PromptQualityIcon({ className = "" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={joinClasses("text-current opacity-70 flex-shrink-0", className)}
      aria-hidden="true"
    >
      <path d="M6.5 3.5h11L22 9 12 21 2 9l4.5-5.5Z" />
      <path d="M2 9h20" />
      <path d="m6.5 3.5 3 5.5L12 21" />
      <path d="m17.5 3.5-3 5.5L12 21" />
    </svg>
  );
}

// "16:9" as a width and height that fit a width x height box; null when the
// value is not a ratio ("auto").
function ratioSize(ratio, width, height) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio).trim());
  if (!match) return null;
  const across = Number(match[1]);
  const down = Number(match[2]);
  if (!across || !down) return null;
  const scale = Math.min(width / across, height / down);
  const least = 3;
  return [Math.max(least, Math.round(across * scale)), Math.max(least, Math.round(down * scale))];
}

// The aspect ratio drawn as its own shape (a dashed square for "auto").
export function PromptRatioIcon({ ratio, width = 14, height = 12, active = false, className = "" }) {
  const size = ratioSize(ratio, width, height);
  const side = Math.min(width, height);
  return (
    <span
      aria-hidden="true"
      className={joinClasses(
        "shrink-0 rounded-[2.5px] border-[1.5px] transition-colors",
        size ? "" : "border-dashed",
        active ? "border-[#22d3ee] bg-[#22d3ee]/15" : "border-white/60",
        className,
      )}
      style={{ width: size ? size[0] : side, height: size ? size[1] : side }}
    />
  );
}

// Wide ratios first, tall ones last, anything that is not a ratio up front.
function ratioOrder(ratio) {
  const size = ratioSize(ratio, 1000, 1000);
  return size ? -size[0] / size[1] : -Infinity;
}

// The aspect ratio picker: one tile per ratio, each drawn as its shape.
export function PromptRatioGrid({ options = [], selected, onSelect, columns = 5 }) {
  const sorted = [...options].sort((a, b) => ratioOrder(a) - ratioOrder(b));
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(columns, sorted.length))}, minmax(0, 1fr))` }}
    >
      {sorted.map((ratio) => {
        const on = ratio === selected;
        return (
          <button
            key={ratio}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(ratio)}
            className={joinClasses(
              "h-[60px] min-w-[52px] flex flex-col items-center justify-center gap-[7px] rounded-[10px] border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50",
              on
                ? "border-[#22d3ee]/55 bg-[#22d3ee]/[0.08]"
                : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.06]",
            )}
            data-ratio={ratio}
          >
            <span className="h-[26px] flex items-center justify-center">
              <PromptRatioIcon ratio={ratio} width={26} height={24} active={on} />
            </span>
            <span className={joinClasses("font-mono text-[11px]", on ? "text-[#67e8f9]" : "text-white/60")}>
              {ratio}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Settings that belong together (ratio, size, count) as one bordered strip,
// a hairline between cells. Each child is a cell (its button, and the
// popover it opens).
export function PromptSettingsGroup({ children, label, className = "" }) {
  const cells = Children.toArray(children).filter(Boolean);
  if (cells.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className={joinClasses(
        "h-9 flex items-stretch rounded-[10px] border border-white/[0.08] p-px",
        className,
      )}
    >
      {cells.map((cell, index) => (
        <Fragment key={cell.key ?? index}>
          {index > 0 && <span aria-hidden="true" className="w-px my-2 shrink-0 bg-white/[0.08]" />}
          {cell}
        </Fragment>
      ))}
    </div>
  );
}

// A hairline between groups of footer controls.
export function PromptDivider({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={joinClasses("mx-1 h-5 w-px shrink-0 bg-white/[0.08]", className)}
    />
  );
}

// "⌘ ↵" (Ctrl on Windows and Linux) beside the action; hidden on phones.
export function PromptShortcutHint({ className = "" }) {
  const [mac, setMac] = useState(true);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ""));
  }, []);
  return (
    <span
      aria-hidden="true"
      className={joinClasses("hidden md:inline font-mono text-[11px] text-white/50 whitespace-nowrap", className)}
    >
      {mac ? "⌘ ↵" : "Ctrl ↵"}
    </span>
  );
}

// The box the popover will occupy once its entrance has finished: the
// animation scales it from its anchor, so a reading taken while it plays
// would be a few percent short on the far side.
function measureSettled(element) {
  const animations = typeof element.getAnimations === "function" ? element.getAnimations() : [];
  const seeks = animations.map((animation) => {
    const time = animation.currentTime;
    const end = animation.effect?.getComputedTiming?.().endTime;
    if (typeof end === "number" && Number.isFinite(end)) animation.currentTime = end;
    return [animation, time];
  });
  const bounds = element.getBoundingClientRect();
  seeks.forEach(([animation, time]) => { if (time !== null) animation.currentTime = time; });
  return bounds;
}

export const PromptPopover = forwardRef(function PromptPopover(
  {
    children,
    className = "",
    positionClassName = DEFAULT_POPOVER_POSITION_CLASS,
    fitViewport = false,
    solid = false,
    ...props
  },
  ref,
) {
  const popoverRef = useRef(null);
  useImperativeHandle(ref, () => popoverRef.current);
  // Ease out before leaving: callers unmount the popover when it closes, so
  // the exit plays on a ghost of it (see ghostExit).
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    return () => ghostExit(popover, POPOVER_EXIT_CLASS, [POPOVER_ENTER_CLASS]);
  }, []);
  useLayoutEffect(() => {
    if (!fitViewport) return;
    const position = () => {
      const popover = popoverRef.current;
      popover.style.translate = "";
      popover.style.height = "";
      let left = 16;
      let right = window.innerWidth - 16;
      let top = 16;
      for (let parent = popover.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clipsX = /auto|scroll|hidden|clip/.test(style.overflowX);
        const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY);
        if (!clipsX && !clipsY) continue;
        const bounds = parent.getBoundingClientRect();
        if (clipsX) {
          left = Math.max(left, bounds.left + 16);
          right = Math.min(right, bounds.right - 16);
        }
        if (clipsY) top = Math.max(top, bounds.top + 16);
      }
      const bounds = measureSettled(popover);
      const shift = Math.max(left - bounds.left, Math.min(0, right - bounds.right));
      popover.style.translate = `${shift}px 0`;
      if (bounds.top < top) popover.style.height = `${Math.max(0, bounds.bottom - top)}px`;
    };
    position();
    const popover = popoverRef.current;
    popover.addEventListener("toggle", position, true);
    window.addEventListener("resize", position);
    return () => {
      popover.removeEventListener("toggle", position, true);
      window.removeEventListener("resize", position);
    };
  }, [fitViewport, children]);
  return (
    <div
      {...props}
      ref={popoverRef}
      className={joinClasses(
        positionClassName,
        POPOVER_ENTER_CLASS,
        DEFAULT_POPOVER_CLASS,
        solid ? "bg-[#0c0c0f]" : "bg-[#0c0c0f]/95",
        className,
      )}
    >
      {children}
    </div>
  );
});

export function PromptPopoverHeader({ children, className = "" }) {
  return (
    <div
      className={joinClasses(
        "text-[11px] font-medium text-white/40 pb-2 mb-1 px-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PromptMenuList({ children, className = "" }) {
  return (
    <div role="menu" className={joinClasses("flex flex-col gap-1", className)}>
      {children}
    </div>
  );
}

export function PromptMenuItem({
  children,
  description,
  wrapDescription = false,
  selected = false,
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      aria-checked={selected}
      role="menuitemradio"
      className={joinClasses(
        "w-full min-h-9 flex items-center justify-between gap-3 px-2.5 py-2 rounded-[10px] text-left cursor-pointer transition-colors group/menu-item",
        "text-[13px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:bg-white/[0.06] focus-visible:text-white",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block truncate">{children}</span>
        {description && (
          <span className={joinClasses(
            "block font-medium mt-0.5",
            wrapDescription
              ? "text-[11.5px] leading-relaxed whitespace-normal text-white/45 group-hover/menu-item:text-white/60"
              : "text-[11px] text-white/40 truncate group-hover/menu-item:text-white/55",
          )}>
            {description}
          </span>
        )}
      </span>
      {selected && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="4.5"
          className="flex-shrink-0"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

export function PromptSegmentedControl({ children, className = "" }) {
  return (
    <div
      className={joinClasses(
        "inline-flex items-center gap-0.5 bg-white/[0.04] border border-white/[0.07] rounded-[10px] p-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PromptSegmentOption({
  children,
  selected = false,
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={joinClasses(
        "min-h-7 px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/40",
        selected
          ? "bg-white/[0.1] text-white"
          : "text-white/45 hover:text-white/75",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PromptComposer({
  children,
  className = "",
  panelClassName = "",
  positionClassName = DEFAULT_POSITION_CLASS,
  style,
}) {
  return (
    <div className={joinClasses(positionClassName, className)} style={style}>
      <div className={joinClasses(DEFAULT_PANEL_CLASS, panelClassName)}>
        {children}
      </div>
    </div>
  );
}

export const PromptTextarea = forwardRef(function PromptTextarea(
  {
    value,
    onChange,
    onInput,
    className = "",
    maxHeightMobile = 150,
    maxHeightDesktop = 250,
    rows = 1,
    ...props
  },
  forwardedRef,
) {
  const internalRef = useRef(null);

  useImperativeHandle(forwardedRef, () => internalRef.current);

  const resize = useCallback(
    (element = internalRef.current) => {
      if (!element) return;

      element.style.height = "auto";
      const maxHeight =
        window.innerWidth < 768 ? maxHeightMobile : maxHeightDesktop;
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    },
    [maxHeightDesktop, maxHeightMobile],
  );

  useEffect(() => {
    resize();
  }, [resize, value]);

  // A textarea measured before its row laid out (or while its studio was
  // hidden) measures again once its width settles.
  useEffect(() => {
    const element = internalRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resize(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [resize]);

  const handleChange = (event) => {
    onChange?.(event);
    resize(event.currentTarget);
  };

  const handleInput = (event) => {
    onInput?.(event);
    resize(event.currentTarget);
  };

  return (
    <textarea
      {...props}
      ref={internalRef}
      value={value}
      onChange={handleChange}
      onInput={handleInput}
      rows={rows}
      className={joinClasses(DEFAULT_TEXTAREA_CLASS, className)}
    />
  );
});

export function PromptFooter({ children, className = "" }) {
  return (
    <div
      className={joinClasses(
        "flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1 relative",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const PromptControls = forwardRef(function PromptControls(
  { children, className = "" },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinClasses(
        "flex items-center gap-2 relative flex-wrap pb-1 md:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
});

// Price chip + primary action, right-aligned; on phones the action keeps
// its full width under the chip.
export function PromptActionGroup({ children, className = "" }) {
  return (
    <div
      className={joinClasses(
        "flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2 sm:gap-3 w-full sm:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

// `addon` rides inside the action's pill, after its label (the price).
export const PromptAction = forwardRef(function PromptAction(
  { children, className = "", addon = null, type = "button", ...props },
  ref,
) {
  if (addon) {
    return (
      <div className={joinClasses(ADDON_ACTION_CLASS, props.disabled && "opacity-50", className)}>
        <button {...props} ref={ref} type={type} className={ADDON_ACTION_BUTTON_CLASS}>
          {children}
        </button>
        {addon}
      </div>
    );
  }
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={joinClasses(DEFAULT_ACTION_CLASS, className)}
    >
      {children}
    </button>
  );
});
