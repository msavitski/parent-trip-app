/*
  The trip app. The trip itself arrives encrypted in trip.enc (made by tools/build.py) and is opened
  with the family password; the app's own words come from locales/<language>/app.json.
  No human-readable text lives in this file: interface words come from t('key'), trip words from tr(value).
*/
(() => {
'use strict';
const view = document.getElementById('view');
const sheetEl = document.getElementById('sheet');
const tabsEl = document.getElementById('tabs');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
const baseLang = l => String(l || '').toLowerCase().split('-')[0];

/* ---------- storage (may be unavailable: private mode, blocked site data) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('trip:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('trip:' + k, JSON.stringify(v)); } catch {} },
  // everything this app saved on the phone, except the chosen language
  clearTrip() { try { Object.keys(localStorage).filter(k => k.startsWith('trip:') && k !== 'trip:lang').forEach(k => localStorage.removeItem(k)); } catch {} },
};

/* ---------- the trip: filled in once trip.enc is opened ---------- */
let T = null, S = {}, LANGS = ['en'], FALLBACK = 'en', DAYS = [], W = null, canSpeak = false;
let tripLoc = {};        // tripLoc[lang] = { key: text } from private/locales/<lang>/trip.json

/* ---------- translations ---------- */
const LOC = {};          // LOC[lang] = { app: { key: text } }
const RULES = {};        // plural rules per language
let lang = 'en', locale = 'en-GB', fmt = {};

async function loadApp(l) {
  if (LOC[l]) return true;
  let app = self.LOCALES?.[l]?.app;   // bundled copy in the single-file build
  if (!app) { try { const r = await fetch(`locales/${l}/app.json`); if (r.ok) app = await r.json(); } catch {} }
  if (app) LOC[l] = { app };
  return !!app;
}
const dict = (l, ns) => ns === 'app' ? LOC[l]?.app : tripLoc[l];

const missing = new Set();
let warnTimer = 0;
function lookup(ns, key, vars) {
  for (const l of lang === FALLBACK ? [lang] : [lang, FALLBACK]) {
    const d = dict(l, ns);
    if (!d) continue;
    let s;
    if (typeof vars.count === 'number') {
      const rule = (RULES[l] ??= new Intl.PluralRules(LOC[l]?.app['meta.locale'] || l)).select(vars.count);
      s = d[`${key}.${rule}`] ?? d[`${key}.other`];
    }
    s ??= d[key];
    if (s != null) {
      if (l !== lang) note(`${lang}/${ns}.json: ${key}`);
      return s;
    }
  }
  note(`${FALLBACK}/${ns}.json: ${key}`);
  return key;   // a visible key on screen means a missing translation
}
function note(what) {
  if (missing.has(what)) return;
  missing.add(what);
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => console.warn('Missing translations:\n' + [...missing].join('\n')), 300);
}

// interface words: t('tab.today'), t('today.dayXofY', { x: 2, y: 5 })
const t = (key, vars = {}) => fill(lookup('app', key, vars), vars);
// trip words from trip.json5: "d1.title" or ["meet.lobbyAt", { time: "09:45" }]
const tr = v => {
  if (v == null || v === '') return '';
  const [key, vars = {}] = Array.isArray(v) ? v : [v];
  return fill(lookup('trip', key, vars), vars);
};

// before the trip is open: the saved choice, else the phone's language, else English
async function pickLoginLang() {
  const wanted = [store.get('lang', null), ...(navigator.languages || [navigator.language]).slice(0, 3).map(baseLang), 'en'];
  for (const l of new Set(wanted.filter(Boolean))) if (await loadApp(l)) return l;
  return 'en';
}
// once it's open: only the trip's languages
function pickLang() {
  const ok = l => l && LANGS.includes(l) && LOC[l];
  const saved = store.get('lang', null);
  if (ok(saved)) return saved;
  if (ok(S.language)) return S.language;
  for (const l of navigator.languages || [navigator.language]) if (ok(baseLang(l))) return baseLang(l);
  return FALLBACK;
}

function setLang(l) {
  lang = l;
  locale = LOC[l]?.app['meta.locale'] || l;
  document.documentElement.lang = l;
  fmt = {
    long: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    short: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
    wd: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    mon: new Intl.DateTimeFormat(locale, { month: 'short' }),
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
  };
  document.title = T ? tr(T.title) : t('login.title');
  tabsEl.innerHTML = [['today', 'sun'], ['days', 'calendar'], ['lists', 'check'], ['phrases', 'chat'], ['help', 'buoy']]
    .map(([k, i]) => `<button type="button" class="tab${k === 'help' ? ' tab--help' : ''}" data-tab="${k}">${ic(i)}<span>${esc(t('tab.' + k))}</span></button>`).join('');
}
const cap = s => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);

