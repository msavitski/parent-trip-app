"""Reading a trip data folder, assembling the payload that goes into trip.enc, and splitting it in two:
what the family password opens, and the hidden days that only the admin key opens (see vault.py).
"""

from __future__ import annotations

import base64
import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import json5

from trip_tools.paths import DataDir

# plural forms of a translation key ("today.startsIn.few"), as in checks.py
PLURAL = re.compile(r"\.(zero|one|two|few|many|other)$")

IMAGE_TYPES = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def read_trip(data: DataDir) -> dict[str, Any]:
    """trip.json5 as a plain dict, exactly as written (only the editor's "$schema" line removed).

    The app receives this raw dict, never a re-serialised model, so the payload stays the same
    whatever the validation models do.
    """
    trip = json5.loads(data.trip_file.read_text(encoding="utf-8"))
    trip.pop("$schema", None)
    return trip


def languages(trip: dict[str, Any]) -> list[str]:
    return trip.get("settings", {}).get("languages") or ["en"]


def read_strings(path: Path) -> dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8"))


def image_paths(trip: dict[str, Any]) -> list[str]:
    return [t["image"] for t in trip.get("tickets", {}).values() if t.get("image")]


def encode(body: dict[str, Any]) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()


def payload(data: DataDir) -> bytes:
    """{"trip": …, "locales": {lang: trip strings}, "images": {path: data URL}} as compact UTF-8 JSON.

    This is the whole trip; vault.py splits it (`split`) before encrypting it.
    """
    trip = read_trip(data)
    locales = {lang: read_strings(data.trip_strings(lang)) for lang in languages(trip)}
    images = {}
    for path in image_paths(trip):
        file = data.path / path
        mime = IMAGE_TYPES[file.suffix.lower()]
        images[path] = f"data:{mime};base64,{base64.b64encode(file.read_bytes()).decode()}"
    return encode({"trip": trip, "locales": locales, "images": images})


# ---------- hidden days ----------


def hidden_days(trip: dict[str, Any]) -> list[str]:
    """Dates of the days with `hidden: true`."""
    return [day.get("date", "?") for day in trip.get("days", []) if day.get("hidden")]


def has_hidden_plans(trip: dict[str, Any]) -> bool:
    """Whether a hidden day has anything to keep from the family (a title, a note or events)."""
    return any(
        day.get("hidden") and (day.get("title") or day.get("note") or day.get("events")) for day in trip.get("days", [])
    )


def _strings(node: Any) -> Iterator[str]:
    """Every string value in the trip: translation keys, image paths and the rest."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _strings(value)


def for_family(body: dict[str, Any]) -> dict[str, Any]:
    """What the family sees. The same as web/js/trip.js forFamily: change both together.

    A hidden day keeps its date (Today counts the days right and shows its weather) but not its plan.
    Tickets and places that only hidden days use are left out, and so are the translation keys and
    ticket images that only the left-out parts use. A trip without hidden days is returned as it is,
    and running this again on its own result changes nothing.
    """
    trip = body["trip"]
    days = trip.get("days", [])
    if not any(day.get("hidden") for day in days):
        return body

    def used_by(hidden: bool, field: str) -> set[Any]:
        found: set[Any] = set()
        for d in days:
            if bool(d.get("hidden")) == hidden:
                for e in d.get("events") or []:
                    value = e.get(field)  # a ticket can also be a list of ticket ids
                    found.update(value if isinstance(value, list) else [value])
        return found

    def without_secret(items: dict[str, Any] | None, field: str, always: Any = None) -> dict[str, Any]:
        shown, secret = used_by(False, field), used_by(True, field)
        return {id_: v for id_, v in (items or {}).items() if id_ == always or id_ in shown or id_ not in secret}

    family_trip = {
        **trip,
        "days": [
            {"date": d["date"], "title": "", "events": [], "hidden": True} if d.get("hidden") else d for d in days
        ],
        "tickets": without_secret(trip.get("tickets"), "ticket"),
        "places": without_secret(trip.get("places"), "place", trip.get("help", {}).get("hotel")),
    }
    # whatever only the left-out parts mention: their translation keys (and plural forms), ticket images
    secret = set(_strings(trip)) - set(_strings(family_trip))

    def is_secret(key: str) -> bool:
        return key in secret or PLURAL.sub("", key) in secret

    return {
        **body,
        "trip": family_trip,
        "locales": {
            lang: {key: text for key, text in strings.items() if not is_secret(key)}
            for lang, strings in body.get("locales", {}).items()
        },
        "images": {path: url for path, url in body.get("images", {}).items() if path not in secret},
    }


def split(payload_bytes: bytes) -> tuple[bytes, bytes | None]:
    """The payload as trip.enc keeps it: (family part, hidden part).

    The family part is `for_family`. The hidden part is the whole trip with its texts, plus only the
    ticket images the family part doesn't have. It is None when no hidden day has a plan: then the
    family part is all there is.
    """
    body = json.loads(payload_bytes)
    family = for_family(body)
    if not has_hidden_plans(body["trip"]):
        return encode(family), None
    images = {path: url for path, url in body.get("images", {}).items() if path not in family["images"]}
    return encode(family), encode({"trip": body["trip"], "locales": body.get("locales", {}), "images": images})


def merge(family: bytes, hidden: bytes) -> bytes:
    """The whole payload again, from the two parts of `split`."""
    shown, secret = json.loads(family), json.loads(hidden)
    images = {**shown.get("images", {}), **secret.get("images", {})}
    return encode({"trip": secret["trip"], "locales": secret.get("locales", {}), "images": images})


def unpack(payload_bytes: bytes, out: Path) -> list[Path]:
    """Write a decrypted payload back out as an editable data folder. Returns the files written."""
    body = json.loads(payload_bytes)
    written = []
    trip_file = out / "trip.json5"
    header = "// Recovered from trip.enc by `trip unpack`. Comments from the original file were not kept.\n"
    out.mkdir(parents=True, exist_ok=True)
    trip_file.write_text(header + json.dumps(body["trip"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    written.append(trip_file)
    for lang, strings in body.get("locales", {}).items():
        file = out / "locales" / lang / "trip.json"
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(strings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append(file)
    for path, data_url in body.get("images", {}).items():
        file = out / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
        written.append(file)
    return written
