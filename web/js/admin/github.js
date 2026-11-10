/**
 * The few GitHub API calls admin mode needs: read a file, and commit several files at once (one
 * commit, all or nothing) with the token from trip.enc's admin settings.
 *
 * A commit is made from the branch's current head and the ref is moved without force, so if someone
 * pushed in between, GitHub refuses (422) instead of losing their work.
 *
 * Every call is a round trip over the phone's connection (and, from a web page, GitHub first answers a
 * "preflight" for each new address), so this module keeps the number of calls that wait for each other low:
 * what can be asked at the same time is (readBranch, the blob uploads), and a repository can be read
 * while another one is being committed to (pass readBranch's promise to commit as `start`).
 *
 * @import { AdminConfig, RepoTarget } from '../../../types/app'
 */
import { toBase64 } from '../vault.js';

const DEFAULT_API = 'https://api.github.com';

export class GitHubError extends Error {
  /**
   * @param {number} status  HTTP status, or 0 when GitHub couldn't be reached
   * @param {string} repo
   * @param {string} detail
   */
  constructor(status, repo, detail) {
    super(`GitHub ${status} for ${repo}: ${detail}`);
    this.status = status;
    this.repo = repo;
  }
}

/**
 * @param {AdminConfig} config
 * @param {string} repo
 * @param {string} method
 * @param {string} path  after /repos/{repo}
 * @param {unknown} [body]
 * @param {string} [accept]
 */
async function call(config, repo, method, path, body, accept = 'application/vnd.github+json') {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`${config.api || DEFAULT_API}/repos/${repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new GitHubError(0, repo, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) throw new GitHubError(response.status, repo, (await response.text()).slice(0, 300));
  return response;
}

/** @param {string} path */
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/**
 * A text file from a branch (or a commit), or null if it doesn't exist.
 * @param {AdminConfig} config
 * @param {RepoTarget} target
 * @param {string} [ref]  a commit to read it at; default: the branch's head
 */
export async function readText(config, target, ref = target.branch) {
  try {
    const response = await call(
      config,
      target.repo,
      'GET',
      `/contents/${encodePath(target.path)}?ref=${encodeURIComponent(ref)}`,
      undefined,
      'application/vnd.github.raw+json',
    );
    return await response.text();
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

/** @param {Response} response */
const json = async (response) => response.json();

/**
 * What a commit builds on: the branch's head, its tree, and (when asked for) the files in it with their ids.
 * @typedef {{ head: string, tree: string, existing: Map<string, string> | null, file: string | null }} Branch
 */

/**
 * Look at a branch: its head commit, that commit's tree, and optionally
 *  - `listing`: every file in it, to skip the ones a commit would write unchanged, and to delete only what exists;
 *  - `read`: the text of a file in it, read at that very head (so what is checked is what gets built on).
 * Start it early and pass the promise to commit(): it only reads.
 * @param {AdminConfig} config
 * @param {RepoTarget} target
 * @param {{ listing?: boolean, read?: string }} [options]
 * @returns {Promise<Branch>}
 */
export async function readBranch(config, target, { listing = true, read } = {}) {
  const { repo, branch } = target;
  const ref = await json(await call(config, repo, 'GET', `/git/ref/heads/${encodeURIComponent(branch)}`));
  const head = ref.object.sha;
  const [base, file] = await Promise.all([
    call(config, repo, 'GET', `/git/commits/${head}`).then(json),
    read ? readText(config, { ...target, path: read }, head) : null,
  ]);
  /** @type {Map<string, string> | null} path -> blob sha, for the files the branch has now */
  let existing = null;
  if (listing) {
    const tree = await json(await call(config, repo, 'GET', `/git/trees/${base.tree.sha}?recursive=1`));
    existing = new Map(
      tree.tree
        .filter((/** @type {{ type: string }} */ e) => e.type === 'blob')
        .map((/** @type {{ path: string, sha: string }} */ e) => [e.path, e.sha]),
    );
  }
  return { head, tree: base.tree.sha, existing, file };
}

/** Uploads that run at the same time (GitHub is fine with a few; a phone's connection isn't helped by more). */
const UPLOADS = 4;

/**
 * Run fn over the items, a few at a time, keeping their order in the result.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

/**
 * Git's id of a file's content (SHA-1 of "blob <size>\0" + content), to skip files that are unchanged.
 * @param {Uint8Array} bytes
 */
async function blobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One commit on top of the branch: write the files with content, delete those with content null.
 * Files the branch already has with the same content are skipped, and so is the commit if nothing is
 * left, so sending the whole set every time is cheap and a copy that failed once catches up later.
 * (Without a listing, readBranch's `listing: false`, every file is written, and deletions are not possible.)
 * @param {AdminConfig} config
 * @param {string} repo
 * @param {string} branch
 * @param {{ path: string, content: string | Uint8Array | null }[]} files
 * @param {string} message
 * @param {Promise<Branch>} [start]  the branch as readBranch found it, started earlier; default: look now
 * @returns {Promise<string>} the new commit's sha (or the branch's head if nothing changed)
 */
export async function commit(config, repo, branch, files, message, start) {
  const { head, tree: baseTree, existing } = await (start ?? readBranch(config, { repo, branch, path: '' }));
  if (!existing && files.some((f) => f.content == null)) throw new Error('Deleting files needs the branch listing');

  // the changed files, uploaded a few at a time; text goes as it is (base64 would make it a third bigger)
  const uploaded = await mapLimit(files, UPLOADS, async (file) => {
    if (file.content == null) return existing?.has(file.path) ? { path: file.path, sha: null } : null;
    const text = typeof file.content === 'string';
    const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
    if (existing?.get(file.path) === (await blobSha(bytes))) return null;
    const blob = await json(
      await call(
        config,
        repo,
        'POST',
        '/git/blobs',
        text ? { content: file.content, encoding: 'utf-8' } : { content: toBase64(bytes), encoding: 'base64' },
      ),
    );
    return { path: file.path, sha: blob.sha };
  });
  const tree = uploaded.filter((e) => e != null).map((e) => ({ ...e, mode: '100644', type: 'blob' }));
  if (!tree.length) return head;
  const newTree = await json(await call(config, repo, 'POST', '/git/trees', { base_tree: baseTree, tree }));
  const created = await json(
    await call(config, repo, 'POST', '/git/commits', { message, tree: newTree.sha, parents: [head] }),
  );
  await call(config, repo, 'PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, {
    sha: created.sha,
    force: false,
  });
  return created.sha;
}