/* ---------- icons (24px grid, stroked) ---------- */
const ICONS = {
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
  buoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  bed: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 2v2M10 2v2M14 2v2"/>',
  landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><polygon points="12 2 20 7 4 7"/>',
  ship: '<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6M12 10v4M12 2v3"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m7 22 3-7M14 22l-1-5-3-3 1-5 4 4 3 1M8 11l3-2"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  suitcase: '<path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14M10 20h4"/><circle cx="16" cy="20" r="2"/><circle cx="8" cy="20" r="2"/>',
  vol: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  max: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  swap: '<path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  check: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudSun: '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.95 12.65a4 4 0 0 0-5.93-4.13"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  rain: '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24M16 14v6M8 14v6M12 16v6"/>',
  snow: '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
  fog: '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24M16 17H7M17 21H9"/>',
  storm: '<path d="M6 16.33A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.97"/><path d="m13 12-3 5h4l-3 5"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  sunset: '<path d="M12 10V2M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M16 6l-4 4-4-4M16 18a4 4 0 0 0-8 0"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
};
const ic = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.dot}</svg>`;

/* ---------- dates and times ---------- */
const DAY_MS = 864e5;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((midnight(b) - midnight(a)) / DAY_MS);
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

const todayIdx = () => DAYS.findIndex(d => daysBetween(d.when, new Date()) === 0);
const inText = diff => {
  const h = Math.floor(diff / 60), m = diff % 60;
  return t('time.in', { t: [h && `${h} ${t('time.h')}`, (m || !h) && `${m} ${t('time.min')}`].filter(Boolean).join(' ') });
};

/* ---------- small helpers ---------- */
const checks = {};
const getChecks = id => (checks[id] ??= store.get('checks:' + id, []));

const q = p => encodeURIComponent([p.localName, p.address].filter(Boolean).join(', '));
const mapUrl = p => 'https://www.google.com/maps/search/?api=1&query=' + q(p);
const dirUrl = p => 'https://www.google.com/maps/dir/?api=1&destination=' + q(p);
const telUrl = n => 'tel:' + String(n).replace(/[^\d+]/g, '');
const EXT = 'target="_blank" rel="noopener"';

const money = (v, c, dec) => {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: c.code, currencyDisplay: 'narrowSymbol', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v); }
  catch { return `${v.toFixed(dec)} ${c.symbol}`; }
};

function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = S.speechLang; u.rate = 0.8;
    const base = S.speechLang.slice(0, 2).toLowerCase();
    const v = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().replace('_', '-').startsWith(base));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}

let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    else if (!on && wake) { const w = wake; wake = null; await w.release(); }
  } catch { wake = null; }
}

/* ---------- weather (Open-Meteo: free, no key). The last forecast is kept on the phone for offline use. ---------- */
const WX_FIELDS = 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,'
  + 'sunset,wind_speed_10m_max,wind_gusts_10m_max,precipitation_probability_max';
const WX_FRESH = 30 * 60e3;     // don't ask again within 30 minutes of a good answer
const WX_RETRY = 5 * 60e3;      // or within 5 minutes of a failed try
let wx = store.get('weather', null);   // { at, lat, lon, days: { 'YYYY-MM-DD': { max, min, wind, sunset, ... } } }
let wxTried = 0;
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const wxHere = () => W && wx && wx.lat === W.lat && wx.lon === W.lon;

function ingestWeather(json, at) {
  const d = json.daily, days = wxHere() ? { ...wx.days } : {};
  d.time.forEach((date, i) => {
    const v = k => d[k]?.[i] ?? null;
    if (v('temperature_2m_max') == null) return;   // the API leaves the last days empty sometimes
    days[date] = {
      code: v('weather_code'), max: v('temperature_2m_max'), min: v('temperature_2m_min'),
      feelsMax: v('apparent_temperature_max'), feelsMin: v('apparent_temperature_min'),
      wind: v('wind_speed_10m_max'), gust: v('wind_gusts_10m_max'),
      rain: v('precipitation_probability_max'), sunset: (v('sunset') || '').slice(11, 16),
    };
  });
  wx = { at, lat: W.lat, lon: W.lon, days: Object.fromEntries(Object.entries(days).sort().slice(-40)) };
}

async function updateWeather(force = false) {
  if (!W || navigator.onLine === false) return;
  const now = Date.now();
  if (!force && (now - wxTried < WX_RETRY || (wxHere() && now - wx.at < WX_FRESH))) return;
  wxTried = now;
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10e3);
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${W.lat}&longitude=${W.lon}`
      + `&daily=${WX_FIELDS}&timezone=auto&past_days=1&forecast_days=16`, { signal: ctrl.signal });
    if (!r.ok) return;
    ingestWeather(await r.json(), Date.now());
    store.set('weather', wx);
    if (!sheets.length && (tab === 'today' || tab === 'days')) render();
  } catch {} finally { clearTimeout(timer); }
}

const wxFor = date => (wxHere() && wx.days[isoDate(date)]) || null;
function wxKind(c) {
  if (c === 0) return 'clear';
  if (c === 1 || c === 2) return 'partly';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 80 && c <= 82) return 'showers';
  if (c >= 95) return 'storm';
  return 'cloudy';
}
const WX_ICON = { clear: 'sun', partly: 'cloudSun', cloudy: 'cloud', fog: 'fog', drizzle: 'rain', rain: 'rain', showers: 'rain', snow: 'snow', storm: 'storm' };

// What to wear, from the "feels like" temperatures, wind and rain. Thresholds in °C and km/h.
function outfit(w) {
  const hi = w.feelsMax ?? w.max, lo = w.feelsMin ?? w.min, kind = wxKind(w.code);
  const style = hi >= 27 ? 'wear.hot' : hi >= 21 ? 'wear.warm' : hi >= 15 ? 'wear.mild'
    : hi >= 8 ? 'wear.cool' : hi >= 0 ? 'wear.cold' : 'wear.freezing';
  const extra = [];
  if (hi - lo >= 8 && hi >= 8) extra.push('wear.layer');
  if (w.wind >= 30 || w.gust >= 55) extra.push('wear.wind');
  if (['rain', 'showers', 'storm'].includes(kind) || w.rain >= 50) extra.push('wear.umbrella');
  if (kind === 'snow') extra.push('wear.snow');
  if (hi >= 25 && (kind === 'clear' || kind === 'partly')) extra.push('wear.sun');
  return { style, extra };
}

