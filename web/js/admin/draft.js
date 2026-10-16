/**
 * The admin's working copy of the trip (state.draft): text for the forms, the keys the editor makes,
 * ticket images, and keeping unpublished changes on this device until they are published.
 *
 * Forms edit what people read; this module turns that into translation keys:
 * - a field whose key is used only there is edited in place (every language);
 * - a field that shares its key with others, or fills {placeholders}, gets a new "ed.*" key,
 *   so editing it changes only that field. Unused "ed.*" keys are dropped before publishing.
 *
 * @import { Payload } from '../../../types/app'
 * @import { TextRef } from '../../../types/trip'
 */
import { t } from '../i18n.js';
import { state } from '../state.js';
import { bigStore, store } from '../util.js';

/** Translation keys look like "d1.title" or "ev.hagia.note" (same rule as tools/…/model.py). */
export const KEY_PATTERN = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

/** Fields whose strings are never translation keys (addresses, codes, phone numbers…). */
const PLAIN_FIELDS = new Set([
  'image',
  'localName',
  'address',
  'phone',
  'code',
  'local',
  'extra',
  'ask',
  'date',
  'time',
  'icon',
  'place',
  'ticket',
  'id',
  'hotel',
  'emergency',
  'company',
  'policy',
  'symbol',
  'speechLang',
  'language',
  'languages',
]);

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @param {TextRef} ref */
export const refKey = (ref) => (Array.isArray(ref) ? ref[0] : ref);

/** @param {TextRef} ref @returns {Record<string, string | number>} */
export const refVars = (ref) => (Array.isArray(ref) && ref[1]) || {};

/**
 * Every translated text in the trip, with where it is ("days[1].events[2].title").
 * @param {unknown} trip
 * @returns {{ path: string, ref: TextRef }[]}
 */
