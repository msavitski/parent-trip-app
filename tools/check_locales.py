"""Check the translation files against each other and against the trip data.

    python tools/check_locales.py          # English is the reference
    python tools/check_locales.py ru       # or any other language

Files checked:
  locales/<lang>/app.json            the app's own words (public)
  private/locales/<lang>/trip.json   the trip's words (private, encrypted by tools/build.py)
  private/trip.json5                 the trip data that uses the keys

Reports:
  - keys that trip.json5 uses but the reference trip.json does not have
  - keys missing from (or extra in) each language compared to the reference
  - {placeholders} that differ between a translation and the reference
  - keys in trip.json that trip.json5 never uses (warning only)
Exits with 1 if anything other than a warning was found, so it can run in CI.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = {"app": ROOT / "locales", "trip": ROOT / "private" / "locales"}
TRIP_DATA = ROOT / "private" / "trip.json5"
REF = sys.argv[1] if len(sys.argv) > 1 else "en"

PLACEHOLDER = re.compile(r"\{(\w+)\}")
PLURAL = re.compile(r"\.(zero|one|two|few|many|other)$")
KEY_LITERAL = re.compile(r'"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"')

problems = 0


def report(msg):
    global problems
    problems += 1
    print("ERROR  " + msg)


def path(lang, ns):
    return FILES[ns] / lang / f"{ns}.json"


def load(lang, ns):
    p = path(lang, ns)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        report(f"{p.relative_to(ROOT)} does not exist")
    except json.JSONDecodeError as e:
        report(f"{p.relative_to(ROOT)} is not valid JSON: {e}")
    return {}


def base(key):
    """'today.startsIn.few' -> 'today.startsIn' (plural forms differ between languages)."""
    return PLURAL.sub("", key)


def placeholders(d, key):
    """Placeholders of a key, or of its plural group's 'other' form."""
    text = d.get(key) or d.get(base(key) + ".other") or ""
    return set(PLACEHOLDER.findall(text))


langs = sorted({p.name for folder in FILES.values() if folder.exists() for p in folder.iterdir() if p.is_dir()})
if REF not in langs:
    sys.exit(f"No '{REF}' translations. Languages found: {', '.join(langs)}")

# 1. keys used in the trip data must exist in the reference trip.json
src = TRIP_DATA.read_text(encoding="utf-8")
src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
src = re.sub(r"(?m)(^|\s)//.*$", r"\1", src)
used = set(KEY_LITERAL.findall(src))
ref_trip_bases = {base(k) for k in load(REF, "trip")}
for key in sorted(used - ref_trip_bases):
    report(f"private/trip.json5 uses '{key}', but {path(REF, 'trip').relative_to(ROOT)} has no such key")
for key in sorted(ref_trip_bases - used):
    print(f"warn   {path(REF, 'trip').relative_to(ROOT)}: '{key}' is not used in private/trip.json5")

# 2. every language must match the reference: same keys, same placeholders
for ns in FILES:
    ref = load(REF, ns)
    ref_bases = {base(k) for k in ref}
    for lang in langs:
        if lang == REF:
            continue
        cur = load(lang, ns)
        where = path(lang, ns).relative_to(ROOT)
        cur_bases = {base(k) for k in cur}
        for key in sorted(ref_bases - cur_bases):
            report(f"{where}: missing '{key}'")
        for key in sorted(cur_bases - ref_bases):
            report(f"{where}: '{key}' is not in the '{REF}' file")
        for key in sorted(cur):
            if base(key) in ref_bases and not key.startswith("meta."):
                want, got = placeholders(ref, key), placeholders(cur, key)
                if want != got:
                    report(f"{where}: '{key}' has placeholders {sorted(got)}, expected {sorted(want)}")

print(f"Checked {len(langs)} languages ({', '.join(langs)}) against '{REF}': "
      + ("all good." if not problems else f"{problems} problem(s)."))
sys.exit(1 if problems else 0)
