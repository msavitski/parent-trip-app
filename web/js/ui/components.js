/**
 * Building blocks shared by screens and sheets. All return Html (see ../html.js).
 *
 * @import { Event, Place, Weather } from '../../../types/trip'
 * @import { TripDay, WeatherDay } from '../../../types/app'
 */
import { html, icon } from '../html.js';
import { fmt, meta, t, tr } from '../i18n.js';
import { state } from '../state.js';
import { currentTrip, daysBetween, nowMin, ticketsOf, toMin, tripToday } from '../trip.js';
import { dirUrl, mapUrl, telUrl } from '../util.js';
import { hasWeather, outfit, WEATHER_ICON, weatherFetchedAt, weatherFor, weatherKind } from '../weather.js';

/**
 * Screen header: small eyebrow line, big title, optional subtitle.
 * @param {string} big
 * @param {string} [sub]
 * @param {string} [eyebrow]  defaults to the trip's title
 */
export function hello(big, sub, eyebrow) {
  return html`<header class="hello">
    <p class="eyebrow"><span>${eyebrow ?? tr(currentTrip().title)}</span>${state.settings.demoTodayIsDay ? html`<span class="demo">${t('badge.demo')}</span>` : ''}</p>
    <h1 class="big">${big}</h1>${sub ? html`<p class="date">${sub}</p>` : ''}</header>`;
}

/** @param {string} text */
export const noteBox = (text) => html`<p class="note">${icon('info')}<span>${text}</span></p>`;

/** A day hidden from the family, seen by the family: only its date, weather and "Plan coming later". @param {TripDay} day */
export const isSecret = (day) => !!day.hidden && state.role !== 'admin';

/** Under a hidden day's header: what the family sees, or (admin) that they don't see it. @param {TripDay} day */
export const hiddenNote = (day) =>
  day.hidden ? noteBox(isSecret(day) ? t('day.hiddenNote') : t('day.hiddenAdmin')) : '';

/** "in 2 h 15 min" @param {number} minutes */
function inText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [h ? `${h} ${t('time.h')}` : '', m || !h ? `${m} ${t('time.min')}` : ''].filter(Boolean);
  return t('time.in', { t: parts.join(' ') });
}

/** Map, Taxi and Ticket buttons of an event (one per ticket, named after it when there are several). @param {Event} e */
function eventActions(e) {
  const trip = currentTrip();
  const place = e.place ? trip.places[e.place] : undefined;
  const buttons = [];
  if (place) {
    buttons.push(
      html`<a class="btn" href="${mapUrl(place)}" target="_blank" rel="noopener">${icon('pin')}${t('action.map')}</a>`,
      html`<button class="btn" type="button" data-action="taxi" data-arg="${e.place}">${icon('car')}${t('action.taxi')}</button>`,
    );
  }
  const tickets = ticketsOf(e).filter((id) => trip.tickets[id]);
  for (const id of tickets) {
    const label = tickets.length > 1 ? tr(trip.tickets[id].title) : t('action.ticket');
    buttons.push(
      html`<button class="btn" type="button" data-action="ticket" data-arg="${id}">${icon('ticket')}${label}</button>`,
    );
  }
  return buttons.length ? html`<div class="actions">${buttons}</div>` : '';
}

/**
 * Per event: '' | 'past' | 'now' | 'next' (only for today).
 * @param {TripDay} day
 * @param {boolean} live
 */
function eventStates(day, live) {
  if (!live) return day.events.map(() => '');
  const now = nowMin();
  const next = day.events.findIndex((e) => toMin(e.time) > now);
  const upto = next < 0 ? day.events.length : next;
  return day.events.map((e, i) =>
    i === next ? 'next' : i === upto - 1 && now - toMin(e.time) < 120 ? 'now' : i < upto ? 'past' : '',
  );
}

/**
 * The day's plan.
 * @param {TripDay} day
 * @param {boolean} live  mark past / now / next (today only)
 */
