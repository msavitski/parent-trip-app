/**
 * The Edit tab (admin only): forms for days, events, places and tickets, a JSON editor for everything
 * else, and Publish. Forms change state.draft; the other tabs show the draft until it is published.
 *
 * This module draws screens and applies forms to the draft. Navigation and saving happen in
 * actions.js, so this module never imports app.js.
 *
 * @import { EditView, Payload } from '../../../types/app'
 * @import { Day, Event, TextRef } from '../../../types/trip'
 */
import { Html, html, icon } from '../html.js';
import { meta, t, tr } from '../i18n.js';
import { state } from '../state.js';
import { addDays, isoDate, parseDate, toMin } from '../trip.js';
import { hello } from '../ui/components.js';
import { isDirty, languagesOf, setText, setTicketImage, textIn } from './draft.js';
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
 * One text field, with an input per language. The first language is the one that must be filled.
 * @param {string} name
 * @param {string} labelKey
 * @param {TextRef | null | undefined} ref
 * @param {{ multiline?: boolean, required?: boolean }} [options]
 */
function textField(name, labelKey, ref, { multiline = false, required = false } = {}) {
  const first = langs()[0];
  return html`<fieldset class="field"><legend class="label">${t(labelKey)}</legend>${langs().map((lang) => {
    const id = `f-${name}-${lang}`;
    const value = textIn(draft(), ref, lang);
    const req = required && lang === first ? html` required` : '';
    return html`<div class="lang-input"><label class="lang-tag" for="${id}" lang="${lang}">${langName(lang)}</label>${
      multiline
        ? html`<textarea id="${id}" name="${name}.${lang}" rows="3" lang="${lang}"${req}>${value}</textarea>`
        : html`<input id="${id}" name="${name}.${lang}" lang="${lang}" value="${value}"${req}>`
    }</div>`;
  })}</fieldset>`;
}

/**
 * A plain (not translated) field.
 * @param {string} name
 * @param {string} labelKey
 * @param {string | number | null | undefined} value
 * @param {string} [attrs]  trusted attributes, e.g. 'type="time" required'
 */
const plainField = (name, labelKey, value, attrs = '') =>
  html`<div class="field"><label class="label" for="f-${name}">${t(labelKey)}</label>
    <input id="f-${name}" name="${name}" value="${value ?? ''}" ${new Html(attrs)}></div>`;

/**
 * A select of ids, with "None" first.
 * @param {string} name
 * @param {string} labelKey
 * @param {[string, string][]} options  [id, label]
 * @param {string | null | undefined} value
 */
const selectField = (name, labelKey, options, value) =>
  html`<div class="field"><label class="label" for="f-${name}">${t(labelKey)}</label>
    <select id="f-${name}" name="${name}"><option value="">${t('edit.none')}</option>${options.map(
      ([id, label]) => html`<option value="${id}"${id === value ? html` selected` : ''}>${label}</option>`,
    )}</select></div>`;

/**
 * A row in a list of things to edit.
 * @param {string} arg  what edit-open opens, e.g. "day:2"
 * @param {string} aside
 * @param {string} title
 */
const row = (arg, aside, title) =>
  html`<li><button class="edit-row" type="button" data-action="edit-open" data-arg="${arg}"><span class="mono">${aside}</span><span>${title}</span>${icon('chev', 'ic chev')}</button></li>`;

const back = () =>
  html`<button class="back" type="button" data-action="back">${icon('left')}<span>${t('edit.back')}</span></button>`;

const formError = () => html`<p class="form-err" id="form-err" role="alert" hidden></p>`;

/**
 * An editor form; applyForm() in this module knows what to do with it.
 * @param {string} formName
 * @param {Html} body
 */
const form = (formName, body) =>
  html`<form class="card form" id="edit-form" data-form="${formName}" novalidate>${body}${formError()}
    <button class="btn btn--solid" type="submit">${icon('check')}${t('edit.save')}</button></form>`;

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

function home() {
  const trip = draft().trip;
  const dirty = isDirty();
  return html`${hello(t('edit.title'), dirty ? t('edit.unpublished') : t('edit.allPublished'))}
  ${notice()}
  <div class="actions">
    <button class="btn btn--solid" type="button" data-action="publish"${!dirty || state.publishing ? html` disabled` : ''}>${icon('upload')}<span>${state.publishing ? t('edit.publishing') : t('edit.publish')}</span></button>
    ${dirty ? html`<button class="btn btn--quiet" type="button" data-action="discard"><span>${t('edit.discard')}</span></button>` : ''}
  </div>
  <section class="section"><h2>${t('edit.days')}</h2>
    <ul class="edit-list">${trip.days.map((day, i) => row(`day:${i}`, day.date, tr(day.title)))}</ul>
    <button class="btn" type="button" data-action="edit-open" data-arg="day:-1" style="align-self:flex-start">${icon('plus')}${t('edit.addDay')}</button></section>
  <section class="section"><h2>${t('edit.places')}</h2>
    <ul class="edit-list">${Object.entries(trip.places).map(([id, p]) => row(`place:${id}`, '', tr(p.name)))}</ul>
    <button class="btn" type="button" data-action="edit-open" data-arg="place:" style="align-self:flex-start">${icon('plus')}${t('edit.addPlace')}</button></section>
  <section class="section"><h2>${t('edit.tickets')}</h2>
    <ul class="edit-list">${Object.entries(trip.tickets).map(([id, tk]) => row(`ticket:${id}`, tk.code, tr(tk.title)))}</ul></section>
  <section class="section"><h2>${t('edit.more')}</h2><p class="muted">${t('edit.moreNote')}</p>
    <ul class="edit-list">${row('json:trip', '{ }', t('edit.json.trip'))}${langs().map((l) => row(`json:${l}`, '{ }', t('edit.json.texts', { lang: langName(l) })))}</ul></section>`;
}

