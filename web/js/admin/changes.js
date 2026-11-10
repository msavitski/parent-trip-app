/**
 * What the admin changed since the last publish, in words, for the commit messages.
 *
 * Every change comes in two wordings:
 *  - `detail`: with names and texts ("Day 3 (Old City): event added "Lunch""), for the private repository
 *    that keeps the readable copy of the trip;
 *  - `plain`: only the kind of change ("Day 3: events"), for the site repository. That one is public (only
 *    trip.enc is encrypted), so no name, text or place of the trip may go into its history, and a hidden day
 *    is never named at all.
 *
 * @import { Payload } from '../../../types/app'
 * @import { Event } from '../../../types/trip'
 */
import { ticketsOf } from '../trip.js';
import { languagesOf, textIn } from './draft.js';

/** @typedef {{ detail: string, plain: string }} Change */

/** One line, short: names are cut so a message stays readable. @param {string} text @param {number} [max] */
const clip = (text, max = 40) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** @param {string[]} names */
const quoted = (names) => names.map((n) => `"${clip(n)}"`).join(', ');

/**
 * @param {Payload} before  the trip as published
 * @param {Payload} after  the edited trip
 * @returns {Change[]}
 */
export function describeChanges(before, after) {
  /** @type {Change[]} */
  const changes = [];
  /** @param {string} detail @param {string} plain */
  const add = (detail, plain) => changes.push({ detail, plain });
  const tb = before.trip;
  const ta = after.trip;
  /** The text of a TextRef in the trip's first language. @param {Payload} p @param {Parameters<typeof textIn>[1]} ref */
  const txt = (p, ref) => textIn(p, ref, languagesOf(p)[0]);
  const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  // ---- days, matched by date
  const oldDays = new Map((tb.days ?? []).map((d) => [d.date, d]));
  const newDates = new Set((ta.days ?? []).map((d) => d.date));
  (ta.days ?? []).forEach((day, i) => {
    const n = i + 1;
    const old = oldDays.get(day.date);
    if (!old) {
      add(
        `New day ${n}: "${clip(txt(after, day.title))}" (${day.date})`,
        day.hidden ? 'Hidden day updated' : `New day ${n}`,
      );
      return;
    }
    /** @type {string[]} */
    const bits = [];
    if (txt(before, old.title) !== txt(after, day.title)) bits.push('title');
    if (txt(before, old.note) !== txt(after, day.note)) bits.push('note');
    if (!!old.hidden !== !!day.hidden) bits.push(day.hidden ? 'hidden from the family' : 'shown to the family');
    if (!same(old.weather, day.weather)) bits.push('weather place');
    if ((old.hotel ?? '') !== (day.hotel ?? '')) bits.push('hotel');
    const events = eventChanges(before, old.events ?? [], after, day.events ?? []);
    if (!bits.length && !events.detail.length) return;
    const hidden = old.hidden || day.hidden;
    add(
      `Day ${n} (${clip(txt(after, day.title))}): ${[...bits, ...events.detail].join('; ')}`,
      hidden ? 'Hidden day updated' : `Day ${n}: ${[...bits, ...(events.detail.length ? ['events'] : [])].join(', ')}`,
    );
  });
  for (const [date, old] of oldDays) {
    if (!newDates.has(date))
      add(`Removed day ${date}: "${clip(txt(before, old.title))}"`, old.hidden ? 'Hidden day updated' : 'Day removed');
  }

  // ---- places and tickets, matched by id
  /**
   * @param {'place' | 'ticket'} kind
   * @param {Record<string, any>} was
   * @param {Record<string, any>} now
   * @param {(p: Payload, item: any) => unknown} signature  what counts as "the same"
   */
  const byId = (kind, was, now, signature) => {
    for (const [id, item] of Object.entries(now ?? {})) {
      const title = clip(txt(after, item.name ?? item.title));
      if (!(id in (was ?? {}))) add(`New ${kind} "${title}"`, `New ${kind}`);
      else if (!same(signature(before, was[id]), signature(after, item)))
        add(`Changed ${kind} "${title}"`, `${kind[0].toUpperCase()}${kind.slice(1)} changed`);
    }
    for (const [id, item] of Object.entries(was ?? {})) {
      if (!(id in (now ?? {})))
        add(
          `Removed ${kind} "${clip(txt(before, item.name ?? item.title))}"`,
          `${kind[0].toUpperCase()}${kind.slice(1)} removed`,
        );
    }
  };
  byId('place', tb.places, ta.places, (p, x) => ({ ...x, name: txt(p, x.name) }));
  byId('ticket', tb.tickets, ta.tickets, (p, x) => ({ ...x, title: txt(p, x.title), when: txt(p, x.when) }));

  // ---- everything else (the JSON editor: lists, phrases, money, help, settings…)
  const skip = new Set(['days', 'places', 'tickets']);
  for (const key of new Set([...Object.keys(tb), ...Object.keys(ta)])) {
    const k = /** @type {keyof typeof tb} */ (key);
    if (!skip.has(key) && !same(tb[k], ta[k])) add(`Changed ${key}`, `Changed ${key}`);
  }
  return changes;
}

