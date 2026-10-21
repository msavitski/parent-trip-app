/**
 * Small helpers with no app state: storage, links, money, speech and keeping the screen on.
 */

/** localStorage under the "trip:" prefix. Storage can be unavailable (private mode, blocked site data). */
export const store = {
  /**
   * @template T
   * @param {string} key
   * @param {T} fallback
   * @returns {T}
   */
  get(key, fallback) {
    try {
      const value = localStorage.getItem('trip:' + key);
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },

  /**
   * @param {string} key
   * @param {unknown} value
   */
  set(key, value) {
    try {
      localStorage.setItem('trip:' + key, JSON.stringify(value));
    } catch {}
  },

  /** Remove everything this app saved on the phone, except the chosen language. */
  clearTrip() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('trip:') && k !== 'trip:lang')
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  },
};

/**
 * Bigger storage for admin mode (the unpublished draft and the just-published trip.enc, which carry
 * ticket images): the Cache Storage API, whose quota is far above localStorage's ~5 MB. The cache's
 * name doesn't start with "our-trip-", so the offline worker never deletes it.
 */
const BIG = 'trip-admin';
export const bigStore = {
  /** @param {string} key @returns {Promise<any>} */
  async get(key) {
    try {
      // caches.match with cacheName doesn't create the cache, so reading leaves nothing behind
      const hit = await caches.match(key, { cacheName: BIG });
      return hit ? await hit.json() : null;
    } catch {
      return null;
    }
  },

  /** Store a value, or delete it with null. Returns false if it couldn't be kept. @param {string} key @param {unknown} value */
  async set(key, value) {
    try {
      const cache = await caches.open(BIG);
      if (value == null) await cache.delete(key);
      else
        await cache.put(key, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
      return true;
    } catch {
      return false;
    }
  },

  async clear() {
    try {
      await caches.delete(BIG);
    } catch {}
  },
};

/** @typedef {{ localName?: string | null, address: string }} Locatable */

/**
 * What Google Maps looks for: the address, or the local name when there's no address (next to an address,
 * a name like "son's house" only confuses the search).
 * @param {Locatable} place
 */
const placeQuery = (place) => encodeURIComponent(place.address.trim() || place.localName || '');

/** Google Maps search for a place. @param {Locatable} place */
export const mapUrl = (place) => 'https://www.google.com/maps/search/?api=1&query=' + placeQuery(place);

/** Google Maps directions to a place. @param {Locatable} place */
export const dirUrl = (place) => 'https://www.google.com/maps/dir/?api=1&destination=' + placeQuery(place);

/** @param {string} number */
export const telUrl = (number) => 'tel:' + String(number).replace(/[^\d+]/g, '');

/**
 * @param {number} value
 * @param {{ code: string, symbol: string }} currency
 * @param {number} decimals
 * @param {string} locale
 */
export function formatMoney(value, currency, decimals, locale) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${value.toFixed(decimals)} ${currency.symbol}`;
  }
}

/** Whether the phone can read text aloud in this language. @param {string} lang */
export const canSpeakIn = (lang) => 'speechSynthesis' in window && !!lang;

/**
 * Read text aloud, slowly, in the destination's language.
 * @param {string} text
 * @param {string} lang  e.g. "tr-TR"
 */
export function speak(text, lang) {
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.8;
    const base = lang.slice(0, 2).toLowerCase();
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base));
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  } catch {}
}

export function stopSpeaking() {
  try {
    speechSynthesis.cancel();
  } catch {}
}

/** @type {WakeLockSentinel | null} */
let wake = null;

/**
 * Keep the screen on while a ticket or the taxi card is shown.
 * @param {boolean} on
 */
export async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => {
        wake = null;
      });
    } else if (!on && wake) {
      const lock = wake;
      wake = null;
      await lock.release();
    }
  } catch {
    wake = null;
  }
}
