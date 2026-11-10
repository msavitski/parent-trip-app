/**
 * Whole screens: the five tabs, the login form and the message/error screens.
 */
import { html, icon } from '../html.js';
import { cap, fmt, loginLangs, meta, t, tr } from '../i18n.js';
import { state } from '../state.js';
import { canSpeak, currentHotelId, currentTrip, daysBetween, todayIndex, tripToday } from '../trip.js';
import { mapUrl, store, telUrl } from '../util.js';
import {
  dayCard,
  fold,
  hiddenNote,
  isSecret,
  nextSign,
  noteBox,
  pageHeader,
  person,
  screen,
  tiles,
  timeline,
  weatherCard,
} from './components.js';

/** @type {Record<string, number[]>} ticked items per list, kept in memory too in case storage is blocked */
const checks = {};

/** Indexes of the ticked items of a list (a live array: change it, then call saveTicked). @param {string} listId */
export const ticked = (listId) => (checks[listId] ??= store.get('checks:' + listId, /** @type {number[]} */ ([])));

/** @param {string} listId */
export const saveTicked = (listId) => store.set('checks:' + listId, ticked(listId));

/** @param {string} listId */
export function clearTicked(listId) {
  checks[listId] = [];
  saveTicked(listId);
  for (const item of mine(listId)) item.done = false;
  saveMine(listId);
}

/**
 * The person's own items of a list: written in the language they use, kept on this phone only (not in the trip, so
 * not shared and not translated), and ticked with the same checkbox as the trip's items.
 * @typedef {{ id: string, text: string, done: boolean }} OwnItem
 */

/** @type {Record<string, OwnItem[]>} */
const own = {};

/** The own items of a list (a live array: change it, then call saveMine). @param {string} listId */
export const mine = (listId) => (own[listId] ??= store.get('mine:' + listId, /** @type {OwnItem[]} */ ([])));

/** @param {string} listId */
export const saveMine = (listId) => store.set('mine:' + listId, mine(listId));

/**
 * Add an item of one's own to a list.
 * @param {string} listId
 * @param {string} text
 * @returns {boolean}  false when there was nothing to add
 */
export function addMine(listId, text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return false;
  mine(listId).push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: clean, done: false });
  saveMine(listId);
  return true;
}

/** @param {string} listId @param {string} id */
export function removeMine(listId, id) {
  own[listId] = mine(listId).filter((item) => item.id !== id);
  saveMine(listId);
}

/** How many items of a list are ticked, and how many there are, the person's own included. @param {{ id: string, items: unknown[] }} list */
export const listCount = (list) => ({
  x: ticked(list.id).length + mine(list.id).filter((item) => item.done).length,
  y: list.items.length + mine(list.id).length,
});

/**
 * The weather of today's real date at the trip's place, for when Today has no trip day to show (before and after the trip).
 */
function weatherToday() {
  const card = weatherCard(new Date());
  return card ? html`<section class="section"><h2>${t('today.weatherNow')}</h2>${card}</section>` : '';
}

function today() {
  const days = state.days;
  const first = days[0];
  const last = days[days.length - 1];
  const now = tripToday();
  const toStart = daysBetween(now, first.when);

  if (toStart > 0) return dayZero(toStart);
  if (daysBetween(last.when, now) > 0)
    return screen(pageHeader(t('today.welcomeHome'), t('today.welcomeSub')), html`${weatherToday()}${tiles()}`);

  const index = todayIndex();
  if (index < 0)
    return screen(pageHeader(t('today.freeDay'), cap(fmt.long.format(now))), html`${weatherCard(now)}${tiles()}`);

  const day = days[index];
  const big = t('today.dayXofY', { x: day.n, y: days.length });
  if (isSecret(day))
    return screen(
      pageHeader(big, cap(fmt.long.format(day.when))),
      html`${hiddenNote(day)}${weatherCard(day.when, day.weather)}${tiles()}`,
    );
  return screen(
    pageHeader(big, `${tr(day.title)} · ${cap(fmt.long.format(day.when))}`),
    html`${hiddenNote(day)}
    ${nextSign(day)}${weatherCard(day.when, day.weather)}${tiles()}${day.note ? noteBox(tr(day.note)) : ''}
    <section class="section"><h2>${t('today.plan')}</h2>${timeline(day, true)}</section>`,
  );
}

/**
 * Day 0: before the trip a greeting, the countdown, the trip's welcome note, the first day with its
 * weather and the rest of the days.
 * @param {number} toStart  days until the first day (1 = tomorrow)
 */
