# Our Trip

A small offline app for the parents' phones, protected by a family password. There is no mobile code and no
server: it's a static web page that Android Chrome installs to the home screen like an app.

## How the password protection works

GitHub Pages can't put a password on a site: on a personal account a Pages site is always public. So the trip is **encrypted**:

- Everything personal lives in `private/`, which is never published (it's in `.gitignore`).
- `tools/build.py` encrypts it into one file, `trip.enc`. Only that file goes online, together with the app code,
  which contains nothing personal.
- The app asks for the password and decrypts the trip on the phone. Without the password, `trip.enc` is
  unreadable, even for someone who downloads it.
- After the first correct password, the phone keeps the derived key (not the password), so the app opens straight away
  and works offline. **Help → This phone → Forget the password** removes it.

Encryption: AES-256-GCM, with the key derived by PBKDF2-SHA256 (600 000 rounds). Browsers do this natively (WebCrypto).
Because `trip.enc` is public, someone could try to guess the password offline, so use a long one.
A few words work well, e.g. `blue-tram-to-galata`.

There are no usernames: without a server there is nothing to check them against. Everyone shares one family password.

## Files

| Path | Published? | What it is |
|---|---|---|
| `private/trip.json5` | no | The trip: dates, times, places, phone numbers, tickets. Only translation keys, no readable text. |
| `private/locales/<lang>/trip.json` | no | The trip's words in each language. |
| `private/tickets/` | no | Images of the real tickets (PNG, JPG or SVG). |
| `trip.enc` | yes | All of `private/`, encrypted. Made by `tools/build.py`. |
| `locales/<lang>/app.json` | yes | The app's own words (buttons, labels, login screen). |
| `app.js`, `index.html`, `sw.js` | yes | The app, its layout, and offline support. |
| `manifest.webmanifest`, `icon-*.png`, `icon.svg` | yes | Home-screen name and icon. |
| `tools/build.py` | yes | Checks the translations and encrypts `private/` into `trip.enc`. |
| `tools/check_locales.py` | yes | Checks that translations are complete and consistent. |

## Setup

```bash
pip install cryptography json5
python tools/build.py --new-password
```

The demo's password is `istanbul-demo`.

## Everyday workflow

1. Edit files in `private/`.
2. Run the build. It checks the translations first, then asks for the password:

   ```bash
   python tools/build.py
   ```

   It refuses a password that doesn't match the current `trip.enc`, so a typo can't lock the parents out.
   Phones that already know the password keep working after an update.
3. Try it: `python -m http.server 8000`, then open http://localhost:8000 (Chrome DevTools phone mode: Ctrl+Shift+M).
4. Commit and push `trip.enc` (and any app changes). Phones get the new trip the next time they open the app online.

To **change the password**, run `python tools/build.py --new-password`. The phones then show
"The password has changed" and ask for the new one.

## How text works

Text fields in `private/trip.json5` hold a translation key. Values that are the same in every language stay there directly.

```js
{ time: "10:00", title: "place.hagia", note: "ev.hagia.note", meet: ["meet.lobbyAt", { time: "09:45" }] }
```

```json
"meet.lobbyAt": "Hotel lobby at {time}"      // private/locales/en/trip.json
"meet.lobbyAt": "В холле отеля в {time}"     // private/locales/ru/trip.json
```

- A plain string is a key. A `[key, {values}]` pair fills `{placeholders}` in the translated text.
- Plurals use the language's own rules: `key.one`, `key.few`, `key.many` and `key.other` (see `today.startsIn` in
  `locales/ru/app.json`).
- These are never translated: addresses and place names in the local language (they're for the taxi driver),
  the phrases' `local` text, names, phone numbers, booking codes.
- A missing translation falls back to the first language in `settings.languages`. If it's missing there too, the key
  itself shows on screen, and the browser console lists it.

**Which language the app shows:** the choice on the Help page, else `settings.language`, else the phone's language,
else the first in `settings.languages`. The login screen follows the phone's language.

**Adding a language** (for example Belarusian): copy `locales/en/` to `locales/be/` and `private/locales/en/` to
`private/locales/be/`, translate them, set `meta.locale` to `"be-BY"`, add `"be"` to `settings.languages`, and build.
Cyrillic languages automatically use the Golos Text font, because Atkinson Hyperlegible has no Cyrillic.

## Weather

The Today screen and every day show the forecast: max and min temperature, wind, sunset, and what to wear.

- **Source:** [Open-Meteo](https://open-meteo.com), which is free and needs no key. Set the place in
  `private/trip.json5` (`weather: { lat, lon }`), or delete that block to hide the weather.
- **Updates:** when the app opens, every 30 minutes while it's open, and right away when the phone gets internet back.
- **Offline:** the last forecast stays on the phone, and the card says when it was updated.
- **What to wear:** the advice comes from the "feels like" temperature, plus extras for cool evenings, wind, rain, snow
  and strong sun. The rules are in `outfit()` in `app.js`; the texts are the `wear.*` keys.
- **Units:** wind uses each language's usual unit (`meta.windUnit`: `kmh`, `ms` or `mph`). Russian uses m/s.

## Put it online (GitHub Pages, free)

1. Create a repository and push this folder. `private/` stays on your computer because of `.gitignore`.
   The build warns you if `private/` is ever not ignored or already committed.
2. Go to **Settings → Pages → Deploy from a branch → `main` / root**.
3. After a minute the app is at `https://<your-user>.github.io/<repo>/`.

**Back up `private/` somewhere private** (a private repository, a cloud drive). It's the only readable copy of your trip.

## Install it on the parents' phones

The easiest way is a **setup link**, which opens the app and remembers the password, with nothing to type:

```bash
python tools/build.py --link https://<your-user>.github.io/<repo>/
```

Anyone who has that link can open the trip, so send it only to your parents and delete the message after setup.
The password is in the part after `#`, which browsers never send to any server, and the app removes it from the address bar.

Then, on each phone:

1. Open the link (or the plain site address and type the password) in **Chrome**.
2. Tap **⋮ → Add to home screen** (or **Install app**).
3. **Test it:** turn on airplane mode and open the app from the new icon. Open a ticket and the taxi card.
4. For "Hear it" to work offline, open Android **Settings → Text-to-speech → Google → Install voice data**
   and download the destination's language.
