/**
 * The Edit tab (admin only): forms for days, events, places and tickets, a JSON editor for everything
 * else, and Publish. Forms change state.draft; the other tabs show the draft until it is published.
 * Days can be hidden from the family (the eye in the list): their phones show "Plan coming later".
 *
 * This module draws screens and applies forms to the draft. Navigation and saving happen in
 * actions.js, so this module never imports app.js.
 *
 * @import { EditView, Payload, TicketImage } from '../../../types/app'
 * @import { Day, Event, TextRef } from '../../../types/trip'
 */
import { Html, html, icon } from '../html.js';
import { cap, fmt, meta, t, tr } from '../i18n.js';
import { state } from '../state.js';
import { addDays, isoDate, parseDate, ticketsOf, toMin } from '../trip.js';
import { fold, pageHeader, screen } from '../ui/components.js';
import { dropUnusedImages, isDirty, languagesOf, setText, setTicketImage, textIn } from './draft.js';
import { EVENT_ICONS, realDate } from './validate.js';

/** @returns {Payload} */
function draft() {
  if (!state.draft) throw new Error('Admin mode has no draft');
  return state.draft;
}
const langs = () => languagesOf(draft());
/** @param {string} lang */
const langName = (lang) => meta(lang, 'meta.name') || lang;

/* ---------- pieces ---------- */

/**
 * For fields that hold names, addresses and codes: words a dictionary doesn't know. The phone's keyboard must
 * leave them as typed, not "correct" them to a word it knows (or refuse a change to one it flagged).
 */
const PLAIN_TYPING = new Html('autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"');

/**
 * Whether a field has to be filled in, said on every field: a red "Required" or a quiet "Optional".
 * @param {boolean} required
 */
const flag = (required) =>
  required
    ? html`<span class="flag flag--req">${t('edit.required')}</span>`
    : html`<span class="flag flag--opt">${t('edit.optional')}</span>`;

/**
 * One text field, with an input per language. The first language is the one that must be filled.
 * @param {string} name
 * @param {string} labelKey
 * @param {TextRef | null | undefined} ref
 * @param {{ multiline?: boolean, required?: boolean }} [options]
 */
function textField(name, labelKey, ref, { multiline = false, required = false } = {}) {
  const first = langs()[0];
  return html`<fieldset class="field"><legend class="label">${t(labelKey)}${flag(required)}</legend>${langs().map(
    (lang) => {
      const id = `f-${name}-${lang}`;
      const value = textIn(draft(), ref, lang);
      const req = required && lang === first ? html` aria-required="true"` : '';
      return html`<div class="lang-input"><label class="lang-tag" for="${id}" lang="${lang}">${langName(lang)}</label>${
        multiline
          ? html`<textarea id="${id}" name="${name}.${lang}" rows="3" lang="${lang}"${req}>${value}</textarea>`
          : html`<input id="${id}" name="${name}.${lang}" lang="${lang}" value="${value}"${req} ${PLAIN_TYPING}>`
      }</div>`;
    },
  )}</fieldset>`;
}

/**
 * A plain (not translated) field.
 * @param {string} name
 * @param {string} labelKey
 * @param {string | number | null | undefined} value
 * @param {{ required?: boolean, attrs?: string, hint?: string, after?: Html }} [options]
 *   attrs: trusted attributes, e.g. 'type="time"'; hint: a line of help under the field; after: more under it
 */
const plainField = (name, labelKey, value, { required = false, attrs = '', hint = '', after = new Html('') } = {}) =>
  html`<div class="field"><label class="label" for="f-${name}">${t(labelKey)}${flag(required)}</label>
    <input id="f-${name}" name="${name}" value="${value ?? ''}"${required ? html` aria-required="true"` : ''} ${PLAIN_TYPING} ${new Html(attrs)}>
    ${hint ? html`<p class="field-hint">${hint}</p>` : ''}${after}</div>`;

/**
 * A select of ids, with "None" first.
 * @param {string} name
 * @param {string} labelKey
 * @param {[string, string][]} options  [id, label]
 * @param {string | null | undefined} value
 * @param {{ noneKey?: string, hint?: string }} [extra]  what the empty choice says, and a line of help
 */
