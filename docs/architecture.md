# Architecture

## Overview

```
private/ (trip.json5, trip texts, ticket images)
   │  trip check  → pydantic models + cross-checks (tools/src/trip_tools)
   │  trip build  → AES-256-GCM, key from PBKDF2-SHA256(password); hidden days apart, for the admin key
   ▼
web/trip.enc ──► GitHub Pages ──► phone: web/js/vault.js decrypts with the password (or the saved key)
                                          │
web/locales/<lang>/app.json (UI words) ───┤
Open-Meteo forecast (live, cached) ───────┤
                                          ▼
                                   web/js/app.js renders the screens

admin password → Edit tab (web/js/admin) → GitHub API: web/trip.enc to the site repo,
                                           readable trip data to the private repo
```

The site has no build step: the browser loads `web/js/main.js` as a native ES module, and it imports the rest.
Types are written as JSDoc and checked by `tsc` (`jsconfig.json`), so editors and CI catch type errors without
compiling anything.

## Frontend modules (`web/js/`)

| Module              | Responsibility                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `main.js`           | Start-up: login language, download `trip.enc`, unlock (setup link → saved key → password form) |
| `app.js`            | Rendering, tab bar, sheets, the phone's Back button, refresh timer, online/offline             |
| `actions.js`        | What taps do: `data-action="…"` → named handler; checkboxes, money inputs, login form          |
| `state.js`          | The one mutable state object (trip, days, language, tab, open sheets). Imports nothing         |
| `html.js`           | `html` tagged template (escapes every value) and the icon set                                  |
| `i18n.js`           | `t()` for UI words, `tr()` for trip words, plurals, language choice, date formats              |
| `vault.js`          | `trip.enc`: fetch, derive key, decrypt (admin: merge the hidden days), seal, remember the key  |
| `trip.js`           | Turn the payload into the current trip (demo day, sorted events, family's view); date helpers  |
| `weather.js`        | Open-Meteo fetch and cache, weather kinds, the clothing rules (`outfit`)                       |
| `util.js`           | Storage, map/phone links, money formatting, speech, screen wake lock                           |
| `ui/components.js`  | Shared pieces: header, timeline, Next sign, tiles, day card, weather card, sheet header        |
| `ui/screens.js`     | The five tabs, login and message screens                                                       |
| `ui/sheets.js`      | Full-screen sheets: taxi card, ticket list, ticket, money, phrase                              |
| `admin/editor.js`   | The Edit tab (admin password only): screens and forms, applying them to the draft              |
| `admin/draft.js`    | The edited copy of the trip: text fields ↔ translation keys, images, kept on the device        |
| `admin/pdf.js`      | A ticket PDF → one image of its pages, with pdf.js (`web/vendor/`) loaded only when needed     |
| `admin/validate.js` | Checks before publishing, plus a test drawing of every screen and sheet in every language      |
| `admin/publish.js`  | Publish: conflict check, re-encrypt with the same keys (`vault.sealTrip`), commit both repos   |
| `admin/github.js`   | The few GitHub API calls: read a file, one commit with several files                           |

Admin mode never changes how the family app works: the editor shows a draft (`state.draft`) on every tab until it is
published, and a family password never gets the Edit tab. The forms turn typed text into translation keys: a key
used by one field is edited in place, and a shared key (or one with `{placeholders}`) gets a new `ed.*` key, so
editing one event never changes another.

Rules that keep it maintainable:

- **No import cycles** (`import-x/no-cycle` in ESLint). Shared mutable data lives in `state.js`, which imports
  nothing; `weather.updateWeather()` returns whether something changed instead of calling `render()`.
- **No HTML injection by accident.** All markup comes from `` html`…` ``, which escapes every interpolated value.
  Only `html` results and `icon()` output pass through. Use `cond ? html`…` : ''` (not `&&`, which would print
  `false`).
- **No human text in code.** UI words are keys in `web/locales/<lang>/app.json`; trip words are keys in the trip's
  own strings. See [data format](data-format.md).
- **Errors don't blank the screen.** A failed render shows the translated `error.generic` with a Try again button.
  If the modules can't load at all, a tiny script in `index.html` shows an icon-only reload button after 10 s.

## Offline (`web/sw.js`)

| Cache                 | Contents                                        | Strategy                              |
| --------------------- | ----------------------------------------------- | ------------------------------------- |
| `our-trip-app-<hash>` | Every file in `web/` except `sw.js`, `trip.enc` | Installed all-or-nothing, cache-first |
| `our-trip-data`       | `trip.enc`                                      | Network-first (3 s), then cache       |
| `our-trip-fonts`      | Google Fonts                                    | Cache-first                           |
| `our-trip-vendor`     | `vendor/` (pdf.js, admin mode only)             | Cache-first, on first use             |

The file list and `<hash>` are generated into `sw.js` by `trip precache` (CI checks they're current). Any change in
`web/` changes `sw.js`, so phones download the new snapshot in the background and use it from the next launch. A
phone never runs a mix of old and new files. Trip updates don't touch `sw.js` and show on the same launch.

`vendor/` is left out of the snapshot, so the family's phones never download pdf.js (about 1.7 MB). It holds
`pdf.min.mjs`, `pdf.worker.min.mjs` and `LICENSE` from the `pdfjs-dist` npm package, in a folder named after the
version. To update it, copy those files into a new `vendor/pdfjs-<version>/`, point `PDFJS` in `admin/pdf.js` at it,
delete the old folder and run `trip precache`.

`activate` deletes only caches named `our-trip-*`: other sites on the same `github.io` origin keep theirs.

The weather API isn't cached by the worker: the app keeps the last forecast in `localStorage`. A trip with several
weather places (`days[].weather`) fetches each (one Open-Meteo request per place) and keeps each place's forecast and
fetch time under its `"lat,lon"`; the older single-place shape is read as one of them.

## Stored on the phone (`localStorage`)

| Key                | Value                                             |
| ------------------ | ------------------------------------------------- |
| `trip:key`         | The derived key and the salt/rounds it belongs to |
| `trip:lang`        | Language chosen on the Help page                  |
| `trip:weather`     | Last forecast per place (up to 40 days each)      |
| `trip:checks:<id>` | Ticked items of a checklist                       |

These names are a compatibility contract with installed phones: renaming them logs everyone out or loses ticks.

Admin mode keeps two bigger values (they carry ticket images) in the Cache Storage cache **`trip-admin`**, whose
quota is far above `localStorage`'s ~5 MB. The name doesn't start with `our-trip-`, so the offline worker never
deletes it; "Forget the password" does.

| Key             | Value                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| `admin-draft`   | Unpublished edits and the `trip.enc` they started from (a damaged one is dropped on start) |
| `admin-pending` | The version just published, and every version it replaced, until the site serves it        |

Version 0.0.2 kept the draft in `localStorage` (`trip:draft`); the app moves it over once.

## Tools (`tools/src/trip_tools/`)

| Module        | Responsibility                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- |
| `cli.py`      | The `trip` command                                                                        |
| `model.py`    | Pydantic models of `trip.json5`; JSON schema generation                                   |
| `checks.py`   | Shape, references and translation checks with readable error paths                        |
| `bundle.py`   | Read a data folder; assemble the payload; split off hidden days; unpack it again          |
| `vault.py`    | `trip.enc` v1/v2/v3: key slots, admin settings, hidden part, password changes; salt reuse |
| `precache.py` | Generate the offline file list and version in `web/sw.js`                                 |
| `serve.py`    | Local server with correct MIME types and no caching                                       |
| `paths.py`    | Repository layout                                                                         |

The payload encrypted into `trip.enc` is the **raw** `trip.json5` (minus `$schema`), not a re-serialised model, so
validation changes can never change what the app receives.

With hidden days the payload goes in as two parts (`bundle.split`, see [security](security.md)): the family's
(`bundle.for_family`) under the data key, and the whole trip under the admin key. The app does the same when it
publishes (`vault.sealTrip` with `trip.js` `forFamily`), so the Python and JavaScript rules must stay the same; the
admin password opens both parts and merges them (`vault.unlock`, `vault.js` `openTrip`).

`types/trip.d.ts` is generated from `schema/trip.schema.json`, which is generated from `model.py`: the Python model is
the single source of truth for the data shape, and CI fails if either generated file is stale.
