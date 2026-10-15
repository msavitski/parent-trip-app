# Security

## What is protected, and how

GitHub Pages can't put a password on a site, so the trip is **encrypted** before it's published:

- Everything personal (trip data, trip texts, ticket images) lives in `private/`, which `.gitignore` keeps out of
  git. `trip build` warns if it's ever not ignored or already committed.
- `trip build` encrypts it into `web/trip.enc`: **AES-256-GCM**, with the key derived by **PBKDF2-SHA256, 600 000
  rounds** from the family password (trimmed, NFC-normalised, UTF-8) and a random 16-byte salt.
- The app (`web/js/vault.js`) decrypts it in the browser with WebCrypto. The published code, the UI texts and the
  icons contain nothing personal.

## What it protects against

- Anyone who finds the site or downloads `trip.enc`: without the password the file is unreadable.
- Because `trip.enc` is public, someone can try passwords offline. The 600 000 PBKDF2 rounds make each guess slow,
  but a short or common password can still be found. **Use a long password**: a few words work well
  (`blue-tram-to-galata`). `trip build` warns below 10 characters.

It does **not** protect an unlocked phone: like a ticket app, anyone holding it can open the trip. Help → "Forget the
password" locks it again.

## On the phone

- After the first correct password the phone keeps the **derived key** (not the password) in `localStorage`
  (`trip:key`), with the salt and rounds it belongs to. The app then opens without asking, also offline.
- The decrypted trip exists only in memory while the app is open. Ticket images are not saved to the gallery.
- The offline cache holds `trip.enc` encrypted, as published.

## Passwords

- `trip build` refuses a password that doesn't open the current `trip.enc`, so a typo can't lock the phones out.
- The salt is kept between builds, so updating the trip keeps phones unlocked.
- `trip build --new-password` makes a new salt. Phones then show "The password has changed" and ask for the new one.

## Setup link

`trip link https://<user>.github.io/<repo>/` prints `…/#unlock=<password>`. Opening it unlocks the app and remembers
the key, with nothing to type. The part after `#` is never sent to any server, and the app removes it from the
address bar at once. But **anyone who has the link can open the trip**: send it only to the people who should have
it, and delete it from the chat after setup.

## Recovery

`private/` is the only readable copy of the trip. Back it up somewhere private. If it's lost,
`trip unpack --out recovered` decrypts `web/trip.enc` back into an editable folder (comments in `trip.json5` are
not kept).