const selectField = (name, labelKey, options, value, { noneKey = 'edit.none', hint = '' } = {}) =>
  html`<div class="field"><label class="label" for="f-${name}">${t(labelKey)}${flag(false)}</label>
    ${hint ? html`<p class="field-hint">${hint}</p>` : ''}
    <select id="f-${name}" name="${name}"><option value="">${t(noneKey)}</option>${options.map(
      ([id, label]) => html`<option value="${id}"${id === value ? html` selected` : ''}>${label}</option>`,
    )}</select></div>`;

/**
 * Checkboxes of ids: none, one or several can be ticked.
 * @param {string} name
 * @param {string} labelKey
 * @param {[string, string][]} options  [id, label]
 * @param {string[]} values
 * @param {string} hintKey  shown under the label
 * @param {string} emptyKey  shown instead when there are no options
 */
const checksField = (name, labelKey, options, values, hintKey, emptyKey) =>
  html`<fieldset class="field"><legend class="label">${t(labelKey)}${flag(false)}</legend>${
    options.length
      ? html`<p class="muted small">${t(hintKey)}</p>${options.map(
          ([id, label]) =>
            html`<label class="field-check"><input type="checkbox" name="${name}" value="${id}"${values.includes(id) ? html` checked` : ''}><span>${label}</span></label>`,
        )}`
      : html`<p class="muted small">${t(emptyKey)}</p>`
  }</fieldset>`;

/**
 * A row in a list of things to edit.
 * @param {string} arg  what edit-open opens, e.g. "day:2"
 * @param {string} aside
 * @param {string} title
 * @param {string} [lead]  an icon name drawn before the aside (an event's icon)
 */
const rowButton = (arg, aside, title, lead = '') =>
  html`<button class="edit-row" type="button" data-action="edit-open" data-arg="${arg}"><span class="mono">${lead ? icon(lead, 'ic edit-row-ic') : ''}${aside}</span><span>${title}</span>${icon('chev', 'ic chev')}</button>`;

/** @param {string} arg @param {string} aside @param {string} title @param {string} [lead] */
const row = (arg, aside, title, lead = '') => html`<li>${rowButton(arg, aside, title, lead)}</li>`;

/**
 * A day in the list, with the eye that shows it to the family or hides it.
 * @param {Day} day
 * @param {number} index
 */
const dayRow = (day, index) =>
  html`<li class="edit-item${day.hidden ? ' edit-item--hidden' : ''}">${rowButton(`day:${index}`, fmt.short.format(parseDate(day.date)), tr(day.title))}
    <button class="eye" type="button" data-action="edit-hide" data-arg="${index}" aria-pressed="${!day.hidden}" aria-label="${t('edit.day.shown')}" title="${t('edit.day.shown')}">${icon(day.hidden ? 'eyeOff' : 'eye')}</button></li>`;

const formError = () => html`<p class="form-err" id="form-err" role="alert" hidden></p>`;

/**
 * The pinned header of an Edit screen: Back, the title and Save (it belongs to the form further down) in one row,
 * and the error of a failed save under it, so none of them needs a scroll however long the form is.
 * @param {string} big
 * @param {string} [sub]
 * @param {string} [eyebrow]
 * @param {string} [saveKey]  the Save button's text
 */
const editHeader = (big, sub, eyebrow, saveKey = 'edit.save') =>
  pageHeader(big, sub, eyebrow, {
    back: t('edit.back'),
    // icon only, like Back: a text button squeezes the title into a narrow column on a small phone
    action: html`<button class="btn btn--solid btn--round" type="submit" form="edit-form" aria-label="${t(saveKey)}" title="${t(saveKey)}">${icon('check')}</button>`,
    after: formError(),
  });

/**
 * The last row of a section: add something to it.
 * @param {string} arg  what edit-open opens, e.g. "event:2:-1"
 * @param {string} label
 */
const addRow = (arg, label) =>
  html`<button class="edit-add" type="button" data-action="edit-open" data-arg="${arg}">${icon('plus')}<span>${label}</span></button>`;

/**
 * Delete what the screen edits (it asks again before deleting).
 * @param {string} arg  e.g. "day:2"
 * @param {string} label
 */
const deleteButton = (arg, label) =>
  html`<button class="btn btn--quiet edit-del" type="button" data-action="edit-delete" data-arg="${arg}">${icon('trash')}<span>${label}</span></button>`;

/**
 * An editor form; applyForm() in this module knows what to do with it. Save is in the pinned header (editHeader).
 * @param {string} formName
 * @param {Html} body
 * @param {{ id: string, title: string, open: boolean }} [folded]  a card that can be collapsed instead of a plain one
 */
