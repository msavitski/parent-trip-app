/* Generated from schema/trip.schema.json by 'npm run types'. Do not edit: change tools/src/trip_tools/model.py, then run 'trip schema' and 'npm run types'. */

/**
 * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
 *
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "TextRef".
 */
export type TextRef = string | [string] | [string, {[name: string]: string | number}];

export interface Trip {
  /**
   * For editors only; ignored by the app.
   */
  $schema?: string | null;
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  title: string | [string] | [string, {[name: string]: string | number}];
  settings: Settings;
  weather?: Weather | null;
  places: {
    [k: string]: Place;
  };
  tickets: {
    [k: string]: Ticket;
  };
  /**
   * @minItems 1
   */
  days: [Day, ...Day[]];
  taxi: Taxi;
  help: Help;
  money: Money;
  lists: Checklist[];
  phrases: Phrase[];
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Settings".
 */
export interface Settings {
  /**
   * Language codes; the first is the fallback.
   *
   * @minItems 1
   */
  languages: [string, ...string[]];
  /**
   * Force one language; null = the phone's language.
   */
  language?: string | null;
  /**
   * Language spoken at the destination, e.g. "tr-TR".
   */
  speechLang?: string;
  /**
   * Demo only: pretend today is this day.
   */
  demoTodayIsDay?: number | null;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Weather".
 */
export interface Weather {
  lat: number;
  lon: number;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Place".
 */
export interface Place {
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  name: string | [string] | [string, {[name: string]: string | number}];
  /**
   * As locals write it (taxi card, maps).
   */
  localName?: string | null;
  /**
   * As locals write it (taxi card, maps).
   */
  address: string;
  phone?: string | null;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Ticket".
 */
export interface Ticket {
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  title: string | [string] | [string, {[name: string]: string | number}];
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  when: string | [string] | [string, {[name: string]: string | number}];
  code: string;
  /**
   * Path inside the data folder, e.g. tickets/flight-out.png
   */
  image?: string | null;
  details?: TextRef[] | null;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Day".
 */
export interface Day {
  /**
   * e.g. 2026-11-03
   */
  date: string;
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  title: string | [string] | [string, {[name: string]: string | number}];
  note?: TextRef | null;
  /**
   * Only the admin password shows this day; the family sees "Plan coming later" (and its weather).
   */
  hidden?: boolean;
  events: Event[];
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Event".
 */
export interface Event {
  /**
   * 24-hour local time, e.g. 09:45
   */
  time: string;
  icon: "plane" | "car" | "bed" | "food" | "coffee" | "landmark" | "ship" | "bag" | "walk" | "moon" | "suitcase";
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  title: string | [string] | [string, {[name: string]: string | number}];
  note?: TextRef | null;
  meet?: TextRef | null;
  /**
   * A key of `places`.
   */
  place?: string | null;
  /**
   * A key of `tickets`.
   */
  ticket?: string | null;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Taxi".
 */
export interface Taxi {
  /**
   * "Please take me to this address", in the local language.
   */
  ask: string;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Help".
 */
export interface Help {
  emergency: string;
  /**
   * The first one gets the big Call button.
   *
   * @minItems 1
   */
  family: [Contact, ...Contact[]];
  lost: TextRef[];
  /**
   * A key of `places`.
   */
  hotel: string;
  insurance?: Insurance | null;
  consulate?: Consulate | null;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Contact".
 */
export interface Contact {
  name: string;
  note?: TextRef | null;
  phone: string;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Insurance".
 */
export interface Insurance {
  company: string;
  policy: string;
  phone: string;
  note?: TextRef | null;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Consulate".
 */
export interface Consulate {
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  name: string | [string] | [string, {[name: string]: string | number}];
  note?: TextRef | null;
  phone: string;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Money".
 */
export interface Money {
  local: Currency;
  home: Currency;
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  pair: string | [string] | [string, {[name: string]: string | number}];
  /**
   * 1 home = this many local.
   */
  rate: number;
  quick: QuickAmounts;
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Currency".
 */
export interface Currency {
  /**
   * ISO 4217, e.g. TRY
   */
  code: string;
  symbol: string;
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  price: string | [string] | [string, {[name: string]: string | number}];
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  from: string | [string] | [string, {[name: string]: string | number}];
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "QuickAmounts".
 */
export interface QuickAmounts {
  local: number[];
  home: number[];
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Checklist".
 */
export interface Checklist {
  /**
   * Also the storage key of the ticks: don't rename during a trip.
   */
  id: string;
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  title: string | [string] | [string, {[name: string]: string | number}];
  /**
   * @minItems 1
   */
  items: [TextRef, ...TextRef[]];
}
/**
 * This interface was referenced by `Trip`'s JSON-Schema
 * via the `definition` "Phrase".
 */
export interface Phrase {
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  meaning: string | [string] | [string, {[name: string]: string | number}];
  /**
   * A translation key ("d1.title") or a key with values for its placeholders (["meet.lobbyAt", {"time": "09:45"}]).
   */
  say: string | [string] | [string, {[name: string]: string | number}];
  /**
   * The phrase in the destination's language.
   */
  local: string;
  /**
   * Shown big under the phrase, e.g. a phone number.
   */
  extra?: string | null;
}
