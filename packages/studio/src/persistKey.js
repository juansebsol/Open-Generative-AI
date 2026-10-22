// Scopes a studio's localStorage persistence key to an identity string so
// separate identities sharing one browser don't read each other's history
// and drafts. The shell currently passes one stable workspace marker.
export function scopedPersistKey(baseKey, apiKey) {
  if (!apiKey) return baseKey;
  // Short, stable hash, so nothing secret ever ends up in a storage key name.
  let hash = 0;
  for (let i = 0; i < apiKey.length; i++) {
    hash = (hash * 31 + apiKey.charCodeAt(i)) | 0;
  }
  return `${baseKey}:${(hash >>> 0).toString(36)}`;
}

// One-time best-effort carryover from the old shared (unscoped) key into the
// current identity's scoped key, then clears the old key so the next different
// identity on this browser doesn't inherit (or re-leak) it.
export function migrateLegacyPersistKey(baseKey, scopedKey) {
  if (scopedKey === baseKey) return;
  try {
    if (localStorage.getItem(scopedKey)) return; // already migrated
    const legacy = localStorage.getItem(baseKey);
    if (legacy) {
      localStorage.setItem(scopedKey, legacy);
      localStorage.removeItem(baseKey);
    }
  } catch {
    // localStorage unavailable (SSR/private mode) — nothing to migrate
  }
}