export function textRefs(trip) {
  /** @type {{ path: string, ref: TextRef }[]} */
  const found = [];
  /** @param {unknown} node @param {string} path */
  const walk = (node, path) => {
    if (typeof node === 'string') {
      if (KEY_PATTERN.test(node)) found.push({ path, ref: node });
    } else if (Array.isArray(node)) {
      const isRef =
        node.length >= 1 &&
        node.length <= 2 &&
        typeof node[0] === 'string' &&
        KEY_PATTERN.test(node[0]) &&
        (node.length === 1 || isObject(node[1]));
      if (isRef) found.push({ path, ref: /** @type {TextRef} */ (node) });
      else node.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (isObject(node)) {
      for (const [k, v] of Object.entries(node)) if (!PLAIN_FIELDS.has(k)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(trip, '');
  return found;
}

/**
 * The text of a TextRef in one language, placeholders filled; '' if that language doesn't have it.
 * @param {Payload} payload
 * @param {TextRef | null | undefined} ref
 * @param {string} lang
 */
export function textIn(payload, ref, lang) {
  if (!ref) return '';
  const strings = payload.locales[lang] ?? {};
  const key = refKey(ref);
  const text = strings[key] ?? strings[`${key}.other`] ?? '';
  const vars = refVars(ref);
  return text.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m));
}

/** The trip's languages; the first one is the one every text must have. @param {Payload} payload */
export const languagesOf = (payload) =>
  payload.trip.settings?.languages?.length ? payload.trip.settings.languages : ['en'];

/** How many fields use this key. @param {Payload} payload @param {string} key */
const uses = (payload, key) => textRefs(payload.trip).filter((r) => refKey(r.ref) === key).length;

/** A new key for text written in the editor. */
const newKey = () => `ed.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Store the text typed into a field. Returns the TextRef to put in the trip, or null if every
 * language was left empty. Empty languages get the first filled one, so no language misses the key.
 * @param {Payload} payload
 * @param {TextRef | null | undefined} ref  the field's current text
 * @param {Record<string, string>} values  typed text per language
 * @returns {TextRef | null}
 */
export function setText(payload, ref, values) {
  const langs = languagesOf(payload);
  const clean = Object.fromEntries(langs.map((l) => [l, (values[l] ?? '').trim()]));
  const fallback = langs.map((l) => clean[l]).find(Boolean);
  if (!fallback) return null;
  if (ref && langs.every((l) => clean[l] === textIn(payload, ref, l))) return ref; // unchanged
  const key = typeof ref === 'string' && uses(payload, ref) === 1 ? ref : newKey();
  for (const l of langs) (payload.locales[l] ??= {})[key] = clean[l] || fallback;
  return key;
}

/** Drop "ed.*" keys that nothing uses any more (left over from edits). @param {Payload} payload */
export function dropUnusedEditorKeys(payload) {
  const used = new Set(textRefs(payload.trip).map((r) => refKey(r.ref)));
  for (const strings of Object.values(payload.locales)) {
    for (const key of Object.keys(strings)) if (key.startsWith('ed.') && !used.has(key)) delete strings[key];
  }
}

/* ---------- images ---------- */

/** @type {Record<string, string>} */
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const MAX_BYTES = 1_500_000;
const MAX_SIDE = 1600;

/** @param {Blob} blob @returns {Promise<string>} */
const asDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * A ticket image for the trip: small files as they are, big photos scaled down to a JPEG.
 * Returns null for a file type the trip can't use.
 * @param {File} file
 * @param {string} ticketId
 * @returns {Promise<{ path: string, dataUrl: string } | null>}
 */
export async function readImage(file, ticketId) {
  let type = file.type;
  if (!EXTENSIONS[type]) return null;
  /** @type {Blob} */
  let blob = file;
  if (file.size > MAX_BYTES && type !== 'image/svg+xml') {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    type = 'image/jpeg';
  }
  const path = `tickets/${ticketId}-${Date.now().toString(36)}.${EXTENSIONS[type]}`;
  return { path, dataUrl: await asDataUrl(blob) };
}

/**
 * Point a ticket at a new image, and drop the old one if no other ticket uses it.
 * @param {Payload} payload
 * @param {string} ticketId
 * @param {{ path: string, dataUrl: string }} image
 */
export function setTicketImage(payload, ticketId, image) {
  const ticket = payload.trip.tickets[ticketId];
  const old = ticket.image;
  ticket.image = image.path;
  payload.images[image.path] = image.dataUrl;
  if (old && old !== image.path && !Object.values(payload.trip.tickets).some((tk) => tk.image === old)) {
    delete payload.images[old];
  }
}

/** Drop ticket images that no ticket uses any more (left over from edits). @param {Payload} payload */
export function dropUnusedImages(payload) {
  const used = new Set(Object.values(payload.trip.tickets ?? {}).map((tk) => tk.image));
  for (const path of Object.keys(payload.images ?? {})) if (!used.has(path)) delete payload.images[path];
}

/* ---------- keeping unpublished changes on this device ---------- */

const DRAFT = 'admin-draft';

/** Whether the draft differs from what is published. */
export const isDirty = () => !!state.draft && JSON.stringify(state.draft) !== JSON.stringify(state.original);

/**
 * Keep the draft on this device (it belongs to the trip.enc it was started from).
 * Returns false if the device couldn't keep it.
 */
export async function saveDraft() {
  if (!state.enc) return false;
  return bigStore.set(DRAFT, isDirty() ? { base: state.enc.iv, payload: state.draft } : null);
}

/**
 * The saved draft, if it was started from the trip.enc that is open now. A draft for an older version
 * (the trip was published from somewhere else since) is set aside with a notice, never dropped silently.
 * @returns {Promise<Payload | null>}
 */
export async function loadDraft() {
  /** @type {{ base: string, payload: Payload } | null} */
  let saved = await bigStore.get(DRAFT);
  // version 0.0.2 kept the draft in localStorage: move it over once
  const legacy = store.get('draft', /** @type {typeof saved} */ (null));
  if (legacy) {
    saved ??= legacy;
    store.set('draft', null);
    await bigStore.set(DRAFT, saved);
  }
  const usable = (/** @type {any} */ p) => !!p && typeof p.trip === 'object' && typeof p.locales === 'object';
  if (!saved || !state.enc) return null;
  if (!usable(saved.payload)) {
    state.notice = { kind: 'warn', text: t('edit.draftBroken') };
    await bigStore.set(DRAFT, null);
    return null;
  }
  if (saved.base === state.enc.iv) return saved.payload;
  state.notice = { kind: 'warn', text: t('edit.draftStale') };
  await bigStore.set(DRAFT, null);
  return null;
}

/** Throw the changes away. */
export async function discardDraft() {
  state.draft = structuredClone(state.original);
  await bigStore.set(DRAFT, null);
}
