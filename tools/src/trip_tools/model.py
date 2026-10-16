"""The shape of trip.json5, as pydantic models.

These models only *validate* (and generate schema/trip.schema.json for editor autocompletion).
The payload that goes into trip.enc is the raw trip.json5 dict, so nothing here changes what the app gets.
Field names follow the file (camelCase); Python attributes are snake_case.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainValidator, WithJsonSchema
from pydantic.alias_generators import to_camel

KEY_PATTERN = r"^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$"
KEY = re.compile(KEY_PATTERN)

# Icons the app has for events (web/js/html.js); anything else would show a plain dot.
EVENT_ICONS = ("plane", "car", "bed", "food", "coffee", "landmark", "ship", "bag", "walk", "moon", "suitcase")


@dataclass(frozen=True)
class Text:
    """A reference to translated text: a key, plus values for its {placeholders}."""

    key: str
    values: dict[str, str | int | float] = field(default_factory=dict)


def parse_text(value: Any) -> Text:
    if isinstance(value, str):
        key, values = value, {}
    elif (
        isinstance(value, list)
        and 1 <= len(value) <= 2
        and isinstance(value[0], str)
        and (len(value) == 1 or isinstance(value[1], dict))
    ):
        key, values = value[0], (value[1] if len(value) == 2 else {})
    else:
        raise ValueError('expected a translation key like "d1.title", or ["key", {"name": value}]')
    if not KEY.match(key):
        raise ValueError(f'"{key}" is not a translation key (keys look like "d1.title" or "ev.hagia.note")')
    for name, v in values.items():
        if isinstance(v, bool) or not isinstance(v, str | int | float):
            raise ValueError(f'value of "{name}" must be text or a number')
    return Text(key, values)


TEXT_REF_SCHEMA = {
    "title": "TextRef",
    "description": (
        'A translation key ("d1.title") or a key with values for its placeholders '
        '(["meet.lobbyAt", {"time": "09:45"}]).'
    ),
    # for json-schema-to-typescript (types/trip.d.ts); JSON schema validators ignore unknown keywords
    "tsType": "string | [string] | [string, { [name: string]: string | number }]",
    "anyOf": [
        {"type": "string", "pattern": KEY_PATTERN},
        {
            "type": "array",
            "prefixItems": [
                {"type": "string", "pattern": KEY_PATTERN},
                {"type": "object", "additionalProperties": {"type": ["string", "number"]}},
            ],
            "items": False,
            "minItems": 1,
            "maxItems": 2,
        },
    ],
}

TextRef = Annotated[Text, PlainValidator(parse_text), WithJsonSchema(TEXT_REF_SCHEMA)]
Time = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="24-hour local time, e.g. 09:45")]
IsoDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$", description="e.g. 2026-11-03")]
Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]+$")]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Settings(Model):
    languages: list[str] = Field(min_length=1, description="Language codes; the first is the fallback.")
    language: str | None = Field(default=None, description="Force one language; null = the phone's language.")
    speech_lang: str = Field(default="", description='Language spoken at the destination, e.g. "tr-TR".')
    demo_today_is_day: int | None = Field(default=None, ge=1, description="Demo only: pretend today is this day.")


class Weather(Model):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Place(Model):
    name: TextRef
    local_name: str | None = Field(default=None, description="As locals write it (taxi card, maps).")
    address: str = Field(description="As locals write it (taxi card, maps).")
    phone: str | None = None


class Ticket(Model):
    title: TextRef
    when: TextRef
    code: str
    image: str | None = Field(default=None, description="Path inside the data folder, e.g. tickets/flight-out.png")
    details: list[TextRef] | None = None


class Event(Model):
    time: Time
    icon: Literal[EVENT_ICONS]  # type: ignore[valid-type]
    title: TextRef
    note: TextRef | None = None
    meet: TextRef | None = None
    place: Id | None = Field(default=None, description="A key of `places`.")
    ticket: Id | None = Field(default=None, description="A key of `tickets`.")


class Day(Model):
    date: IsoDate
    title: TextRef
    note: TextRef | None = None
    hidden: bool = Field(
        default=False,
        description='Only the admin password shows this day; the family sees "Plan coming later" (and its weather).',
    )
    events: list[Event]


class Taxi(Model):
    ask: str = Field(description='"Please take me to this address", in the local language.')


class Contact(Model):
    name: str
    note: TextRef | None = None
    phone: str


class Insurance(Model):
    company: str
    policy: str
    phone: str
    note: TextRef | None = None


class Consulate(Model):
    name: TextRef
    note: TextRef | None = None
    phone: str


class Help(Model):
    emergency: str
    family: list[Contact] = Field(min_length=1, description="The first one gets the big Call button.")
    lost: list[TextRef]
    hotel: Id = Field(description="A key of `places`.")
    insurance: Insurance | None = None
    consulate: Consulate | None = None


class Currency(Model):
    code: str = Field(pattern=r"^[A-Z]{3}$", description="ISO 4217, e.g. TRY")
    symbol: str
    price: TextRef
    from_: TextRef = Field(alias="from")


class QuickAmounts(Model):
    local: list[float]
    home: list[float]


class Money(Model):
    local: Currency
    home: Currency
    pair: TextRef
    rate: float = Field(gt=0, description="1 home = this many local.")
    quick: QuickAmounts


class Checklist(Model):
    id: Id = Field(description="Also the storage key of the ticks: don't rename during a trip.")
    title: TextRef
    items: list[TextRef] = Field(min_length=1)


class Phrase(Model):
    meaning: TextRef
    say: TextRef
    local: str = Field(description="The phrase in the destination's language.")
    extra: str | None = Field(default=None, description="Shown big under the phrase, e.g. a phone number.")


class Trip(Model):
    schema_: str | None = Field(default=None, alias="$schema", description="For editors only; ignored by the app.")
    title: TextRef
    settings: Settings
    weather: Weather | None = None
    places: dict[str, Place]
    tickets: dict[str, Ticket]
    days: list[Day] = Field(min_length=1)
    taxi: Taxi
    help: Help
    money: Money
    lists: list[Checklist]
    phrases: list[Phrase]


def json_schema() -> dict[str, Any]:
    """The JSON schema of trip.json5, with every TextRef pointing at one shared definition."""
    schema = Trip.model_json_schema(by_alias=True)

    # pydantic titles every field ("Speechlang"); keep titles only on models, so types stay readable
    for model in [schema, *schema.get("$defs", {}).values()]:
        for prop in model.get("properties", {}).values():
            prop.pop("title", None)

    def share(node: Any) -> Any:
        if isinstance(node, dict):
            if node.get("title") == "TextRef" and "anyOf" in node:
                return {"$ref": "#/$defs/TextRef"}
            return {k: share(v) for k, v in node.items()}
        if isinstance(node, list):
            return [share(v) for v in node]
        return node

    schema = share(schema)
    schema.setdefault("$defs", {})["TextRef"] = TEXT_REF_SCHEMA
    schema["$defs"] = dict(sorted(schema["$defs"].items()))
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", **schema}