/** @param {Day} day */
const sortedEvents = (day) => day.events.map((e, j) => ({ e, j })).sort((a, b) => toMin(a.e.time) - toMin(b.e.time));

/** @param {number} index  -1 for a new day */
function dayView(index) {
  const days = draft().trip.days;
  const day = days[index];
  const isNew = !day;
  const date =
    day?.date ?? (days.length ? isoDate(addDays(parseDate(days[days.length - 1].date), 1)) : isoDate(new Date()));
  return html`${back()}${hello(isNew ? t('edit.newDay') : tr(day.title), date, t('day.n', { n: isNew ? days.length + 1 : index + 1 }))}
  ${form(
    'day',
    html`${plainField('date', 'edit.day.date', date, 'type="date" required')}
    ${textField('title', 'edit.day.title', day?.title, { required: true })}
    ${textField('note', 'edit.day.note', day?.note, { multiline: true })}`,
  )}
  ${
    isNew
      ? ''
      : html`<section class="section"><h2>${t('edit.events')}</h2>
    <ul class="edit-list">${sortedEvents(day).map(({ e, j }) => row(`event:${index}:${j}`, e.time, tr(e.title)))}</ul>
    <button class="btn" type="button" data-action="edit-open" data-arg="event:${index}:-1" style="align-self:flex-start">${icon('plus')}${t('edit.addEvent')}</button></section>
  ${days.length > 1 ? html`<button class="btn btn--quiet" type="button" data-action="edit-delete" data-arg="day:${index}" style="align-self:flex-start">${icon('trash')}<span>${t('edit.deleteDay')}</span></button>` : ''}`
  }`;
}

/** @param {number} dayIndex @param {number} index  -1 for a new event */
function eventView(dayIndex, index) {
  const trip = draft().trip;
  const day = trip.days[dayIndex];
  /** @type {Partial<Event>} */
  const ev = day.events[index] ?? { time: '09:00', icon: 'landmark' };
  const places = Object.entries(trip.places).map(([id, p]) => /** @type {[string, string]} */ ([id, tr(p.name)]));
  const tickets = Object.entries(trip.tickets).map(([id, tk]) => /** @type {[string, string]} */ ([id, tr(tk.title)]));
  return html`${back()}${hello(index < 0 ? t('edit.newEvent') : tr(ev.title), `${tr(day.title)} · ${day.date}`, t('day.n', { n: dayIndex + 1 }))}
  ${form(
    'event',
    html`${plainField('time', 'edit.event.time', ev.time, 'type="time" required')}
    <fieldset class="field"><legend class="label">${t('edit.event.icon')}</legend><div class="chips icons">${EVENT_ICONS.map(
      (name) =>
        html`<label class="chip choice"><input type="radio" name="icon" value="${name}"${name === ev.icon ? html` checked` : ''}>${icon(name)}<span>${t('edit.icon.' + name)}</span></label>`,
    )}</div></fieldset>
    ${textField('title', 'edit.event.title', ev.title, { required: true })}
    ${textField('note', 'edit.event.note', ev.note, { multiline: true })}
    ${textField('meet', 'edit.event.meet', ev.meet)}
    ${selectField('place', 'edit.event.place', places, ev.place)}
    ${selectField('ticket', 'edit.event.ticket', tickets, ev.ticket)}`,
  )}
  ${index < 0 ? '' : html`<button class="btn btn--quiet" type="button" data-action="edit-delete" data-arg="event:${dayIndex}:${index}" style="align-self:flex-start">${icon('trash')}<span>${t('edit.deleteEvent')}</span></button>`}`;
}

/** @param {string} id  "" for a new place */
function placeView(id) {
  const place = draft().trip.places[id];
  return html`${back()}${hello(place ? tr(place.name) : t('edit.newPlace'), place?.address ?? '', t('edit.places'))}
  ${form(
    'place',
    html`${textField('name', 'edit.place.name', place?.name, { required: true })}
    ${plainField('localName', 'edit.place.localName', place?.localName)}
    ${plainField('address', 'edit.place.address', place?.address, 'required')}
    ${plainField('phone', 'edit.place.phone', place?.phone, 'type="tel"')}`,
  )}`;
}

