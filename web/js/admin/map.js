/**
 * Choosing a place on a map (admin mode). The Edit tab's place form has an address field to type into; this is
 * the other way in: tap a spot on the map, or search for it, and the address (and name) found there are put into
 * the form, where they can still be edited by hand. Nothing here is required: typing the address stays possible.
 *
 * The map is Leaflet (BSD-2, in web/vendor/) with OpenStreetMap tiles; searching and finding the address of a spot
 * use OpenStreetMap's Nominatim. They need the internet, and they see what is searched and which area is shown, so
 * the family's phones never load any of it: it is loaded when the admin opens the map (see docs/security.md).
 *
 * @import { LeafletLib, LMap, LMarker } from '../../../types/leaflet'
 */
import { html, icon } from '../html.js';
import { baseLang, t } from '../i18n.js';
import { state } from '../state.js';
import { screen, sheetHeader } from '../ui/components.js';

/** Leaflet, relative to the page. A new version goes into a new folder: the offline worker caches by URL. */
const LEAFLET = 'vendor/leaflet-1.9.4/';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** @typedef {{ lat: number, lon: number, address: string, name: string }} Pick */
/** @typedef {{ lat: string, lon: string, display_name?: string, name?: string }} Found */

/** @type {Promise<LeafletLib> | null} */
let library = null;

/** Load Leaflet once; a failed download (offline the first time) is tried again next time. */
function leaflet() {
  if (!library) {
    const base = new URL(LEAFLET, document.baseURI);
    library = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = new URL('leaflet.css', base).href;
      document.head.append(css);
      const script = document.createElement('script');
      script.src = new URL('leaflet.js', base).href;
      script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet did not start')));
      script.onerror = () => reject(new Error('Leaflet could not be loaded'));
      document.head.append(script);
    });
    library.catch(() => (library = null));
  }
  return library;
}

/** @type {{ L: LeafletLib, map: LMap, marker: LMarker | null, pick: Pick | null, found: Pick[], turn: number } | null} */
let picker = null;

/** The map sheet: a search box, the map, and the address found at the pin. Started by startMap() once it is on screen. */
export function mapSheet() {
  // what is typed in the place form so far is a good first search
  const typed = document.getElementById('f-address');
  const query = typed instanceof HTMLInputElement ? typed.value.trim() : '';
  const forWeather = isWeather();
  return screen(
    sheetHeader(t('map.title')),
    html`
    <form class="map-search" id="map-search" role="search">
      <input id="map-q" type="search" value="${query}" placeholder="${t('map.search')}" aria-label="${t('map.search')}" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
      <button class="btn" type="submit">${icon('search')}<span>${t('map.go')}</span></button></form>
    <ul class="map-results" id="map-results" hidden></ul>
    <div class="map" id="map" role="application" aria-label="${t('map.title')}"><p class="map-msg" id="map-msg">${t('map.loading')}</p></div>
    <p class="muted small">${forWeather ? t('map.hintWeather') : t('map.hint')}</p>
    <div class="card map-pick"><p class="map-addr" id="map-addr">${t('map.none')}</p>
      <button class="btn btn--solid" type="button" id="map-use" data-action="map-use" disabled>${icon('check')}<span>${forWeather ? t('map.useSpot') : t('map.use')}</span></button></div>
    <p class="muted small">${t('map.credit')}</p>`,
  );
}

/** Whether the open map is choosing the spot for a day's weather (not a place's address). */
const isWeather = () => state.sheets[state.sheets.length - 1]?.arg === 'weather';