const temp = v => `${Math.round(v)}°`.replace('-', '−');
function wind(kmh) {
  const u = LOC[lang].app['meta.windUnit'] || 'kmh';
  return { v: Math.round(u === 'ms' ? kmh / 3.6 : u === 'mph' ? kmh / 1.609 : kmh), unit: t('wx.unit.' + u) };
}
function wxUpdated() {
  const at = new Date(wx.at);
  const when = daysBetween(at, new Date()) === 0 ? t('wx.atTime', { time: fmt.time.format(at) })
    : `${fmt.short.format(at)}, ${fmt.time.format(at)}`;
  return t('wx.updated', { when }) + (navigator.onLine === false ? ` · ${t('wx.offline')}` : '');
}

function weatherCard(date) {
  if (!W) return '';
  const w = wxFor(date);
  if (!w) return `<section class="card wx wx--empty">${ic('cloud')}<p>${esc(t(daysBetween(new Date(), date) > 14 ? 'wx.notYet' : 'wx.none'))}</p></section>`;
  const kind = wxKind(w.code), o = outfit(w), wd = wind(w.wind);
  const cell = (icon, value, label, unit) => `<div class="wx-cell"><dt>${esc(label)}</dt>
    <dd>${ic(icon)}<b>${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</b></dd></div>`;
  return `<section class="card wx" aria-label="${esc(t('wx.title'))}">
    <div class="wx-head">${ic(WX_ICON[kind], 'ic wx-ic')}<p><b>${esc(t('wx.code.' + kind))}</b>${w.rain >= 20 ? `<span class="muted">, ${esc(t('wx.rain', { p: w.rain }))}</span>` : ''}</p></div>
    <dl class="wx-grid">${cell('up', temp(w.max), t('wx.max'))}${cell('down', temp(w.min), t('wx.min'))}${cell('wind', wd.v, t('wx.wind'), wd.unit)}${cell('sunset', w.sunset || '–', t('wx.sunset'))}</dl>
    <div class="wear"><p class="label">${esc(t('wear.title'))}</p>
      <p class="wear-main">${ic('shirt')}<span>${esc(t(o.style))}</span></p>
      ${o.extra.length ? `<ul class="wear-list">${o.extra.map(k => `<li>${esc(t(k))}</li>`).join('')}</ul>` : ''}</div>
    <p class="wx-upd">${esc(wxUpdated())}</p></section>`;
}
const wxMini = date => {
  const w = wxFor(date);
  return w ? `<span class="wx-mini">${ic(WX_ICON[wxKind(w.code)])}${esc(temp(w.max))} / ${esc(temp(w.min))}</span>` : '';
};

/* ---------- pieces ---------- */
const hello = (big, sub, eyebrow = tr(T.title)) => `<header class="hello">
  <p class="eyebrow"><span>${esc(eyebrow)}</span>${S.demoTodayIsDay ? `<span class="demo">${esc(t('badge.demo'))}</span>` : ''}</p>
  <h1 class="big">${esc(big)}</h1>${sub ? `<p class="date">${esc(sub)}</p>` : ''}</header>`;
const noteBox = text => `<p class="note">${ic('info')}<span>${esc(text)}</span></p>`;

function evActions(e) {
  const p = e.place && T.places[e.place], out = [];
  if (p) out.push(`<a class="btn" href="${mapUrl(p)}" ${EXT}>${ic('pin')}${esc(t('action.map'))}</a>`,
                  `<button class="btn" type="button" data-taxi="${esc(e.place)}">${ic('car')}${esc(t('action.taxi'))}</button>`);
  if (e.ticket && T.tickets[e.ticket]) out.push(`<button class="btn" type="button" data-ticket="${esc(e.ticket)}">${ic('ticket')}${esc(t('action.ticket'))}</button>`);
  return out.length ? `<div class="actions">${out.join('')}</div>` : '';
}

function evStates(d, live) {
  if (!live) return d.events.map(() => '');
  const now = nowMin();
  const next = d.events.findIndex(e => toMin(e.time) > now);
  const upto = next < 0 ? d.events.length : next;
  return d.events.map((e, i) => i === next ? 'next' : i === upto - 1 && now - toMin(e.time) < 120 ? 'now' : i < upto ? 'past' : '');
}

function timeline(d, live) {
  const st = evStates(d, live);
  return `<ol class="timeline">${d.events.map((e, i) => `<li class="ev${st[i] ? ' ev--' + st[i] : ''}">
    <div class="ev-time">${esc(e.time)}</div><div class="ev-rail"></div>
    <div class="ev-body">
      ${st[i] === 'now' || st[i] === 'next' ? `<span class="tag tag--${st[i]}">${esc(t('badge.' + st[i]))}</span>` : ''}
      <h3 class="ev-title">${ic(e.icon)}<span>${esc(tr(e.title))}</span></h3>
      ${e.note ? `<p>${esc(tr(e.note))}</p>` : ''}
      ${e.meet ? `<p><b>${esc(t('event.meet'))}:</b> ${esc(tr(e.meet))}</p>` : ''}
      ${st[i] === 'past' ? '' : evActions(e)}
    </div></li>`).join('')}</ol>`;
}

