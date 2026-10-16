/**
 * Opening (and, in admin mode, re-sealing) the encrypted trip.
 *
 * trip.enc (made by `trip build` and `trip password`, see tools/src/trip_tools/vault.py):
 *   v1: { v, kdf, iter, salt, iv, data }   data = AES-256-GCM(PBKDF2-SHA256(password, salt, iter), payload)
 *   v2: the same, plus
 *       slots.family = AES-GCM(PBKDF2(family password), data key)
 *       slots.admin  = AES-GCM(PBKDF2(admin password), data key + admin key)
 *       admin        = AES-GCM(admin key, admin settings JSON)
 *       and data is encrypted with the data key.
 * Both slots use the one salt, so the key a phone saved (PBKDF2 of the family password) opens the
 * trip in v1 and in v2 alike. Passwords are trimmed, NFC-normalised and UTF-8, as in the tools.
 *
 * The phone keeps the password's derived key (not the password) in localStorage "trip:key", so the app
 * opens offline without asking again.
 *
 * @import { AdminConfig, EncFile, Opened, Payload } from '../../types/app'
 */
import { store } from './util.js';

const KEY_BYTES = 32;

/** @param {string} b64 */
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** @returns {Promise<EncFile | null>} */
export async function fetchEnc() {
  try {
    const response = await fetch('trip.enc');
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} password
 * @param {EncFile} enc
 */
export async function deriveKey(password, enc) {
  const secret = new TextEncoder().encode(password.trim().normalize('NFC'));
  const base = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(enc.salt), iterations: enc.iter },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * AES-256-GCM decrypt, or null if the key is wrong.
 * @param {Uint8Array<ArrayBuffer>} rawKey
 * @param {string} iv
 * @param {string} data
 */
async function decrypt(rawKey, iv, data) {
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(data)));
  } catch {
    return null;
  }
}

/**
 * AES-256-GCM encrypt with a fresh 12-byte IV.
 * @param {Uint8Array<ArrayBuffer>} rawKey
 * @param {Uint8Array<ArrayBuffer>} plain
 */
async function encrypt(rawKey, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv: toBase64(iv), data: toBase64(data) };
}

/** @param {Uint8Array} bytes */
const parse = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

/**
 * Open the trip with a password's derived key: the family or (v2) the admin password.
 * Returns null if the key opens nothing.
 * @param {Uint8Array<ArrayBuffer>} rawKey
 * @param {EncFile} enc
 * @returns {Promise<Opened | null>}
 */
export async function openTrip(rawKey, enc) {
  if (enc.v === 1 || !enc.slots) {
    const plain = await decrypt(rawKey, enc.iv, enc.data);
    return plain && { role: 'family', payload: parse(plain), dataKey: rawKey, adminKey: null, admin: null };
  }
  for (const role of /** @type {const} */ (['admin', 'family'])) {
    const slot = enc.slots[role];
    const keys = slot && (await decrypt(rawKey, slot.iv, slot.key));
    if (!keys) continue;
    const dataKey = keys.slice(0, KEY_BYTES);
    const adminKey = keys.length > KEY_BYTES ? keys.slice(KEY_BYTES) : null;
    const plain = await decrypt(dataKey, enc.iv, enc.data);
    if (!plain) return null;
    /** @type {AdminConfig | null} */
    let admin = null;
    if (adminKey && enc.admin) {
      const config = await decrypt(adminKey, enc.admin.iv, enc.admin.data);
      admin = config ? parse(config) : null;
    }
    return { role, payload: parse(plain), dataKey, adminKey, admin };
  }
  return null;
}

/**
 * The trip file with a new payload: same salt, slots and admin settings, so both passwords and every
 * phone's saved key keep working (admin mode's Publish). Only for two-password (v2) trips.
 * @param {Payload} payload
 * @param {Opened} opened
 * @param {EncFile} enc
 * @returns {Promise<EncFile>}
 */
export async function sealTrip(payload, opened, enc) {
  if (enc.v !== 2) throw new Error('Publishing needs a two-password trip.enc (trip password admin)');
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  return { ...enc, ...(await encrypt(opened.dataKey, plain)) };
}

/**
 * Keep the key on this phone.
 * @param {Uint8Array} rawKey
 * @param {EncFile} enc
 */
export const remember = (rawKey, enc) => store.set('key', { salt: enc.salt, iter: enc.iter, key: toBase64(rawKey) });

/**
 * The key saved on this phone: `fits` says whether it was made for this trip.enc (same salt and rounds).
 * @param {EncFile} enc
 * @returns {{ key: Uint8Array<ArrayBuffer>, fits: boolean } | null}
 */
export function savedKey(enc) {
  const saved = store.get('key', /** @type {{ salt: string, iter: number, key: string } | null} */ (null));
  if (!saved) return null;
  return { key: fromBase64(saved.key), fits: saved.salt === enc.salt && saved.iter === enc.iter };
}

/** Forget the key and everything else this app saved, except the chosen language. */
export const forget = () => store.clearTrip();
