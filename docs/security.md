# Security

## What is protected, and how

GitHub Pages can't put a password on a site, so the trip is **encrypted** before it's published:

- Everything personal (trip data, trip texts, ticket images) lives in `private/`, which `.gitignore` keeps out of
  this repository. `trip build` warns if it's ever not ignored or already committed. `private/` can be its own git
  repository, pushed to a **private** GitHub repository as the backup.
- `trip build` encrypts it into `web/trip.enc` with **AES-256-GCM**. Keys come from passwords by **PBKDF2-SHA256,
  600 000 rounds** (passwords trimmed, NFC-normalised, UTF-8) with a random 16-byte salt.
- The app (`web/js/vault.js`) decrypts it in the browser with WebCrypto. The published code, the UI texts and the
  icons contain nothing personal.

## One password or two

**Version 1** (one family password): the payload is encrypted with PBKDF2(family password).

**Version 2** (`trip password admin` adds an admin password):

| Part           | Encrypted with          | Contains                                   |
| -------------- | ----------------------- | ------------------------------------------ |
| `data`         | a random **data key**   | the trip                                   |
| `slots.family` | PBKDF2(family password) | the data key                               |
| `slots.admin`  | PBKDF2(admin password)  | the data key + a random **admin key**      |
| `admin`        | the admin key           | admin settings: GitHub token, repositories |

Both slots use the file's one salt. A phone keeps PBKDF2(family password), which opens the family slot exactly
as it opened a v1 file, so **upgrading to two passwords doesn't log any phone out**. The family password can't open
the admin settings; the admin password opens everything.

## What it protects against

- Anyone who finds the site or downloads `trip.enc`: without a password the file is unreadable.
- Because `trip.enc` is public, someone can try passwords offline. The 600 000 PBKDF2 rounds make each guess slow,
  but a short or common password can still be found. **Use long passwords**: a few words work well
  (`blue-tram-to-galata`). The tools warn below 10 characters.
- **The admin password matters most.** Whoever guesses it can read the trip _and_ the GitHub token, so they could
  write to the two repositories (not delete them, not touch settings, workflows or your other repositories). Make it
  long, different from the family password (the tools refuse the same one), and give the token an expiry date.

It does **not** protect an unlocked phone: like a ticket app, anyone holding it can open the trip (and on an admin
phone, edit and publish). Help → "Forget the password" locks it again.

## The GitHub token (admin mode)

- A **fine-grained** token: only the site repository and the private trip-data repository, permission
  **Contents: Read and write**, nothing else, with an expiry date. `trip admin` stores it in the admin section;
  it's never written anywhere in plain text, and the family password can't read it.
- Publishing commits from the app (`web/js/admin/github.js`). It first checks that the site still has the
  `trip.enc` this app opened, and moves the branch without force, so it never overwrites someone else's change.
- The token can't change `.github/workflows/`, so admin mode can't alter what CI does.
- **Lost phone or leaked token:** delete the token on GitHub (it stops working at once), make a new one, run
  `trip admin`, and change the admin password with `trip password admin`.

## On the phone

- After the first correct password the phone keeps the **derived key** (not the password) in `localStorage`
  (`trip:key`), with the salt and rounds it belongs to. The app then opens without asking, also offline.
- The decrypted trip exists only in memory while the app is open. Ticket images are not saved to the gallery.
- The offline cache holds `trip.enc` encrypted, as published.
- Admin phones also keep unpublished edits and the version just published (until the site serves it) in the
  browser's Cache Storage (`trip-admin`). Edits are kept readable there, like the derived key that opens the trip.
  "Forget the password" removes both.

## Passwords

- `trip build` refuses a password that doesn't open the current `trip.enc`, so a typo can't lock the phones out. The
  salt and slots are kept between builds, so updating the trip keeps every phone unlocked.
- `trip password family` changes the family password. In a two-password trip it needs the admin password and also
  makes a **new data key**, so someone who knew the old family password can't read later versions. Phones show "The
  password has changed" and ask for the new one; admin logins are not affected.
- `trip password admin` changes the admin password, and keeps the admin settings. If you forgot it, open with the family
  password instead: the admin settings then start empty (run `trip admin` again).
- A one-password trip changes its password with `trip build --new-password` (a new salt).

## Setup link

`trip link https://<user>.github.io/<repo>/` prints `…/#unlock=<password>`. Opening it unlocks the app and remembers
the key, with nothing to type. The part after `#` is never sent to any server, and the app removes it from the
address bar at once. But **anyone who has the link can open the trip**: send it only to the people who should have
it, and delete it from the chat after setup. `trip link` accepts only the family password.

## Recovery

`private/` (and its private repository) is the readable copy of the trip. If it's lost,
`trip unpack --out recovered` decrypts `web/trip.enc` back into an editable folder (comments in `trip.json5` are
not kept). Either password works.
