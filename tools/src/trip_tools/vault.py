"""Encrypting and decrypting web/trip.enc.

Version 1 (one password), still read and written:
    {"v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": b64, "iv": b64, "data": b64}
    data = AES-256-GCM(PBKDF2-SHA256(password, salt, iter), payload)
    With one password nobody but the family could open hidden days, so their plans are left out
    (`bundle.split`): hidden days are empty until the trip gets an admin password and is built again.

Version 2 (family + admin password), made by `trip password admin`:
    {"v": 2, "kdf": "PBKDF2-SHA256", "iter": …, "salt": b64, "iv": b64, "data": b64,
     "slots": {"family": {"iv": b64, "key": b64}, "admin": {"iv": b64, "key": b64}},
     "admin": {"iv": b64, "data": b64}}
    data          = AES-256-GCM(data key, family part)           the trip, as in v1
    slots.family  = AES-256-GCM(PBKDF2(family password), data key)
    slots.admin   = AES-256-GCM(PBKDF2(admin password), data key + admin key)
    admin         = AES-256-GCM(admin key, admin config JSON)     GitHub token and repositories

Version 3 (written when a hidden day has a plan): version 2 plus
     "hidden": {"iv": b64, "data": b64}
    hidden        = AES-256-GCM(admin key, hidden part)
    The payload is split (`bundle.split`): `data` holds the family part, the trip with hidden days as
    empty stubs and without the tickets, places, texts and images only they use; `hidden` holds the
    whole trip and its texts, plus the ticket images `data` doesn't have. The family password can't
    decrypt the hidden days at all; the admin password opens both parts and `unlock` merges them.
    The new number keeps tools and apps that don't know `hidden` from rewriting the file without it:
    they refuse anything but version 1 and 2. Without hidden plans a file stays version 2.

Both slots use the file's one salt, so a phone's saved key (PBKDF2 of the family password, see
web/js/vault.js) keeps opening the trip when a v1 file is upgraded to v2, and when the trip is rebuilt.
Passwords are trimmed and NFC-normalised before use, the same way the app does it.
"""

from __future__ import annotations

import base64
import getpass
import json
import os
import unicodedata
from dataclasses import dataclass, field, replace
from hashlib import pbkdf2_hmac
from pathlib import Path
from typing import Any, Literal

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from trip_tools import bundle

ITERATIONS = 600_000
MIN_PASSWORD_LENGTH = 10
KEY_BYTES = 32

# Non-interactive use (scripts, tests): the password that opens the current trip.enc, a new password,
# and the GitHub token for `trip admin`. Without them, each is asked for (hidden).
PASSWORD_ENV = "TRIP_PASSWORD"
NEW_PASSWORD_ENV = "TRIP_NEW_PASSWORD"
TOKEN_ENV = "TRIP_TOKEN"

Role = Literal["family", "admin"]


class VaultError(Exception):
    """A problem the user can fix (wrong password, mismatching passwords, missing file)."""


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


@dataclass(frozen=True)
class Box:
    """One AES-256-GCM encrypted value: a fresh 12-byte IV and the ciphertext with its tag."""

    iv: bytes
    data: bytes

    @classmethod
    def seal(cls, key: bytes, plain: bytes) -> Box:
        iv = os.urandom(12)
        return cls(iv, AESGCM(key).encrypt(iv, plain, None))

    def open(self, key: bytes) -> bytes | None:
        """The plain bytes, or None if the key is wrong."""
        try:
            return AESGCM(key).decrypt(self.iv, self.data, None)
        except InvalidTag:
            return None


@dataclass(frozen=True)
class EncFile:
    version: int
    iterations: int
    salt: bytes
    payload: Box
    slots: dict[str, Box] = field(default_factory=dict)  # v2, v3: "family" and "admin"
    admin: Box | None = None  # v2, v3: the admin config
    hidden: Box | None = None  # v3: the hidden part, for the admin key only

    @property
    def two_passwords(self) -> bool:
        return self.version >= 2

    @classmethod
    def load(cls, path: Path) -> EncFile:
        if not path.is_file():
            raise VaultError(f"{path} does not exist. Build it first with: trip build")
        raw = json.loads(path.read_text(encoding="utf-8"))
        version = raw.get("v")
        if version not in (1, 2, 3) or raw.get("kdf") != "PBKDF2-SHA256":
            raise VaultError(f"{path} is not a trip file this version of the tools can read.")
        slots = {role: Box(_unb64(s["iv"]), _unb64(s["key"])) for role, s in raw.get("slots", {}).items()}
        admin, hidden = raw.get("admin"), raw.get("hidden")
        return cls(
            version=version,
            iterations=raw["iter"],
            salt=_unb64(raw["salt"]),
            payload=Box(_unb64(raw["iv"]), _unb64(raw["data"])),
            slots=slots,
            admin=Box(_unb64(admin["iv"]), _unb64(admin["data"])) if admin else None,
            hidden=Box(_unb64(hidden["iv"]), _unb64(hidden["data"])) if hidden else None,
        )

    def to_json(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "v": self.version,
            "kdf": "PBKDF2-SHA256",
            "iter": self.iterations,
            "salt": _b64(self.salt),
            "iv": _b64(self.payload.iv),
            "data": _b64(self.payload.data),
        }
        if self.two_passwords:
            body["slots"] = {role: {"iv": _b64(b.iv), "key": _b64(b.data)} for role, b in self.slots.items()}
            if self.admin:
                body["admin"] = {"iv": _b64(self.admin.iv), "data": _b64(self.admin.data)}
            if self.hidden:
                body["hidden"] = {"iv": _b64(self.hidden.iv), "data": _b64(self.hidden.data)}
        return body

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_json()), encoding="utf-8")

    def password_key(self, password: str) -> bytes:
        return derive_key(password, self.salt, self.iterations)


