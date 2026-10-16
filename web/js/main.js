/**
 * Start-up: pick the login language, download trip.enc, and open it with (in this order)
 * a setup link (…/#unlock=<password>), the key saved on this phone, or the password form.
 */
import { listen } from './actions.js';
import { pendingEnc } from './admin/publish.js';
import { applyLanguage, showScreen, start } from './app.js';
import { loadApp, pickLoginLang } from './i18n.js';
import { state } from './state.js';
import { loginScreen, messageScreen } from './ui/screens.js';
import { deriveKey, fetchEnc, openTrip, remember, savedKey } from './vault.js';

// the modules loaded: tells the fallback script in index.html not to show its reload button
document.documentElement.dataset.ready = '1';

async function boot() {
  listen();
  applyLanguage(await pickLoginLang());
  await loadApp('en');
  if (!globalThis.crypto?.subtle) return showScreen(messageScreen('login.unsupported'));

  const fetched = await fetchEnc();
  if (!fetched) return showScreen(messageScreen('login.noData', true));
  // admin: a version just published from this device that the site isn't serving yet
  const enc = pendingEnc(fetched);
  state.enc = enc;

  // 1. a setup link: …/#unlock=<password> (the part after # never leaves the phone)
  const link = location.hash.match(/^#unlock=(.+)$/);
  if (link) {
    history.replaceState(null, '', location.pathname + location.search);
    const key = await deriveKey(decodeURIComponent(link[1]), enc);
    const opened = await openTrip(key, enc);
    if (opened) {
      remember(key, enc);
      return start(opened);
    }
  }

  // 2. already opened on this phone
  const saved = savedKey(enc);
  if (saved?.fits) {
    const opened = await openTrip(saved.key, enc);
    if (opened) return start(opened);
  }

  // 3. ask; a saved key that no longer fits means the password was changed
  showScreen(loginScreen(saved ? 'login.changed' : null));
  document.getElementById('pw')?.focus();
}

boot();

// offline support (works on https and on localhost)
if ('serviceWorker' in navigator && /^(https:|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(location.href)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
