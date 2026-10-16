/**
 * The running app: rendering, tabs, sheets, the phone's Back button, and keeping Today fresh.
 *
 * @import { EditView, Opened, SheetType, Tab } from '../../types/app'
 */
import { discardDraft, loadDraft } from './admin/draft.js';
import { editScreen } from './admin/editor.js';
import { html, icon, mount } from './html.js';
import { loadApp, pickLang, setLang, t, tr } from './i18n.js';
import { state } from './state.js';
import { forFamily, initTrip } from './trip.js';
import { messageScreen, SCREENS } from './ui/screens.js';
import { KEEP_AWAKE, moneyUpdate, renderSheet } from './ui/sheets.js';
import { keepAwake, stopSpeaking } from './util.js';
import { updateWeather } from './weather.js';

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const view = byId('view');
const sheetEl = byId('sheet');
const tabsEl = byId('tabs');

/** @type {[Tab, string][]} tab and its icon */
const TABS = [
  ['today', 'sun'],
  ['days', 'calendar'],
  ['lists', 'check'],
  ['phrases', 'chat'],
  ['help', 'buoy'],
];
/** @type {[Tab, string]} only for the admin password */
const EDIT_TAB = ['edit', 'edit'];

/** Minute of the last render, to re-render Today when the clock moves on. */
let lastStamp = '';
const stamp = () => {
  const now = new Date();
  return `${now.toDateString()} ${now.getHours()}:${now.getMinutes()}`;
};

/** Draw the current tab. If drawing fails, show a message instead of a blank screen. */
export function render() {
  try {
    mount(view, state.tab === 'edit' ? editScreen() : SCREENS[state.tab]());
  } catch (error) {
    console.error(error);
    mount(view, messageScreen('error.generic', true));
  }
  for (const b of tabsEl.querySelectorAll('[data-action="tab"]')) {
    b.setAttribute('aria-current', b.getAttribute('data-arg') === state.tab ? 'page' : 'false');
  }
  lastStamp = stamp();
}

/**
 * Show a screen outside the app (login, messages): no tab bar.
 * @param {import('./html.js').Html} content
 */
export function showScreen(content) {
  tabsEl.hidden = true;
  mount(view, content);
}

/** Switch language: words, dates, title and tab bar. @param {string} lang */
export function applyLanguage(lang) {
  setLang(lang);
  document.title = state.trip ? tr(state.trip.title) : t('login.title');
  const tabs = state.role === 'admin' ? [...TABS, EDIT_TAB] : TABS;
  tabsEl.style.setProperty('--tab-count', String(tabs.length));
  mount(
    tabsEl,
    html`${tabs.map(
      ([tab, iconName]) =>
        html`<button type="button" class="tab${tab === 'help' ? ' tab--help' : ''}" data-action="tab" data-arg="${tab}">${icon(iconName)}<span>${t('tab.' + tab)}</span></button>`,
    )}`,
  );
}

/* ---------- the phone's Back button closes sheets, days and editor screens ---------- */

let depth = 0; // history entries we pushed
let silent = 0; // history moves whose popstate we ignore

function pushNav() {
  try {
    history.pushState({ trip: Date.now() }, '');
    depth++;
  } catch {}
}

export function goBack() {
  if (depth > 0) history.back();
  else stepBack();
}

function stepBack() {
  if (state.sheets.length) {
    state.sheets.pop();
    showSheet();
  } else if (state.tab === 'edit' && state.edit.length) {
    state.edit.pop();
    render();
    window.scrollTo(0, 0);
  } else if (state.dayOpen != null) {
    state.dayOpen = null;
    render();
    window.scrollTo(0, 0);
  }
}

addEventListener('popstate', () => {
  if (silent) {
    silent--;
    return;
  }
  depth = Math.max(0, depth - 1);
  stepBack();
});

/** @param {Tab} tab */
export function setTab(tab) {
  // leaving an open day or editor screen: drop their history entries quietly
  const inside = (state.dayOpen != null ? 1 : 0) + state.edit.length;
  const steps = Math.min(inside, depth);
  if (steps > 0) {
    depth -= steps;
    silent++;
    history.go(-steps);
  }
  state.tab = tab;
  state.dayOpen = null;
  state.edit = [];
  render();
  window.scrollTo(0, 0);
}