function dayZero(toStart) {
  const days = state.days;
  const first = days[0];
  const last = days[days.length - 1];
  const welcome = currentTrip().welcome;
  const count = toStart === 1 ? t('today.startsTomorrow') : t('today.startsIn', { count: toStart });
  const range = `${fmt.short.format(first.when)} – ${fmt.short.format(last.when)}`;
  return screen(
    pageHeader(t('today.greeting'), range),
    html`
    <section class="sign"><div class="sign-head"><span class="sign-tag">${t('today.dayZero')}</span><span>${cap(fmt.long.format(first.when))}</span></div>
      <h2 class="sign-title">${count}</h2></section>
    ${weatherToday()}${welcome ? noteBox(tr(welcome)) : ''}${tiles()}
    <section class="section"><h2>${t('today.firstDay')}</h2>${dayCard(first, 0)}${weatherCard(first.when, first.weather)}</section>
    <button class="btn" type="button" data-action="tab" data-arg="lists" style="align-self:flex-start">${icon('check')}${t('today.openPacking')}</button>
    ${days.length > 1 ? html`<section class="section"><h2>${t('today.nextDays')}</h2><ol class="days">${days.slice(1).map((day, i) => html`<li>${dayCard(day, i + 1)}</li>`)}</ol></section>` : ''}`,
  );
}

function days() {
  const all = state.days;
  if (state.dayOpen != null) {
    const day = all[state.dayOpen];
    const secret = isSecret(day);
    return screen(
      pageHeader(secret ? t('day.hidden') : tr(day.title), cap(fmt.long.format(day.when)), t('day.n', { n: day.n }), {
        back: t('days.back'),
      }),
      html`${hiddenNote(day)}
      ${weatherCard(day.when, day.weather)}${secret ? '' : html`${day.note ? noteBox(tr(day.note)) : ''}${timeline(day, daysBetween(day.when, tripToday()) === 0)}`}`,
    );
  }
  const range = `${fmt.short.format(all[0].when)} – ${fmt.short.format(all[all.length - 1].when)}`;
  return screen(
    pageHeader(t('days.title'), range),
    html`<ol class="days">${all.map((day, i) => html`<li>${dayCard(day, i)}</li>`)}</ol>`,
  );
}

function lists() {
  return screen(
    pageHeader(t('lists.title'), ''),
    html`<div class="stack">${currentTrip().lists.map((list) => {
      const done = ticked(list.id);
      return fold(
        'list:' + list.id,
        tr(list.title),
        html`<div class="list-body">
      <ul class="checks">${list.items.map(
        (item, j) => html`<li><label class="check" for="c-${list.id}-${j}">
        <input type="checkbox" id="c-${list.id}-${j}" data-list="${list.id}" data-item="${j}"${done.includes(j) ? html` checked` : ''}><span>${tr(item)}</span></label></li>`,
      )}${mine(list.id).map(
        (item) => html`<li class="check-mine"><label class="check" for="m-${list.id}-${item.id}">
        <input type="checkbox" id="m-${list.id}-${item.id}" data-list="${list.id}" data-mine="${item.id}"${item.done ? html` checked` : ''}><span>${item.text}</span></label>
        <button class="check-del" type="button" data-action="mine-remove" data-list="${list.id}" data-arg="${item.id}" aria-label="${t('lists.remove', { item: item.text })}">${icon('trash')}</button></li>`,
      )}</ul>
      <form class="add-item" data-add-item="${list.id}" novalidate>
        <input name="text" maxlength="200" enterkeyhint="done" autocomplete="off" aria-label="${t('lists.addLabel', { list: tr(list.title) })}" placeholder="${t('lists.addPlaceholder')}">
        <button class="btn" type="submit">${icon('plus')}<span>${t('lists.add')}</span></button></form>
      <button class="btn btn--quiet" type="button" data-action="reset-list" data-arg="${list.id}">${t('lists.reset')}</button></div>`,
        { open: true, count: t('lists.count', listCount(list)), countId: 'count-' + list.id },
      );
    })}</div>`,
  );
}

function phrases() {
  const speechLang = state.settings.speechLang;
  return screen(
    pageHeader(t('phrases.title'), t('phrases.sub')),
    html`<div class="stack">${currentTrip().phrases.map(
      (p, i) => html`<article class="card phrase">
    <p class="ph-mean">${tr(p.meaning)}</p>
    <p class="ph-local" lang="${speechLang}">${p.local}</p>
    <p class="ph-say">${tr(p.say)}</p>
    <div class="actions">${canSpeak() ? html`<button class="btn" type="button" data-action="say" data-arg="${p.local}">${icon('vol')}${t('action.hear')}</button>` : ''}
      <button class="btn" type="button" data-action="phrase" data-arg="${i}">${icon('max')}${t('action.show')}</button></div></article>`,
    )}</div>`,
  );
}

