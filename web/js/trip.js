/**
 * The opened trip and calendar helpers.
 *
 * @import { Trip } from '../../types/trip'
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

/** Index of today's trip day, or -1. */
export const todayIndex = () => state.days.findIndex((d) => daysBetween(d.when, new Date()) === 0);

/** Whether "Hear it" buttons can work for this trip's destination language. */
export const canSpeak = () => canSpeakIn(state.settings.speechLang);

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

  // demo mode: move the whole trip so that the chosen day is today (a day that doesn't exist means no demo)
  const demoDay = state.settings.demoTodayIsDay;
  const anchor = demoDay ? trip.days[demoDay - 1] : undefined;
  const shift = anchor ? daysBetween(parseDate(anchor.date), new Date()) : 0;
  state.days = trip.days.map(
    (day, i) =>
      /** @type {TripDay} */ ({
        ...day,
        n: i + 1,
        when: addDays(parseDate(day.date), shift),
        events: [...(day.events || [])].sort((a, b) => toMin(a.time) - toMin(b.time)),
      }),
  );
}