export function timeline(day, live) {
  const states = eventStates(day, live);
  return html`<ol class="timeline">${day.events.map(
    (e, i) => html`<li class="ev${states[i] ? ' ev--' + states[i] : ''}">
    <div class="ev-time">${e.time}</div><div class="ev-rail"></div>
    <div class="ev-body">
      ${states[i] === 'now' || states[i] === 'next' ? html`<span class="tag tag--${states[i]}">${t('badge.' + states[i])}</span>` : ''}
      <h3 class="ev-title">${icon(e.icon)}<span>${tr(e.title)}</span></h3>
      ${e.note ? html`<p>${tr(e.note)}</p>` : ''}
      ${e.meet ? html`<p><b>${t('event.meet')}:</b> ${tr(e.meet)}</p>` : ''}
      ${states[i] === 'past' ? '' : eventActions(e)}
    </div></li>`,
  )}</ol>`;
}

/** The yellow "Next" sign on Today. @param {TripDay} day */
export function nextSign(day) {
  const now = nowMin();
  const e = day.events.find((ev) => toMin(ev.time) > now);
  if (!e) return html`<section class="sign sign--rest">${icon('moon')}<p>${t('today.nothingMore')}</p></section>`;
  return html`<section class="sign" aria-label="${t('badge.next')}">
    <div class="sign-head"><span class="sign-tag">${t('badge.next')}</span><span>${inText(toMin(e.time) - now)}</span></div>
    <div class="sign-main"><span class="sign-time">${e.time}</span><h2 class="sign-title">${tr(e.title)}</h2></div>
    ${e.meet ? html`<p><b>${t('event.meet')}:</b> ${tr(e.meet)}</p>` : ''}
    ${eventActions(e)}</section>`;
}

/** The six big buttons on Today. */
export function tiles() {
  const trip = currentTrip();
  const family = trip.help.family[0];
  const hotel = trip.places[trip.help.hotel];
  return html`<div class="tiles">
    <a class="tile" href="${telUrl(family.phone)}">${icon('phone')}<span>${t('tile.call', { name: family.name })}<small>${family.phone}</small></span></a>
    <button class="tile" type="button" data-action="taxi" data-arg="${trip.help.hotel}">${icon('car')}<span>${t('tile.taxi')}<small>${t('tile.taxi.sub')}</small></span></button>
    <a class="tile" href="${dirUrl(hotel)}" target="_blank" rel="noopener">${icon('nav')}<span>${t('tile.hotel')}<small>${t('tile.hotel.sub')}</small></span></a>
    <button class="tile" type="button" data-action="open" data-arg="tickets">${icon('ticket')}<span>${t('tile.tickets')}<small>${t('tile.tickets.sub', { count: Object.keys(trip.tickets).length })}</small></span></button>
    <button class="tile" type="button" data-action="open" data-arg="money">${icon('coins')}<span>${t('tile.money')}<small>${tr(trip.money.pair)}</small></span></button>
    <button class="tile tile--sos" type="button" data-action="tab" data-arg="help">${icon('buoy')}<span>${t('tile.help')}<small>${t('tile.help.sub')}</small></span></button>
  </div>`;
}

/**
 * A day in the Days list.
 * @param {TripDay} day
 * @param {number} index
 */
export function dayCard(day, index) {
  const rel = daysBetween(tripToday(), day.when);
  const tag =
    rel === 0
      ? html`<span class="tag tag--today">${t('badge.today')}</span>`
      : rel < 0
        ? html`<span class="tag tag--done">${t('badge.done')}</span>`
        : html`<span></span>`;
  const secret = isSecret(day);
  return html`<button class="day${rel === 0 ? ' day--today' : ''}${secret ? ' day--secret' : ''}" type="button" data-action="day" data-arg="${index}">
    <span class="leaf"><small>${fmt.weekday.format(day.when)}</small><b>${day.when.getDate()}</b><small>${fmt.month.format(day.when)}</small></span>
    <span class="day-main"><span class="day-n">${t('day.n', { n: day.n })}${day.hidden && !secret ? html`<span class="hidden-mark">${icon('eyeOff')}${t('badge.hidden')}</span>` : ''}</span><span class="day-t">${secret ? t('day.hidden') : tr(day.title)}</span>${weatherMini(day.when, day.weather)}</span>
    ${tag}${icon('chev', 'ic chev')}</button>`;
}

/**
 * A contact card with a Call button.
 * @param {string} name
 * @param {string} sub
 * @param {string} phone
 */
export const person = (name, sub, phone) => html`<div class="card person">
  <div class="person-main"><p class="person-name">${name}</p>${sub ? html`<p class="muted">${sub}</p>` : ''}<p class="mono">${phone}</p></div>
  <a class="btn btn--solid" href="${telUrl(phone)}">${icon('phone')}${t('action.call')}</a></div>`;