const form = (formName, body, folded) =>
  folded
    ? html`<form class="form" id="edit-form" data-form="${formName}" novalidate>${fold(folded.id, folded.title, body, { open: folded.open })}</form>`
    : html`<form class="card form" id="edit-form" data-form="${formName}" novalidate>${body}</form>`;

/** The latest Publish result. */
function notice() {
  const n = state.notice;
  if (!n) return state.pending ? html`<p class="note">${icon('info')}<span>${t('edit.pending')}</span></p>` : '';
  return html`<section class="card notice notice--${n.kind}" role="status"><p>${n.text}</p>${
    n.problems?.length
      ? html`<ul class="problems">${n.problems.map((p) => html`<li><span class="mono">${p.where}</span> ${p.message}</li>`)}</ul>`
      : ''
  }</section>`;
}

/* ---------- screens ---------- */

/**
 * Publish and Discard, in the pinned header of the overview: they are what this screen is for, and a long list of
 * days and places must not push them out of reach. Round icons, like the other header buttons; Discard asks twice,
 * and its label (hidden until then) says so.
 * @param {boolean} dirty  there are unpublished changes
 */
const publishButtons = (dirty) =>
  html`${
    dirty
      ? html`<button class="btn btn--quiet btn--round" type="button" data-action="discard" title="${t('edit.discard')}" aria-label="${t('edit.discard')}">${icon('trash')}</button>`
      : ''
  }<button class="btn btn--solid btn--round" type="button" data-action="publish" title="${state.publishing ? t('edit.publishing') : t('edit.publish')}" aria-label="${state.publishing ? t('edit.publishing') : t('edit.publish')}"${!dirty || state.publishing ? html` disabled` : ''}${state.publishing ? html` aria-busy="true"` : ''}>${icon('upload')}</button>`;

function home() {
  const trip = draft().trip;
  const dirty = isDirty();
  return screen(
    pageHeader(t('edit.title'), dirty ? t('edit.unpublished') : t('edit.allPublished'), undefined, {
      action: publishButtons(dirty),
    }),
    html`
  ${notice()}${dirty && !state.notice && !state.pending ? html`<p class="note">${icon('info')}<span>${t('edit.unpublishedNote')}</span></p>` : ''}
  ${fold(
    'days',
    t('edit.days'),
    html`<p class="muted fold-note">${t('edit.daysNote')}</p>
    <ul class="edit-list">${trip.days.map(dayRow)}</ul>${addRow('day:-1', t('edit.addDay'))}`,
    { open: true, count: trip.days.length, list: true },
  )}
  ${fold(
    'places',
    t('edit.places'),
    html`<ul class="edit-list">${Object.entries(trip.places).map(([id, p]) => row(`place:${id}`, '', tr(p.name)))}</ul>
    ${addRow('place:', t('edit.addPlace'))}`,
    { count: Object.keys(trip.places).length, list: true },
  )}
  ${fold(
    'tickets',
    t('edit.tickets'),
    html`<ul class="edit-list">${Object.entries(trip.tickets)
      .reverse()
      .map(([id, tk]) => row(`ticket:${id}`, tk.code, tr(tk.title)))}</ul>
    ${addRow('ticket:', t('edit.addTicket'))}`,
    { count: Object.keys(trip.tickets).length, list: true },
  )}
  ${fold(
    'more',
    t('edit.more'),
    html`<p class="muted fold-note">${t('edit.moreNote')}</p>
    <ul class="edit-list">${row('json:trip', '{ }', t('edit.json.trip'))}${langs().map((l) => row(`json:${l}`, '{ }', t('edit.json.texts', { lang: langName(l) })))}</ul>`,
    { list: true },
  )}`,
  );
}

/** @param {Day} day */
const sortedEvents = (day) => day.events.map((e, j) => ({ e, j })).sort((a, b) => toMin(a.e.time) - toMin(b.e.time));

/**
 * Where the day's forecast is for: a place of its own (a day in another city), or empty for the trip's place.
 * Typed as latitude and longitude, or chosen on the map.
 * @param {{ lat: number, lon: number } | null | undefined} own
 */