function nextSign(d) {
  const now = nowMin(), e = d.events.find(e => toMin(e.time) > now);
  if (!e) return `<section class="sign sign--rest">${ic('moon')}<p>${esc(t('today.nothingMore'))}</p></section>`;
  return `<section class="sign" aria-label="${esc(t('badge.next'))}">
    <div class="sign-head"><span class="sign-tag">${esc(t('badge.next'))}</span><span>${esc(inText(toMin(e.time) - now))}</span></div>
    <div class="sign-main"><span class="sign-time">${esc(e.time)}</span><h2 class="sign-title">${esc(tr(e.title))}</h2></div>
    ${e.meet ? `<p><b>${esc(t('event.meet'))}:</b> ${esc(tr(e.meet))}</p>` : ''}
    ${evActions(e)}</section>`;
}

function tiles() {
  const fam = T.help.family[0], hotel = T.places[T.help.hotel];
  return `<div class="tiles">
    <a class="tile" href="${telUrl(fam.phone)}">${ic('phone')}<span>${esc(t('tile.call', { name: fam.name }))}<small>${esc(fam.phone)}</small></span></a>
    <button class="tile" type="button" data-taxi="${esc(T.help.hotel)}">${ic('car')}<span>${esc(t('tile.taxi'))}<small>${esc(t('tile.taxi.sub'))}</small></span></button>
    <a class="tile" href="${dirUrl(hotel)}" ${EXT}>${ic('nav')}<span>${esc(t('tile.hotel'))}<small>${esc(t('tile.hotel.sub'))}</small></span></a>
    <button class="tile" type="button" data-open="tickets">${ic('ticket')}<span>${esc(t('tile.tickets'))}<small>${esc(t('tile.tickets.sub', { count: Object.keys(T.tickets).length }))}</small></span></button>
    <button class="tile" type="button" data-open="money">${ic('coins')}<span>${esc(t('tile.money'))}<small>${esc(tr(T.money.pair))}</small></span></button>
    <button class="tile tile--sos" type="button" data-tab="help">${ic('buoy')}<span>${esc(t('tile.help'))}<small>${esc(t('tile.help.sub'))}</small></span></button>
  </div>`;
}

function dayCard(d, i) {
  const rel = daysBetween(new Date(), d.when);
  const tag = rel === 0 ? `<span class="tag tag--today">${esc(t('badge.today'))}</span>`
    : rel < 0 ? `<span class="tag tag--done">${esc(t('badge.done'))}</span>` : '<span></span>';
  return `<button class="day${rel === 0 ? ' day--today' : ''}" type="button" data-day="${i}">
    <span class="leaf"><small>${esc(fmt.wd.format(d.when))}</small><b>${d.when.getDate()}</b><small>${esc(fmt.mon.format(d.when))}</small></span>
    <span class="day-main"><span class="day-n">${esc(t('day.n', { n: d.n }))}</span><span class="day-t">${esc(tr(d.title))}</span>${wxMini(d.when)}</span>
    ${tag}${ic('chev', 'ic chev')}</button>`;
}

const person = (name, sub, phone) => `<div class="card person">
  <div class="person-main"><p class="person-name">${esc(name)}</p>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}<p class="mono">${esc(phone)}</p></div>
  <a class="btn btn--solid" href="${telUrl(phone)}">${ic('phone')}${esc(t('action.call'))}</a></div>`;

/* ---------- screens ---------- */
function viewToday() {
  const i = todayIdx(), first = DAYS[0], last = DAYS[DAYS.length - 1];
  const toStart = daysBetween(new Date(), first.when);
  if (toStart > 0) return hello(toStart === 1 ? t('today.startsTomorrow') : t('today.startsIn', { count: toStart }), cap(fmt.long.format(first.when)))
    + tiles() + `<section class="section"><h2>${esc(t('today.firstDay'))}</h2>${dayCard(first, 0)}${weatherCard(first.when)}</section>`
    + `<button class="btn" type="button" data-tab="lists" style="align-self:flex-start">${ic('check')}${esc(t('today.openPacking'))}</button>`;
  if (daysBetween(last.when, new Date()) > 0) return hello(t('today.welcomeHome'), t('today.welcomeSub')) + tiles();
  if (i < 0) return hello(t('today.freeDay'), cap(fmt.long.format(new Date()))) + weatherCard(new Date()) + tiles();
  const d = DAYS[i];
  return hello(t('today.dayXofY', { x: d.n, y: DAYS.length }), `${tr(d.title)} · ${cap(fmt.long.format(d.when))}`)
    + nextSign(d) + weatherCard(d.when) + tiles() + (d.note ? noteBox(tr(d.note)) : '')
    + `<section class="section"><h2>${esc(t('today.plan'))}</h2>${timeline(d, true)}</section>`;
}