/**
 * Events of one day that were added, removed or changed.
 * @param {Payload} before @param {Event[]} was @param {Payload} after @param {Event[]} now
 * @returns {{ detail: string[] }}
 */
function eventChanges(before, was, after, now) {
  /** @param {Payload} p @param {Event} e */
  const title = (p, e) => textIn(p, e.title, languagesOf(p)[0]);
  /** @param {Payload} p @param {Event} e */
  const sig = (p, e) =>
    JSON.stringify([
      e.time,
      e.icon,
      title(p, e),
      textIn(p, e.note, languagesOf(p)[0]),
      textIn(p, e.meet, languagesOf(p)[0]),
      e.place ?? '',
      ticketsOf(e).join(','),
    ]);
  const olds = was.map((e) => ({ e, s: sig(before, e) }));
  const news = now.map((e) => ({ e, s: sig(after, e) }));
  let removed = olds.filter((o) => !news.some((n) => n.s === o.s));
  const fresh = news.filter((n) => !olds.some((o) => o.s === n.s));
  /** @type {string[]} */
  const changed = [];
  /** @type {string[]} */
  const added = [];
  for (const n of fresh) {
    // an old event with the same title or time that is gone now: this one is it, edited
    const match = removed.find((o) => title(before, o.e) === title(after, n.e) || o.e.time === n.e.time);
    if (match) {
      removed = removed.filter((o) => o !== match);
      changed.push(title(after, n.e));
    } else added.push(title(after, n.e));
  }
  /** @type {string[]} */
  const detail = [];
  if (changed.length) detail.push(`event changed ${quoted(changed)}`);
  if (added.length) detail.push(`event added ${quoted(added)}`);
  if (removed.length) detail.push(`event removed ${quoted(removed.map((o) => title(before, o.e)))}`);
  return { detail };
}

/**
 * A commit message: a short first line, then every change on its own line. Nothing changed (a text edit
 * nothing shows yet): "Update the trip".
 * @param {string[]} summary  one short line per change: the first line is made from these
 * @param {string[]} [lines]  one line per change for the body (default: the summary)
 * @param {string} [prefix]  start of the first line
 */
export function commitMessage(summary, lines = summary, prefix = '') {
  const unique = [...new Set(summary)];
  if (!unique.length) return `${prefix}Update the trip (published from the app)`;
  const first = unique.slice(0, 2).join('; ') + (unique.length > 2 ? ` (+${unique.length - 2} more)` : '');
  const subject = `${prefix}${first}`;
  const short = subject.length > 72 ? `${subject.slice(0, 71)}…` : subject;
  const body = [...new Set(lines)];
  return `${short}\n\n${body.map((l) => `- ${l}`).join('\n')}\n\nPublished from the app (admin mode).`;
}