function weatherField(own) {
  const main = draft().trip.weather;
  /** @param {string} name @param {string} labelKey @param {number | undefined} value @param {number | undefined} fallback */
  const coord = (name, labelKey, value, fallback) =>
    html`<div class="lang-input"><label class="lang-tag" for="f-${name}">${t(labelKey)}</label>
      <input id="f-${name}" name="${name}" inputmode="decimal" value="${value ?? ''}" placeholder="${fallback ?? ''}" ${PLAIN_TYPING}></div>`;
  return html`<fieldset class="field"><legend class="label">${t('edit.day.weather')}${flag(false)}</legend>
    <p class="field-hint">${t('edit.day.weatherHint')}</p>
    <div class="coords">${coord('lat', 'edit.day.lat', own?.lat, main?.lat)}${coord('lon', 'edit.day.lon', own?.lon, main?.lon)}</div>
    <div class="actions"><button class="btn" type="button" data-action="map-open" data-arg="weather">${icon('pin')}<span>${t('edit.day.weatherMap')}</span></button>
      <button class="btn btn--quiet" type="button" data-action="weather-clear"><span>${t('edit.day.weatherClear')}</span></button></div></fieldset>`;
}

/** A day's date the way the rest of the app writes it: "Tuesday 3 November". @param {string} iso */
const longDate = (iso) => cap(fmt.long.format(parseDate(iso)));

/** @param {number} index  -1 for a new day */
function dayView(index) {
  const days = draft().trip.days;
  const day = days[index];
  const isNew = !day;
  const date =
    day?.date ?? (days.length ? isoDate(addDays(parseDate(days[days.length - 1].date), 1)) : isoDate(new Date()));
  return screen(
    editHeader(
      isNew ? t('edit.newDay') : tr(day.title),
      longDate(date),
      t('day.n', { n: isNew ? days.length + 1 : index + 1 }),
    ),
    html`
  ${form(
    'day',
    html`${plainField('date', 'edit.day.date', date, { required: true, attrs: 'type="date"' })}
    ${textField('title', 'edit.day.title', day?.title, { required: true })}
    ${textField('note', 'edit.day.note', day?.note, { multiline: true })}
    ${weatherField(day?.weather)}
    ${selectField(
      'hotel',
      'edit.day.hotel',
      Object.entries(draft().trip.places).map(([id, p]) => /** @type {[string, string]} */ ([id, tr(p.name)])),
      day?.hotel,
      { noneKey: 'edit.day.hotelSame', hint: t('edit.day.hotelHint') },
    )}
    <label class="field-check"><input type="checkbox" name="hidden"${day?.hidden ? html` checked` : ''}><span>${t('edit.day.hide')}</span></label>
    ${isNew || days.length < 2 ? '' : deleteButton(`day:${index}`, t('edit.deleteDay'))}`,
    // a new day has nothing but these fields; an existing one is mostly opened to work on its events
    { id: 'day-details', title: t('edit.day.details'), open: isNew },
  )}
  ${
    isNew
      ? ''
      : fold(
          'day-events',
          t('edit.events'),
          html`<ul class="edit-list">${sortedEvents(day).map(({ e, j }) => row(`event:${index}:${j}`, e.time, tr(e.title), e.icon))}</ul>${addRow(`event:${index}:-1`, t('edit.addEvent'))}`,
          { open: true, count: day.events.length, list: true },
        )
  }`,
  );
}

/** @param {number} dayIndex @param {number} index  -1 for a new event */
function eventView(dayIndex, index) {
  const trip = draft().trip;
  const day = trip.days[dayIndex];
  /** @type {Partial<Event>} */
  const ev = day.events[index] ?? { time: '09:00', icon: 'landmark' };
  const places = Object.entries(trip.places).map(([id, p]) => /** @type {[string, string]} */ ([id, tr(p.name)]));
  const tickets = Object.entries(trip.tickets)
    .reverse()
    .map(([id, tk]) => /** @type {[string, string]} */ ([id, tr(tk.title)]));
  return screen(
    editHeader(
      index < 0 ? t('edit.newEvent') : tr(ev.title),
      `${tr(day.title)} · ${longDate(day.date)}`,
      t('day.n', { n: dayIndex + 1 }),
    ),
    html`
  ${form(
    'event',
    html`${plainField('time', 'edit.event.time', ev.time, { required: true, attrs: 'type="time"' })}
    <fieldset class="field"><legend class="label">${t('edit.event.icon')}${flag(true)}</legend><div class="chips icons">${EVENT_ICONS.map(
      (name) =>
        html`<label class="chip choice"><input type="radio" name="icon" value="${name}"${name === ev.icon ? html` checked` : ''}>${icon(name)}<span>${t('edit.icon.' + name)}</span></label>`,
    )}</div></fieldset>
    ${textField('title', 'edit.event.title', ev.title, { required: true })}
    ${textField('note', 'edit.event.note', ev.note, { multiline: true })}
    ${textField('meet', 'edit.event.meet', ev.meet)}
    ${selectField('place', 'edit.event.place', places, ev.place)}
    ${checksField('ticket', 'edit.event.tickets', tickets, ticketsOf(ev), 'edit.event.ticketsHint', 'edit.event.noTickets')}
    ${index < 0 ? '' : deleteButton(`event:${dayIndex}:${index}`, t('edit.deleteEvent'))}`,
  )}`,
  );
}