function viewDays() {
  if (dayOpen != null) {
    const d = DAYS[dayOpen];
    return `<button class="back" type="button" data-back>${ic('left')}<span>${esc(t('days.back'))}</span></button>`
      + hello(tr(d.title), cap(fmt.long.format(d.when)), t('day.n', { n: d.n }))
      + weatherCard(d.when) + (d.note ? noteBox(tr(d.note)) : '') + timeline(d, daysBetween(d.when, new Date()) === 0);
  }
  return hello(t('days.title'), `${fmt.short.format(DAYS[0].when)} – ${fmt.short.format(DAYS[DAYS.length - 1].when)}`)
    + `<ol class="days">${DAYS.map((d, i) => `<li>${dayCard(d, i)}</li>`).join('')}</ol>`;
}

function viewLists() {
  return hello(t('lists.title'), '') + `<div class="stack">${T.lists.map(l => {
    const c = getChecks(l.id);
    return `<section class="card list">
      <div class="list-head"><h2>${esc(tr(l.title))}</h2><span class="count" id="count-${esc(l.id)}">${esc(t('lists.count', { x: c.length, y: l.items.length }))}</span></div>
      <ul class="checks">${l.items.map((it, j) => `<li><label class="check" for="c-${esc(l.id)}-${j}">
        <input type="checkbox" id="c-${esc(l.id)}-${j}" data-list="${esc(l.id)}" data-item="${j}"${c.includes(j) ? ' checked' : ''}><span>${esc(tr(it))}</span></label></li>`).join('')}</ul>
      <button class="btn btn--quiet" type="button" data-reset="${esc(l.id)}">${esc(t('lists.reset'))}</button></section>`;
  }).join('')}</div>`;
}

function viewPhrases() {
  return hello(t('phrases.title'), t('phrases.sub')) + `<div class="stack">${T.phrases.map((p, i) => `<article class="card phrase">
    <p class="ph-mean">${esc(tr(p.meaning))}</p>
    <p class="ph-local" lang="${esc(S.speechLang)}">${esc(p.local)}</p>
    <p class="ph-say">${esc(tr(p.say))}</p>
    <div class="actions">${canSpeak ? `<button class="btn" type="button" data-say="${esc(p.local)}">${ic('vol')}${esc(t('action.hear'))}</button>` : ''}
      <button class="btn" type="button" data-phrase="${i}">${ic('max')}${esc(t('action.show'))}</button></div></article>`).join('')}</div>`;
}

function viewHelp() {
  const H = T.help, hotel = T.places[H.hotel], ins = H.insurance, con = H.consulate;
  return hello(t('help.title'), '') + `
  <section class="card sos">
    <p class="sos-label">${esc(t('help.emergency'))}</p>
    <a class="sos-num" href="${telUrl(H.emergency)}">${ic('phone')}<span>${esc(H.emergency)}</span></a>
    <p>${esc(t('help.emergency.note'))}</p>
  </section>
  <section class="section"><h2>${esc(t('help.family'))}</h2><div class="stack">${H.family.map(f => person(f.name, tr(f.note), f.phone)).join('')}</div></section>
  <section class="section"><h2>${esc(t('help.lost'))}</h2><ol class="steps">${H.lost.map(s => `<li><span>${esc(tr(s))}</span></li>`).join('')}</ol></section>
  <section class="section"><h2>${esc(t('help.hotel'))}</h2><div class="card info">
    <p class="info-name">${esc(tr(hotel.name))}</p><p>${esc(hotel.address)}</p>${hotel.phone ? `<p class="mono">${esc(hotel.phone)}</p>` : ''}
    <div class="actions"><button class="btn" type="button" data-taxi="${esc(H.hotel)}">${ic('car')}${esc(t('tile.taxi'))}</button>
      <a class="btn" href="${mapUrl(hotel)}" ${EXT}>${ic('pin')}${esc(t('action.map'))}</a>
      ${hotel.phone ? `<a class="btn" href="${telUrl(hotel.phone)}">${ic('phone')}${esc(t('action.call'))}</a>` : ''}</div></div></section>
  ${ins ? `<section class="section"><h2>${esc(t('help.insurance'))}</h2><div class="card info">
    <p class="info-name">${esc(ins.company)}</p><p><span class="label">${esc(t('help.policy'))}</span> <span class="mono">${esc(ins.policy)}</span></p>
    ${ins.note ? `<p class="muted">${esc(tr(ins.note))}</p>` : ''}<p class="mono">${esc(ins.phone)}</p>
    <div class="actions"><a class="btn" href="${telUrl(ins.phone)}">${ic('phone')}${esc(t('action.call'))}</a></div></div></section>` : ''}
  ${con ? `<section class="section"><h2>${esc(t('help.consulate'))}</h2>${person(tr(con.name), tr(con.note), con.phone)}</section>` : ''}
  ${LANGS.length > 1 ? `<section class="section"><h2>${esc(t('help.language'))}</h2><div class="chips">${LANGS.map(l =>
    `<button class="chip" type="button" lang="${esc(l)}" data-lang="${esc(l)}" aria-pressed="${l === lang}">${esc(LOC[l]?.app['meta.name'] || l)}</button>`).join('')}</div></section>` : ''}
  <section class="section"><h2>${esc(t('help.phone'))}</h2><div class="card info">
    <p class="muted">${esc(t('help.forgetNote'))}</p>
    <div class="actions"><button class="btn btn--quiet" type="button" data-forget>${ic('lock')}<span>${esc(t('help.forget'))}</span></button></div></div></section>`;
}

/* ---------- full-screen sheets ---------- */
const sheetHead = title => `<div class="sheet-top"><h2 class="sheet-title">${esc(title)}</h2>
  <button class="close" type="button" data-back>${ic('x')}<span>${esc(t('action.close'))}</span></button></div>`;

