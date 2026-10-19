/**
 * Weather from Open-Meteo (free, no key) and what to wear.
 * A trip can span several cities: every day may have its own place (`day.weather`), the trip's `weather`
 * is the default. Each place is fetched on its own, and the last forecast of each is kept on the phone
 * (localStorage "trip:weather") for offline use.
 *
 * @import { Weather } from '../../types/trip'
 * @import { WeatherCache, WeatherDay, WeatherPlace } from '../../types/app'
 */
import { state } from './state.js';
import { isoDate } from './trip.js';
import { store } from './util.js';

const FIELDS =
  'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,' +
  'sunset,wind_speed_10m_max,wind_gusts_10m_max,precipitation_probability_max';
const FRESH_MS = 30 * 60e3; // don't ask again within 30 minutes of a good answer
const RETRY_MS = 5 * 60e3; // or within 5 minutes of a failed try

/** The key of a place in the saved forecast. @param {Weather} p */
const keyOf = (p) => `${p.lat},${p.lon}`;

/**
 * The saved forecast. Older versions kept one place as {at, lat, lon, days}: that one moves into `places`.
 * @param {any} saved
 * @returns {WeatherCache | null}
 */
function readCache(saved) {
  if (!saved || typeof saved !== 'object') return null;
  if (saved.places && typeof saved.places === 'object') return saved;
  if (typeof saved.lat === 'number' && typeof saved.lon === 'number' && saved.days && typeof saved.at === 'number')
    return { places: { [keyOf(saved)]: { at: saved.at, days: saved.days } } };
  return null;
}

/** @type {WeatherCache | null} */
let cache = readCache(store.get('weather', null));
let lastTry = 0;

/**
 * Where a day's forecast is for: its own place, else the trip's.
 * @param {Weather | null | undefined} own  the day's `weather`
 * @returns {Weather | null}
 */
const placeOf = (own) => own ?? state.trip?.weather ?? null;

/** Every distinct place the trip needs a forecast for. */
function tripPlaces() {
  const all = [state.trip?.weather, ...(state.trip?.days ?? []).map((d) => d.weather)];
  /** @type {Map<string, Weather>} */
  const found = new Map();
  for (const p of all) if (p) found.set(keyOf(p), p);
  return [...found.values()];
}

/**
 * Merge an Open-Meteo answer into a place's saved forecast (keeps up to 40 days).
 * @param {any} json  the answer for this place
 * @param {WeatherPlace | undefined} old
 * @param {number} at
 * @returns {WeatherPlace | undefined}
 */
function ingest(json, old, at) {
  const daily = json?.daily;
  if (!daily?.time) return old;
  /** @type {Record<string, WeatherDay>} */
  const days = { ...old?.days };
  daily.time.forEach((/** @type {string} */ date, /** @type {number} */ i) => {
    /** @param {string} k */
    const v = (k) => daily[k]?.[i] ?? null;
    if (v('temperature_2m_max') == null) return; // the API leaves the last days empty sometimes
    days[date] = {
      code: v('weather_code'),
      max: v('temperature_2m_max'),
      min: v('temperature_2m_min'),
      feelsMax: v('apparent_temperature_max'),
      feelsMin: v('apparent_temperature_min'),
      wind: v('wind_speed_10m_max'),
      gust: v('wind_gusts_10m_max'),
      rain: v('precipitation_probability_max'),
      sunset: (v('sunset') || '').slice(11, 16), // local time at that place (timezone=auto)
    };
  });
  return { at, days: Object.fromEntries(Object.entries(days).sort().slice(-40)) };
}

/**
 * Fetch a fresh forecast if the phone is online and a saved one is old enough.
 * @param {boolean} [force]  ignore the 30-minute and 5-minute limits (used when the phone comes online)
 * @returns {Promise<boolean>} whether a new forecast arrived
 */
