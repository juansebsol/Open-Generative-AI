// Saved characters and avatars: a name plus 1-3 reference photos, kept in this
// browser. Studios attach a character's photos as reference images and write
// @Name in the prompt; expandCharacterMentions() turns each mention into words
// a model understands just before the request goes out.

const STORAGE_KEY = 'oga_characters_v1';
const CHANGE_EVENT = 'oga:characters-changed';
export const MAX_CHARACTER_IMAGES = 3;
const MAX_CHARACTERS = 60;

export function characterHandle(name) {
  return String(name || '').trim().replace(/\s+/g, '_');
}

export function loadCharacters() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((item) => item?.id && item.name && item.images?.length) : [];
  } catch {
    return [];
  }
}

function saveCharacters(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CHARACTERS)));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCharacters(listener) {
  const onStorage = (event) => event.key === STORAGE_KEY && listener();
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Adds a character (or replaces one with the same handle) and returns it. */
export function saveCharacter({ name, images, description = '', kind = 'character' }) {
  const handle = characterHandle(name);
  if (!handle) throw new Error('A name is required.');
  if (!images?.length) throw new Error('Add at least one photo.');
  const character = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    description: description.trim(),
    images: images.slice(0, MAX_CHARACTER_IMAGES),
    kind,
    createdAt: Date.now(),
  };
  const others = loadCharacters().filter((item) => characterHandle(item.name).toLowerCase() !== handle.toLowerCase());
  saveCharacters([character, ...others]);
  return character;
}

export function deleteCharacter(id) {
  saveCharacters(loadCharacters().filter((item) => item.id !== id));
}

/** Replaces @Name mentions of saved characters with a plain description. */
export function expandCharacterMentions(prompt, characters = loadCharacters()) {
  if (typeof prompt !== 'string' || !prompt.includes('@') || characters.length === 0) return prompt;
  const byHandle = new Map(characters.map((item) => [characterHandle(item.name).toLowerCase(), item]));
  return prompt.replace(/@([\p{L}\p{N}_-]+)/gu, (mention, handle) => {
    const character = byHandle.get(handle.toLowerCase());
    if (!character) return mention;
    const who = character.kind === 'avatar' ? 'person' : 'character';
    const where = character.images.length > 1 ? 'reference images' : 'reference image';
    return `${character.name} (the ${who} shown in the ${where}${character.description ? `: ${character.description}` : ''})`;
  });
}

/** Expands character mentions in a request payload's prompt. */
export function applyCharacterMentions(payload) {
  if (typeof payload?.prompt !== 'string' || !payload.prompt.includes('@')) return payload;
  try {
    return { ...payload, prompt: expandCharacterMentions(payload.prompt) };
  } catch {
    return payload;
  }
}
