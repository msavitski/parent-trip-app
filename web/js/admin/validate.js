/**
 * Checks before publishing from the app: the important rules of `trip check` (tools/…/checks.py),
 * then a test drawing of every screen and sheet in every language with the edited trip, so a mistake
 * in the JSON editor can't reach the phones as a broken screen.
 *
 * @import { Payload, Problem, Role } from '../../../types/app'
 */
import { setLang, t } from '../i18n.js';
import { state } from '../state.js';
import { forFamily, initTrip, ticketsOf } from '../trip.js';
import { SCREENS } from '../ui/screens.js';
import { renderSheet } from '../ui/sheets.js';
import { languagesOf, refKey, refVars, textRefs } from './draft.js';

/** Event icons the app draws (same list as tools/…/model.py EVENT_ICONS). */
export const EVENT_ICONS = [
  'plane',
  'car',
  'bed',
  'food',
  'coffee',
  'landmark',
  'ship',
  'bag',
  'walk',
  'moon',
  'suitcase',
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} iso */
export const realDate = (iso) => DATE.test(iso) && !Number.isNaN(Date.parse(iso + 'T00:00:00Z'));

/**
 * @param {Payload} payload
 * @returns {Problem[]}
 */
export function validate(payload) {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {string} where @param {string} key @param {Record<string, string | number>} [vars] */
  const add = (where, key, vars = {}) => problems.push({ where, message: t(key, vars) });

  const trip = payload.trip;
  if (!trip || typeof trip !== 'object') return [{ where: 'trip', message: t('edit.err.missing') }];
  const places = trip.places ?? {};
  const tickets = trip.tickets ?? {};
  if (!Array.isArray(trip.days) || !trip.days.length) add('days', 'edit.err.missing');

  // dates, times, icons, references
  let previous = '';
  (trip.days ?? []).forEach((day, i) => {
    if (!realDate(day.date)) add(`days[${i}].date`, 'edit.err.date', { value: day.date });
    else if (previous && day.date <= previous) add(`days[${i}].date`, 'edit.err.dateOrder', { value: day.date });
    previous = day.date;
    (day.events ?? []).forEach((ev, j) => {
      const where = `days[${i}].events[${j}]`;
      if (!TIME.test(ev.time)) add(`${where}.time`, 'edit.err.time', { value: ev.time });
      if (!EVENT_ICONS.includes(ev.icon)) add(`${where}.icon`, 'edit.err.icon', { value: ev.icon });
      if (!ev.title) add(`${where}.title`, 'edit.err.missing');
      if (ev.place && !places[ev.place]) add(`${where}.place`, 'edit.err.place', { value: ev.place });
      for (const id of ticketsOf(ev)) if (!tickets[id]) add(`${where}.ticket`, 'edit.err.ticket', { value: id });
    });
  });
  if (!places[trip.help?.hotel]) add('help.hotel', 'edit.err.place', { value: trip.help?.hotel ?? '' });

  // settings (as in tools/…/checks.py)
  const days = trip.days?.length ?? 0;
  const demo = trip.settings?.demoTodayIsDay;
  if (demo != null && (!Number.isInteger(demo) || demo < 1 || demo > days)) {
    add('settings.demoTodayIsDay', 'edit.err.demoDay', { value: String(demo), count: days });
  }
  const forced = trip.settings?.language;
  if (forced && !trip.settings.languages?.includes(forced))
    add('settings.language', 'edit.err.language', { value: forced });

  const ids = new Set();
  (trip.lists ?? []).forEach((list, i) => {
    if (ids.has(list.id)) add(`lists[${i}].id`, 'edit.err.listId', { value: list.id });
    ids.add(list.id);
  });
  for (const [id, ticket] of Object.entries(tickets)) {
    if (ticket.image && !payload.images?.[ticket.image])
      add(`tickets.${id}.image`, 'edit.err.image', { value: ticket.image });
  }

  // every text exists in every language, and gets values for its {placeholders}
  const langs = languagesOf(payload);
  for (const { path, ref } of textRefs(trip)) {
    const key = refKey(ref);
    for (const lang of langs) {
      const strings = payload.locales?.[lang] ?? {};
      const text = strings[key] ?? strings[`${key}.other`];
      if (text == null) {
        add(path, 'edit.err.text', { key, lang });
        continue;
      }
      const missing = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((name) => !(name in refVars(ref)));
      if (missing.length && lang === langs[0]) add(path, 'edit.err.vars', { key, names: missing.join(', ') });
    }
  }

  return problems.length ? problems : renderTest(payload);
}

/**
 * Draw every screen and sheet with the edited trip in every language, as the admin sees it and (with
 * hidden days) as the family will. Restores the app's state after.
 * @param {Payload} payload
 * @returns {Problem[]}
 */
function renderTest(payload) {
  const saved = {
    role: state.role,
    trip: state.trip,
    settings: state.settings,
    days: state.days,
    demoShift: state.demoShift,
    languages: state.languages,
    fallback: state.fallback,
    tripStrings: state.tripStrings,
    dayOpen: state.dayOpen,
  };
  const lang = state.lang;
  /** @type {Map<string, Problem>} */
  const problems = new Map();
  /** @param {string} where @param {() => unknown} draw */
  const attempt = (where, draw) => {
    try {
      draw();
    } catch (error) {
      const message = t('edit.err.render', { error: error instanceof Error ? error.message : String(error) });
      problems.set(where + message, { where, message });
    }
  };
  const family = forFamily(payload);
  /** @type {[Role, Payload][]} */
  const views = [['admin', payload]];
  if (family !== payload) views.push(['family', family]);
  try {
    for (const [role, data] of views) {
      state.role = role;
      const before = problems.size;
      attempt('trip', () => initTrip(structuredClone(data)));
      if (problems.size > before) continue; // nothing to draw
      const trip = /** @type {NonNullable<typeof state.trip>} */ (state.trip);
      for (const l of state.languages) {
        setLang(l);
        for (const [tab, draw] of Object.entries(SCREENS)) {
          state.dayOpen = null;
          attempt(tab, draw);
        }
        state.days.forEach((_, i) => {
          state.dayOpen = i;
          attempt(`days[${i}]`, SCREENS.days);
        });
        state.dayOpen = null;
        for (const id of Object.keys(trip.places))
          attempt(`places.${id}`, () => renderSheet({ type: 'taxi', arg: id }));
        for (const id of Object.keys(trip.tickets))
          attempt(`tickets.${id}`, () => renderSheet({ type: 'ticket', arg: id }));
        trip.phrases.forEach((_, i) => attempt(`phrases[${i}]`, () => renderSheet({ type: 'phrase', arg: i })));
        attempt('tickets', () => renderSheet({ type: 'tickets' }));
        attempt('money', () => renderSheet({ type: 'money' }));
      }
    }
  } finally {
    Object.assign(state, saved);
    setLang(lang);
  }
  return [...problems.values()];
}