export async function updateWeather(force = false) {
  const places = tripPlaces();
  if (!places.length || navigator.onLine === false) return false;
  const now = Date.now();
  const fresh = places.every((p) => {
    const saved = cache?.places[keyOf(p)];
    return saved && now - saved.at < FRESH_MS;
  });
  if (!force && (now - lastTry < RETRY_MS || fresh)) return false;
  lastTry = now;
  // one request per place, side by side: a slow or failed one doesn't cost the others
  const answers = await Promise.all(places.map(fetchPlace));
  /** @type {Record<string, WeatherPlace>} */
  const saved = {};
  let arrived = false;
  places.forEach((p, i) => {
    const old = cache?.places[keyOf(p)];
    const entry = answers[i] ? ingest(answers[i], old, Date.now()) : old;
    if (entry) saved[keyOf(p)] = entry;
    if (entry && entry !== old) arrived = true;
  });
  if (!arrived) return false;
  cache = { places: saved };
  store.set('weather', cache);
  return true;
}

/**
 * Ask Open-Meteo for one place; null if it can't be reached.
 * @param {Weather} p
 */
async function fetchPlace(p) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10e3);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
      `&daily=${FIELDS}&timezone=auto&past_days=1&forecast_days=16`;
    const response = await fetch(url, { signal: ctrl.signal });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The forecast for a calendar day, if known.
 * @param {Date} date
 * @param {Weather | null} [own]  the day's `weather`; without one the trip's place is used
 */
export const weatherFor = (date, own) => {
  const p = placeOf(own);
  return (p && cache?.places[keyOf(p)]?.days[isoDate(date)]) || null;
};

/**
 * When the saved forecast of a place was fetched (ms), or null.
 * @param {Weather | null} [own]  the day's `weather`
 */
export const weatherFetchedAt = (own) => {
  const p = placeOf(own);
  return (p && cache?.places[keyOf(p)]?.at) || null;
};

/**
 * Whether a day shows weather at all: it has a place of its own, or the trip has one.
 * @param {Weather | null} [own]  the day's `weather`
 */
export const hasWeather = (own) => !!placeOf(own);

/**
 * WMO weather code -> one of our kinds (also a translation key: wx.code.<kind>).
 * @param {number | null} code
 */
export function weatherKind(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 45 || code === 48) return 'fog';
  if (code == null) return 'cloudy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

/** @type {Record<string, string>} kind -> icon name */
export const WEATHER_ICON = {
  clear: 'sun',
  partly: 'cloudSun',
  cloudy: 'cloud',
  fog: 'fog',
  drizzle: 'rain',
  rain: 'rain',
  showers: 'rain',
  snow: 'snow',
  storm: 'storm',
};

/**
 * What to wear, from the "feels like" temperatures, wind and rain. Thresholds in °C and km/h.
 * Returns translation keys (wear.*).
 * @param {WeatherDay} w
 */
export function outfit(w) {
  const hi = w.feelsMax ?? w.max;
  const lo = w.feelsMin ?? w.min ?? hi;
  const kind = weatherKind(w.code);
  const style =
    hi >= 27
      ? 'wear.hot'
      : hi >= 21
        ? 'wear.warm'
        : hi >= 15
          ? 'wear.mild'
          : hi >= 8
            ? 'wear.cool'
            : hi >= 0
              ? 'wear.cold'
              : 'wear.freezing';
  const extra = [];
  if (hi - lo >= 8 && hi >= 8) extra.push('wear.layer');
  if ((w.wind ?? 0) >= 30 || (w.gust ?? 0) >= 55) extra.push('wear.wind');
  if (['rain', 'showers', 'storm'].includes(kind) || (w.rain ?? 0) >= 50) extra.push('wear.umbrella');
  if (kind === 'snow') extra.push('wear.snow');
  if (hi >= 25 && (kind === 'clear' || kind === 'partly')) extra.push('wear.sun');
  return { style, extra };
}
