# Our Trip

A small offline app for my parents' phones during a trip: today's plan, weather and what to wear, a taxi card,
tickets, money, phrases and help. It's protected by a family password and works without internet.

There's no build step and no server: `web/` is a static site that Android Chrome installs to the home screen.
The trip itself is encrypted into `web/trip.enc`; everything personal stays on your computer in `private/`.

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

1. Edit `private/trip.json5` and the texts in `private/locales/<lang>/trip.json` (see [data format](docs/data-format.md)).
2. Check it: `trip check`. Every problem is reported with its place in the file, e.g.
   `days[1].events[3].place: unknown place 'hagiaa' (known: hotel, airport, …)`.
3. Encrypt it: `trip build` (asks for the family password; the first time, use `trip build --new-password`).
4. Try it: `trip serve`, then open http://localhost:8000 (Chrome DevTools phone mode: Ctrl+Shift+M).
5. Commit and push `web/trip.enc`. The phones get the new trip the next time they open the app online.

Changing the app itself (`web/`): after editing, run `trip precache` so the offline worker picks up the new files,
then `npm run check`. The pre-commit hook checks both.

## Commands

| Command                                               | What it does                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `trip check [--data DIR]`                             | Validate the trip data, references, translations and ticket images          |
| `trip build [--new-password] [--link URL]`            | Check, then encrypt `private/` into `web/trip.enc`                          |
| `trip link URL`                                       | Print a setup link that opens the app without typing the password           |
| `trip unpack --out DIR`                               | Decrypt `web/trip.enc` back into an editable folder (if `private/` is lost) |
| `trip serve [--port N] [--host 0.0.0.0] [--enc FILE]` | Serve `web/` locally (`--enc` serves another trip file, e.g. a demo build)  |
| `trip schema [--check]`                               | Regenerate `schema/trip.schema.json` from the data model                    |
| `trip precache [--check]`                             | Regenerate the offline file list in `web/sw.js`                             |
| `npm run check`                                       | Prettier, ESLint and the JSDoc type check                                   |
| `npm run types`                                       | Regenerate `types/trip.d.ts` from the schema                                |

The password comes from the `TRIP_PASSWORD` environment variable, or is asked for.

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
   with nothing to type. Anyone with the link can open the trip, so delete the message after setup.
2. Open it in **Chrome**, then **⋮ → Add to home screen**.
3. Test in airplane mode: open the app from the icon, open a ticket and the taxi card.
4. For "Hear it" offline: Android **Settings → Text-to-speech → Google → Install voice data** for the destination's
   language.
