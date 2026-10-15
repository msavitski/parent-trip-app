/**
 * Weather from Open-Meteo (free, no key) and what to wear.
 * The last forecast is kept on the phone (localStorage "trip:weather") for offline use.
 *
 * @import { WeatherCache, WeatherDay } from '../../types/app'
 */
import { state } from './state.js';
import { isoDate } from './trip.js';
import { store } from './util.js';

const FIELDS =
  'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,' +
  'sunset,wind_speed_10m_max,wind_gusts_10m_max,precipitation_probability_max';
const FRESH_MS = 30 * 60e3; // don't ask again within 30 minutes of a good answer
const RETRY_MS = 5 * 60e3; // or within 5 minutes of a failed try

/** @type {WeatherCache | null} */
let cache = store.get('weather', null);
let lastTry = 0;

const place = () => state.trip?.weather ?? null;

/** Whether the saved forecast is for this trip's place. */
function cacheFits() {
  const p = place();
  return !!(p && cache && cache.lat === p.lat && cache.lon === p.lon);
}

/**
 * Merge an Open-Meteo answer into the saved forecast (keeps up to 40 days).
 * @param {any} json
 * @param {number} at
 */
function ingest(json, at) {
  const p = place();
  if (!p) return;
  const daily = json.daily;
  /** @type {Record<string, WeatherDay>} */
  const days = cacheFits() && cache ? { ...cache.days } : {};
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
      sunset: (v('sunset') || '').slice(11, 16),
    };
  });
  cache = { at, lat: p.lat, lon: p.lon, days: Object.fromEntries(Object.entries(days).sort().slice(-40)) };
}

/**
 * Fetch a fresh forecast if the phone is online and the saved one is old enough.
 * @param {boolean} [force]  ignore the 30-minute and 5-minute limits (used when the phone comes online)
 * @returns {Promise<boolean>} whether a new forecast arrived
 */
export async function updateWeather(force = false) {
  const p = place();
  if (!p || navigator.onLine === false) return false;
  const now = Date.now();
  if (!force && (now - lastTry < RETRY_MS || (cacheFits() && cache && now - cache.at < FRESH_MS))) return false;
  lastTry = now;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10e3);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
      `&daily=${FIELDS}&timezone=auto&past_days=1&forecast_days=16`;
    const response = await fetch(url, { signal: ctrl.signal });
    if (!response.ok) return false;
    ingest(await response.json(), Date.now());
    store.set('weather', cache);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The forecast for a calendar day, if known. @param {Date} date */
export const weatherFor = (date) => (cacheFits() && cache?.days[isoDate(date)]) || null;

/** When the saved forecast was fetched (ms), or null. */
export const weatherFetchedAt = () => (cacheFits() && cache ? cache.at : null);

/** Whether this trip shows weather at all. */
export const hasWeather = () => !!place();

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
