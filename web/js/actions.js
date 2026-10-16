/**
 * What taps and typing do. Buttons and links carry data-action="name" (and data-arg="…"); each name
 * maps to one handler below. Checkboxes, the money input and the login form have their own listeners.
 *
 * @import { SheetType, Tab } from '../../types/app'
 */
import { discardDraft, readImage, saveDraft } from './admin/draft.js';
import { applyForm, deleteFromDraft, pagesNote, parseEditArg, toggleHidden } from './admin/editor.js';
import { publish } from './admin/publish.js';
import {
  applyLanguage,
  goBack,
  openDay,
  openEdit,
  openSheet,
  render,
  retargetSheet,
  setTab,
  showScreen,
  start,
  topSheet,
  useDraft,
} from './app.js';
import { icon, mount } from './html.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { currentTrip } from './trip.js';
import { clearTicked, loginScreen, saveTicked, ticked } from './ui/screens.js';
import { moneyCalc, moneyUpdate } from './ui/sheets.js';
import { speak, store } from './util.js';
import { deriveKey, forget, openTrip, remember } from './vault.js';

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * A button that needs a second tap within 4 seconds (untick a whole list, forget the password).
 * @param {HTMLElement} button
 * @param {HTMLElement} label  the element whose text changes
 * @param {string} confirmKey  text for "tap again…"
 * @param {string} normalKey   text to go back to
 * @param {() => void} onConfirm
 */
function confirmTwice(button, label, confirmKey, normalKey, onConfirm) {
  if (button.dataset.armed) {
    onConfirm();
    return;
  }
  button.dataset.armed = '1';
  button.classList.add('btn--warn');
  label.textContent = t(confirmKey);
  setTimeout(() => {
    if (!button.isConnected) return;
    delete button.dataset.armed;
    button.classList.remove('btn--warn');
    label.textContent = t(normalKey);
  }, 4000);
}

/** What a Delete button says, by what it deletes. @type {Record<string, string>} */
const DELETE_LABELS = { day: 'edit.deleteDay', event: 'edit.deleteEvent', ticket: 'edit.deleteTicket' };

