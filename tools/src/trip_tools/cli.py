"""The `trip` command.

    trip check  [--data DIR]                     validate the trip data, references and translations
    trip build  [--data DIR] [--out FILE] [--new-password] [--link URL]
                                                 check, then encrypt into web/trip.enc
    trip link   URL                              print a setup link (opens the app without typing)
    trip unpack --out DIR [--enc FILE]           decrypt trip.enc back into an editable folder
    trip schema [--check]                        write schema/trip.schema.json
    trip precache [--check]                      write the offline file list into web/sw.js
    trip serve  [--port N] [--host H] [--enc FILE]   serve web/ locally

DIR defaults to private/ (your trip). The password comes from TRIP_PASSWORD or is asked for.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

from trip_tools import bundle, precache, vault
from trip_tools.checks import check
from trip_tools.model import json_schema
from trip_tools.paths import DataDir, Project, ProjectNotFound, find_root
from trip_tools.serve import serve


class Fail(Exception):
    """Stop with a message and exit code 1."""


def _data_dir(project: Project, given: str | None) -> DataDir:
    if given:
        path = project.resolve(given)
    elif project.private.is_dir():
        path = project.private
    else:
        raise Fail("No private/ folder yet. Start your trip with a copy of the demo:\n  cp -r example private")
    if not path.is_dir():
        raise Fail(f"{path} is not a folder.")
    return DataDir(path)


def _rel(project: Project, path: Path) -> str:
    try:
        return path.resolve().relative_to(project.root).as_posix()
    except ValueError:
        return str(path)


def cmd_check(project: Project, args: argparse.Namespace) -> None:
    data = _data_dir(project, args.data)
    report = check(project, data)
    report.print()
    print(f"Checked {_rel(project, data.path)}: {report.summary()}")
    if not report.ok:
        raise Fail("")


def _warn_if_published(project: Project) -> None:
    """private/ must never reach GitHub."""
    if not (project.root / ".git").exists():
        return
    ignored = subprocess.run(["git", "check-ignore", "-q", "private/trip.json5"], cwd=project.root).returncode == 0
    tracked = (
        subprocess.run(
            ["git", "ls-files", "--error-unmatch", "private"], cwd=project.root, capture_output=True
        ).returncode
        == 0
    )
    if not ignored or tracked:
        print(
            "WARNING: private/ is not ignored by git, or is already committed. Your unencrypted trip could end up "
            "on GitHub. Check .gitignore and run: git rm -r --cached private"
        )


def _link(site: str, password: str) -> str:
    return f"{site.rstrip('/')}/#unlock={quote(vault.normalise(password), safe='')}"


def _print_link(site: str, password: str) -> None:
    print("\nSetup link (opens the app and remembers the password on that phone):")
    print(f"  {_link(site, password)}")
    print("Anyone who has this link can open the trip. Send it only to your parents, and delete it after setup.")


def cmd_build(project: Project, args: argparse.Namespace) -> None:
    data = _data_dir(project, args.data)
    out = project.resolve(args.out) if args.out else project.trip_enc
    report = check(project, data)
    report.print()
    if not report.ok:
        raise Fail(f"Fix the problems above first. {_rel(project, out)} was not changed.")

    payload = bundle.payload(data)
    key = vault.key_for_build(out, args.new_password)
    if key.is_new and (warning := vault.weak_password_warning(key.password)):
        print("Warning: " + warning)
    vault.encrypt(payload, key.key, key.salt, key.iterations).save(out)
    print(f"Wrote {_rel(project, out)} ({out.stat().st_size // 1024} KB) from {_rel(project, data.path)}.")
    if out.resolve() == project.trip_enc.resolve():
        print("Commit and push it to update the phones.")
    _warn_if_published(project)
    if args.link:
        _print_link(args.link, key.password)


def cmd_link(project: Project, args: argparse.Namespace) -> None:
    password = vault.ask_password("Family password: ")
    vault.open_trip(project.trip_enc, password)  # make sure the link will actually work
    _print_link(args.site, password)


def cmd_unpack(project: Project, args: argparse.Namespace) -> None:
    enc = project.resolve(args.enc) if args.enc else project.trip_enc
    out = project.resolve(args.out)
    if out.exists() and any(out.iterdir()) and not args.force:
        raise Fail(f"{out} is not empty. Choose another folder, or add --force to overwrite.")
    payload = vault.open_trip(enc, vault.ask_password("Family password: "))
    files = bundle.unpack(payload, out)
    print(f"Wrote {len(files)} files to {out}. Comments from the original trip.json5 are not in trip.enc.")


def cmd_schema(project: Project, args: argparse.Namespace) -> None:
    text = json.dumps(json_schema(), indent=2, ensure_ascii=False) + "\n"
    file = project.schema_file
    current = file.read_text(encoding="utf-8").replace("\r\n", "\n") if file.is_file() else None
    if args.check:
        if current != text:
            raise Fail(f"{_rel(project, file)} is out of date. Run: trip schema")
        print(f"{_rel(project, file)} is up to date.")
        return
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {_rel(project, file)}.")


def cmd_precache(project: Project, args: argparse.Namespace) -> None:
    sw = project.service_worker
    changed = precache.update(sw, project.web, write=not args.check)
    if args.check:
        if changed:
            raise Fail(f"{_rel(project, sw)} lists outdated files. Run: trip precache")
        print(f"{_rel(project, sw)} is up to date.")
    else:
        print(f"Updated {_rel(project, sw)}." if changed else f"{_rel(project, sw)} was already up to date.")


def cmd_serve(project: Project, args: argparse.Namespace) -> None:
    enc = project.resolve(args.enc) if args.enc else None
    if enc and not enc.is_file():
        raise Fail(f"{enc} does not exist.")
    serve(project.web, args.host, args.port, enc)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="trip", description="Validate, encrypt and serve the Our Trip app.")
    p.add_argument("--root", help="repository root (default: found from the current folder)")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("check", help="validate the trip data, references and translations")
    s.add_argument("--data", help="data folder (default: private/)")
    s.set_defaults(func=cmd_check)

    s = sub.add_parser("build", help="check, then encrypt the trip into web/trip.enc")
    s.add_argument("--data", help="data folder (default: private/)")
    s.add_argument("--out", help="where to write (default: web/trip.enc)")
    s.add_argument("--new-password", action="store_true", help="set or change the family password")
    s.add_argument("--link", metavar="SITE_URL", help="also print a setup link for this site")
    s.set_defaults(func=cmd_build)

    s = sub.add_parser("link", help="print a setup link that opens the app without typing the password")
    s.add_argument("site", metavar="SITE_URL", help="e.g. https://you.github.io/parent-trip-app/")
    s.set_defaults(func=cmd_link)

    s = sub.add_parser("unpack", help="decrypt trip.enc back into an editable folder (recovery)")
    s.add_argument("--out", required=True, help="folder to write into")
    s.add_argument("--enc", help="encrypted file (default: web/trip.enc)")
    s.add_argument("--force", action="store_true", help="write into a folder that is not empty")
    s.set_defaults(func=cmd_unpack)

    s = sub.add_parser("schema", help="write schema/trip.schema.json (editor autocompletion)")
    s.add_argument("--check", action="store_true", help="only check that it is up to date")
    s.set_defaults(func=cmd_schema)

    s = sub.add_parser("precache", help="write the offline file list into web/sw.js")
    s.add_argument("--check", action="store_true", help="only check that it is up to date")
    s.set_defaults(func=cmd_precache)

    s = sub.add_parser("serve", help="serve web/ on localhost")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to open it from a phone on your Wi-Fi")
    s.add_argument("--enc", help="serve this file as trip.enc instead of web/trip.enc")
    s.set_defaults(func=cmd_serve)
    return p


def main(argv: list[str] | None = None) -> None:
    args = parser().parse_args(argv)
    try:
        project = Project(Path(args.root).resolve() if args.root else find_root())
        args.func(project, args)
    except (Fail, vault.VaultError, ProjectNotFound, precache.PrecacheError) as e:
        if str(e):
            print(e, file=sys.stderr)
        sys.exit(1)
