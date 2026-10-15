/**
 * Full-screen sheets that open over a tab: taxi card, ticket list, one ticket, money, one phrase.
 *
 * @import { Sheet } from '../../../types/app'
 */
import { html, icon, mount } from '../html.js';
import { locale, t, tr } from '../i18n.js';
import { state } from '../state.js';
import { canSpeak, currentTrip } from '../trip.js';
import { formatMoney, mapUrl } from '../util.js';
import { placeName, sheetHead } from './components.js';

/** @param {string} placeId */
function taxi(placeId) {
  const trip = currentTrip();
  const place = trip.places[placeId];
  const speechLang = state.settings.speechLang;
  const others = Object.entries(trip.places).filter(([id]) => id !== placeId);
  return html`${sheetHead(t('taxi.title'))}
      <p class="taxi-hint">${t('taxi.hint')}</p>
      <div class="taxi-card" lang="${speechLang}">
        <p class="taxi-ask">${trip.taxi.ask}</p>
        <p class="taxi-name">${placeName(place)}</p>
        <p class="taxi-addr">${place.address}</p>
      </div>
      <div class="actions"><a class="btn" href="${mapUrl(place)}" target="_blank" rel="noopener">${icon('pin')}${t('action.openMap')}</a>
        ${canSpeak() ? html`<button class="btn" type="button" data-action="say" data-arg="${`${trip.taxi.ask} ${place.localName || ''}`}">${icon('vol')}${t('action.hear')}</button>` : ''}</div>
      <div class="section"><h3 class="sub">${t('taxi.other')}</h3>
        <div class="chips">${others.map(([id, other]) => html`<button class="chip" type="button" data-action="swap-place" data-arg="${id}">${tr(other.name)}</button>`)}</div></div>`;
}

function tickets() {
  const all = Object.entries(currentTrip().tickets);
  return html`${sheetHead(t('tickets.title'))}<ul class="tk-list">${all.map(
    ([id, tk]) => html`<li>
      <button class="tk" type="button" data-action="ticket" data-arg="${id}">${icon('ticket')}<span class="tk-main"><b>${tr(tk.title)}</b><span>${tr(tk.when)}</span></span>${icon('chev', 'ic chev')}</button></li>`,
  )}</ul>`;
}

/** @param {string} ticketId */
function ticket(ticketId) {
  const tk = currentTrip().tickets[ticketId];
  return html`${sheetHead(tr(tk.title))}<div class="ticket">
      ${tk.image ? html`<img class="ticket-img" src="${tk.image}" alt="${tr(tk.title)}">` : ''}
      <p class="ticket-when">${tr(tk.when)}</p>
      <p class="label">${t('ticket.code')}</p><p class="ticket-code">${tk.code}</p>
      ${tk.details?.length ? html`<ul class="ticket-details">${tk.details.map((d) => html`<li>${tr(d)}</li>`)}</ul>` : ''}
      <p class="ticket-hint">${icon('sun')}<span>${t('ticket.brightness')}</span></p></div>`;
}

function money() {
  const m = currentTrip().money;
  return html`${sheetHead(t('money.title'))}<div class="money">
      <label class="label" for="m-in" id="m-lab"></label>
      <div class="money-in"><span class="cur" id="m-cur" aria-hidden="true"></span><input id="m-in" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0"></div>
      <p class="money-out"><span aria-hidden="true">≈ </span><output id="m-out" for="m-in"></output></p>
      <div class="chips" id="m-quick"></div>
      <button class="btn" type="button" data-action="money-swap">${icon('swap')}<span id="m-swap"></span></button>
      <p class="muted small">${t('money.rate', { home: formatMoney(1, m.home, 0, locale), rate: m.rate, local: m.local.symbol })}</p></div>`;
}

/** @param {number} index */
function phrase(index) {
  const p = currentTrip().phrases[index];
  return html`${sheetHead('')}<div class="show">
      <p class="label">${t('phrases.showPerson')}</p>
      <p class="show-local" lang="${state.settings.speechLang}">${p.local}</p>
      ${p.extra ? html`<p class="show-extra">${p.extra}</p>` : ''}
      <p class="show-say">${tr(p.say)}</p><p class="show-mean">${tr(p.meaning)}</p>
      ${canSpeak() ? html`<button class="btn btn--solid" type="button" data-action="say" data-arg="${p.local}">${icon('vol')}${t('action.hear')}</button>` : ''}</div>`;
}

/**
 * Render a sheet.
 * @param {Sheet} sheet
 */
export function renderSheet(sheet) {
  switch (sheet.type) {
    case 'taxi':
      return taxi(String(sheet.arg));
    case 'tickets':
      return tickets();
    case 'ticket':
      return ticket(String(sheet.arg));
    case 'money':
      return money();
    case 'phrase':
      return phrase(Number(sheet.arg));
  }
}

/** Sheets that keep the screen on (shown to a driver, a scanner or a stranger). */
export const KEEP_AWAKE = ['taxi', 'ticket', 'phrase'];

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Fill the money sheet for its current direction (local -> home or home -> local).
 * @param {Sheet} sheet
 * @param {boolean} reset  clear the typed amount
 */
export function moneyUpdate(sheet, reset) {
  const m = currentTrip().money;
  const fromLocal = sheet.dir !== 'home';
  const from = fromLocal ? m.local : m.home;
  const to = fromLocal ? m.home : m.local;
  byId('m-lab').textContent = tr(from.price);
  byId('m-cur').textContent = from.symbol;
  byId('m-swap').textContent = tr(to.from);
  const amounts = fromLocal ? m.quick.local : m.quick.home;
  mount(
    byId('m-quick'),
    html`${amounts.map((v) => html`<button class="chip" type="button" data-action="amount" data-arg="${v}">${formatMoney(v, from, 0, locale)}</button>`)}`,
  );
  if (reset) /** @type {HTMLInputElement} */ (byId('m-in')).value = '';
  moneyCalc(sheet);
}

/** Convert the typed amount. @param {Sheet} sheet */
export function moneyCalc(sheet) {
  const m = currentTrip().money;
  const fromLocal = sheet.dir !== 'home';
  const to = fromLocal ? m.home : m.local;
  const typed = /** @type {HTMLInputElement} */ (byId('m-in')).value;
  const value = parseFloat(typed.replace(',', '.').replace(/[^\d.]/g, ''));
  const out = byId('m-out');
  if (isNaN(value)) {
    out.textContent = '–';
    return;
  }
  const result = fromLocal ? value / m.rate : value * m.rate;
  out.textContent = formatMoney(result, to, result >= 100 ? 0 : 2, locale);
}