/** @type {Record<string, (el: HTMLElement, arg: string) => void>} */
const ACTIONS = {
  tab: (_, arg) => setTab(/** @type {Tab} */ (arg)),
  day: (_, arg) => openDay(Number(arg)),
  back: () => goBack(),
  open: (_, arg) => openSheet(/** @type {SheetType} */ (arg)),
  taxi: (_, arg) => openSheet('taxi', arg),
  ticket: (_, arg) => openSheet('ticket', arg),
  phrase: (_, arg) => openSheet('phrase', Number(arg)),
  'swap-place': (_, arg) => retargetSheet(arg),
  say: (_, arg) => speak(arg, state.settings.speechLang),
  retry: () => location.reload(),

  lang(_, arg) {
    store.set('lang', arg);
    applyLanguage(arg);
    if (state.trip) render();
    else relabelLogin();
  },

  'reset-list': (el, arg) =>
    confirmTwice(el, el, 'lists.resetConfirm', 'lists.reset', () => {
      clearTicked(arg);
      render();
    }),

  forget: (el) =>
    confirmTwice(el, /** @type {HTMLElement} */ (el.querySelector('span')), 'help.forgetConfirm', 'help.forget', () =>
      forget().then(() => location.replace(location.pathname)),
    ),

  'toggle-password'(el) {
    const input = /** @type {HTMLInputElement} */ (byId('pw'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.setAttribute('aria-pressed', String(show));
    mount(el, icon(show ? 'eyeOff' : 'eye'));
    input.focus();
  },

  amount(_, arg) {
    const sheet = topSheet();
    if (!sheet) return;
    /** @type {HTMLInputElement} */ (byId('m-in')).value = arg;
    moneyCalc(sheet);
  },

  'money-swap'() {
    const sheet = topSheet();
    if (!sheet) return;
    sheet.dir = sheet.dir === 'home' ? 'local' : 'home';
    moneyUpdate(sheet, true);
  },

  /* ---------- admin: the Edit tab ---------- */

  'edit-open'(_, arg) {
    const editView = parseEditArg(arg);
    if (editView) openEdit(editView);
  },

  'edit-delete': (el, arg) =>
    confirmTwice(
      el,
      /** @type {HTMLElement} */ (el.querySelector('span')),
      'edit.deleteConfirm',
      DELETE_LABELS[arg.split(':')[0]] ?? 'edit.deleteEvent',
      () => {
        deleteFromDraft(arg);
        changed();
      },
    ),

  'edit-hide'(_, arg) {
    toggleHidden(Number(arg));
    changed(false);
  },

  discard: (el) =>
    confirmTwice(
      el,
      /** @type {HTMLElement} */ (el.querySelector('span')),
      'edit.discardConfirm',
      'edit.discard',
      () => {
        discardDraft();
        state.notice = null;
        useDraft();
        render();
      },
    ),

  async publish() {
    if (state.publishing) return;
    state.publishing = true;
    state.notice = null;
    render();
    try {
      state.notice = await publish();
    } finally {
      state.publishing = false;
      useDraft();
      render();
      window.scrollTo(0, 0);
    }
  },
};

/**
 * The draft changed: keep it on this device, show it everywhere, and close the editor screen.
 * @param {boolean} [close]  false: stay on this screen (the eye in the list of days)
 */
function changed(close = true) {
  state.notice = null;
  useDraft();
  if (close) goBack();
  else render();
  // if the device can't keep it, say so (publishing still works from memory)
  saveDraft().then((kept) => {
    if (kept) return;
    state.notice = { kind: 'warn', text: t('edit.draftNotSaved') };
    render();
  });
}

/** Save an editor form. @param {HTMLFormElement} form */
function onEditSubmit(form) {
  const error = applyForm(form);
  if (!error) return changed();
  const box = byId('form-err');
  box.textContent = t(error.key, error.vars);
  box.hidden = false;
  box.scrollIntoView({ block: 'center' });
}

/**
 * A ticket image or PDF was chosen: show it; Save puts it in the draft. The picture is updated in place,
 * so the text typed into the form so far stays. A PDF takes a moment (and pdf.js the first time).
 * @param {HTMLInputElement} input
 */
async function onImage(input) {
  const top = state.edit[state.edit.length - 1];
  const file = input.files?.[0];
  if (!file || top?.view !== 'ticket') return;
  const box = byId('form-err');
  const label = input.labels?.[0]?.querySelector('span');
  box.hidden = true;
  input.disabled = true;
  if (label) label.textContent = t('edit.ticket.reading');
  /** @type {Awaited<ReturnType<typeof readImage>>} */
  let image = null;
  let error = 'edit.err.imageType';
  try {
    image = await readImage(file, top.id);
  } catch (reason) {
    console.error(reason);
    error = 'edit.err.pdf';
  }
  input.value = '';
  if (state.edit[state.edit.length - 1] !== top || !input.isConnected) return; // the admin went elsewhere meanwhile
  input.disabled = false;
  if (label) label.textContent = t('edit.ticket.replaceImage');
  if (!image) {
    box.textContent = t(error);
    box.hidden = false;
    return;
  }
  top.image = image;
  const thumb = /** @type {HTMLImageElement} */ (byId('f-thumb'));
  thumb.src = image.dataUrl;
  thumb.hidden = false;
  const note = byId('f-pages');
  note.textContent = pagesNote(image);
  note.hidden = !note.textContent;
}

/** Tick or untick a checklist item. @param {HTMLInputElement} box */
function onCheck(box) {
  const listId = box.dataset.list ?? '';
  const item = Number(box.dataset.item);
  const done = ticked(listId);
  const at = done.indexOf(item);
  if (box.checked && at < 0) done.push(item);
  if (!box.checked && at >= 0) done.splice(at, 1);
  saveTicked(listId);
  const list = currentTrip().lists.find((l) => l.id === listId);
  byId('count-' + listId).textContent = t('lists.count', { x: done.length, y: list?.items.length ?? 0 });
}

/** The login form in the new language, keeping what was typed and the error shown. */
function relabelLogin() {
  const input = /** @type {HTMLInputElement | null} */ (byId('pw'));
  if (!input) return;
  const typed = input.value;
  const shown = input.type;
  const error = byId('login-err');
  const errorKey = error.hidden ? null : (error.dataset.key ?? null);
  showScreen(loginScreen(errorKey));
  const fresh = /** @type {HTMLInputElement} */ (byId('pw'));
  fresh.value = typed;
  if (shown === 'text') ACTIONS['toggle-password'](/** @type {HTMLElement} */ (document.querySelector('.pw-eye')), '');
}

/** Try the typed password. @param {SubmitEvent} event */
async function onLogin(event) {
  event.preventDefault();
  const enc = state.enc;
  const input = /** @type {HTMLInputElement} */ (byId('pw'));
  const go = /** @type {HTMLButtonElement} */ (byId('login-go'));
  const goLabel = /** @type {HTMLElement} */ (go.querySelector('span'));
  const error = byId('login-err');
  if (!enc || !input.value.trim()) {
    input.focus();
    return;
  }
  go.disabled = true;
  goLabel.textContent = t('login.opening');
  error.hidden = true;
  const key = await deriveKey(input.value, enc);
  const opened = await openTrip(key, enc);
  if (!opened) {
    go.disabled = false;
    goLabel.textContent = t('login.open');
    error.textContent = t('login.wrong');
    error.dataset.key = 'login.wrong';
    error.hidden = false;
    input.select();
    return;
  }
  remember(key, enc);
  start(opened);
}

/** Attach the listeners once. */
export function listen() {
  document.addEventListener('click', (event) => {
    const el = /** @type {Element} */ (event.target).closest('[data-action]');
    if (!(el instanceof HTMLElement)) return;
    const action = ACTIONS[el.dataset.action ?? ''];
    if (action) action(el, el.dataset.arg ?? '');
  });
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el instanceof HTMLInputElement && el.dataset.list) onCheck(el);
    if (el instanceof HTMLInputElement && el.id === 'f-image') onImage(el);
  });
  document.addEventListener('input', (event) => {
    const sheet = topSheet();
    if (/** @type {Element} */ (event.target).id === 'm-in' && sheet) moneyCalc(sheet);
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === 'login') onLogin(event);
    if (form.id === 'edit-form') {
      event.preventDefault();
      onEditSubmit(form);
    }
  });
}
