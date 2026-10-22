// Per-visitor provider settings, kept only in this browser's localStorage.
// Keys are sent to this app's /api routes with each request and forwarded to
// the provider; the server never stores them.

import { PROVIDER_IDS, getProvider } from './directProviders.js';

const STORAGE_KEY = 'oga_providers_v1';
const CHANGE_EVENT = 'oga:providers-changed';

const EMPTY = Object.freeze({ keys: {}, urls: {}, options: {}, order: PROVIDER_IDS });

let cache = null;

function hasStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function normalise(raw) {
  const order = Array.isArray(raw?.order) ? raw.order.filter((id) => PROVIDER_IDS.includes(id)) : [];
  for (const id of PROVIDER_IDS) if (!order.includes(id)) order.push(id);
  return {
    keys: { ...(raw?.keys || {}) },
    urls: { ...(raw?.urls || {}) },
    options: { ...(raw?.options || {}) },
    order,
  };
}

export function loadProviderSettings() {
  if (cache) return cache;
  if (!hasStorage()) return EMPTY;
  try {
    cache = normalise(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    cache = normalise(null);
  }
  return cache;
}

export function saveProviderSettings(next) {
  cache = normalise(next);
  if (hasStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // quota or privacy mode: settings still apply for this tab
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
  return cache;
}

export function subscribeProviderSettings(callback) {
  if (typeof window === 'undefined') return () => {};
  const onChange = () => callback(loadProviderSettings());
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function getProviderKey(id) {
  return loadProviderSettings().keys[id] || '';
}

export function getProviderUrl(id) {
  return (loadProviderSettings().urls[id] || '').replace(/\/+$/, '');
}

export function getProviderOptions(id) {
  return loadProviderSettings().options[id] || {};
}

export function isProviderConfigured(id) {
  const provider = getProvider(id);
  if (!provider) return false;
  return provider.kind === 'local' ? Boolean(getProviderUrl(id)) : Boolean(getProviderKey(id));
}

// Configured providers in the visitor's preferred order.
export function configuredProviders() {
  return loadProviderSettings().order.filter(isProviderConfigured);
}

export function hasAnyProvider() {
  return configuredProviders().length > 0;
}
