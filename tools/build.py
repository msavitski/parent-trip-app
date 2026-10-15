"""Encrypt the private trip into trip.enc, the only trip file that is published.

    python tools/build.py                       # asks for the family password
    python tools/build.py --new-password        # set or change the password (phones will ask for it again)
    python tools/build.py --link https://you.github.io/our-trip/
                                                # also print a one-tap setup link for the parents' phones

The password can also come from the TRIP_PASSWORD environment variable.
Needs: pip install cryptography json5

What goes into trip.enc: private/trip.json5, private/locales/<lang>/trip.json and the ticket images.
Encryption: AES-256-GCM with a key from PBKDF2-SHA256 (600 000 rounds). app.js decrypts it with WebCrypto.
The salt is kept between builds, so phones that already know the password keep working after an update.
"""
import argparse
import base64
import getpass
import json
import os
import subprocess
import sys
import unicodedata
from hashlib import pbkdf2_hmac
from pathlib import Path
from urllib.parse import quote

import json5
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / "private"
OUT = ROOT / "trip.enc"
ITERATIONS = 600_000
MIN_LENGTH = 10
MIME = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif"}


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def derive(password: str, salt: bytes, iterations: int) -> bytes:
    # app.js does the same: trim, NFC-normalise, UTF-8
    norm = unicodedata.normalize("NFC", password.strip())
    return pbkdf2_hmac("sha256", norm.encode(), salt, iterations, dklen=32)


def ask(prompt: str) -> str:
    return os.environ.get("TRIP_PASSWORD") or getpass.getpass(prompt)


def key_for_build(new_password: bool) -> tuple[bytes, bytes, int, str]:
    """Return (key, salt, iterations, password), checking the password against the current trip.enc."""
    current = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None

    if current and not new_password:
        salt, iterations = base64.b64decode(current["salt"]), current["iter"]
        password = ask("Family password: ")
        key = derive(password, salt, iterations)
        try:
            AESGCM(key).decrypt(base64.b64decode(current["iv"]), base64.b64decode(current["data"]), None)
        except InvalidTag:
            sys.exit("That password doesn't open the current trip.enc.\n"
                     "Type it again, or run with --new-password to change it (phones will then ask for the new one).")
        return key, salt, iterations, password

    password = ask("New family password: ")
    if not os.environ.get("TRIP_PASSWORD") and getpass.getpass("Repeat it: ") != password:
        sys.exit("The two passwords are different. Nothing was changed.")
    if len(password.strip()) < MIN_LENGTH:
        print(f"Warning: the password is shorter than {MIN_LENGTH} characters. trip.enc is public, so anyone can try "
              "to guess it offline. A few words work well, e.g. 'blue-tram-to-galata'.")
    salt = os.urandom(16)
    return derive(password, salt, ITERATIONS), salt, ITERATIONS, password


def payload() -> bytes:
    trip = json5.loads((PRIVATE / "trip.json5").read_text(encoding="utf-8"))
    languages = trip.get("settings", {}).get("languages") or ["en"]
    locales = {lang: json.loads((PRIVATE / "locales" / lang / "trip.json").read_text(encoding="utf-8"))
               for lang in languages}
    images = {}
    for name, ticket in trip.get("tickets", {}).items():
        path = ticket.get("image")
        if not path:
            continue
        file = PRIVATE / path
        if not file.exists():
            sys.exit(f"Ticket '{name}': image private/{path} does not exist.")
        mime = MIME.get(file.suffix.lower())
        if not mime:
            sys.exit(f"Ticket '{name}': use a PNG, JPG, WEBP, GIF or SVG image, not {file.suffix}.")
        images[path] = f"data:{mime};base64,{b64(file.read_bytes())}"
    body = {"trip": trip, "locales": locales, "images": images}
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()


def warn_if_published():
    """private/ must never reach GitHub."""
    if not (ROOT / ".git").exists():
        return
    ignored = subprocess.run(["git", "check-ignore", "-q", "private/trip.json5"], cwd=ROOT).returncode == 0
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", "private"], cwd=ROOT,
                             capture_output=True).returncode == 0
    if not ignored or tracked:
        print("WARNING: private/ is not ignored by git, or is already committed. "
              "Your unencrypted trip could end up on GitHub. Check .gitignore and run: git rm -r --cached private")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--new-password", action="store_true", help="set or change the family password")
    parser.add_argument("--link", metavar="SITE_URL", help="print a setup link that opens the app without typing")
    args = parser.parse_args()

    check = subprocess.run([sys.executable, str(ROOT / "tools" / "check_locales.py")])
    if check.returncode != 0:
        sys.exit("Fix the translation problems above first. trip.enc was not changed.")

    data = payload()
    key, salt, iterations, password = key_for_build(args.new_password)
    iv = os.urandom(12)
    sealed = AESGCM(key).encrypt(iv, data, None)
    OUT.write_text(json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": iterations,
                               "salt": b64(salt), "iv": b64(iv), "data": b64(sealed)}), encoding="utf-8")
    print(f"\nWrote trip.enc ({OUT.stat().st_size // 1024} KB). Publish it together with the app files.")
    warn_if_published()

    if args.link:
        print("\nSetup link (opens the app and remembers the password on that phone):")
        print(f"  {args.link.rstrip('/')}/#unlock={quote(password.strip(), safe='')}")
        print("Anyone who has this link can open the trip. Send it only to your parents, and delete it from the chat after setup.")


if __name__ == "__main__":
    main()