/** @param {string} id @param {string} text */
function say(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Language for the addresses and names: the one spoken at the destination, as locals write them. */
const placeLang = () => baseLang(state.settings.speechLang);

/**
 * @param {string} path  e.g. "search?q=…"
 * @returns {Promise<any>}
 */
async function nominatim(path) {
  const lang = placeLang();
  const response = await fetch(`${NOMINATIM}/${path}&format=jsonv2${lang ? `&accept-language=${lang}` : ''}`);
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  return response.json();
}

/** Draw the map once its sheet is on screen. */
export async function startMap() {
  stopMap();
  const el = document.getElementById('map');
  if (!el) return;
  /** @type {LeafletLib} */
  let L;
  try {
    if (navigator.onLine === false) throw new Error('offline');
    L = await leaflet();
  } catch {
    say('map-msg', t('map.offline'));
    return;
  }
  if (!el.isConnected) return; // closed while Leaflet was loading
  document.getElementById('map-msg')?.remove();

  // start at the day's own spot if the form has one, else the trip's city (if it has the weather block)
  const num = (/** @type {string} */ id) =>
    Number(
      (document.getElementById(id) instanceof HTMLInputElement
        ? /** @type {HTMLInputElement} */ (document.getElementById(id)).value
        : ''
      ).replace(',', '.'),
    );
  const typedSpot = isWeather() && num('f-lat') && num('f-lon') ? { lat: num('f-lat'), lon: num('f-lon') } : null;
  const here = typedSpot ?? state.trip?.weather;
  const map = L.map(el).setView(here ? [here.lat, here.lon] : [30, 10], here ? 12 : 2);
  L.tileLayer(TILES, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  picker = { L, map, marker: null, pick: null, found: [], turn: 0 };
  map.on('click', (e) => choose(e.latlng.lat, e.latlng.lng));

  const q = document.getElementById('map-q');
  if (q instanceof HTMLInputElement && q.value.trim()) searchMap();
}

/** Free the map when its sheet closes. */
export function stopMap() {
  picker?.map.remove();
  picker = null;
}

/** Put the pin at a spot and find the address there. @param {number} lat @param {number} lon @param {Pick} [known] */
async function choose(lat, lon, known) {
  if (!picker) return;
  const { L, map } = picker;
  const turn = ++picker.turn;
  const spot = /** @type {[number, number]} */ ([lat, lon]);
  if (picker.marker) picker.marker.setLatLng(spot);
  else {
    const pin = L.divIcon({
      className: 'map-pin',
      html: icon('pin', '').markup,
      iconSize: [40, 40],
      iconAnchor: [20, 38],
    });
    picker.marker = L.marker(spot, { icon: pin, keyboard: false }).addTo(map);
  }
  const use = /** @type {HTMLButtonElement | null} */ (document.getElementById('map-use'));
  if (known) {
    picker.pick = known;
  } else {
    picker.pick = null;
    if (use) use.disabled = true;
    say('map-addr', t('map.looking'));
    /** @type {Pick} */
    let pick = { lat, lon, address: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, name: '' };
    try {
      const found = await nominatim(`reverse?lat=${lat}&lon=${lon}&zoom=18`);
      if (found?.display_name) pick = { lat, lon, address: found.display_name, name: found.name || '' };
    } catch {
      // no address found (offline, busy): the coordinates still find the spot in Google Maps
    }
    if (!picker || turn !== picker.turn) return; // another spot was chosen meanwhile
    picker.pick = pick;
  }
  say('map-addr', picker.pick.address);
  if (use) use.disabled = false;
}

/** Search the box's text and list what was found. */
export async function searchMap() {
  const input = document.getElementById('map-q');
  const list = document.getElementById('map-results');
  if (!picker || !(input instanceof HTMLInputElement) || !list) return;
  const q = input.value.trim();
  if (!q) return;
  const turn = ++picker.turn;
  list.hidden = false;
  list.textContent = t('map.looking');
  /** @type {Found[]} */
  let found;
  try {
    found = await nominatim(`search?q=${encodeURIComponent(q)}&limit=5`);
  } catch {
    if (picker && turn === picker.turn) list.textContent = t('map.error');
    return;
  }
  if (!picker || turn !== picker.turn) return;
  picker.found = found.map((f) => ({
    lat: Number(f.lat),
    lon: Number(f.lon),
    address: f.display_name || '',
    name: f.name || '',
  }));
  if (!picker.found.length) {
    list.textContent = t('map.noResults');
    return;
  }
  list.replaceChildren(
    ...picker.found.map((f, i) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = 'map-result';
      button.dataset.arg = String(i);
      button.textContent = f.address || `${f.lat}, ${f.lon}`;
      item.append(button);
      return item;
    }),
  );
}

/** A search result was tapped: go there and put the pin on it. @param {number} index */
export function pickResult(index) {
  const f = picker?.found[index];
  if (!picker || !f) return;
  document.getElementById('map-results')?.setAttribute('hidden', '');
  picker.map.setView([f.lat, f.lon], 17);
  choose(f.lat, f.lon, f);
}

/**
 * Put the chosen place into the place form underneath: the address always (the admin chose a new spot), the
 * names only where nothing is typed yet. Everything stays editable. Returns false when nothing was chosen.
 */
export function useMapPlace() {
  const pick = picker?.pick;
  if (!pick) return false;
  if (isWeather()) {
    // the spot for a day's forecast: its coordinates (4 decimals are about 10 m)
    /** @param {string} id @param {number} n */
    const put = (id, n) => {
      const field = document.getElementById(id);
      if (field instanceof HTMLInputElement) field.value = n.toFixed(4);
    };
    put('f-lat', pick.lat);
    put('f-lon', pick.lon);
    return true;
  }
  /** @param {string} id @param {string} value @param {boolean} overwrite */
  const fill = (id, value, overwrite) => {
    const field = document.getElementById(id);
    if (value && field instanceof HTMLInputElement && (overwrite || !field.value.trim())) field.value = value;
  };
  fill('f-address', pick.address, true);
  fill('f-localName', pick.name, false);
  const first = state.languages[0];
  fill(`f-name-${first}`, pick.name, false);
  return true;
}
