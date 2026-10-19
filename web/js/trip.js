/**
 * The opened trip and calendar helpers.
 *
 * @import { Day, Event, Trip } from '../../types/trip'
 * @import { Payload, TripDay } from '../../types/app'
 */
import { state } from './state.js';
import { canSpeakIn } from './util.js';

const DAY_MS = 864e5;

/** "2026-11-03" -> local midnight of that day. @param {string} iso */
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** @param {Date} date @param {number} n */
export const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/** @param {Date} date */
const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Whole calendar days from a to b (DST-safe). @param {Date} a @param {Date} b */
export const daysBetween = (a, b) => Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY_MS);

/** "09:45" -> minutes after midnight. @param {string} hhmm */
export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function nowMin() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** @param {Date} date */
export const isoDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The opened trip. Only call this after the app has started. */
export function currentTrip() {
  if (!state.trip) throw new Error('The trip is not open yet');
  return state.trip;
}

/**
 * Today on the trip's calendar: today, or in demo mode the demo day. Trip days keep their real dates
 * (so they show the right date and the weather for that date); only "which day is today" moves.
 */
export const tripToday = () => addDays(new Date(), -state.demoShift);

/** Index of today's trip day, or -1. */
export const todayIndex = () => state.days.findIndex((d) => daysBetween(d.when, tripToday()) === 0);

/**
 * An event's ticket ids: `ticket` is one id, or a list (one ticket per person).
 * @param {Pick<Event, 'ticket'>} e
 * @returns {string[]}
 */
export const ticketsOf = (e) => (e.ticket == null ? [] : Array.isArray(e.ticket) ? e.ticket : [e.ticket]);

/** Whether "Hear it" buttons can work for this trip's destination language. */
export const canSpeak = () => canSpeakIn(state.settings.speechLang);

/** Plural forms of a translation key ("today.startsIn.few"). */
const PLURAL = /\.(zero|one|two|few|many|other)$/;

/**
 * Every string value in a trip: translation keys, image paths and the rest.
 * @param {unknown} node
 * @param {Set<string>} [found]
 */
function stringsIn(node, found = new Set()) {
  if (typeof node === 'string') found.add(node);
  else if (node && typeof node === 'object') for (const value of Object.values(node)) stringsIn(value, found);
  return found;
}

/**
 * Whether a hidden day has anything to keep from the family (a title, a note or events).
 * @param {Trip} trip
 */
export const hasHiddenPlans = (trip) =>
  (trip.days ?? []).some((d) => d.hidden && (d.title || d.note || d.events?.length));

/**
 * A hidden day as the family sees it: its date and weather place, no plan.
 * @param {Day} day
 * @returns {Day}
 */
const hiddenStub = (day) => ({
  date: day.date,
  title: '',
  events: [],
  hidden: true,
  ...(day.weather ? { weather: day.weather } : {}),
});

/**
 * What the family sees. A hidden day keeps its date and weather place (so Today counts the days right and
 * shows the day's weather) but not its plan: Today and Days say "Plan coming later". Tickets and places that only hidden days use
 * are left out too, so the Tickets list and the taxi card don't give the plan away, and so are the
 * translation keys and ticket images only the left-out parts use. The admin password sees everything,
 * with hidden days marked.
 *
 * trip.enc keeps exactly this for the family password (vault.sealTrip and tools/…/bundle.py for_family,
 * which must stay the same as this), so on the family's phones the payload already is this, and running
 * it again changes nothing.
 * @param {Payload} payload
 * @returns {Payload}
 */
export function forFamily(payload) {
  const trip = payload.trip;
  const days = trip.days;
  if (!days?.some((d) => d.hidden)) return payload;
  /** @param {boolean} hidden @param {'place' | 'ticket'} field */
  const usedBy = (hidden, field) =>
    new Set(days.filter((d) => !!d.hidden === hidden).flatMap((d) => (d.events ?? []).flatMap((e) => e[field])));
  /**
   * @template T
   * @param {Record<string, T>} all
   * @param {'place' | 'ticket'} field
   * @param {unknown} [always]  an id that stays whatever uses it (the hotel)
   */
  const withoutSecret = (all, field, always) => {
    const shown = usedBy(false, field);
    const secret = usedBy(true, field);
    return Object.fromEntries(
      Object.entries(all ?? {}).filter(([id]) => id === always || shown.has(id) || !secret.has(id)),
    );
  };
  /** @type {Trip} */
  const familyTrip = {
    ...trip,
    days: /** @type {Trip['days']} */ (days.map((d) => (d.hidden ? hiddenStub(d) : d))),
    tickets: withoutSecret(trip.tickets, 'ticket'),
    places: withoutSecret(trip.places, 'place', trip.help?.hotel),
  };
  // whatever only the left-out parts mention: their translation keys (and plural forms), ticket images
  const kept = stringsIn(familyTrip);
  const secret = new Set([...stringsIn(trip)].filter((s) => !kept.has(s)));
  /** @param {string} key */
  const isSecret = (key) => secret.has(key) || secret.has(key.replace(PLURAL, ''));
  return {
    ...payload,
    trip: familyTrip,
    locales: Object.fromEntries(
      Object.entries(payload.locales ?? {}).map(([lang, strings]) => [
        lang,
        Object.fromEntries(Object.entries(strings).filter(([key]) => !isSecret(key))),
      ]),
    ),
    images: Object.fromEntries(Object.entries(payload.images ?? {}).filter(([path]) => !secret.has(path))),
  };
}

/**
 * Take a decrypted payload as the current trip.
 * @param {Payload} payload
 */
export function initTrip(payload) {
  /** @type {Trip} */
  const trip = payload.trip;
  state.trip = trip;
  state.settings = { language: null, speechLang: '', demoTodayIsDay: null, ...trip.settings };
  state.languages = state.settings.languages.length ? state.settings.languages : ['en'];
  state.fallback = state.languages[0];
  state.tripStrings = payload.locales || {};

  // ticket images travel inside trip.enc as data: URLs
  for (const ticket of Object.values(trip.tickets || {})) {
    if (ticket.image && payload.images?.[ticket.image]) ticket.image = payload.images[ticket.image];
  }

  // demo mode: the chosen day counts as today (a day that doesn't exist means no demo)
  const demoDay = state.settings.demoTodayIsDay;
  const anchor = demoDay ? trip.days[demoDay - 1] : undefined;
  state.demoShift = anchor ? daysBetween(parseDate(anchor.date), new Date()) : 0;
  state.days = trip.days.map(
    (day, i) =>
      /** @type {TripDay} */ ({
        ...day,
        n: i + 1,
        when: parseDate(day.date),
        events: [...(day.events || [])].sort((a, b) => toMin(a.time) - toMin(b.time)),
      }),
  );
}
