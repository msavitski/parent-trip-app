/* Types of the app's own data (the trip's types are generated in trip.d.ts). Used by JSDoc in web/js. */
import type { Day, Trip } from './trip';

/**
 * web/trip.enc (see tools/src/trip_tools/vault.py). Version 1: one password; version 2: family + admin;
 * version 3: version 2 with the hidden days apart, for the admin key only.
 */
export interface EncFile {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  /** The payload (v3: the family part): encrypted with the password key (v1) or the data key (v2, v3). */
  iv: string;
  data: string;
  /** v2, v3: the data key, wrapped by each password's key (admin: data key + admin key). */
  slots?: Partial<Record<Role, { iv: string; key: string }>>;
  /** v2, v3: the admin settings, encrypted with the admin key. */
  admin?: { iv: string; data: string };
  /** v3: the hidden part (the whole trip, and the ticket images only hidden days use), encrypted with the admin key. */
  hidden?: { iv: string; data: string };
}

/** Which password opened the trip. */
export type Role = 'family' | 'admin';

/** Where a file is published on GitHub. */
export interface RepoTarget {
  /** "owner/name" */
  repo: string;
  branch: string;
  /** File (site) or folder (trip data, "" = root) inside the repository. */
  path: string;
}

/** The admin settings inside trip.enc (set by `trip admin`). */
export interface AdminConfig {
  token?: string;
  /** GitHub API address (only changed for testing). */
  api?: string;
  /** The public site repository and the trip.enc file in it. */
  site?: RepoTarget;
  /** The private repository with the readable trip data. */
  data?: RepoTarget;
}

/** trip.enc opened with one password. The keys stay in memory only. */
export interface Opened {
  role: Role;
  /** The trip as this password sees it: the admin's has the hidden days merged in (v3). */
  payload: Payload;
  dataKey: Uint8Array<ArrayBuffer>;
  adminKey: Uint8Array<ArrayBuffer> | null;
  admin: AdminConfig | null;
}

/** A screen inside the Edit tab (admin only). */
export type EditView =
  | { view: 'day'; day: number }
  /** event -1: a new event */
  | { view: 'event'; day: number; event: number }
  /** id "": a new place */
  | { view: 'place'; id: string }
  /** id "": a new ticket. image: chosen but not saved yet */
  | { view: 'ticket'; id: string; image?: TicketImage }
  /** "trip", or a language code for that language's trip texts */
  | { view: 'json'; part: string };

/** A ticket image read from a file in the Edit tab. */
export interface TicketImage {
  /** Where it goes in the trip data folder, e.g. "tickets/boat-m1x2y3.png". */
  path: string;
  dataUrl: string;
  /** Made from a PDF: how many of its pages are in the image. */
  pages?: { kept: number; total: number };
}

/** Something to fix before publishing. */
export interface Problem {
  where: string;
  message: string;
}

/** What the Edit tab says after Publish. */
export interface EditNotice {
  kind: 'ok' | 'warn' | 'error';
  text: string;
  problems?: Problem[];
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

export type Tab = 'today' | 'days' | 'lists' | 'phrases' | 'help' | 'edit';
export type SheetType = 'taxi' | 'tickets' | 'ticket' | 'money' | 'phrase';

/** An open full-screen sheet. */
export interface Sheet {
  type: SheetType;
  /** Place id, ticket id or phrase index. */
  arg?: string | number;
  /** Money sheet direction: from local currency (default) or from home currency. */
  dir?: 'local' | 'home';
}
