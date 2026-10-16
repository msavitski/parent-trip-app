# Our Trip

A small offline app for my parents' phones during a trip: today's plan, weather and what to wear, a taxi card,
tickets, money, phrases and help. It's protected by a family password and works without internet. With a second,
admin password, the app also gets an **Edit** tab to change the trip from a phone and publish it.

There's no build step and no server: `web/` is a static site that Android Chrome installs to the home screen.
The trip itself is encrypted into `web/trip.enc`; everything personal stays in `private/` (on your computer, and
optionally in a private repository of its own).

## Project layout

| Path                | What it is                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `web/`              | The site, published as-is: `index.html`, `css/`, `js/` (ES modules), `locales/`, `sw.js`               |
| `web/trip.enc`      | The encrypted trip (made by `trip build`, committed)                                                   |
| `private/`          | Your real trip: `trip.json5`, `locales/<lang>/trip.json`, `tickets/`. **Never committed**              |
| `example/`          | A made-up demo trip: the template for `private/`, and what CI validates                                |
| `tools/`            | Python package `trip-tools` with the `trip` command                                                    |
| `schema/`, `types/` | Generated from the data model: editor autocompletion and JS types                                      |
| `docs/`             | [Architecture](docs/architecture.md), [data format](docs/data-format.md), [security](docs/security.md) |

## Setup

Requires Python 3.11+ and Node 22+.

```bash
python -m venv .venv
.venv/Scripts/activate           # Windows (Git Bash: source .venv/Scripts/activate); macOS/Linux: source .venv/bin/activate
pip install -e "tools[dev]"
npm ci
pre-commit install               # checks run on every commit
```

Start your own trip from the demo:

```bash
cp -r example private
```

## Everyday workflow

1. If you also edit from the app (admin mode), first get those changes: `git pull` and `git -C private pull`.
   `trip build` refuses to run while either is behind GitHub, so it can't undo an edit made in the app.
2. Edit `private/trip.json5` and the texts in `private/locales/<lang>/trip.json` (see [data format](docs/data-format.md)).
3. Check it: `trip check`. Every problem is reported with its place in the file, e.g.
   `days[1].events[3].place: unknown place 'hagiaa' (known: hotel, airport, …)`.
4. Encrypt it: `trip build` (asks for the family or the admin password; the first time, use
   `trip build --new-password`).
5. Try it: `trip serve`, then open http://localhost:8000 (Chrome DevTools phone mode: Ctrl+Shift+M).
6. Commit and push `web/trip.enc` (and back up `private/`). The phones get the new trip the next time they open the
   app online.

Changing the app itself (`web/`): after editing, run `trip precache` so the offline worker picks up the new files,
then `npm run check`. The pre-commit hook checks both.

## Commands

| Command                                                 | What it does                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `trip check [--data DIR]`                               | Validate the trip data, references, translations and ticket images          |
| `trip build [--new-password] [--link URL] [--no-fetch]` | Check, then encrypt `private/` into `web/trip.enc`                          |
| `trip password family`                                  | Change the family password (phones then ask for the new one)                |
| `trip password admin`                                   | Add the admin password (the first time), or change it                       |
| `trip admin [--show]`                                   | Store the GitHub token and repositories that admin mode publishes to        |
| `trip link URL`                                         | Print a setup link that opens the app without typing the (family) password  |
| `trip unpack --out DIR`                                 | Decrypt `web/trip.enc` back into an editable folder (if `private/` is lost) |
| `trip serve [--port N] [--host 0.0.0.0] [--enc FILE]`   | Serve `web/` locally (`--enc` serves another trip file, e.g. a demo build)  |
| `trip schema [--check]`                                 | Regenerate `schema/trip.schema.json` from the data model                    |
| `trip precache [--check]`                               | Regenerate the offline file list in `web/sw.js`                             |
| `npm run check`                                         | Prettier, ESLint and the JSDoc type check                                   |
| `npm run types`                                         | Regenerate `types/trip.d.ts` from the schema                                |

Passwords are asked for (hidden), or come from environment variables: `TRIP_PASSWORD` (one that opens the
current `trip.enc`), `TRIP_NEW_PASSWORD` (a new one) and `TRIP_TOKEN` (the GitHub token for `trip admin`).

## Admin mode: editing from the app

The family password opens the app; a separate **admin password** opens it with an extra **Edit** tab. There you
change days, events, places and tickets with forms (texts in every language), or anything else as JSON, then
**Publish**: the app checks everything, encrypts the trip and commits it to GitHub. Both passwords keep working, and
the parents' phones get the update within a few minutes. See [security](docs/security.md) for how it's protected.

One-time setup:

1. Add the admin password: `trip password admin` (asks the family password, then the new admin one). Phones that
   already know the family password are not affected.
2. Create a **fine-grained GitHub token**: Settings → Developer settings → Fine-grained tokens. Only these two
   repositories (the site, and the private repository with your trip data), permission **Contents: Read and write**,
   nothing else, and an expiry date shortly after the trip.
3. Store it, encrypted, for admin mode: `trip admin`. The repositories are taken from `git remote` of this repo and
   of `private/`; check them with `trip admin --show`.
4. Commit and push `web/trip.enc`.
5. On your phone, open the site and log in with the **admin** password.

Publishing writes `web/trip.enc` to the site repository and a readable copy (`trip.json5`, texts, ticket images) to
the private one. Comments in `trip.json5` aren't kept by the app. Before you edit on the computer again, pull both.

## Deployment

GitHub Actions (`.github/workflows/site.yml`) checks every push and pull request, and on `master` deploys
`web/` to GitHub Pages. Only `web/` is published.

**One-time setting:** repository Settings → Pages → Source: **GitHub Actions**. Switch it _before_ the first
push of this layout: with "Deploy from a branch", Pages would publish the repository root, which no longer has an
`index.html`.

After a deploy that changes the app, open it twice on each phone with internet: the first launch downloads the new
version in the background, and the second one uses it. Trip updates (`web/trip.enc` only) show on the first launch.

## Installing on the parents' phones

1. Make a setup link: `trip link https://<user>.github.io/<repo>/`. It opens the app and remembers the password,
   with nothing to type. Anyone with the link can open the trip, so delete the message after setup. It only accepts
   the family password, so a parent's phone never gets the Edit tab.
2. Open it in **Chrome**, then **⋮ → Add to home screen**.
3. Test in airplane mode: open the app from the icon, open a ticket and the taxi card.
4. For "Hear it" offline: Android **Settings → Text-to-speech → Google → Install voice data** for the destination's
   language.