/** @param {string} id  "" for a new place */
function placeView(id) {
  const place = draft().trip.places[id];
  return screen(
    editHeader(place ? tr(place.name) : t('edit.newPlace'), place?.address ?? '', t('edit.places')),
    html`
  ${form(
    'place',
    html`${textField('name', 'edit.place.name', place?.name, { required: true })}
    ${plainField('localName', 'edit.place.localName', place?.localName)}
    ${plainField('address', 'edit.place.address', place?.address, {
      required: true,
      hint: t('edit.place.addressHint'),
      after: html`<button class="btn" type="button" data-action="map-open">${icon('pin')}<span>${t('edit.place.chooseMap')}</span></button>`,
    })}
    ${plainField('phone', 'edit.place.phone', place?.phone, { attrs: 'type="tel"' })}`,
  )}`,
  );
}

/** File types a ticket can be made from (a PDF becomes an image). */
const TICKET_FILES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.pdf';

/**
 * "Only the first 6 of 9 pages were kept", or '' when the whole file is in the image.
 * @param {TicketImage | undefined} image
 */
export const pagesNote = (image) =>
  image?.pages && image.pages.kept < image.pages.total ? t('edit.ticket.pdfPages', image.pages) : '';

/** @param {Extract<EditView, { view: 'ticket' }>} v  id "": a new ticket */
function ticketView(v) {
  const payload = draft();
  const ticket = payload.trip.tickets[v.id];
  const image = v.image?.dataUrl ?? (ticket?.image ? payload.images[ticket.image] : null);
  const note = pagesNote(v.image);
  // choosing a file updates the picture in place (actions.js), so the text typed so far stays
  return screen(
    editHeader(ticket ? tr(ticket.title) : t('edit.newTicket'), ticket ? tr(ticket.when) : '', t('edit.tickets')),
    html`
  ${form(
    'ticket',
    html`${textField('title', 'edit.ticket.title', ticket?.title, { required: true })}
    ${textField('when', 'edit.ticket.when', ticket?.when, { required: true })}
    ${plainField('booking', 'edit.ticket.code', ticket?.code, { hint: t('edit.ticket.codeHint') })}
    <div class="field"><span class="label">${t('edit.ticket.image')}${flag(false)}</span>
      <img class="thumb" id="f-thumb" alt=""${image ? html` src="${image}"` : html` hidden`}>
      <p class="muted small" id="f-pages"${note ? '' : html` hidden`}>${note}</p>
      <label class="btn" for="f-image">${icon('upload')}<span>${t('edit.ticket.replaceImage')}</span></label>
      <input class="visually-hidden" id="f-image" type="file" accept="${TICKET_FILES}"></div>
    ${ticket ? deleteButton(`ticket:${v.id}`, t('edit.deleteTicket')) : ''}`,
  )}`,
  );
}

/** @param {string} part  "trip" or a language code */
function jsonView(part) {
  const payload = draft();
  const value = part === 'trip' ? payload.trip : (payload.locales[part] ?? {});
  const title = part === 'trip' ? t('edit.json.trip') : t('edit.json.texts', { lang: langName(part) });
  return screen(
    editHeader(title, t('edit.json.note'), t('edit.more'), 'edit.json.apply'),
    html`
  <form class="card form" id="edit-form" data-form="json" novalidate>
    <textarea class="json" id="f-json" name="json" spellcheck="false" autocapitalize="none" autocomplete="off">${JSON.stringify(value, null, 2)}</textarea></form>`,
  );
}

