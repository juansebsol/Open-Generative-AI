'use client';

// The provider settings store as a hook, shared by the Providers and Local
// engines sections. Saving notifies every studio (and the other section),
// so it runs outside React's state updater.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProviderSettings, saveProviderSettings, subscribeProviderSettings } from 'studio';

export function useProviderSettings() {
  const [settings, setSettings] = useState(() => loadProviderSettings());
  const settingsRef = useRef(settings);

  useEffect(() => subscribeProviderSettings((next) => {
    settingsRef.current = next;
    setSettings(next);
  }), []);

  const update = useCallback((updater) => {
    const next = saveProviderSettings(updater(settingsRef.current));
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const setKey = useCallback((id, value) => update((current) => ({ ...current, keys: { ...current.keys, [id]: value.trim() } })), [update]);
  const setUrl = useCallback((id, value) => update((current) => ({ ...current, urls: { ...current.urls, [id]: value.trim() } })), [update]);
  const setOptions = useCallback((id, value) => update((current) => ({ ...current, options: { ...current.options, [id]: value } })), [update]);
  const move = useCallback((id, delta) => update((current) => {
    const order = [...current.order];
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return current;
    [order[index], order[target]] = [order[target], order[index]];
    return { ...current, order };
  }), [update]);

  const isConfigured = useCallback((provider) => Boolean(provider.kind === 'local' ? settings.urls[provider.id] : settings.keys[provider.id]), [settings]);

  return { settings, setKey, setUrl, setOptions, move, isConfigured };
}