@dataclass(frozen=True)
class Opened:
    """A trip.enc opened with one password."""

    enc: EncFile
    role: Role
    password_key: bytes  # PBKDF2 of the password it was opened with
    data_key: bytes
    admin_key: bytes | None
    family_part: bytes  # `data`, decrypted: what the family password opens
    hidden_part: bytes | None = None  # `hidden` (v3), decrypted: only with the admin password

    @property
    def payload(self) -> bytes:
        """The trip as this password sees it: with the admin password, the hidden days merged in."""
        return self.family_part if self.hidden_part is None else bundle.merge(self.family_part, self.hidden_part)

    @property
    def missing_hidden(self) -> bool:
        """The file has hidden days that this password (the family one) can't open."""
        return self.enc.hidden is not None and self.hidden_part is None

    def admin_config(self) -> dict[str, Any]:
        """The admin config (GitHub token and repositories). Only the admin password opens it."""
        if self.admin_key is None:
            raise VaultError("Only the admin password opens the admin settings.")
        if self.enc.admin is None:
            return {}
        plain = self.enc.admin.open(self.admin_key)
        if plain is None:
            raise VaultError("The admin settings in trip.enc are damaged. Set them again with: trip admin")
        return json.loads(plain)


def normalise(password: str) -> str:
    return unicodedata.normalize("NFC", password.strip())


def derive_key(password: str, salt: bytes, iterations: int) -> bytes:
    return pbkdf2_hmac("sha256", normalise(password).encode(), salt, iterations, dklen=KEY_BYTES)


def unlock(enc: EncFile, password: str) -> Opened:
    """Open trip.enc with the family or the admin password (VaultError if neither).

    The admin password also opens the hidden part; the family password gets the family part only.
    """
    key = enc.password_key(password)
    if enc.version == 1:
        payload = enc.payload.open(key)
        if payload is None:
            raise VaultError("Wrong password for this trip.enc.")
        return Opened(enc, "family", key, key, None, payload)
    for role in ("admin", "family"):
        slot = enc.slots.get(role)
        keys = slot.open(key) if slot else None
        if keys is None:
            continue
        data_key, admin_key = keys[:KEY_BYTES], (keys[KEY_BYTES:] or None)
        payload = enc.payload.open(data_key)
        if payload is None:
            raise VaultError("trip.enc is damaged: the password fits but the trip doesn't open.")
        hidden = None
        if admin_key and enc.hidden:
            hidden = enc.hidden.open(admin_key)
            if hidden is None:
                raise VaultError("trip.enc is damaged: the admin password fits but the hidden days don't open.")
        return Opened(enc, role, key, data_key, admin_key, payload, hidden)  # type: ignore[arg-type]
    raise VaultError("Wrong password for this trip.enc (it is neither the family nor the admin password).")


def opens_slot(enc: EncFile, password: str, role: Role) -> bool:
    slot = enc.slots.get(role)
    return slot is not None and slot.open(enc.password_key(password)) is not None


# ---------- making files ----------


def _version(hidden: Box | None) -> int:
    """A two-password file is version 3 with a hidden part, 2 without one."""
    return 3 if hidden else 2


def new_v1(payload: bytes, password: str) -> EncFile:
    """A fresh one-password file with a new salt. It gets the family part only: no admin key could open
    hidden days, so their plans are left out."""
    salt = os.urandom(16)
    family, _ = bundle.split(payload)
    return EncFile(1, ITERATIONS, salt, Box.seal(derive_key(password, salt, ITERATIONS), family))


def with_payload(opened: Opened, payload: bytes) -> EncFile:
    """The same file (salt, slots, admin settings) with a new payload: passwords and phones keep working.

    The payload is split (`bundle.split`): the family part goes into `data`, and the hidden part, if a
    hidden day has a plan, is encrypted with the admin key, so it needs the admin password (VaultError
    otherwise). A one-password file has no admin key: it gets the family part only, without those plans.
    """
    enc = opened.enc
    family, hidden_part = bundle.split(payload)
    data = Box.seal(opened.data_key, family)
    if not enc.two_passwords:
        return replace(enc, payload=data)
    hidden = None
    if hidden_part is not None:
        if opened.admin_key is None:
            raise VaultError(
                "The trip has hidden days, and only the admin password can encrypt them so that the family "
                "password can't read them. Use the admin password."
            )
        hidden = Box.seal(opened.admin_key, hidden_part)
    return replace(enc, version=_version(hidden), payload=data, hidden=hidden)


