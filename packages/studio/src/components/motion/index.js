"use client";

import { createElement, useCallback, useEffect, useRef, useState } from "react";

// The React half of the motion system. The CSS half (keyframes, the
// .oga-enter-* classes, easing and durations) is in app/globals.css.
//
// Entrances are plain CSS animations, so they replay by themselves whenever
// the shell shows a tab again (display:none cancels an animation and showing
// the element restarts it). The helpers here cover the two cases CSS cannot:
// replaying while an element stays displayed (useEntrance / <Entrance active>)
// and animating something only once, when it first appears (<Entrance once>),
// so result cards that were already in a grid stay still when a new one lands.

const VARIANT_CLASS = {
  up: "oga-enter",
  bar: "oga-enter-bar",
  card: "oga-enter-card",
  fade: "oga-enter-fade",
};

/**
 * Returns a key that changes each time `active` flips from false to true.
 * Put it on the element (or subtree) that should replay its entrance: the
 * remount restarts every CSS animation inside it.
 *
 * @param {boolean} [active]
 * @returns {number}
 */
export function useEntrance(active = true) {
  const [generation, setGeneration] = useState(0);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) setGeneration((current) => current + 1);
    wasActive.current = active;
  }, [active]);
  return generation;
}

/**
 * An element with an entrance animation.
 *
 * @param {object} props
 * @param {string|import("react").ComponentType} [props.as]  Element type, "div" by default.
 * @param {"up"|"bar"|"card"|"fade"} [props.variant]       Which .oga-enter-* class; "up" by default.
 * @param {number} [props.index]      Stagger step (--i); 0 plays at once.
 * @param {boolean} [props.active]    Replays the entrance each time it turns true.
 * @param {boolean} [props.once]      Drops the class after the first run, so later
 *                                    display toggles (tab switches) do not replay it.
 * @param {string} [props.className]
 * @param {object} [props.style]
 */
export function Entrance({
  as = "div",
  variant = "up",
  index = 0,
  active = true,
  once = false,
  className = "",
  style,
  children,
  ...rest
}) {
  const generation = useEntrance(active);
  const [played, setPlayed] = useState(false);
  const settle = useCallback((event) => {
    if (event.target === event.currentTarget) setPlayed(true);
  }, []);
  const animating = !(once && played);
  const enterClass = animating ? VARIANT_CLASS[variant] || VARIANT_CLASS.up : "";
  const props = {
    ...rest,
    key: generation,
    className: [enterClass, className].filter(Boolean).join(" "),
    style: animating && index ? { "--i": index, ...style } : style,
  };
  // A run cut short (the tab was hidden mid-way) keeps the class, so the
  // card still gets its entrance the next time the tab is shown.
  if (once && animating) props.onAnimationEnd = settle;
  return createElement(as, props, children);
}

const GHOST_TIMEOUT_MS = 400;

/**
 * Plays an exit animation for an element React is about to remove. Call it
 * from a layout-effect cleanup: the node is still in the DOM at that point,
 * so a static copy can be left in its place with `exitClass`, and removed
 * when the animation ends. Nothing happens if the node is not removed
 * (React's development double-invoke) or its parent leaves the DOM too.
 *
 * @param {HTMLElement|null} node
 * @param {string} exitClass
 * @param {string[]} [dropClasses]  Classes to strip from the copy (its entrance).
 */
export function ghostExit(node, exitClass, dropClasses = []) {
  if (!node || typeof document === "undefined") return;
  const parent = node.parentNode;
  const next = node.nextSibling;
  queueMicrotask(() => {
    if (node.isConnected || !parent?.isConnected) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ghost = node.cloneNode(true);
    ghost.classList.remove(...dropClasses);
    ghost.classList.add(exitClass);
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    const remove = () => ghost.parentNode?.removeChild(ghost);
    ghost.addEventListener("animationend", (event) => { if (event.target === ghost) remove(); });
    setTimeout(remove, GHOST_TIMEOUT_MS);
    parent.insertBefore(ghost, next?.isConnected ? next : null);
  });
}