/** The Edit tab: the innermost open editor screen, or the overview. */
export function editScreen() {
  const v = state.edit[state.edit.length - 1];
  if (!v) return home();
  switch (v.view) {
    case 'day':
      return dayView(v.day);
    case 'event':
      return eventView(v.day, v.event);
    case 'place':
      return placeView(v.id);
    case 'ticket':
      return ticketView(v);
    case 'json':
      return jsonView(v.part);
  }
}

/* ---------- applying forms and buttons to the draft ---------- */

/**
 * "day:2", "event:2:-1", "place:hotel", "ticket:boat", "json:ru" -> an editor screen.
 * @param {string} arg
 * @returns {EditView | null}
 */
export function parseEditArg(arg) {
  const [view, a = '', b = ''] = arg.split(':');
  if (view === 'day') return { view, day: Number(a) };
  if (view === 'event') return { view, day: Number(a), event: Number(b) };
  if (view === 'place') return { view, id: a };
  if (view === 'ticket') return { view, id: a };
  if (view === 'json') return { view, part: a };
  return null;
}

/**
 * Text typed into a text field, per language.
 * @param {FormData} data
 * @param {string} name
 */
const typed = (data, name) => Object.fromEntries(langs().map((l) => [l, String(data.get(`${name}.${l}`) ?? '')]));

/** @param {FormData} data @param {string} name */
const value = (data, name) => String(data.get(name) ?? '').trim();

/** @param {Event} ev @param {string} field @param {TextRef | null} ref */
function setOptional(ev, field, ref) {
  const target = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (ev));
  if (ref == null) delete target[field];
  else target[field] = ref;
}

/** A new id that isn't used yet. @param {string} prefix @param {Record<string, unknown>} taken */
function newId(prefix, taken) {
  for (;;) {
    const id = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    if (!(id in taken)) return id;
  }
}

/**
 * Apply the open editor screen's form to the draft.
 * @param {HTMLFormElement} formEl
 * @returns {{ key: string, vars?: Record<string, string>, field?: string } | null}
 *   an error to show (and the id of the field it is about), or null when applied
 */