/** Open a screen inside the Edit tab. @param {EditView} editView */
export function openEdit(editView) {
  state.edit.push(editView);
  pushNav();
  render();
  window.scrollTo(0, 0);
}

/** Admin: make every screen show the edited trip (the next render draws it). */
export function useDraft() {
  if (state.draft) initTrip(structuredClone(state.draft));
}

/** @param {number} index */
export function openDay(index) {
  state.dayOpen = index;
  pushNav();
  render();
  window.scrollTo(0, 0);
}

/* ---------- sheets ---------- */

/**
 * @param {SheetType} type
 * @param {string | number} [arg]
 */
export function openSheet(type, arg) {
  state.sheets.push({ type, arg });
  pushNav();
  showSheet();
  sheetEl.scrollTop = 0;
}

/** Change what the top sheet shows (the taxi card's place). @param {string} arg */
export function retargetSheet(arg) {
  const top = state.sheets[state.sheets.length - 1];
  if (!top) return;
  top.arg = arg;
  showSheet();
  sheetEl.scrollTop = 0;
}

/** Draw the top sheet, or hide the sheet layer when none is open. */
export function showSheet() {
  const top = state.sheets[state.sheets.length - 1];
  if (!top) {
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
    document.documentElement.classList.remove('locked');
    keepAwake(false);
    stopSpeaking();
    if (stamp() !== lastStamp) render();
    return;
  }
  try {
    sheetEl.className = 'sheet sheet--' + top.type;
    mount(sheetEl, renderSheet(top));
  } catch (error) {
    console.error(error);
    state.sheets.length = 0;
    showSheet();
    mount(view, messageScreen('error.generic', true));
    return;
  }
  sheetEl.hidden = false;
  document.documentElement.classList.add('locked');
  keepAwake(KEEP_AWAKE.includes(top.type));
  if (top.type === 'money') moneyUpdate(top, false);
  sheetEl.querySelector(/** @type {'button'} */ ('button.close'))?.focus({ preventScroll: true });
}

/** The sheet on top, if any. */
export const topSheet = () => state.sheets[state.sheets.length - 1];

/* ---------- start and keep fresh ---------- */

/** Re-render Today or an open day when the minute changes (the "Next" countdown). */
function refresh() {
  if (state.trip && !state.sheets.length && (state.tab === 'today' || state.dayOpen != null) && stamp() !== lastStamp) {
    render();
  }
}

/** Fetch weather and redraw if a new forecast arrived. @param {boolean} [force] */
async function refreshWeather(force = false) {
  const changed = await updateWeather(force);
  if (changed && !state.sheets.length && (state.tab === 'today' || state.tab === 'days')) render();
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  setInterval(() => {
    refresh();
    refreshWeather();
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refresh();
      refreshWeather();
    }
  });
  // the moment the phone gets internet back, fetch a fresh forecast; when it loses it, say so on the card
  addEventListener('online', () => refreshWeather(true));
  addEventListener('offline', () => {
    if (!state.sheets.length && (state.tab === 'today' || state.tab === 'days')) render();
  });
}

/**
 * Start the app with an opened trip. The admin sees (and edits) a draft copy of everything; the family
 * sees hidden days as "Plan coming later".
 * @param {Opened} opened
 */
export async function start(opened) {
  state.opened = opened;
  state.role = opened.role;
  if (opened.role === 'admin') {
    state.original = structuredClone(opened.payload);
    state.draft = (await loadDraft()) ?? structuredClone(opened.payload);
  }
  try {
    initTrip(structuredClone(state.draft ?? forFamily(opened.payload)));
  } catch (error) {
    // a broken draft must never lock the admin out: drop it and open the published trip
    if (!state.draft) throw error;
    console.error(error);
    await discardDraft();
    state.notice = { kind: 'warn', text: t('edit.draftBroken') };
    initTrip(structuredClone(opened.payload));
  }
  await Promise.all(state.languages.map(loadApp));
  applyLanguage(pickLang());
  tabsEl.hidden = false;
  render();
  watch();
  refreshWeather();
}
