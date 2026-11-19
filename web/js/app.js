/**
 * The running app: rendering, tabs, sheets, the phone's Back button, and keeping Today fresh.
 *
 * @import { EditView, Opened, SheetType, Tab } from '../../types/app'
 */
import { loadArchive } from './admin/archive.js';
import { discardDraft, isDirty, loadDraft } from './admin/draft.js';
import { editScreen } from './admin/editor.js';
import { startMap, stopMap } from './admin/map.js';
import { pendingArchive, pendingEnc } from './admin/publish.js';
import { tokenAlert, tokenExpiry } from './admin/token.js';
import { html, icon, mount } from './html.js';
import { loadApp, pickLang, setLang, t, tr } from './i18n.js';
import { state } from './state.js';
import { forFamily, initTrip } from './trip.js';
import { messageScreen, SCREENS } from './ui/screens.js';
import { KEEP_AWAKE, listenPinch, renderSheet } from './ui/sheets.js';
import { fitTextareas, keepAwake, stopSpeaking, store } from './util.js';
import { fetchEnc } from './vault.js';
import { updateWeather } from './weather.js';

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
// The shell (index.html): the header, the one area that scrolls, the tab bar, and the sheet with the same parts.
const bar = byId('bar');
const page = byId('page');
const view = byId('view');
const tabsEl = byId('tabs');
const sheetEl = byId('sheet');
const sheetBar = byId('sheet-bar');
const sheetPage = byId('sheet-page');
const sheetView = byId('sheet-view');
const appEl = byId('app');
listenPinch(sheetEl);

/**
 * Keep the shell above the on-screen keyboard. Chrome on Android shrinks the page for it (the viewport meta in
 * index.html asks for that, so the shell shrinks with it). iOS Safari never does: the page keeps its full height and
 * the keyboard covers the bottom of it, so there the shell follows the visual viewport (what is really visible), and
 * the field being typed in is scrolled into view.
 */
function fitShell() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const fit = () => {
    const covered = viewport.height < innerHeight - 1;
    appEl.style.height = covered ? `${viewport.height}px` : '';
    appEl.style.transform = covered && viewport.offsetTop ? `translateY(${viewport.offsetTop}px)` : '';
    const typing = document.activeElement;
    if (covered && (typing instanceof HTMLInputElement || typing instanceof HTMLTextAreaElement))
      typing.scrollIntoView({ block: 'nearest' });
  };
  viewport.addEventListener('resize', fit);
  viewport.addEventListener('scroll', fit);
}
fitShell();

/** Back to the top of the page (a new screen opens at its top). */
export const scrollToTop = () => {
  page.scrollTop = 0;
};

/**
 * Draw a screen: the header in the bar, the body in the scrolling area.
 * @param {import('./ui/components.js').Screen} screen
 */
function showPage({ head, body }) {
  mount(bar, head);
  bar.hidden = false;
  mount(view, body);
  fitTextareas(view);
}

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
    const screen = state.tab === 'edit' ? editScreen() : SCREENS[state.tab]();
    // admin: a GitHub token that is about to expire is the first thing on Today and on the Edit tab's overview
    const alert = state.tab === 'today' || (state.tab === 'edit' && !state.edit.length) ? tokenAlert() : '';
    showPage(alert ? { head: screen.head, body: html`${alert}${screen.body}` } : screen);
  } catch (error) {
    console.error(error);
    showError();
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
  bar.hidden = true;
  mount(view, content);
}

/**
 * Something broke while drawing: the message replaces the page, but the tab bar stays, so the other tabs (Help, with
 * the emergency numbers) can still be opened, and the next successful render() draws a page again.
 */
function showError() {
  bar.hidden = true;
  mount(view, messageScreen('error.generic', true));
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
        html`<button type="button" class="tab${tab === 'help' ? ' tab--help' : ''}" data-action="tab" data-arg="${tab}">${icon(iconName)}<span>${t('tab.' + tab)}</span>${tab === 'edit' && tokenExpiry() ? html`<span class="tab-dot" aria-hidden="true"></span>` : ''}</button>`,
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
    scrollToTop();
  } else if (state.dayOpen != null) {
    state.dayOpen = null;
    render();
    scrollToTop();
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
  const inside = (state.dayOpen != null ? 1 : 0) + state.edit.length + state.sheets.length;
  const steps = Math.min(inside, depth);
  if (steps > 0) {
    depth -= steps;
    silent++;
    history.go(-steps);
  }
  state.tab = tab;
  state.dayOpen = null;
  state.edit = [];
  // the tab bar stays under an open sheet: a tap on a tab closes the sheets
  state.sheets.length = 0;
  showSheet();
  render();
  scrollToTop();
}

/** Open a screen inside the Edit tab. @param {EditView} editView */
export function openEdit(editView) {
  state.edit.push(editView);
  pushNav();
  render();
  scrollToTop();
}

/** Admin: make every screen show the edited trip (the next render draws it). */
export function useDraft() {
  if (state.draft) initTrip(structuredClone(state.draft));
}

/**
 * Admin: the draft became another trip (archived and started anew, or switched to a past one): show it, with the
 * interface words of its languages (it may have others than the trip before), from its first day.
 */
