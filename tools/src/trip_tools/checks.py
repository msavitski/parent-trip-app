"""`trip check`: everything that can be wrong with a trip data folder before it is encrypted.

1. Shape: trip.json5 against the models (missing fields, typos in field names, bad times).
2. References: places, tickets and the hotel exist; dates ascend; list ids are unique; images exist.
3. Translations: every key exists, every language has every key, placeholders match and get values.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any

import json5
from pydantic import BaseModel, ValidationError

from trip_tools.bundle import IMAGE_TYPES
from trip_tools.model import Text, Trip
from trip_tools.paths import DataDir, Project
from trip_tools.report import Report

PLACEHOLDER = re.compile(r"\{(\w+)\}")
PLURAL = re.compile(r"\.(zero|one|two|few|many|other)$")

# readable messages for fields with a fixed format (by field name)
FORMATS = {
    "time": "use 24-hour time like 09:45",
    "date": "use a date like 2026-11-03",
    "code": "use a 3-letter currency code like TRY",
    "id": "use only letters, digits, - and _",
    "place": "use only letters, digits, - and _",
    "ticket": "use only letters, digits, - and _",
    "hotel": "use only letters, digits, - and _",
}


def check(project: Project, data: DataDir) -> Report:
    report = Report()
    trip = _parse(data, report)
    if trip is None:
        return report
    _check_references(trip, data, report)
    _check_translations(project, data, trip, report)
    if trip.settings.demo_today_is_day and data.path.resolve() == project.private.resolve():
        report.warn(
            "settings.demoTodayIsDay",
            "is set: the app will pretend the trip is happening now. Use null for a real trip.",
        )
    return report


# ---------- 1. shape ----------


def _loc(loc: tuple[Any, ...]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def _parse(data: DataDir, report: Report) -> Trip | None:
    where = data.trip_file.name
    if not data.trip_file.is_file():
        report.error(str(data.trip_file), "does not exist")
        return None
    try:
        raw = json5.loads(data.trip_file.read_text(encoding="utf-8"))
    except ValueError as e:
        report.error(where, f"is not valid JSON5: {e}")
        return None
    try:
        return Trip.model_validate(raw)
    except ValidationError as e:
        for err in e.errors():
            message = err["msg"].removeprefix("Value error, ")
            if err["type"] == "extra_forbidden":
                message = "unknown field (a typo?)"
            elif err["type"] == "missing":
                message = "is missing"
            elif err["type"] == "string_pattern_mismatch" and str(err["loc"][-1]) in FORMATS:
                message = f'"{err["input"]}": {FORMATS[str(err["loc"][-1])]}'
            report.error(_loc(err["loc"]), message)
        return None


# ---------- 2. references ----------


def _check_references(trip: Trip, data: DataDir, report: Report) -> None:
    places, tickets = trip.places.keys(), trip.tickets.keys()
    known = lambda keys: ", ".join(keys) or "none"  # noqa: E731

    previous: date | None = None
    for i, day in enumerate(trip.days):
        try:
            current = date.fromisoformat(day.date)
        except ValueError:
            report.error(f"days[{i}].date", f'"{day.date}" is not a real date')
            continue
        if previous and current <= previous:
            report.error(f"days[{i}].date", f"{day.date} must come after the previous day ({previous})")
        previous = current
        for j, event in enumerate(day.events):
            if event.place and event.place not in places:
                report.error(f"days[{i}].events[{j}].place", f"unknown place '{event.place}' (known: {known(places)})")
            if event.ticket and event.ticket not in tickets:
                report.error(
                    f"days[{i}].events[{j}].ticket", f"unknown ticket '{event.ticket}' (known: {known(tickets)})"
                )
        times = [e.time for e in day.events]
        if times != sorted(times):
            report.warn(
                f"days[{i}].events", "are not in time order (the app sorts them, but the file is easier to read sorted)"
            )

    if trip.help.hotel not in places:
        report.error("help.hotel", f"unknown place '{trip.help.hotel}' (known: {known(places)})")

    seen: set[str] = set()
    for i, checklist in enumerate(trip.lists):
        if checklist.id in seen:
            report.error(f"lists[{i}].id", f"'{checklist.id}' is used twice (ids are where the ticks are saved)")
        seen.add(checklist.id)

    for name, ticket in trip.tickets.items():
        if not ticket.image:
            continue
        file = (data.path / ticket.image).resolve()
        if data.path.resolve() not in file.parents:
            report.error(f"tickets.{name}.image", "must be inside the data folder")
        elif not file.is_file():
            report.error(f"tickets.{name}.image", f"{ticket.image} does not exist")
        elif file.suffix.lower() not in IMAGE_TYPES:
            report.error(f"tickets.{name}.image", f"use {', '.join(IMAGE_TYPES)} (not {file.suffix})")

    demo = trip.settings.demo_today_is_day
    if demo and demo > len(trip.days):
        report.error("settings.demoTodayIsDay", f"is {demo}, but the trip has {len(trip.days)} days")
    if trip.settings.language and trip.settings.language not in trip.settings.languages:
        report.error("settings.language", f"'{trip.settings.language}' is not in settings.languages")


# ---------- 3. translations ----------


def _texts(node: Any, path: str = "") -> list[tuple[str, Text]]:
    """Every Text in the validated trip, with its path in the file (camelCase, like trip.json5)."""
    found: list[tuple[str, Text]] = []
    if isinstance(node, Text):
        found.append((path, node))
    elif isinstance(node, BaseModel):
        for name, info in type(node).model_fields.items():
            alias = info.alias or name
            found += _texts(getattr(node, name), f"{path}.{alias}" if path else alias)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            found += _texts(item, f"{path}[{i}]")
    elif isinstance(node, dict):
        for key, item in node.items():
            found += _texts(item, f"{path}.{key}")
    return found


def _base(key: str) -> str:
    """'today.startsIn.few' -> 'today.startsIn' (plural forms differ between languages)."""
    return PLURAL.sub("", key)


def _placeholders(strings: dict[str, str], key: str) -> set[str]:
    text = strings.get(key) or strings.get(_base(key) + ".other") or ""
    return set(PLACEHOLDER.findall(text))


def _load(path: Path, where: str, report: Report) -> dict[str, str] | None:
    if not path.is_file():
        report.error(where, "does not exist")
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        report.error(where, f"is not valid JSON: {e}")
        return None


def _compare(ref: dict[str, str], cur: dict[str, str], where: str, ref_where: str, report: Report) -> None:
    ref_bases, cur_bases = {_base(k) for k in ref}, {_base(k) for k in cur}
    for key in sorted(ref_bases - cur_bases):
        report.error(where, f"missing '{key}'")
    for key in sorted(cur_bases - ref_bases):
        report.error(where, f"'{key}' is not in {ref_where}")
    for key in sorted(cur):
        if _base(key) in ref_bases and not key.startswith("meta."):
            want, got = _placeholders(ref, key), _placeholders(cur, key)
            if want != got:
                report.error(where, f"'{key}' has placeholders {sorted(got)}, expected {sorted(want)}")


def _check_translations(project: Project, data: DataDir, trip: Trip, report: Report) -> None:
    langs = trip.settings.languages
    ref_lang = langs[0]
    rel = lambda p: p.relative_to(project.root).as_posix() if p.is_relative_to(project.root) else str(p)  # noqa: E731

    # interface words (web/locales/<lang>/app.json): same keys and placeholders in every language
    ref_app_path = project.app_strings(ref_lang)
    ref_app = _load(ref_app_path, rel(ref_app_path), report)
    for lang in langs[1:]:
        path = project.app_strings(lang)
        cur = _load(path, rel(path), report)
        if ref_app is not None and cur is not None:
            _compare(ref_app, cur, rel(path), rel(ref_app_path), report)

    # trip words (<data>/locales/<lang>/trip.json)
    ref_trip_path = data.trip_strings(ref_lang)
    ref_trip = _load(ref_trip_path, rel(ref_trip_path), report)
    for lang in langs[1:]:
        path = data.trip_strings(lang)
        cur = _load(path, rel(path), report)
        if ref_trip is not None and cur is not None:
            _compare(ref_trip, cur, rel(path), rel(ref_trip_path), report)
    for lang in data.languages_on_disk():
        if lang not in langs:
            report.warn(rel(data.path / "locales" / lang), f"'{lang}' is not in settings.languages, so it is not used")
    if ref_trip is None:
        return

    # every key used in trip.json5 exists, and gets a value for each of its placeholders
    used: set[str] = set()
    ref_bases = {_base(k) for k in ref_trip}
    for path, text in _texts(trip):
        used.add(text.key)
        if text.key not in ref_bases:
            report.error(path, f"uses '{text.key}', but {rel(ref_trip_path)} has no such key")
            continue
        missing = _placeholders(ref_trip, text.key) - set(text.values)
        if missing:
            names = ", ".join("{" + m + "}" for m in sorted(missing))
            report.error(path, f"'{text.key}' needs a value for {names}: write [\"{text.key}\", {{...}}]")
    for key in sorted(ref_bases - used):
        report.warn(rel(ref_trip_path), f"'{key}' is not used in {data.trip_file.name}")