const SHEETS = {
  taxi(id) {
    const p = T.places[id];
    return sheetHead(t('taxi.title')) + `
      <p class="taxi-hint">${esc(t('taxi.hint'))}</p>
      <div class="taxi-card" lang="${esc(S.speechLang)}">
        <p class="taxi-ask">${esc(T.taxi.ask)}</p>
        <p class="taxi-name">${esc(p.localName || tr(p.name))}</p>
        <p class="taxi-addr">${esc(p.address)}</p>
      </div>
      <div class="actions"><a class="btn" href="${mapUrl(p)}" ${EXT}>${ic('pin')}${esc(t('action.openMap'))}</a>
        ${canSpeak ? `<button class="btn" type="button" data-say="${esc(`${T.taxi.ask} ${p.localName || ''}`)}">${ic('vol')}${esc(t('action.hear'))}</button>` : ''}</div>
      <div class="section"><h3 class="sub">${esc(t('taxi.other'))}</h3>
        <div class="chips">${Object.entries(T.places).filter(([k]) => k !== id)
          .map(([k, o]) => `<button class="chip" type="button" data-swap-place="${esc(k)}">${esc(tr(o.name))}</button>`).join('')}</div></div>`;
  },
  tickets() {
    return sheetHead(t('tickets.title')) + `<ul class="tk-list">${Object.entries(T.tickets).map(([k, tk]) => `<li>
      <button class="tk" type="button" data-ticket="${esc(k)}">${ic('ticket')}<span class="tk-main"><b>${esc(tr(tk.title))}</b><span>${esc(tr(tk.when))}</span></span>${ic('chev', 'ic chev')}</button></li>`).join('')}</ul>`;
  },
  ticket(id) {
    const tk = T.tickets[id];
    return sheetHead(tr(tk.title)) + `<div class="ticket">
      ${tk.image ? `<img class="ticket-img" src="${esc(tk.image)}" alt="${esc(tr(tk.title))}">` : ''}
      <p class="ticket-when">${esc(tr(tk.when))}</p>
      <p class="label">${esc(t('ticket.code'))}</p><p class="ticket-code">${esc(tk.code)}</p>
      ${tk.details?.length ? `<ul class="ticket-details">${tk.details.map(x => `<li>${esc(tr(x))}</li>`).join('')}</ul>` : ''}
      <p class="ticket-hint">${ic('sun')}<span>${esc(t('ticket.brightness'))}</span></p></div>`;
  },
  money() {
    const m = T.money;
    return sheetHead(t('money.title')) + `<div class="money">
      <label class="label" for="m-in" id="m-lab"></label>
      <div class="money-in"><span class="cur" id="m-cur" aria-hidden="true"></span><input id="m-in" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0"></div>
      <p class="money-out"><span aria-hidden="true">≈ </span><output id="m-out" for="m-in"></output></p>
      <div class="chips" id="m-quick"></div>
      <button class="btn" type="button" data-money-swap>${ic('swap')}<span id="m-swap"></span></button>
      <p class="muted small">${esc(t('money.rate', { home: money(1, m.home, 0), rate: m.rate, local: m.local.symbol }))}</p></div>`;
  },
  phrase(i) {
    const p = T.phrases[i];
    return sheetHead('') + `<div class="show">
      <p class="label">${esc(t('phrases.showPerson'))}</p>
      <p class="show-local" lang="${esc(S.speechLang)}">${esc(p.local)}</p>
      ${p.extra ? `<p class="show-extra">${esc(p.extra)}</p>` : ''}
      <p class="show-say">${esc(tr(p.say))}</p><p class="show-mean">${esc(tr(p.meaning))}</p>
      ${canSpeak ? `<button class="btn btn--solid" type="button" data-say="${esc(p.local)}">${ic('vol')}${esc(t('action.hear'))}</button>` : ''}</div>`;
  },
};

function moneyUpdate(reset) {
  const top = sheets[sheets.length - 1], m = T.money, fromLocal = top.dir !== 'home';
  const from = fromLocal ? m.local : m.home, to = fromLocal ? m.home : m.local;
  document.getElementById('m-lab').textContent = tr(from.price);
  document.getElementById('m-cur').textContent = from.symbol;
  document.getElementById('m-swap').textContent = tr(to.from);
  document.getElementById('m-quick').innerHTML = (fromLocal ? m.quick.local : m.quick.home)
    .map(v => `<button class="chip" type="button" data-amt="${v}">${esc(money(v, from, 0))}</button>`).join('');
  if (reset) document.getElementById('m-in').value = '';
  moneyCalc();
}
function moneyCalc() {
  const top = sheets[sheets.length - 1], m = T.money, fromLocal = top.dir !== 'home';
  const to = fromLocal ? m.home : m.local;
  const v = parseFloat(document.getElementById('m-in').value.replace(',', '.').replace(/[^\d.]/g, ''));
  const out = document.getElementById('m-out');
  if (isNaN(v)) { out.textContent = '–'; return; }
  const r = fromLocal ? v / m.rate : v * m.rate;
  out.textContent = money(r, to, r >= 100 ? 0 : 2);
}