export function applyForm(formEl) {
  const v = state.edit[state.edit.length - 1];
  const payload = draft();
  const trip = payload.trip;
  const data = new FormData(formEl);
  const first = langs()[0];
  /** @param {string} name */
  const needText = (name) =>
    value(data, `${name}.${first}`)
      ? null
      : { key: 'edit.err.required', vars: { lang: langName(first) }, field: `f-${name}-${first}` };

  if (v?.view === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(value(data, 'json'));
    } catch (error) {
      return { key: 'edit.json.invalid', vars: { error: error instanceof Error ? error.message : String(error) } };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { key: 'edit.json.notObject' };
    if (v.part === 'trip') payload.trip = parsed;
    else payload.locales[v.part] = parsed;
    return null;
  }

  if (v?.view === 'day') {
    const date = value(data, 'date');
    if (!realDate(date)) return { key: 'edit.err.dateForm', field: 'f-date' };
    if (trip.days.some((d, i) => d.date === date && i !== v.day))
      return { key: 'edit.err.dateTaken', vars: { date }, field: 'f-date' };
    const missing = needText('title');
    if (missing) return missing;
    // the day's own weather place: both numbers, or neither (then the trip's place is used)
    const lat = value(data, 'lat').replace(',', '.');
    const lon = value(data, 'lon').replace(',', '.');
    /** @type {{ lat: number, lon: number } | null} */
    let weather = null;
    if (lat || lon) {
      const [la, lo] = [Number(lat), Number(lon)];
      if (!lat || !Number.isFinite(la) || Math.abs(la) > 90) return { key: 'edit.err.coords', field: 'f-lat' };
      if (!lon || !Number.isFinite(lo) || Math.abs(lo) > 180) return { key: 'edit.err.coords', field: 'f-lon' };
      weather = { lat: la, lon: lo };
    }
    /** @type {Day} */
    const day = trip.days[v.day] ?? { date, title: '', events: [] };
    if (weather) day.weather = weather;
    else delete day.weather;
    const hotel = value(data, 'hotel');
    if (hotel) day.hotel = hotel;
    else delete day.hotel;
    day.date = date;
    day.title = /** @type {TextRef} */ (setText(payload, day.title || null, typed(data, 'title')));
    const note = setText(payload, day.note, typed(data, 'note'));
    if (note == null) delete day.note;
    else day.note = note;
    if (data.get('hidden')) day.hidden = true;
    else delete day.hidden;
    if (!trip.days.includes(day)) trip.days.push(day);
    trip.days.sort((a, b) => a.date.localeCompare(b.date));
    return null;
  }

  if (v?.view === 'event') {
    const time = value(data, 'time');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { key: 'edit.err.timeForm', field: 'f-time' };
    const missing = needText('title');
    if (missing) return missing;
    const day = trip.days[v.day];
    /** @type {Event} */
    const ev = day.events[v.event] ?? /** @type {Event} */ ({ time, icon: 'landmark', title: '' });
    ev.time = time;
    ev.icon = /** @type {Event['icon']} */ (value(data, 'icon') || ev.icon);
    ev.title = /** @type {TextRef} */ (setText(payload, ev.title || null, typed(data, 'title')));
    setOptional(ev, 'note', setText(payload, ev.note, typed(data, 'note')));
    setOptional(ev, 'meet', setText(payload, ev.meet, typed(data, 'meet')));
    const place = value(data, 'place');
    // one ticket stays a plain id (as before), several become a list
    const tickets = data.getAll('ticket').map(String);
    if (place) ev.place = place;
    else delete ev.place;
    if (tickets.length > 1) ev.ticket = tickets;
    else if (tickets.length) ev.ticket = tickets[0];
    else delete ev.ticket;
    if (!day.events.includes(ev)) day.events.push(ev);
    day.events.sort((a, b) => toMin(a.time) - toMin(b.time));
    return null;
  }

  if (v?.view === 'place') {
    const missing = needText('name');
    if (missing) return missing;
    const address = value(data, 'address');
    if (!address) return { key: 'edit.err.address', field: 'f-address' };
    const id = v.id || newId('p', trip.places);
    const place = trip.places[id] ?? { name: '', address };
    place.name = /** @type {TextRef} */ (setText(payload, place.name || null, typed(data, 'name')));
    place.address = address;
    const localName = value(data, 'localName');
    const phone = value(data, 'phone');
    if (localName) place.localName = localName;
    else delete place.localName;
    if (phone) place.phone = phone;
    else delete place.phone;
    trip.places[id] = place;
    return null;
  }

  if (v?.view === 'ticket') {
    for (const name of ['title', 'when']) {
      const missing = needText(name);
      if (missing) return missing;
    }
    // the code is optional: a ticket can be just a picture or a PDF (the model keeps it as an empty text)
    const code = value(data, 'booking');
    const id = v.id || newId('t', trip.tickets);
    const ticket = trip.tickets[id] ?? { title: '', when: '', code };
    ticket.title = /** @type {TextRef} */ (setText(payload, ticket.title || null, typed(data, 'title')));
    ticket.when = /** @type {TextRef} */ (setText(payload, ticket.when || null, typed(data, 'when')));
    ticket.code = code;
    trip.tickets[id] = ticket;
    if (v.image) setTicketImage(payload, id, v.image);
    return null;
  }
  return null;
}

/**
 * Delete a day, an event or a ticket: "day:2", "event:2:3" or "ticket:boat".
 * @param {string} arg
 */
export function deleteFromDraft(arg) {
  const [kind, a = '', b = ''] = arg.split(':');
  const payload = draft();
  const trip = payload.trip;
  const days = trip.days;
  if (kind === 'day') {
    days.splice(Number(a), 1);
    // demo mode points at a day number: keep it pointing at a day that still exists
    const demo = trip.settings.demoTodayIsDay;
    if (demo && demo > days.length) trip.settings.demoTodayIsDay = days.length || null;
  }
  if (kind === 'event') days[Number(a)]?.events.splice(Number(b), 1);
  if (kind === 'ticket') {
    delete trip.tickets[a];
    // its events stay in the plan, without the Ticket button
    for (const day of days)
      for (const ev of day.events) {
        const left = ticketsOf(ev).filter((id) => id !== a);
        if (left.length > 1) ev.ticket = left;
        else if (left.length) ev.ticket = left[0];
        else delete ev.ticket;
      }
    dropUnusedImages(payload);
  }
}

/**
 * Show a day to the family, or hide it (they see "Plan coming later"; the admin password shows it all).
 * @param {number} index
 */
export function toggleHidden(index) {
  const day = draft().trip.days[index];
  if (!day) return;
  if (day.hidden) delete day.hidden;
  else day.hidden = true;
}
