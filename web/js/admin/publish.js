/**
 * Publish from the app (admin mode).
 *
 * 1. Check the draft (validate.js).
 * 2. Make sure the site still has the trip.enc this app opened; otherwise someone published since
 *    (`trip build`, or the app on another device) and publishing now would undo their changes.
 * 3. Re-encrypt with the same data key (vault.sealTrip): both passwords and every phone keep working.
 * 4. Commit web/trip.enc to the site repository: GitHub Actions deploys it in a minute or two.
 * 5. Commit the readable copy (trip.json5, texts, ticket images) to the private repository.
 *
 * Until GitHub Pages serves the new file, this device keeps using it (pendingEnc), so a reload right
 * after publishing doesn't show the old trip.
 *
 * @import { EditNotice, EncFile, Payload } from '../../../types/app'
 */
import { t } from '../i18n.js';
import { state } from '../state.js';
import { bigStore } from '../util.js';
import { fromBase64, sealTrip } from '../vault.js';
import { dropUnusedEditorKeys, dropUnusedImages } from './draft.js';
import { GitHubError, commit, readText } from './github.js';
import { validate } from './validate.js';

/** Commit messages (they are for the repositories' history, not for the app's screens). */
const SITE_MESSAGE = 'Update the trip (published from the app)';
const DATA_MESSAGE = 'Update the trip data (published from the app)';
const TRIP_HEADER =
  '// Published from the Our Trip app (admin mode). Comments are not kept when the app publishes.\n' +
  '// Edit it like any trip.json5, then `trip build` (pull this repository first).\n';

const PENDING = 'admin-pending';
const PENDING_HOURS = 24;

/** @typedef {{ at: number, enc: EncFile, replaced: string[] }} Pending  replaced: IVs of the versions it supersedes */

/**
 * The trip.enc to use. Right after publishing, GitHub Pages still serves an older version for a few
 * minutes (and after several quick publishes, possibly one from before the first of them): while the
 * site serves any version this device replaced, use the one it published. Once the site serves the new
 * version, or one published elsewhere, use what was downloaded.
 * @param {EncFile} fetched
 * @returns {Promise<EncFile>}
 */
export async function pendingEnc(fetched) {
  /** @type {Pending | null} */
  const pending = await bigStore.get(PENDING);
  if (!pending) return fetched;
  const fresh = Date.now() - pending.at < PENDING_HOURS * 3600e3;
  if (fresh && pending.replaced.includes(fetched.iv)) {
    state.pending = true;
    return pending.enc;
  }
  await bigStore.set(PENDING, null);
  return fetched;
}

/** @param {unknown} error */
function describe(error) {
  if (!(error instanceof GitHubError)) return t('edit.err.unexpected', { error: String(error) });
  if (error.status === 0) return t('edit.err.network');
  if (error.status === 401) return t('edit.err.token');
  if (error.status === 403 || error.status === 404) return t('edit.err.access', { repo: error.repo });
  if (error.status === 409 || error.status === 422) return t('edit.err.race', { repo: error.repo });
  return t('edit.err.github', { status: error.status, repo: error.repo });
}

/**
 * The readable copy for the private repository: the whole trip (github.commit uploads only what differs
 * from the repository, so a copy that failed once catches up on the next publish), and the deletion of
 * ticket images that `before` had and the draft no longer has.
 * @param {Payload} draft
 * @param {Payload} before
 * @param {string} folder  "" for the repository's root
 */
function readableFiles(draft, before, folder) {
  const at = (/** @type {string} */ path) => (folder ? `${folder.replace(/\/+$/, '')}/${path}` : path);
  /** @type {{ path: string, content: string | Uint8Array | null }[]} */
  const files = [
    {
      path: at('trip.json5'),
      content: TRIP_HEADER + JSON.stringify({ $schema: '../schema/trip.schema.json', ...draft.trip }, null, 2) + '\n',
    },
  ];
  for (const [lang, strings] of Object.entries(draft.locales)) {
    files.push({ path: at(`locales/${lang}/trip.json`), content: JSON.stringify(strings, null, 2) + '\n' });
  }
  for (const [path, dataUrl] of Object.entries(draft.images)) {
    files.push({ path: at(path), content: fromBase64(dataUrl.split(',', 2)[1]) });
  }
  for (const path of Object.keys(before.images))
    if (!(path in draft.images)) files.push({ path: at(path), content: null });
  return files;
}

/**
 * Publish the draft. Returns what the Edit tab should say.
 * @returns {Promise<EditNotice>}
 */
export async function publish() {
  const { draft, original, opened, enc } = state;
  if (!draft || !original || !opened || !enc)
    return { kind: 'error', text: t('edit.err.unexpected', { error: 'no draft' }) };

  dropUnusedEditorKeys(draft);
  dropUnusedImages(draft);
  const problems = validate(draft);
  if (problems.length) return { kind: 'error', text: t('edit.problems'), problems };

  const config = opened.admin;
  if (!config?.token || !config.site || !config.data) return { kind: 'error', text: t('edit.err.noToken') };
  if (navigator.onLine === false) return { kind: 'error', text: t('edit.err.offline') };

  try {
    const current = await readText(config, config.site);
    if (current && JSON.parse(current).iv !== enc.iv) return { kind: 'error', text: t('edit.err.conflict') };

    const sealed = await sealTrip(draft, opened, enc);
    await commit(
      config,
      config.site.repo,
      config.site.branch,
      [{ path: config.site.path, content: JSON.stringify(sealed) }],
      SITE_MESSAGE,
    );

    // published: this is now the trip as it is online
    /** @type {Pending | null} */
    const previous = await bigStore.get(PENDING);
    const replaced = [...(previous?.enc.iv === enc.iv ? previous.replaced : []), enc.iv];
    await bigStore.set(PENDING, { at: Date.now(), enc: sealed, replaced });
    await bigStore.set('admin-draft', null);
    state.enc = sealed;
    state.original = structuredClone(draft);
    state.pending = true;

    try {
      await commit(
        config,
        config.data.repo,
        config.data.branch,
        readableFiles(draft, original, config.data.path),
        DATA_MESSAGE,
      );
    } catch (error) {
      return { kind: 'warn', text: t('edit.publishedNoCopy', { error: describe(error) }) };
    }
    return { kind: 'ok', text: t('edit.published') };
  } catch (error) {
    return { kind: 'error', text: describe(error) };
  }
}
