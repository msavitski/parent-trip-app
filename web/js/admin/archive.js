/**
 * The archive (admin mode): past trips put away in web/archive.enc, which only the admin password opens, so the
 * family's phones (and anyone who downloads the site) never see them. The site shows one trip at a time, the one in
 * trip.enc; the admin can put it away and start another, or bring a past trip back (it takes the place of the
 * current one, which goes to the archive). Like every Edit-tab change this stays a draft until Publish, which writes
 * trip.enc and archive.enc together (publish.js).
 *
 * The archive key that opens archive.enc lives in the admin settings of trip.enc (`archiveKey`, made on the first
 * archive), so it is as private as the GitHub token and survives a change of the admin password (vault.js).
 *
 * @import { ArchiveFile, ArchivedTrip, Payload } from '../../../types/app'
 */
import { state } from '../state.js';
import { isoDate } from '../trip.js';
import { bigStore } from '../util.js';
import { newArchiveKey, openArchive, sealArchive } from '../vault.js';
import { languagesOf, textIn } from './draft.js';

/** The last archive.enc this device read, kept for when it is offline. */
const CACHED = 'admin-archive-file';

/** Where archive.enc goes: next to the trip file ("web/trip.enc" -> "web/archive.enc"). @param {string} tripPath */
export const archivePath = (tripPath) => tripPath.replace(/[^/]*$/, 'archive.enc');

/**
 * Read archive.enc (or the one just published, `pending`: the site may still serve an older one) and open it with
 * the archive key. Sets state.archive, state.archiveOriginal and state.archiveStatus; never throws.
 * @param {ArchiveFile | null} [pending]
 */
export async function loadArchive(pending = null) {
  state.archive = [];
  state.archiveOriginal = [];
  state.archiveStatus = 'ok';
  /** @type {ArchiveFile | null} */
  let file = pending;
  if (!file) {
    try {
      // no-cache: the site lets a browser keep files for 10 minutes; ask whether it changed
      const response = await fetch('archive.enc', { cache: 'no-cache' });
      if (response.ok) {
        file = await response.json();
        await bigStore.set(CACHED, file);
      } else if (response.status !== 404) throw new Error(`archive.enc: ${response.status}`);
      else await bigStore.set(CACHED, null);
    } catch {
      file = await bigStore.get(CACHED);
      if (!file) state.archiveStatus = 'offline';
    }
  }
  if (!file) return;
  const key = state.opened?.admin?.archiveKey;
  const trips = key ? await openArchive(file, key).catch(() => null) : null;
  if (!trips) {
    state.archiveStatus = 'locked';
    return;
  }
  state.archive = trips;
  state.archiveOriginal = [...trips];
}

/** A new id for a trip. */
const newTripId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A trip's title in its first language, for lists. @param {Payload} payload */
export const tripName = (payload) => textIn(payload, payload.trip.title, languagesOf(payload)[0]) || '?';

/** First and last day of a trip, "2026-11-02 – 2026-11-06", for lists. @param {Payload} payload */
export function tripDates(payload) {
  const days = payload.trip.days ?? [];
  return days.length ? `${days[0].date} – ${days[days.length - 1].date}` : '';
}

/**
 * A trip as the archive keeps it: a copy that has an id (a trip made before ids existed gets its first one here).
 * @param {Payload} payload
 * @returns {ArchivedTrip}
 */
function archived(payload) {
  const copy = structuredClone(payload);
  copy.trip.id ??= newTripId();
  return { id: copy.trip.id, name: tripName(copy), archivedAt: isoDate(new Date()), payload: copy };
}

/** Put the current trip away and carry on with a copy of it, with a new id, to turn into the next trip. */
export function archiveAndStartNew() {
  if (!state.draft) return;
  state.archive = [archived(state.draft), ...state.archive];
  state.draft = structuredClone(state.draft);
  state.draft.trip.id = newTripId();
}

/**
 * Bring a past trip back: it becomes the current trip, and the current one takes its place in the archive.
 * @param {string} id
 */
export function switchToArchived(id) {
  const entry = state.archive.find((t) => t.id === id);
  if (!entry || !state.draft) return;
  state.archive = [archived(state.draft), ...state.archive.filter((t) => t.id !== id)];
  state.draft = structuredClone(entry.payload);
}

/** Delete a past trip for good (once published). @param {string} id */
export function deleteArchived(id) {
  state.archive = state.archive.filter((t) => t.id !== id);
}

/**
 * archive.enc for Publish. The archive key is made here the first time; `adminChanged` says the admin settings get
 * it now, so trip.enc has to carry them (vault.sealTrip). The key is not put into the open admin settings yet:
 * that is for after the commit succeeded (publish.js), or a failed publish would leave the next one believing
 * trip.enc already has a key it never got, and the archive could not be opened again.
 * @returns {Promise<{ file: ArchiveFile, key: string, adminChanged: boolean }>}
 */
export async function sealForPublish() {
  const config = state.opened?.admin;
  if (!config) throw new Error('Only the admin settings can hold the archive key');
  const key = config.archiveKey ?? newArchiveKey();
  return { file: await sealArchive(state.archive, key), key, adminChanged: !config.archiveKey };
}
