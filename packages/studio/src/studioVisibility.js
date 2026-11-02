"use client";

// Whether the studio a component sits in is the one on screen. The shell keeps
// every studio mounted and hides all but one, so work that costs a request
// (price quotes) waits until its studio is shown. Outside a provider, as when
// a studio is rendered on its own, everything counts as shown.

import { createContext, useContext } from 'react';

const StudioVisibleContext = createContext(true);

/** Wrap a studio: `<StudioVisibility value={isActive}>`. */
export const StudioVisibility = StudioVisibleContext.Provider;

export const useStudioVisible = () => useContext(StudioVisibleContext);