def make_v2(
    *,
    salt: bytes,
    iterations: int,
    payload: bytes,
    data_key: bytes,
    admin_key: bytes,
    family_key: bytes,
    admin_password_key: bytes,
    admin_config: dict[str, Any],
    hidden_part: bytes | None = None,
) -> EncFile:
    """A two-password file: version 2, or 3 with a hidden part (`payload` is then the family part)."""
    config = json.dumps(admin_config, ensure_ascii=False, separators=(",", ":")).encode()
    hidden = Box.seal(admin_key, hidden_part) if hidden_part is not None else None
    return EncFile(
        version=_version(hidden),
        iterations=iterations,
        salt=salt,
        payload=Box.seal(data_key, payload),
        slots={
            "family": Box.seal(family_key, data_key),
            "admin": Box.seal(admin_password_key, data_key + admin_key),
        },
        admin=Box.seal(admin_key, config),
        hidden=hidden,
    )


def set_admin_password(opened: Opened, new_password: str) -> EncFile:
    """Add or change the admin password (upgrades a v1 file to v2, or v3 if a hidden day has a plan).

    Opened with the admin password: the admin settings and the hidden days are kept, encrypted with
    the new admin key. Opened with the family password (a v1 file, or a forgotten admin password): the
    admin settings start empty, and the hidden days of a v3 file are lost (`Opened.missing_hidden`),
    because only the old admin key opened them; build again with the new admin password to put them back.
    The family slot and the salt stay as they are, so the parents' phones are not affected.
    """
    enc = opened.enc
    config = opened.admin_config() if opened.role == "admin" else {}
    admin_key = os.urandom(KEY_BYTES)
    admin_password_key = enc.password_key(new_password)
    if enc.version == 1:
        # the v1 key becomes the family slot's key, so phones that saved it keep working. A file built by
        # an older version of the tools may have hidden days' plans in its one part: they move to `hidden`.
        family, hidden_part = bundle.split(opened.payload)
        return make_v2(
            salt=enc.salt,
            iterations=enc.iterations,
            payload=family,
            data_key=os.urandom(KEY_BYTES),
            admin_key=admin_key,
            family_key=opened.password_key,
            admin_password_key=admin_password_key,
            admin_config=config,
            hidden_part=hidden_part,
        )
    plain = json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode()
    slots = {**enc.slots, "admin": Box.seal(admin_password_key, opened.data_key + admin_key)}
    hidden = Box.seal(admin_key, opened.hidden_part) if opened.hidden_part is not None else None
    return replace(enc, version=_version(hidden), slots=slots, admin=Box.seal(admin_key, plain), hidden=hidden)


def set_family_password(opened: Opened, new_password: str) -> EncFile:
    """Change the family password. Phones will ask for the new one.

    v1: a new salt and key. v2, v3 (opened with the admin password): a new data key re-encrypts the
    family part, so someone who knew the old family password can't read future versions; the admin login,
    the admin settings and the hidden part (encrypted with the admin key) stay as they are.
    """
    enc = opened.enc
    if enc.version == 1:
        return new_v1(opened.payload, new_password)
    if opened.role != "admin" or opened.admin_key is None:
        raise VaultError("To change the family password of a two-password trip, open it with the admin password.")
    data_key = os.urandom(KEY_BYTES)
    return replace(
        enc,
        payload=Box.seal(data_key, opened.family_part),
        slots={
            "family": Box.seal(enc.password_key(new_password), data_key),
            "admin": Box.seal(opened.password_key, data_key + opened.admin_key),
        },
    )


def set_admin_config(opened: Opened, config: dict[str, Any]) -> EncFile:
    """Replace the admin settings (GitHub token and repositories)."""
    if opened.role != "admin" or opened.admin_key is None:
        raise VaultError("Only the admin password can change the admin settings.")
    plain = json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode()
    return replace(opened.enc, admin=Box.seal(opened.admin_key, plain))


# ---------- asking ----------


def ask_password(prompt: str, confirm: bool = False, env: str | tuple[str, ...] = PASSWORD_ENV) -> str:
    """From the first set environment variable in `env`, or typed (hidden)."""
    for name in (env,) if isinstance(env, str) else env:
        if value := os.environ.get(name):
            return value
    password = getpass.getpass(prompt)
    if confirm and getpass.getpass("Repeat it: ") != password:
        raise VaultError("The two passwords are different. Nothing was changed.")
    return password


def open_file(path: Path, prompt: str = "Password (family or admin): ") -> Opened:
    return unlock(EncFile.load(path), ask_password(prompt))


def weak_password_warning(password: str) -> str | None:
    if len(normalise(password)) >= MIN_PASSWORD_LENGTH:
        return None
    return (
        f"The password is shorter than {MIN_PASSWORD_LENGTH} characters. trip.enc is public, so anyone can try "
        "to guess it offline. A few words work well, e.g. 'blue-tram-to-galata'."
    )
