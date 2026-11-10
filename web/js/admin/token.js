/**
 * Admin mode publishes with a GitHub token, and a fine-grained token stops working on the day it was made to
 * expire (`trip admin` asks GitHub for that day and keeps it with the token, in trip.enc). The browser can't ask
 * GitHub itself (GitHub doesn't expose the header to web pages), so the app warns from the saved date: on Today
 * and in the Edit tab, with a dot on the tab, for the admin only, from two weeks before.
 */
import { html, icon } from '../html.js';
import { fmt, t } from '../i18n.js';
import { state } from '../state.js';
import { daysBetween, parseDate } from '../trip.js';

/** How many days ahead the warning starts. */
const WARN_DAYS = 14;
/** From this close, the warning is red. */
const URGENT_DAYS = 3;

/**
 * Days until the token stops working (negative: it already has) and that day, once it is time to say so.
 * @returns {{ days: number, date: Date } | null}
 */
export function tokenExpiry() {
  const iso = state.opened?.admin?.tokenExpires;
  if (state.role !== 'admin' || !iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = parseDate(iso);
  const days = daysBetween(new Date(), date);
  return days <= WARN_DAYS ? { days, date } : null;
}

/** The warning card, or '' when the token is fine (or isn't known to expire). */
export function tokenAlert() {
  const expiry = tokenExpiry();
  if (!expiry) return '';
  const { days, date } = expiry;
  const when = fmt.date.format(date);
  const text =
    days < 0
      ? t('token.expired', { date: when })
      : days === 0
        ? t('token.today')
        : t('token.soon', { count: days, date: when });
  return html`<section class="card notice notice--${days <= URGENT_DAYS ? 'error' : 'warn'}" role="alert">
    <p>${icon('key')} ${text}</p><p class="muted">${t('token.fix')}</p></section>`;
}