/** Title row of a full-screen sheet with the Close button. @param {string} title */
export const sheetHead = (title) => html`<div class="sheet-top"><h2 class="sheet-title">${title}</h2>
  <button class="close" type="button" data-action="back">${icon('x')}<span>${t('action.close')}</span></button></div>`;

/* ---------- weather ---------- */

/** @param {number} celsius */
const temp = (celsius) => `${Math.round(celsius)}°`.replace('-', '−');

/** Wind in the language's usual unit (meta.windUnit: kmh, ms or mph). @param {number} kmh */
function wind(kmh) {
  const unit = meta(state.lang, 'meta.windUnit') || 'kmh';
  const value = unit === 'ms' ? kmh / 3.6 : unit === 'mph' ? kmh / 1.609 : kmh;
  return { value: Math.round(value), unit: t('wx.unit.' + unit) };
}

/** @param {Weather | null} [own] */
function updatedText(own) {
  const at = weatherFetchedAt(own);
  if (at == null) return '';
  const date = new Date(at);
  const when =
    daysBetween(date, new Date()) === 0
      ? t('wx.atTime', { time: fmt.time.format(date) })
      : `${fmt.short.format(date)}, ${fmt.time.format(date)}`;
  return t('wx.updated', { when }) + (navigator.onLine === false ? ` · ${t('wx.offline')}` : '');
}

/**
 * @param {string} iconName
 * @param {string | number} value
 * @param {string} label
 * @param {string} [unit]
 */
const weatherCell = (iconName, value, label, unit) => html`<div class="wx-cell"><dt>${label}</dt>
    <dd>${icon(iconName)}<b>${value}${unit ? html`<small>${unit}</small>` : ''}</b></dd></div>`;

/**
 * Max, min, wind, sunset and what to wear for one day.
 * @param {Date} date
 * @param {Weather | null} [own]  the day's `weather` (without one: the trip's place)
 */
export function weatherCard(date, own) {
  if (!hasWeather(own)) return '';
  /** @type {WeatherDay | null} */
  const w = weatherFor(date, own);
  if (!w) {
    // the real date, also in demo mode: the forecast is for the day's real date
    const key = daysBetween(new Date(), date) > 14 ? 'wx.notYet' : 'wx.none';
    return html`<section class="card wx wx--empty">${icon('cloud')}<p>${t(key)}</p></section>`;
  }
  const kind = weatherKind(w.code);
  const wear = outfit(w);
  const wd = wind(w.wind ?? 0);
  return html`<section class="card wx" aria-label="${t('wx.title')}">
    <div class="wx-head">${icon(WEATHER_ICON[kind], 'ic wx-ic')}<p><b>${t('wx.code.' + kind)}</b>${(w.rain ?? 0) >= 20 ? html`<span class="muted">, ${t('wx.rain', { p: w.rain ?? 0 })}</span>` : ''}</p></div>
    <dl class="wx-grid">${weatherCell('up', temp(w.max), t('wx.max'))}${weatherCell('down', w.min == null ? '–' : temp(w.min), t('wx.min'))}${weatherCell('wind', wd.value, t('wx.wind'), wd.unit)}${weatherCell('sunset', w.sunset || '–', t('wx.sunset'))}</dl>
    <div class="wear"><p class="label">${t('wear.title')}</p>
      <p class="wear-main">${icon('shirt')}<span>${t(wear.style)}</span></p>
      ${wear.extra.length ? html`<ul class="wear-list">${wear.extra.map((k) => html`<li>${t(k)}</li>`)}</ul>` : ''}</div>
    <p class="wx-upd">${updatedText(own)}</p></section>`;
}

/**
 * Small forecast in the Days list.
 * @param {Date} date
 * @param {Weather | null} [own]  the day's `weather`
 */
function weatherMini(date, own) {
  const w = weatherFor(date, own);
  if (!w) return '';
  return html`<span class="wx-mini">${icon(WEATHER_ICON[weatherKind(w.code)])}${temp(w.max)} / ${w.min == null ? '–' : temp(w.min)}</span>`;
}

/** @param {Place} place */
export const placeName = (place) => place.localName || tr(place.name);
