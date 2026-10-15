/**
 * Opening the encrypted trip.
 *
 * trip.enc = { v, kdf, iter, salt, iv, data }: AES-256-GCM, key = PBKDF2-SHA256(password, salt, iter).
 * It is made by `trip build` (tools/src/trip_tools/vault.py), which uses the same password rules:
 * trimmed, NFC-normalised, UTF-8. The phone keeps the derived key (not the password) in
 * localStorage "trip:key", so the app opens offline without asking again.
 *
 * @import { EncFile, Payload } from '../../types/app'
 */
import { store } from './util.js';

/** @param {string} b64 */
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

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
 * Decrypt the trip, or return null if the key is wrong.
 * @param {Uint8Array<ArrayBuffer>} rawKey
 * @param {EncFile} enc
 * @returns {Promise<Payload | null>}
 */
export async function openTrip(rawKey, enc) {
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(enc.iv) }, key, fromBase64(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
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