/* ---------- navigation (the phone's Back button closes sheets and days) ---------- */
let tab = 'today', dayOpen = null, depth = 0, silent = 0, lastStamp = '';
const sheets = [];
const VIEWS = { today: viewToday, days: viewDays, lists: viewLists, phrases: viewPhrases, help: viewHelp };
const stamp = () => { const n = new Date(); return `${n.toDateString()} ${n.getHours()}:${n.getMinutes()}`; };

function render() {
  view.innerHTML = VIEWS[tab]();
  tabsEl.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  lastStamp = stamp();
}
function pushNav() { try { history.pushState({ trip: Date.now() }, ''); depth++; } catch {} }
function goBack() { if (depth > 0) history.back(); else stepBack(); }
function stepBack() {
  if (sheets.length) { sheets.pop(); showSheet(); }
  else if (dayOpen != null) { dayOpen = null; render(); window.scrollTo(0, 0); }
}
addEventListener('popstate', () => { depth = Math.max(0, depth - 1); if (silent) { silent--; return; } stepBack(); });

function setTab(next) {
  if (dayOpen != null && depth > 0) { silent++; history.back(); }
  tab = next; dayOpen = null; render(); window.scrollTo(0, 0);
}
function openSheet(type, arg) { sheets.push({ type, arg }); pushNav(); showSheet(); sheetEl.scrollTop = 0; }
function showSheet() {
  const top = sheets[sheets.length - 1];
  if (!top) {
    sheetEl.hidden = true; sheetEl.innerHTML = ''; document.documentElement.classList.remove('locked');
    keepAwake(false); if (canSpeak) speechSynthesis.cancel();
    if (stamp() !== lastStamp) render();
    return;
  }
  sheetEl.className = 'sheet sheet--' + top.type;
  sheetEl.innerHTML = SHEETS[top.type](top.arg);
  sheetEl.hidden = false; document.documentElement.classList.add('locked');
  keepAwake(['taxi', 'ticket', 'phrase'].includes(top.type));
  if (top.type === 'money') moneyUpdate(false);
  sheetEl.querySelector('.close')?.focus({ preventScroll: true });
}

function resetList(b, id) {
  if (b.dataset.armed) { checks[id] = []; store.set('checks:' + id, []); render(); return; }
  b.dataset.armed = '1'; b.textContent = t('lists.resetConfirm'); b.classList.add('btn--warn');
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = t('lists.reset'); b.classList.remove('btn--warn'); } }, 4000);
}

document.addEventListener('click', e => {
  const b = e.target.closest('button, a'); if (!b) return;
  const d = b.dataset;
  if (d.tab) setTab(d.tab);
  else if (d.day) { dayOpen = +d.day; pushNav(); render(); window.scrollTo(0, 0); }
  else if ('back' in d) goBack();
  else if (d.taxi) openSheet('taxi', d.taxi);
  else if (d.swapPlace) { sheets[sheets.length - 1].arg = d.swapPlace; showSheet(); sheetEl.scrollTop = 0; }
  else if (d.ticket) openSheet('ticket', d.ticket);
  else if (d.open) openSheet(d.open);
  else if (d.phrase) openSheet('phrase', +d.phrase);
  else if (d.say) speak(d.say);
  else if (d.reset) resetList(b, d.reset);
  else if (d.lang) { store.set('lang', d.lang); setLang(d.lang); render(); }
  else if ('eye' in d) {
    const pw = document.getElementById('pw'), show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', show); b.innerHTML = ic(show ? 'eyeOff' : 'eye'); pw.focus();
  }
  else if ('forget' in d) {
    if (!b.dataset.armed) {
      b.dataset.armed = '1'; b.classList.add('btn--warn'); b.querySelector('span').textContent = t('help.forgetConfirm');
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.classList.remove('btn--warn'); b.querySelector('span').textContent = t('help.forget'); } }, 4000);
    } else { store.clearTrip(); location.replace(location.pathname); }
  }
  else if ('retry' in d) location.reload();
  else if (d.amt) { document.getElementById('m-in').value = d.amt; moneyCalc(); }
  else if ('moneySwap' in d) { const top = sheets[sheets.length - 1]; top.dir = top.dir === 'home' ? 'local' : 'home'; moneyUpdate(true); }
});
document.addEventListener('input', e => { if (e.target.id === 'm-in') moneyCalc(); });
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset.list) return;
  const id = el.dataset.list, j = +el.dataset.item, c = getChecks(id), k = c.indexOf(j);
  if (el.checked && k < 0) c.push(j);
  if (!el.checked && k >= 0) c.splice(k, 1);
  store.set('checks:' + id, c);
  const l = T.lists.find(x => x.id === id);
  document.getElementById('count-' + id).textContent = t('lists.count', { x: c.length, y: l.items.length });
});

// keep "Next" and the countdown fresh while the app stays open, and when the phone wakes up
const refresh = () => { if (T && !sheets.length && (tab === 'today' || dayOpen != null) && stamp() !== lastStamp) render(); };
setInterval(() => { refresh(); updateWeather(); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); updateWeather(); } });
// the moment the phone gets internet back, fetch a fresh forecast; when it loses it, say so on the card
addEventListener('online', () => updateWeather(true));
addEventListener('offline', () => { if (T && !sheets.length && (tab === 'today' || tab === 'days')) render(); });

/* ---------- opening the trip ---------- */
// trip.enc = { iter, salt, iv, data }: AES-256-GCM, key = PBKDF2-SHA256(password, salt, iter). See tools/build.py.
let ENC = null;
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64e = bytes => btoa(String.fromCharCode(...bytes));

