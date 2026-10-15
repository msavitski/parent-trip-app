/* Types of the app's own data (the trip's types are generated in trip.d.ts). Used by JSDoc in web/js. */
import type { Day, Trip } from './trip';

/** web/trip.enc (see tools/src/trip_tools/vault.py). */
export interface EncFile {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

/** What trip.enc decrypts to (see tools/src/trip_tools/bundle.py). */
export interface Payload {
  trip: Trip;
  /** Trip strings per language. */
  locales: Record<string, Strings>;
  /** Ticket image path -> data: URL. */
  images: Record<string, string>;
}

export type Strings = Record<string, string>;
export type Vars = Record<string, string | number>;

/** A trip day with its calendar date and events sorted by time. */
export interface TripDay extends Day {
  /** 1-based day number. */
  n: number;
  /** Local midnight of the day (moved to "now" in demo mode). */
  when: Date;
}

/** One day of the saved Open-Meteo forecast. */
export interface WeatherDay {
  code: number | null;
  max: number;
  min: number | null;
  feelsMax: number | null;
  feelsMin: number | null;
  /** km/h */
  wind: number | null;
  gust: number | null;
  /** chance of rain, % */
  rain: number | null;
  /** "18:22", local time at the destination */
  sunset: string;
}

/** localStorage "trip:weather" */
export interface WeatherCache {
  at: number;
  lat: number;
  lon: number;
  days: Record<string, WeatherDay>;
}

export type Tab = 'today' | 'days' | 'lists' | 'phrases' | 'help';
export type SheetType = 'taxi' | 'tickets' | 'ticket' | 'money' | 'phrase';

/** An open full-screen sheet. */
export interface Sheet {
  type: SheetType;
  /** Place id, ticket id or phrase index. */
  arg?: string | number;
  /** Money sheet direction: from local currency (default) or from home currency. */
  dir?: 'local' | 'home';
}
