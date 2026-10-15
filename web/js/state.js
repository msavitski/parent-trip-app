/**
 * The app's one mutable state object. It imports nothing, so every module can read and update it
 * without import cycles. Only plain data lives here; behaviour lives in the modules that use it.
 *
 * @import { Settings, Trip } from '../../types/trip'
 * @import { EncFile, Sheet, Strings, Tab, TripDay } from '../../types/app'
 */

export const state = {
  /** The encrypted trip file, once downloaded. */
  enc: /** @type {EncFile | null} */ (null),

  /** The opened trip (null until the password or a saved key opens it). */
  trip: /** @type {Trip | null} */ (null),
  /** Trip settings with defaults filled in. */
  settings: /** @type {Required<Settings>} */ ({
    languages: ['en'],
    language: null,
    speechLang: '',
    demoTodayIsDay: null,
  }),
  /** Trip days with their real calendar date (`when`) and events sorted by time. */
  days: /** @type {TripDay[]} */ ([]),

  /** Languages of this trip; the first one is the fallback for missing words. */
  languages: ['en'],
  fallback: 'en',
  /** Current language code. */
  lang: 'en',
  /** Trip texts per language (private/locales/<lang>/trip.json, delivered inside trip.enc). */
  tripStrings: /** @type {Record<string, Strings>} */ ({}),

  /** Screen state. */
  tab: /** @type {Tab} */ ('today'),
  dayOpen: /** @type {number | null} */ (null),
  /** Open full-screen sheets, topmost last. */
  sheets: /** @type {Sheet[]} */ ([]),
};