export async function useOtherTrip() {
  useDraft();
  state.dayOpen = null;
  await Promise.all(state.languages.map(loadApp));
  applyLanguage(pickLang());
}

/** Open a day in the Days tab (also from Today's list of days before the trip). @param {number} index */
export function openDay(index) {
  state.tab = 'days';
  state.dayOpen = index;
  pushNav();
  render();
  scrollToTop();
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
  sheetPage.scrollTop = 0;
}

/** Change what the top sheet shows (the taxi card's place). @param {string} arg */
export function retargetSheet(arg) {
  const top = state.sheets[state.sheets.length - 1];
  if (!top) return;
  top.arg = arg;
  showSheet();
  sheetPage.scrollTop = 0;
}

/** Draw the top sheet, or hide the sheet layer when none is open. */
export function showSheet() {
  const top = state.sheets[state.sheets.length - 1];
  if (top?.type !== 'map') stopMap();
  if (!top) {
    sheetEl.hidden = true;
    bar.inert = false;
    page.inert = false;
    sheetBar.innerHTML = '';
    sheetView.innerHTML = '';
    keepAwake(false);
    stopSpeaking();
    // catch up with the clock, on the screens that show it: re-drawing the Edit tab here would wipe an open form
    if (stamp() !== lastStamp && (state.tab === 'today' || state.dayOpen != null)) render();
    return;
  }
  try {
    sheetEl.className = 'sheet sheet--' + top.type;
    const { head, body } = renderSheet(top);
    mount(sheetBar, head);
    mount(sheetView, body);
  } catch (error) {
    console.error(error);
    state.sheets.length = 0;
    showSheet();
    showError();
    return;
  }
  sheetEl.hidden = false;
  // the page under the sheet can't be reached by Tab or a screen reader (the tab bar stays: a tap on a tab closes the sheet)
  bar.inert = true;
  page.inert = true;
  keepAwake(KEEP_AWAKE.includes(top.type));
  sheetBar.querySelector('button')?.focus({ preventScroll: true });
  if (top.type === 'map') startMap();
}

/* ---------- start and keep fresh ---------- */

/** Re-render Today or an open day when the minute changes (the "Next" countdown). */
function refresh() {
  if (state.trip && !state.sheets.length && (state.tab === 'today' || state.dayOpen != null) && stamp() !== lastStamp) {
    render();
  }
}

/** Fetch weather and redraw if a new forecast arrived. @param {boolean} [force] */
export async function refreshWeather(force = false) {
  const changed = await updateWeather(force);
  if (changed && !state.sheets.length && (state.tab === 'today' || state.tab === 'days')) render();
}

/**
 * A newer app or trip is waiting: the service worker took over with new files, or the site serves a
 * trip.enc other than the one this page opened. A page that stays open (a phone's home-screen app is
 * resumed, not launched) would otherwise keep showing the old one.
 */
let updateWaiting = false;
const hadWorker = !!navigator.serviceWorker?.controller; // the very first install also "takes over": not an update

/** Reload into the new version, unless that would lose something (an open sheet or editor, unpublished edits). */
function applyUpdate() {
  if (updateWaiting && !state.sheets.length && !state.edit.length && !state.publishing && !isDirty()) location.reload();
}

/** Ask for new app files (the browser only checks on navigation) and for a new trip.enc. */
async function checkForUpdates() {
  navigator.serviceWorker
    ?.getRegistration()
    .then((registration) => registration?.update())
    .catch(() => {});
  const fetched = await fetchEnc();
  if (fetched && state.enc && (await pendingEnc(fetched)).iv !== state.enc.iv) updateWaiting = true;
  applyUpdate();
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
      checkForUpdates();
    }
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (!hadWorker) return;
    updateWaiting = true;
    applyUpdate();
  });
  // the moment the phone gets internet back, fetch a fresh forecast; when it loses it, say so on the card
  addEventListener('online', () => refreshWeather(true));
  // the phone says it lost the internet: try the forecast now, and the card says so if that fails too
  addEventListener('offline', () => refreshWeather(true));
}

/**
 * A phone that finds another trip than it had (the admin switched trips) starts with empty checklists: the ticks and
 * the own items of the trip before would not fit this one, even under the same list names. A trip without an id
 * (one that never was archived or switched) changes nothing.
 * @param {string | null} id  the published trip's id
 */
function forgetOtherTrip(id) {
  const known = store.get('tripId', /** @type {string | null} */ (null));
  if (id === known) return;
  store.clearLists();
  store.set('tripId', id);
}

/**
 * Start the app with an opened trip. The admin sees (and edits) a draft copy of everything; the family
 * sees hidden days as "Plan coming later". The family password only decrypts its own part of trip.enc,
 * which already is forFamily's result; it still matters for a trip.enc made before that (0.0.4).
 * @param {Opened} opened
 */
export async function start(opened) {
  state.opened = opened;
  state.role = opened.role;
  forgetOtherTrip(opened.payload.trip.id ?? null);
  if (opened.role === 'admin') {
    state.original = structuredClone(opened.payload);
    // the past trips (archive.enc) and the unpublished draft, which may hold changes to them
    const [, saved] = await Promise.all([loadArchive(await pendingArchive()), loadDraft()]);
    state.draft = saved?.payload ?? structuredClone(opened.payload);
    if (saved?.archive) state.archive = saved.archive;
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
