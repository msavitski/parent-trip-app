/**
 * Translations. Interface words come from locales/<lang>/app.json (public); trip words come from
 * the trip's own strings inside trip.enc. No human-readable text is written in code:
 *
 *   t('today.dayXofY', { x: 2, y: 5 })        interface text with {placeholders}
 *   tr('d1.title') / tr(['meet.lobbyAt', { time: '09:45' }])   trip text from a TextRef
 *
 * Plurals: a `count` value picks key.one / key.few / key.many / key.other by the language's rules.
 * A missing word falls back to the trip's first language; if it is missing there too, the key itself
 * shows on screen and the console lists it.
 *
 * @import { TextRef } from '../../types/trip'
 * @import { Strings, Vars } from '../../types/app'
 */
import { state } from './state.js';
import { store } from './util.js';

/** @type {Record<string, Strings>} interface strings per language */
const appStrings = {};
/** @type {Record<string, Intl.PluralRules>} */
const pluralRules = {};

/** BCP 47 locale of the current language, e.g. "ru-RU". */
export let locale = 'en-GB';
/** Date and time formats for the current language. */
export let fmt = makeFormats(locale);

/** @param {string} loc */
function makeFormats(loc) {
  return {
    long: new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' }),
    short: new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }),
    weekday: new Intl.DateTimeFormat(loc, { weekday: 'short' }),
    month: new Intl.DateTimeFormat(loc, { month: 'short' }),
    time: new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }),
  };
}

/** "ru-RU" -> "ru" @param {string | null | undefined} code */
export const baseLang = (code) =>
  String(code || '')
    .toLowerCase()
    .split('-')[0];

/** Metadata of a loaded language, e.g. meta.name ("Русский") or meta.windUnit. @param {string} lang @param {string} key */
export const meta = (lang, key) => appStrings[lang]?.[key];

/**
 * Load locales/<lang>/app.json once. Returns false if that language doesn't exist.
 * @param {string} lang
 */
export async function loadApp(lang) {
  if (appStrings[lang]) return true;
  try {
    const response = await fetch(`locales/${lang}/app.json`);
    if (response.ok) appStrings[lang] = await response.json();
  } catch {}
  return !!appStrings[lang];
}

/**
 * @param {string} text
 * @param {Vars} vars
 */
const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m).toString());

const missing = new Set();
let warnTimer = 0;
/** @param {string} what */
function reportMissing(what) {
  if (missing.has(what)) return;
  missing.add(what);
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => console.warn('Missing translations:\n' + [...missing].join('\n')), 300);
}

/**
 * @param {'app' | 'trip'} ns
 * @param {string} key
 * @param {Vars} vars
 */
function lookup(ns, key, vars) {
  const langs = state.lang === state.fallback ? [state.lang] : [state.lang, state.fallback];
  for (const lang of langs) {
    const dict = ns === 'app' ? appStrings[lang] : state.tripStrings[lang];
    if (!dict) continue;
    let text;
    if (typeof vars.count === 'number') {
      pluralRules[lang] ??= new Intl.PluralRules(meta(lang, 'meta.locale') || lang);
      text = dict[`${key}.${pluralRules[lang].select(vars.count)}`] ?? dict[`${key}.other`];
    }
    text ??= dict[key];
    if (text != null) {
      if (lang !== state.lang) reportMissing(`${state.lang}/${ns}.json: ${key}`);
      return text;
    }
  }
  reportMissing(`${state.fallback}/${ns}.json: ${key}`);
  return key;
}

/**
 * Interface text.
 * @param {string} key
 * @param {Vars} [vars]
 */
export const t = (key, vars = {}) => fill(lookup('app', key, vars), vars);

/**
 * Trip text from a TextRef: "key" or ["key", { values }].
 * @param {TextRef | null | undefined} ref
 */
export function tr(ref) {
  if (ref == null || ref === '') return '';
  const [key, vars = {}] = Array.isArray(ref) ? ref : [ref];
  return fill(lookup('trip', key, vars), vars);
}

/** Capitalise the first letter (weekday names are lower-case in Russian). @param {string} text */
export const cap = (text) => text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

/** Before the trip is open: the saved choice, else the phone's language, else English. */
export async function pickLoginLang() {
  const saved = savedLang();
  const phone = (navigator.languages || [navigator.language]).slice(0, 3).map(baseLang);
  const wanted = [...(saved ? [saved] : []), ...phone, 'en'];
  for (const lang of new Set(wanted)) if (await loadApp(lang)) return lang;
  return 'en';
}

/** The language chosen on the Help page, if any. */
const savedLang = () => store.get('lang', /** @type {string | null} */ (null));

/** Once the trip is open: the saved choice, the trip's setting, the phone's language, else the fallback. */
export function pickLang() {
  /** @param {string | null | undefined} l */
  const ok = (l) => !!l && state.languages.includes(l) && !!appStrings[l];
  const saved = savedLang();
  if (saved && ok(saved)) return saved;
  const forced = state.settings.language;
  if (forced && ok(forced)) return forced;
  for (const l of navigator.languages || [navigator.language]) if (ok(baseLang(l))) return baseLang(l);
  return state.fallback;
}

/** @param {string} lang */
export function setLang(lang) {
  state.lang = lang;
  locale = meta(lang, 'meta.locale') || lang;
  document.documentElement.lang = lang;
  fmt = makeFormats(locale);
}
