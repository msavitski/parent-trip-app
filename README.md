# Our Trip

A small app that goes on your family's phones during a trip: today's plan, the weather and what to wear, a taxi card
in the local language, tickets, a money converter, useful phrases and help numbers. It works **without internet**
once installed, and it is **protected by a password**, so you can publish it on the web without sharing your plans.

You write the trip in a few text files on your computer, run one command, and put the result on GitHub Pages
(free). Your parents open a link once, add the app to their home screen, and that's it.

**What you get**

- Today, Days, Lists (packing and the like), Phrases and Help tabs, in as many languages as you add (English and
  Russian are included).
- Tickets and boarding passes (images or PDFs) that open offline, and can be zoomed.
- An optional **admin password**: with it the app gets an **Edit** tab to change the trip from your own phone and
  publish it, hide days from the family, and keep past trips in an archive.
- No server, no accounts and no build step: the site is plain files. The only outside services it uses are
  [Open-Meteo](https://open-meteo.com) for the forecast (it sees the trip's coordinates) and Google Fonts for the
  typefaces.

## How it works

1. Your trip lives in a folder, `private/`, that never leaves your computer (or your own private repository).
2. `trip build` **encrypts** it into one file, `web/trip.enc`. That file is all that goes online, so without the
   password it is unreadable.
3. The app in `web/` is a static site. It downloads `trip.enc`, asks for the password once, and decrypts the trip on
   the phone. After that it works offline.

## What you need

- **Python 3.11+** and **Git**
- A **GitHub account** (to put the site online)
- **Node.js 22+**, only if you want to change the app's own code

## Try the demo (5 minutes)

```bash
git clone https://github.com/<you>/<this-repo>.git
cd <this-repo>

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e tools

cp -r example private            # a made-up trip to start from
rm -f web/trip.enc               # a trip.enc that came with the repository is not yours
trip build --new-password        # asks you to choose a family password
trip serve                       # then open http://localhost:8000
```

On a computer, open the page in Chrome's phone mode (Ctrl+Shift+M) to see it as the family will.

## Make it your trip

Edit the files in `private/`:

| File                       | What is in it                                                      |
| -------------------------- | ------------------------------------------------------------------ |
| `trip.json5`               | Dates, times, places, phone numbers and tickets (no readable text) |
| `locales/<lang>/trip.json` | The trip's words, one file per language                            |
| `tickets/`                 | Ticket images (PNG, JPG, WEBP, GIF or SVG)                         |

Then repeat these three steps whenever you change something:

```bash
trip check      # finds mistakes and says where: days[1].events[3].place: unknown place 'hagiaa'
trip build      # encrypts private/ into web/trip.enc
trip serve      # look at it on http://localhost:8000
```

The files are explained in [docs/data-format.md](docs/data-format.md). Keep a backup of `private/` (a **private**
GitHub repository is a good place): it is the readable copy of your trip.

## Put it online

The repository includes a GitHub Actions workflow that publishes `web/` to GitHub Pages.

1. Push this project to your own GitHub repository.
2. In the repository: **Settings → Pages → Source: GitHub Actions**. Do this _before_ the first push.
3. Commit and push `web/trip.enc` after each `trip build`. A minute or two later your site is at
   `https://<you>.github.io/<repository>/`.

`private/` is git-ignored, so your readable trip is never pushed by accident (`trip build` warns if it ever isn't).

## Install it on the phones

1. Make a setup link: `trip link https://<you>.github.io/<repository>/`. It opens the app and remembers the
   password, so nobody has to type it. **Anyone with the link can open the trip**: send it only to the family and
   delete the message afterwards.
2. On the phone, open the link in **Chrome**, then **⋮ → Add to home screen**.
3. Test it once in airplane mode: open the app from its icon, a ticket and the taxi card.
4. Optional, for "Hear it" offline: Android **Settings → Text-to-speech → Google → Install voice data** for the
   destination's language.

After you change the **app itself** (not just the trip), open it twice on each phone while online: the first start
downloads the new version, the second one uses it. A new trip shows up on the first start.

## Edit from your phone (admin mode)

Add a second, **admin** password and the app gets an **Edit** tab. There you change days, events, places and tickets
with forms (texts in every language) or anything else as JSON, then press **Publish**. The family's phones get the
update within a few minutes.

It can also:

- **Hide days from the family.** Tap the eye next to a day: their phones show "Plan coming later". Hidden days are
  encrypted for the admin password only.
- **Make tickets from PDFs** (a boarding pass from an airline email) and **pick places on a map** (OpenStreetMap).
- **Keep past trips in an archive** and switch between trips, see below.

One-time setup:

1. `trip password admin`: asks the family password, then a new admin password (long and different from the family one).
2. Create a **fine-grained GitHub token**: GitHub → Settings → Developer settings → Fine-grained tokens. Only the two
   repositories (the site, and the private one with your trip files), permission **Contents: Read and write**, nothing
   else, and an expiry date shortly after the trip.
3. `trip admin`: stores the token, encrypted, in `trip.enc`. It takes the repositories from `git remote` of the project
   and of `private/` (check with `trip admin --show`).
4. Commit and push `web/trip.enc`, then open the site on your phone and log in with the **admin** password.

Publishing writes the encrypted trip to the site repository and a readable copy to the private one. Pull both
(`git pull` and `git -C private pull`) before you edit on the computer again; `trip build` refuses to run if you forgot.

## Past trips: the archive

The site shows **one trip at a time**. In **Edit → Trips** you can put the current trip away and keep it:

- **Archive this trip, start a new one**: the current trip goes to the archive, and you carry on with a copy to turn
  into the next trip.
- **Switch to a past trip**: it becomes the current trip, and the current one takes its place in the archive.
- **Delete from the archive**: removes a past trip for good.

Nothing changes for the family until you press **Publish**, and **Discard changes** undoes it. Past trips are
encrypted so that only the admin password opens them: the family's phones never download them. Details and limits (for
example, what happens if you forget the admin password) are in [docs/security.md](docs/security.md).

## Commands

| Command                                        | What it does                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `trip check`                                   | Validates the trip files and says where a mistake is                 |
| `trip build [--new-password] [--link URL]`     | Checks, then encrypts `private/` into `web/trip.enc`                 |
| `trip serve [--port N] [--host 0.0.0.0]`       | Serves the site on your computer (`--host 0.0.0.0` for your Wi-Fi)   |
| `trip link URL`                                | Prints the setup link for the family                                 |
| `trip password family` / `trip password admin` | Changes the family password, or adds or changes the admin one        |
| `trip admin [--show]`                          | Stores the GitHub token and repositories for admin mode              |
| `trip unpack --out DIR`                        | Decrypts `web/trip.enc` back into files, if `private/` is lost       |
| `trip precache`                                | Updates the offline file list in `web/sw.js` after you change `web/` |
| `trip schema`                                  | Rebuilds `schema/trip.schema.json` (editor autocompletion)           |

Passwords are asked for (hidden). For scripts they can come from `TRIP_PASSWORD` (one that opens the current
`trip.enc`), `TRIP_NEW_PASSWORD` (a new one) and `TRIP_TOKEN` (the GitHub token for `trip admin`).

## If something goes wrong

- **I forgot the family password.** With an admin password, change it: `trip password family`. Without one, build the
  trip again from `private/` with `trip build --new-password`. Either way the phones then ask for the new password.
- **I forgot the admin password.** Open the trip with the family password and add a new admin password
  (`trip password admin`), then run `trip admin` again. This loses the stored GitHub token, the hidden days' plans in
  `trip.enc` (build again from `private/` to put them back), and access to the archive.
- **`private/` is gone.** `trip unpack --out recovered` (with the admin password) makes the files again.
- **`trip build` says my files are behind GitHub.** Someone (you, from the app) published a change. Run `git pull` and
  `git -C private pull`, then build again.
- **The phones don't show my change.** They need to be online once. For a change to the app itself, open it twice
  (see "Install it on the phones").

## Changing the app itself

```bash
npm ci
pre-commit install        # checks run on every commit
npm run check             # Prettier, ESLint and the JSDoc type check
trip precache             # after any change in web/, so the offline worker sees the new files
```

The app is plain JavaScript modules and CSS in `web/`, with no build step. [docs/architecture.md](docs/architecture.md)
explains the modules, what is stored on the phone, and how offline mode and publishing work.

## Is it secure?

The trip is encrypted with AES-256-GCM, with keys made from your passwords by PBKDF2 (600,000 rounds). Because
`trip.enc` is public, someone could try passwords on it offline, so **use long passwords** (a few words work well).
The decrypted trip exists only in the phone's memory while the app is open. An unlocked phone can open the trip, like
any ticket app; **Help → Forget the password** locks it again. The full picture, including admin mode and the GitHub
token, is in [docs/security.md](docs/security.md).

## Project layout

| Path                | What it is                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `web/`              | The site, published as-is: `index.html`, `css/`, `js/`, `locales/`, `sw.js`                            |
| `web/trip.enc`      | The encrypted trip (made by `trip build`)                                                              |
| `web/archive.enc`   | The admin's past trips, encrypted (made by the app)                                                    |
| `private/`          | Your real trip. **Never committed**                                                                    |
| `example/`          | A made-up demo trip: the template for `private/`                                                       |
| `tools/`            | The Python package with the `trip` command                                                             |
| `schema/`, `types/` | Generated from the data model: editor autocompletion and JS types                                      |
| `docs/`             | [Architecture](docs/architecture.md), [data format](docs/data-format.md), [security](docs/security.md) |
