/**
 * Full-screen sheets that open over a tab: taxi card, ticket list, one ticket, money, one phrase.
 *
 * @import { Currency } from '../../../types/trip'
 * @import { MoneySide, Sheet } from '../../../types/app'
 */
import { html, icon } from '../html.js';
import { locale, t, tr } from '../i18n.js';
import { state } from '../state.js';
import { canSpeak, currentTrip } from '../trip.js';
import { formatMoney, mapUrl } from '../util.js';
import { placeName, sheetHead } from './components.js';
import { mapSheet } from '../admin/map.js';

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

/**
 * The list of tickets: all of them, or (an event with many) only the ones it uses.
 * @param {string} [only]  ticket ids, "a,b"
 */
function tickets(only) {
  const wanted = only ? only.split(',') : null;
  // newest first: a ticket added in the app goes to the end of the trip's list, so the list is read from its end
  const all = Object.entries(currentTrip().tickets)
    .filter(([id]) => !wanted || wanted.includes(id))
    .reverse();
  return html`${sheetHead(t('tickets.title'))}<ul class="tk-list">${all.map(
    ([id, tk]) => html`<li>
      <button class="tk" type="button" data-action="ticket" data-arg="${id}">${icon('ticket')}<span class="tk-main"><b>${tr(tk.title)}</b><span>${tr(tk.when)}</span></span>${icon('chev', 'ic chev')}</button></li>`,
  )}</ul>`;
}

/** How far the + button zooms a ticket's picture: 1 is the width of the screen. */
const ZOOMS = [1, 1.5, 2, 3, 4];
let zoomAt = 0;

/** @param {string} ticketId */
function ticket(ticketId) {
  const tk = currentTrip().tickets[ticketId];
  zoomAt = 0;
  // the code is optional (a ticket can be just a picture or a PDF)
  return html`${sheetHead(tr(tk.title))}<div class="ticket">
      ${
        tk.image
          ? html`<div class="ticket-view" id="ticket-view"><div class="ticket-pan"><img class="ticket-img" src="${tk.image}" alt="${tr(tk.title)}"></div></div>`
          : ''
      }
      <p class="ticket-when">${tr(tk.when)}</p>
      ${tk.code ? html`<p class="label">${t('ticket.code')}</p><p class="ticket-code">${tk.code}</p>` : ''}
      ${tk.details?.length ? html`<ul class="ticket-details">${tk.details.map((d) => html`<li>${tr(d)}</li>`)}</ul>` : ''}
      <p class="ticket-hint">${icon('sun')}<span>${t('ticket.brightness')}</span></p></div>
    ${tk.image ? zoomBar() : ''}`;
}

/** The - / 100% / + buttons that make a ticket's picture bigger (a QR code, or the small print of a PDF). */
const zoomBar = () => html`<div class="ticket-zoom" role="group" aria-label="${t('ticket.zoom')}">
      <button class="btn" type="button" data-action="zoom" data-arg="out" disabled aria-label="${t('ticket.zoomOut')}">${icon('minus')}</button>
      <button class="btn" type="button" id="zoom-level" data-action="zoom" data-arg="fit" aria-label="${t('ticket.zoomFit')}">100%</button>
      <button class="btn" type="button" data-action="zoom" data-arg="in" aria-label="${t('ticket.zoomIn')}">${icon('plus')}</button></div>`;

/**
 * Zoom the open ticket's picture, keeping the part in the middle of the screen in the middle.
 * @param {'in' | 'out' | 'fit'} how
 */
export function zoomTicket(how) {
  const view = document.getElementById('ticket-view');
  const img = view?.querySelector('img');
  const sheet = document.getElementById('sheet');
  if (!view || !img || !sheet) return;
  zoomAt = how === 'fit' ? 0 : Math.max(0, Math.min(ZOOMS.length - 1, zoomAt + (how === 'in' ? 1 : -1)));
  const before = img.getBoundingClientRect();
  const down = (innerHeight / 2 - before.top) / before.height;
  const across = (view.scrollLeft + view.clientWidth / 2) / view.scrollWidth;
  view.style.setProperty('--zoom', String(ZOOMS[zoomAt]));
  const after = img.getBoundingClientRect();
  sheet.scrollTop += after.top + down * after.height - innerHeight / 2;
  view.scrollLeft = across * view.scrollWidth - view.clientWidth / 2;
  const level = document.getElementById('zoom-level');
  if (level) level.textContent = `${Math.round(ZOOMS[zoomAt] * 100)}%`;
  /** @param {string} arg @param {boolean} off */
  const toggle = (arg, off) => {
    const button = /** @type {HTMLButtonElement | null} */ (
      sheet.querySelector(`[data-action="zoom"][data-arg="${arg}"]`)
    );
    if (button) button.disabled = off;
  };
  toggle('out', zoomAt === 0);
  toggle('in', zoomAt === ZOOMS.length - 1);
}

function money() {
  const m = currentTrip().money;
  return html`${sheetHead(t('money.title'))}<div class="money">
      ${moneySide('local', m.local, m.quick.local)}${moneySide('home', m.home, m.quick.home)}
      <p class="muted small">${t('money.rate', { home: formatMoney(1, m.home, 0, locale), rate: m.rate, local: m.local.symbol })}</p></div>`;
}

/**
 * One currency of the money sheet: its amount (type in either one, the other follows) and its quick amounts.
 * @param {MoneySide} side
 * @param {Currency} currency
 * @param {number[]} quick
 */
const moneySide = (side, currency, quick) => html`<div class="money-side">
      <label class="label" for="m-${side}">${tr(currency.price)}</label>
      <div class="money-in"><span class="cur" aria-hidden="true">${currency.symbol}</span><input id="m-${side}" data-money="${side}" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0"></div>
      <div class="chips">${quick.map((v) => html`<button class="chip" type="button" data-action="amount" data-arg="${side}:${v}">${formatMoney(v, currency, 0, locale)}</button>`)}</div></div>`;

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
      return tickets(sheet.arg == null ? undefined : String(sheet.arg));
    case 'ticket':
      return ticket(String(sheet.arg));
    case 'money':
      return money();
    case 'phrase':
      return phrase(Number(sheet.arg));
    case 'map':
      return mapSheet();
  }
}

/** Sheets that keep the screen on (shown to a driver, a scanner or a stranger). */
export const KEEP_AWAKE = ['taxi', 'ticket', 'phrase'];

/**
 * An amount was typed (or a quick amount tapped) in one currency: show it in the other one, as a plain
 * number that can be typed over in turn.
 * @param {HTMLInputElement} input
 */
export function moneyCalc(input) {
  const m = currentTrip().money;
  const fromLocal = input.dataset.money === 'local';
  const other = /** @type {HTMLInputElement} */ (document.getElementById(fromLocal ? 'm-home' : 'm-local'));
  const value = parseFloat(input.value.replace(',', '.').replace(/[^\d.]/g, ''));
  if (isNaN(value)) {
    other.value = '';
    return;
  }
  const result = fromLocal ? value / m.rate : value * m.rate;
  // no ".00" tacked on: that point showed up in the field the person was about to type into
  other.value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: result >= 100 ? 0 : 2,
    useGrouping: false,
  }).format(result);
}
