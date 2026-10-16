/**
 * The few GitHub API calls admin mode needs: read a file, and commit several files at once (one
 * commit, all or nothing) with the token from trip.enc's admin settings.
 *
 * A commit is made from the branch's current head and the ref is moved without force, so if someone
 * pushed in between, GitHub refuses (422) instead of losing their work.
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
 * A text file from a branch, or null if it doesn't exist.
 * @param {AdminConfig} config
 * @param {RepoTarget} target
 */
export async function readText(config, target) {
  try {
    const response = await call(
      config,
      target.repo,
      'GET',
      `/contents/${encodePath(target.path)}?ref=${encodeURIComponent(target.branch)}`,
      undefined,
      'application/vnd.github.raw+json',
    );
    return await response.text();
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
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
 * @param {AdminConfig} config
 * @param {string} repo
 * @param {string} branch
 * @param {{ path: string, content: string | Uint8Array | null }[]} files
 * @param {string} message
 * @returns {Promise<string>} the new commit's sha (or the branch's head if nothing changed)
 */
export async function commit(config, repo, branch, files, message) {
  const json = async (/** @type {Response} */ r) => r.json();
  const ref = await json(await call(config, repo, 'GET', `/git/ref/heads/${encodeURIComponent(branch)}`));
  const head = ref.object.sha;
  const base = await json(await call(config, repo, 'GET', `/git/commits/${head}`));
  const listing = await json(await call(config, repo, 'GET', `/git/trees/${base.tree.sha}?recursive=1`));
  /** @type {Map<string, string>} path -> blob sha, for the files the branch has now */
  const existing = new Map(
    listing.tree
      .filter((/** @type {{ type: string }} */ e) => e.type === 'blob')
      .map((/** @type {{ path: string, sha: string }} */ e) => [e.path, e.sha]),
  );

  const tree = [];
  for (const file of files) {
    if (file.content == null) {
      if (existing.has(file.path)) tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
    if (existing.get(file.path) === (await blobSha(bytes))) continue;
    const blob = await json(
      await call(config, repo, 'POST', '/git/blobs', { content: toBase64(bytes), encoding: 'base64' }),
    );
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (!tree.length) return head;
  const newTree = await json(await call(config, repo, 'POST', '/git/trees', { base_tree: base.tree.sha, tree }));
  const created = await json(
    await call(config, repo, 'POST', '/git/commits', { message, tree: newTree.sha, parents: [head] }),
  );
  await call(config, repo, 'PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, {
    sha: created.sha,
    force: false,
  });
  return created.sha;
}
