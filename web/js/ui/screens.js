/**
 * Whole screens: the five tabs, the login form and the message/error screens.
 */
import { html, icon } from '../html.js';
import { cap, fmt, meta, t, tr } from '../i18n.js';
import { state } from '../state.js';
import { canSpeak, currentTrip, daysBetween, todayIndex } from '../trip.js';
import { mapUrl, store, telUrl } from '../util.js';
import { dayCard, hello, nextSign, noteBox, person, tiles, timeline, weatherCard } from './components.js';

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
}

function today() {
  const days = state.days;
  const first = days[0];
  const last = days[days.length - 1];
  const toStart = daysBetween(new Date(), first.when);

  if (toStart > 0) {
    const big = toStart === 1 ? t('today.startsTomorrow') : t('today.startsIn', { count: toStart });
    return html`${hello(big, cap(fmt.long.format(first.when)))}${tiles()}
      <section class="section"><h2>${t('today.firstDay')}</h2>${dayCard(first, 0)}${weatherCard(first.when)}</section>
      <button class="btn" type="button" data-action="tab" data-arg="lists" style="align-self:flex-start">${icon('check')}${t('today.openPacking')}</button>`;
  }
  if (daysBetween(last.when, new Date()) > 0)
    return html`${hello(t('today.welcomeHome'), t('today.welcomeSub'))}${tiles()}`;

  const index = todayIndex();
  if (index < 0)
    return html`${hello(t('today.freeDay'), cap(fmt.long.format(new Date())))}${weatherCard(new Date())}${tiles()}`;

  const day = days[index];
  return html`${hello(t('today.dayXofY', { x: day.n, y: days.length }), `${tr(day.title)} · ${cap(fmt.long.format(day.when))}`)}
    ${nextSign(day)}${weatherCard(day.when)}${tiles()}${day.note ? noteBox(tr(day.note)) : ''}
    <section class="section"><h2>${t('today.plan')}</h2>${timeline(day, true)}</section>`;
}

function days() {
  const all = state.days;
  if (state.dayOpen != null) {
    const day = all[state.dayOpen];
    return html`<button class="back" type="button" data-action="back">${icon('left')}<span>${t('days.back')}</span></button>
      ${hello(tr(day.title), cap(fmt.long.format(day.when)), t('day.n', { n: day.n }))}
      ${weatherCard(day.when)}${day.note ? noteBox(tr(day.note)) : ''}${timeline(day, daysBetween(day.when, new Date()) === 0)}`;
  }
  const range = `${fmt.short.format(all[0].when)} – ${fmt.short.format(all[all.length - 1].when)}`;
  return html`${hello(t('days.title'), range)}<ol class="days">${all.map((day, i) => html`<li>${dayCard(day, i)}</li>`)}</ol>`;
}

function lists() {
  return html`${hello(t('lists.title'), '')}<div class="stack">${currentTrip().lists.map((list) => {
    const done = ticked(list.id);
    return html`<section class="card list">
      <div class="list-head"><h2>${tr(list.title)}</h2><span class="count" id="count-${list.id}">${t('lists.count', { x: done.length, y: list.items.length })}</span></div>
      <ul class="checks">${list.items.map(
        (item, j) => html`<li><label class="check" for="c-${list.id}-${j}">
        <input type="checkbox" id="c-${list.id}-${j}" data-list="${list.id}" data-item="${j}"${done.includes(j) ? html` checked` : ''}><span>${tr(item)}</span></label></li>`,
      )}</ul>
      <button class="btn btn--quiet" type="button" data-action="reset-list" data-arg="${list.id}">${t('lists.reset')}</button></section>`;
  })}</div>`;
}

function phrases() {
  const speechLang = state.settings.speechLang;
  return html`${hello(t('phrases.title'), t('phrases.sub'))}<div class="stack">${currentTrip().phrases.map(
    (p, i) => html`<article class="card phrase">
    <p class="ph-mean">${tr(p.meaning)}</p>
    <p class="ph-local" lang="${speechLang}">${p.local}</p>
    <p class="ph-say">${tr(p.say)}</p>
    <div class="actions">${canSpeak() ? html`<button class="btn" type="button" data-action="say" data-arg="${p.local}">${icon('vol')}${t('action.hear')}</button>` : ''}
      <button class="btn" type="button" data-action="phrase" data-arg="${i}">${icon('max')}${t('action.show')}</button></div></article>`,
  )}</div>`;
}

function help() {
  const trip = currentTrip();
  const { help: h } = trip;
  const hotel = trip.places[h.hotel];
  const ins = h.insurance;
  const con = h.consulate;
  return html`${hello(t('help.title'), '')}
  <section class="card sos">
    <p class="sos-label">${t('help.emergency')}</p>
    <a class="sos-num" href="${telUrl(h.emergency)}">${icon('phone')}<span>${h.emergency}</span></a>
    <p>${t('help.emergency.note')}</p>
  </section>
  <section class="section"><h2>${t('help.family')}</h2><div class="stack">${h.family.map((f) => person(f.name, tr(f.note), f.phone))}</div></section>
  <section class="section"><h2>${t('help.lost')}</h2><ol class="steps">${h.lost.map((s) => html`<li><span>${tr(s)}</span></li>`)}</ol></section>
  <section class="section"><h2>${t('help.hotel')}</h2><div class="card info">
    <p class="info-name">${tr(hotel.name)}</p><p>${hotel.address}</p>${hotel.phone ? html`<p class="mono">${hotel.phone}</p>` : ''}
    <div class="actions"><button class="btn" type="button" data-action="taxi" data-arg="${h.hotel}">${icon('car')}${t('tile.taxi')}</button>
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
      ? html`<section class="section"><h2>${t('help.language')}</h2><div class="chips">${state.languages.map(
          (l) =>
            html`<button class="chip" type="button" lang="${l}" data-action="lang" data-arg="${l}" aria-pressed="${l === state.lang}">${meta(l, 'meta.name') || l}</button>`,
        )}</div></section>`
      : ''
  }
  <section class="section"><h2>${t('help.phone')}</h2><div class="card info">
    <p class="muted">${t('help.forgetNote')}</p>
    <div class="actions"><button class="btn btn--quiet" type="button" data-action="forget">${icon('lock')}<span>${t('help.forget')}</span></button></div></div></section>`;
}

/** The five tabs. */
export const SCREENS = { today, days, lists, phrases, help };

/** Password form. @param {string | null} errorKey  e.g. 'login.changed' */
export const loginScreen = (errorKey) => html`<form class="login" id="login" novalidate>
    <span class="login-badge">${icon('plane')}</span>
    <h1 class="big">${t('login.title')}</h1>
    <p>${t('login.text')}</p>
    <label class="label" for="pw">${t('login.password')}</label>
    <div class="pw">
      <input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false">
      <button class="pw-eye" type="button" data-action="toggle-password" aria-label="${t('login.show')}" aria-pressed="false">${icon('eye')}</button>
    </div>
    <p class="login-err" id="login-err" role="alert"${errorKey ? '' : html` hidden`}>${errorKey ? t(errorKey) : ''}</p>
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