function help() {
  const trip = currentTrip();
  const { help: h } = trip;
  const hotelId = currentHotelId();
  const hotel = trip.places[hotelId];
  const ins = h.insurance;
  const con = h.consulate;
  return screen(
    pageHeader(t('help.title'), ''),
    html`
  <section class="card sos">
    <p class="sos-label">${t('help.emergency')}</p>
    <a class="sos-num" href="${telUrl(h.emergency)}">${icon('phone')}<span>${h.emergency}</span></a>
    <p>${t('help.emergency.note')}</p>
  </section>
  <section class="section"><h2>${t('help.family')}</h2><div class="stack">${h.family.map((f) => person(f.name, tr(f.note), f.phone))}</div></section>
  <section class="section"><h2>${t('help.lost')}</h2><ol class="steps">${h.lost.map((s) => html`<li><span>${tr(s)}</span></li>`)}</ol></section>
  <section class="section"><h2>${t('help.hotel')}</h2><div class="card info">
    <p class="info-name">${tr(hotel.name)}</p><p>${hotel.address}</p>${hotel.phone ? html`<p class="mono">${hotel.phone}</p>` : ''}
    <div class="actions"><button class="btn" type="button" data-action="taxi" data-arg="${hotelId}">${icon('car')}${t('tile.taxi')}</button>
      <a class="btn" href="${mapUrl(hotel)}" target="_blank" rel="noopener">${icon('pin')}${t('action.map')}</a>
      ${hotel.phone ? html`<a class="btn" href="${telUrl(hotel.phone)}">${icon('phone')}${t('action.call')}</a>` : ''}</div></div></section>
  ${
    ins
      ? html`<section class="section"><h2>${t('help.insurance')}</h2><div class="card info">
    <p class="info-name">${ins.company}</p><p><span class="label">${t('help.policy')}</span> <span class="mono">${ins.policy}</span></p>
    ${ins.note ? html`<p class="muted">${tr(ins.note)}</p>` : ''}<p class="mono">${ins.phone}</p>
    <div class="actions"><a class="btn" href="${telUrl(ins.phone)}">${icon('phone')}${t('action.call')}</a></div></div></section>`
      : ''
  }
  ${con ? html`<section class="section"><h2>${t('help.consulate')}</h2>${person(tr(con.name), tr(con.note), con.phone)}</section>` : ''}
  ${
    state.languages.length > 1
      ? html`<section class="section"><h2>${t('help.language')}</h2>${langChips(state.languages)}</section>`
      : ''
  }
  <section class="section"><h2>${t('help.phone')}</h2><div class="card info">
    <p class="muted">${t('help.forgetNote')}</p>
    <div class="actions"><button class="btn btn--quiet" type="button" data-action="forget">${icon('lock')}<span>${t('help.forget')}</span></button></div></div></section>`,
  );
}

/** The five tabs. */
export const SCREENS = { today, days, lists, phrases, help };

/**
 * Language buttons. @param {string[]} langs
 * @param {string} [cls]  extra class of the row
 */
const langChips = (langs, cls = '') =>
  html`<div class="chips${cls}">${langs.map(
    (l) =>
      html`<button class="chip" type="button" lang="${l}" data-action="lang" data-arg="${l}" aria-pressed="${l === state.lang}">${meta(l, 'meta.name') || l}</button>`,
  )}</div>`;

/** Password form. @param {string | null} errorKey  e.g. 'login.changed' */
export const loginScreen = (errorKey) => html`<form class="login" id="login" novalidate>
    ${loginLangs.length > 1 ? html`<div class="login-lang" role="group" aria-label="${t('help.language')}">${icon('globe')}${langChips(loginLangs)}</div>` : ''}
    <span class="login-badge">${icon('plane')}</span>
    <h1 class="big">${t('login.title')}</h1>
    <p>${t('login.text')}</p>
    <label class="label" for="pw">${t('login.password')}</label>
    <div class="pw">
      <input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false">
      <button class="pw-eye" type="button" data-action="toggle-password" aria-label="${t('login.show')}" aria-pressed="false">${icon('eye')}</button>
    </div>
    <p class="login-err" id="login-err" role="alert"${errorKey ? html` data-key="${errorKey}"` : html` hidden`}>${errorKey ? t(errorKey) : ''}</p>
    <button class="btn btn--solid btn--big" type="submit" id="login-go">${icon('unlock')}<span>${t('login.open')}</span></button>
    <p class="muted small">${t('login.once')}</p>
  </form>`;

/**
 * A message instead of the app (no trip file, unsupported browser, something broke).
 * @param {string} key
 * @param {boolean} [retry]  show a "Try again" button that reloads the app
 */
export const messageScreen = (
  key,
  retry = false,
) => html`<div class="login"><span class="login-badge">${icon('lock')}</span><h1 class="big">${t('login.title')}</h1>
    <p>${t(key)}</p>${retry ? html`<button class="btn btn--solid btn--big" type="button" data-action="retry">${t('login.retry')}</button>` : ''}</div>`;
