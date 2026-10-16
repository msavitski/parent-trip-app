# Trip data format

A trip is a folder (`private/` for your real trip, `example/` for the demo):

```
trip.json5                  dates, times, places, phone numbers, tickets: no readable text
locales/<lang>/trip.json    the trip's words, one file per language
tickets/                    ticket images (PNG, JPG, WEBP, GIF or SVG; a PDF becomes one in the app's Edit tab)
```

`trip.json5` is [JSON5](https://json5.org): JSON plus comments, unquoted keys and trailing commas. Its shape is
defined in `tools/src/trip_tools/model.py`; `schema/trip.schema.json` gives autocompletion in JetBrains IDEs through
the first line `$schema: "../schema/trip.schema.json"`. Run `trip check` after every edit.

## Text: keys and placeholders

Fields that people read hold a **translation key**, never the text itself:

```js
{ time: "10:00", icon: "landmark", title: "place.hagia", note: "ev.hagia.note",
  meet: ["meet.lobbyAt", { time: "09:45" }] }
```

```json
"meet.lobbyAt": "Hotel lobby at {time}"      // locales/en/trip.json
"meet.lobbyAt": "В холле отеля в {time}"     // locales/ru/trip.json
```

- A plain string is a key; `[key, {values}]` fills its `{placeholders}`. `trip check` reports a placeholder without a
  value, and a key that doesn't exist.
- Keys look like `group.name` (`d1.title`, `ev.hagia.note`) and can be reused (`ev.breakfast` on several days).
- Not translated, because they're the same in every language or meant for locals: addresses and `localName` (taxi
  card, maps), the phrases' `local` text, names, phone numbers, booking codes, `taxi.ask`.

## Plurals

A key used with a `count` value picks a plural form by the language's rules: `key.one`, `key.few`, `key.many`,
`key.other` (English needs only `one` and `other`). Example: `today.startsIn` in `web/locales/ru/app.json`.

## Languages

`settings.languages` lists the languages; the first is the fallback for missing words. Each needs
`web/locales/<lang>/app.json` (UI words, public) and `locales/<lang>/trip.json` in the data folder. The app follows
the phone's language unless `settings.language` forces one, or the language is chosen on the Help page.

To add a language (e.g. Belarusian): copy `web/locales/en/` to `web/locales/be/` and the data folder's
`locales/en/` to `locales/be/`, translate both, set `meta.locale` to `be-BY` (and `meta.windUnit`: `kmh`, `ms` or
`mph`), add `"be"` to `settings.languages`, and run `trip check`. Cyrillic languages switch to the Golos Text font.

## Main fields

| Field                     | Notes                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `settings.demoTodayIsDay` | Demo only: shifts the trip so this day is today. `null` for a real trip (`trip check` warns).                                                                |
| `settings.speechLang`     | The destination's language for "Hear it", e.g. `tr-TR`                                                                                                       |
| `weather`                 | `{ lat, lon }` of the destination; remove it to hide the weather                                                                                             |
| `places`                  | Keyed by id; events, the taxi card and `help.hotel` refer to these ids                                                                                       |
| `tickets`                 | Keyed by id; `image` is a path inside the data folder                                                                                                        |
| `days[].hidden`           | `true`: only the admin password shows the day; the family sees "Plan coming later", its weather, no tickets or places of its own                             |
| `days[].events[]`         | `time` (24 h, local), `icon` (plane, car, bed, food, coffee, landmark, ship, bag, walk, moon, suitcase), `title`, optional `note`, `meet`, `place`, `ticket` |
| `help.family`             | At least one contact; the first gets the big Call button                                                                                                     |
| `lists[].id`              | Also the storage key of the ticks: don't rename it during a trip                                                                                             |
| `money.rate`              | 1 home currency = this many local                                                                                                                            |

Times are local times at the destination; phones switch time zone when they land.