async function fetchEnc() {
  if (self.TRIP_ENC) return self.TRIP_ENC;   // single-file build
  try { const r = await fetch('trip.enc'); return r.ok ? await r.json() : null; } catch { return null; }
}
async function deriveKey(password) {
  const pw = new TextEncoder().encode(password.trim().normalize('NFC'));   // same as tools/build.py
  const base = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(ENC.salt), iterations: ENC.iter }, base, 256);
  return new Uint8Array(bits);
}
// the decrypted trip, or null if the key is wrong
async function openTrip(rawKey) {
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(ENC.iv) }, key, b64d(ENC.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { return null; }
}
// the key (not the password) stays on this phone, so the app opens offline without asking again
const remember = rawKey => store.set('key', { salt: ENC.salt, iter: ENC.iter, key: b64e(rawKey) });

function initTrip(p) {
  T = p.trip;
  S = Object.assign({ languages: ['en'], language: null, speechLang: '', demoTodayIsDay: null }, T.settings);
  LANGS = S.languages.length ? S.languages : ['en'];
  FALLBACK = LANGS[0];
  tripLoc = p.locales || {};
  for (const tk of Object.values(T.tickets || {})) if (p.images?.[tk.image]) tk.image = p.images[tk.image];
  canSpeak = 'speechSynthesis' in window && !!S.speechLang;
  const shift = S.demoTodayIsDay ? daysBetween(parseDate(T.days[S.demoTodayIsDay - 1].date), new Date()) : 0;
  DAYS = T.days.map((d, i) => ({
    ...d, n: i + 1, when: addDays(parseDate(d.date), shift),
    events: [...(d.events || [])].sort((a, b) => toMin(a.time) - toMin(b.time)),
  }));
  W = T.weather || null;
  if (W && !wxHere() && self.WEATHER_RAW) ingestWeather(self.WEATHER_RAW.data, self.WEATHER_RAW.at);  // single-file build
}

async function unlocked(p) {
  initTrip(p);
  await Promise.all(LANGS.map(loadApp));
  setLang(pickLang());
  tabsEl.hidden = false;
  render();
  updateWeather();
}

function showMessage(key, retry) {
  tabsEl.hidden = true;
  view.innerHTML = `<div class="login"><span class="login-badge">${ic('lock')}</span><h1 class="big">${esc(t('login.title'))}</h1>
    <p>${esc(t(key))}</p>${retry ? `<button class="btn btn--solid btn--big" type="button" data-retry>${esc(t('login.retry'))}</button>` : ''}</div>`;
}

function showLogin(errorKey) {
  tabsEl.hidden = true;
  view.innerHTML = `<form class="login" id="login" novalidate>
    <span class="login-badge">${ic('plane')}</span>
    <h1 class="big">${esc(t('login.title'))}</h1>
    <p>${esc(t('login.text'))}</p>
    <label class="label" for="pw">${esc(t('login.password'))}</label>
    <div class="pw">
      <input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false">
      <button class="pw-eye" type="button" data-eye aria-label="${esc(t('login.show'))}" aria-pressed="false">${ic('eye')}</button>
    </div>
    <p class="login-err" id="login-err" role="alert"${errorKey ? '' : ' hidden'}>${errorKey ? esc(t(errorKey)) : ''}</p>
    <button class="btn btn--solid btn--big" type="submit" id="login-go">${ic('unlock')}<span>${esc(t('login.open'))}</span></button>
    <p class="muted small">${esc(t('login.once'))}</p>
  </form>`;
  document.getElementById('pw').focus();
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'login') return;
  e.preventDefault();
  const pw = document.getElementById('pw'), go = document.getElementById('login-go'), err = document.getElementById('login-err');
  if (!pw.value.trim()) { pw.focus(); return; }
  go.disabled = true; go.querySelector('span').textContent = t('login.opening'); err.hidden = true;
  const raw = await deriveKey(pw.value);
  const trip = await openTrip(raw);
  if (!trip) {
    go.disabled = false; go.querySelector('span').textContent = t('login.open');
    err.textContent = t('login.wrong'); err.hidden = false; pw.select();
    return;
  }
  remember(raw);
  unlocked(trip);
});

async function boot() {
  setLang(await pickLoginLang());
  await loadApp('en');
  if (!self.crypto?.subtle) return showMessage('login.unsupported');
  ENC = await fetchEnc();
  if (!ENC) return showMessage('login.noData', true);

  // 1. a setup link: …/#unlock=<password> (the part after # never leaves the phone)
  const link = location.hash.match(/^#unlock=(.+)$/);
  if (link) {
    history.replaceState(null, '', location.pathname + location.search);
    const raw = await deriveKey(decodeURIComponent(link[1]));
    const trip = await openTrip(raw);
    if (trip) { remember(raw); return unlocked(trip); }
  }
  // 2. already opened on this phone
  const saved = store.get('key', null);
  if (saved && saved.salt === ENC.salt && saved.iter === ENC.iter) {
    const trip = await openTrip(b64d(saved.key));
    if (trip) return unlocked(trip);
  }
  // 3. ask; a saved key that no longer fits means the password was changed
  showLogin(saved ? 'login.changed' : null);
}
boot();

// offline support (works on https and on localhost)
if ('serviceWorker' in navigator && /^(https:|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(location.href)) {
  try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch {}
}
})();