/** @param {Extract<EditView, { view: 'ticket' }>} v */
function ticketView(v) {
  const payload = draft();
  const ticket = payload.trip.tickets[v.id];
  const image = v.image?.dataUrl ?? (ticket.image ? payload.images[ticket.image] : null);
  return html`${back()}${hello(tr(ticket.title), tr(ticket.when), t('edit.tickets'))}
  ${form(
    'ticket',
    html`${textField('title', 'edit.ticket.title', ticket.title, { required: true })}
    ${textField('when', 'edit.ticket.when', ticket.when, { required: true })}
    ${plainField('code', 'edit.ticket.code', ticket.code, 'required')}
    <div class="field"><span class="label">${t('edit.ticket.image')}</span>
      ${image ? html`<img class="thumb" src="${image}" alt="">` : ''}
      <label class="btn" for="f-image">${icon('upload')}<span>${t('edit.ticket.replaceImage')}</span></label>
      <input class="visually-hidden" id="f-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"></div>`,
  )}`;
}

/** @param {string} part  "trip" or a language code */
function jsonView(part) {
  const payload = draft();
  const value = part === 'trip' ? payload.trip : (payload.locales[part] ?? {});
  const title = part === 'trip' ? t('edit.json.trip') : t('edit.json.texts', { lang: langName(part) });
  return html`${back()}${hello(title, t('edit.json.note'), t('edit.more'))}
  <form class="card form" id="edit-form" data-form="json" novalidate>
    <textarea class="json" id="f-json" name="json" spellcheck="false" autocapitalize="none" autocomplete="off">${JSON.stringify(value, null, 2)}</textarea>
    ${formError()}
    <button class="btn btn--solid" type="submit">${icon('check')}${t('edit.json.apply')}</button></form>`;
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
 * @returns {{ key: string, vars?: Record<string, string> } | null}  an error to show, or null when applied
 */
export function applyForm(formEl) {
  const v = state.edit[state.edit.length - 1];
  const payload = draft();
  const trip = payload.trip;
  const data = new FormData(formEl);
  const first = langs()[0];
  /** @param {string} name */
  const needText = (name) =>
    value(data, `${name}.${first}`) ? null : { key: 'edit.err.required', vars: { lang: langName(first) } };

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
    if (!realDate(date)) return { key: 'edit.err.dateForm' };
    if (trip.days.some((d, i) => d.date === date && i !== v.day)) return { key: 'edit.err.dateTaken', vars: { date } };
    const missing = needText('title');
    if (missing) return missing;
    /** @type {Day} */
    const day = trip.days[v.day] ?? { date, title: '', events: [] };
    day.date = date;
    day.title = /** @type {TextRef} */ (setText(payload, day.title || null, typed(data, 'title')));
    const note = setText(payload, day.note, typed(data, 'note'));
    if (note == null) delete day.note;
    else day.note = note;
    if (!trip.days.includes(day)) trip.days.push(day);
    trip.days.sort((a, b) => a.date.localeCompare(b.date));
    return null;
  }

  if (v?.view === 'event') {
    const time = value(data, 'time');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { key: 'edit.err.timeForm' };
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
    const ticket = value(data, 'ticket');
    if (place) ev.place = place;
    else delete ev.place;
    if (ticket) ev.ticket = ticket;
    else delete ev.ticket;
    if (!day.events.includes(ev)) day.events.push(ev);
    day.events.sort((a, b) => toMin(a.time) - toMin(b.time));
    return null;
  }

  if (v?.view === 'place') {
    const missing = needText('name');
    if (missing) return missing;
    const address = value(data, 'address');
    if (!address) return { key: 'edit.err.address' };
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
    const ticket = trip.tickets[v.id];
    for (const name of ['title', 'when']) {
      const missing = needText(name);
      if (missing) return missing;
    }
    const code = value(data, 'code');
    if (!code) return { key: 'edit.err.code' };
    ticket.title = /** @type {TextRef} */ (setText(payload, ticket.title, typed(data, 'title')));
    ticket.when = /** @type {TextRef} */ (setText(payload, ticket.when, typed(data, 'when')));
    ticket.code = code;
    if (v.image) setTicketImage(payload, v.id, v.image);
    return null;
  }
  return null;
}

/**
 * Delete a day or an event: "day:2" or "event:2:3".
 * @param {string} arg
 */
export function deleteFromDraft(arg) {
  const [kind, a, b] = arg.split(':').map((s, i) => (i ? Number(s) : s));
  const trip = draft().trip;
  const days = trip.days;
  if (kind === 'day') {
    days.splice(/** @type {number} */ (a), 1);
    // demo mode points at a day number: keep it pointing at a day that still exists
    const demo = trip.settings.demoTodayIsDay;
    if (demo && demo > days.length) trip.settings.demoTodayIsDay = days.length || null;
  }
  if (kind === 'event') days[/** @type {number} */ (a)]?.events.splice(/** @type {number} */ (b), 1);
}
