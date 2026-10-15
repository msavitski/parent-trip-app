"""Reading a trip data folder and assembling the payload that goes into trip.enc."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import json5

from trip_tools.paths import DataDir

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


def payload(data: DataDir) -> bytes:
    """{"trip": …, "locales": {lang: trip strings}, "images": {path: data URL}} as compact UTF-8 JSON."""
    trip = read_trip(data)
    locales = {lang: read_strings(data.trip_strings(lang)) for lang in languages(trip)}
    images = {}
    for path in image_paths(trip):
        file = data.path / path
        mime = IMAGE_TYPES[file.suffix.lower()]
        images[path] = f"data:{mime};base64,{base64.b64encode(file.read_bytes()).decode()}"
    body = {"trip": trip, "locales": locales, "images": images}
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()


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
