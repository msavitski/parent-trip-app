"""Encrypting and decrypting web/trip.enc.

Format (version 1), read by web/js/vault.js:
    {"v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": b64, "iv": b64, "data": b64}
The key is PBKDF2-SHA256(password, salt, iter), 32 bytes; data is AES-256-GCM (ciphertext + tag).
Passwords are trimmed and NFC-normalised before use, the same way the app does it.

The salt is kept between builds: phones store the derived key, so they keep working after an update.
A new salt (and so a new key) is made only when the password changes.
"""

from __future__ import annotations

import base64
import getpass
import json
import os
import unicodedata
from dataclasses import dataclass
from hashlib import pbkdf2_hmac
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ITERATIONS = 600_000
MIN_PASSWORD_LENGTH = 10
PASSWORD_ENV = "TRIP_PASSWORD"


class VaultError(Exception):
    """A problem the user can fix (wrong password, mismatching passwords, missing file)."""


@dataclass(frozen=True)
class EncFile:
    iterations: int
    salt: bytes
    iv: bytes
    data: bytes

    @classmethod
    def load(cls, path: Path) -> EncFile:
        if not path.is_file():
            raise VaultError(f"{path} does not exist. Build it first with: trip build")
        raw = json.loads(path.read_text(encoding="utf-8"))
        if raw.get("v") != 1 or raw.get("kdf") != "PBKDF2-SHA256":
            raise VaultError(f"{path} is not a version-1 trip file.")
        b64 = base64.b64decode
        return cls(raw["iter"], b64(raw["salt"]), b64(raw["iv"]), b64(raw["data"]))

    def save(self, path: Path) -> None:
        b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
        body = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": self.iterations, "salt": b64(self.salt), "iv": b64(self.iv)}
        body["data"] = b64(self.data)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(body), encoding="utf-8")

    def decrypt(self, key: bytes) -> bytes:
        """The payload, or VaultError if the key (password) is wrong."""
        try:
            return AESGCM(key).decrypt(self.iv, self.data, None)
        except InvalidTag:
            raise VaultError("Wrong password for this trip.enc.") from None


def normalise(password: str) -> str:
    return unicodedata.normalize("NFC", password.strip())


def derive_key(password: str, salt: bytes, iterations: int) -> bytes:
    return pbkdf2_hmac("sha256", normalise(password).encode(), salt, iterations, dklen=32)


def encrypt(payload: bytes, key: bytes, salt: bytes, iterations: int) -> EncFile:
    iv = os.urandom(12)
    return EncFile(iterations, salt, iv, AESGCM(key).encrypt(iv, payload, None))


def ask_password(prompt: str, confirm: bool = False) -> str:
    """From the TRIP_PASSWORD environment variable, or typed (hidden)."""
    env = os.environ.get(PASSWORD_ENV)
    if env:
        return env
    password = getpass.getpass(prompt)
    if confirm and getpass.getpass("Repeat it: ") != password:
        raise VaultError("The two passwords are different. Nothing was changed.")
    return password


@dataclass(frozen=True)
class BuildKey:
    key: bytes
    salt: bytes
    iterations: int
    password: str
    is_new: bool


def key_for_build(current: Path, new_password: bool) -> BuildKey:
    """The key to encrypt with.

    With an existing trip.enc (and no --new-password) the password must open it, so a typo can't
    lock the phones out; the salt is reused, so phones that know the password stay unlocked.
    """
    if current.is_file() and not new_password:
        enc = EncFile.load(current)
        password = ask_password("Family password: ")
        key = derive_key(password, enc.salt, enc.iterations)
        try:
            enc.decrypt(key)
        except VaultError:
            raise VaultError(
                f"That password doesn't open the current {current.name}.\n"
                "Type it again, or use --new-password to change it (phones will then ask for the new one)."
            ) from None
        return BuildKey(key, enc.salt, enc.iterations, password, is_new=False)

    password = ask_password("New family password: ", confirm=True)
    salt = os.urandom(16)
    return BuildKey(derive_key(password, salt, ITERATIONS), salt, ITERATIONS, password, is_new=True)


def open_trip(path: Path, password: str) -> bytes:
    enc = EncFile.load(path)
    return enc.decrypt(derive_key(password, enc.salt, enc.iterations))


def weak_password_warning(password: str) -> str | None:
    if len(normalise(password)) >= MIN_PASSWORD_LENGTH:
        return None
    return (
        f"The password is shorter than {MIN_PASSWORD_LENGTH} characters. trip.enc is public, so anyone can try "
        "to guess it offline. A few words work well, e.g. 'blue-tram-to-galata'."
    )
