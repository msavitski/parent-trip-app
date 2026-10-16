"""The `trip` command.

    trip check  [--data DIR]                     validate the trip data, references and translations
    trip build  [--data DIR] [--out FILE] [--new-password] [--link URL] [--no-fetch]
                                                 check, then encrypt into web/trip.enc
    trip password family|admin [--enc FILE]      change the family password, or add/change the admin one
    trip admin  [--show] [--enc FILE] […]        set the GitHub token and repositories the app publishes to
    trip link   URL                              print a setup link (opens the app without typing)
    trip unpack --out DIR [--enc FILE]           decrypt trip.enc back into an editable folder
    trip schema [--check]                        write schema/trip.schema.json
    trip precache [--check]                      write the offline file list into web/sw.js
    trip serve  [--port N] [--host H] [--enc FILE]   serve web/ locally

DIR defaults to private/ (your trip). Passwords are asked for (hidden), or come from TRIP_PASSWORD
(one that opens the current trip.enc), TRIP_NEW_PASSWORD (a new one) and TRIP_TOKEN (the GitHub token).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any
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


def _git(cwd: Path, *args: str, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=timeout)


def _behind(repo: Path, path: str | None, fetch: bool) -> int | None:
    """Commits on the branch's GitHub copy that this folder doesn't have (touching `path`), or None if unknown."""
    if _git(repo, "rev-parse", "--abbrev-ref", "@{u}").returncode != 0:
        return None  # not a git folder, or the branch tracks nothing
    if fetch:
        try:
            if _git(repo, "fetch", "--quiet").returncode != 0:
                print(f"Note: couldn't check GitHub for newer versions of {repo.name}/ (offline?).")
        except subprocess.TimeoutExpired:
            print(f"Note: checking GitHub for newer versions of {repo.name}/ took too long; skipped.")
    count = _git(repo, "rev-list", "--count", "HEAD..@{u}", *(["--", path] if path else []))
    return int(count.stdout.strip() or 0) if count.returncode == 0 else None


def _refuse_if_behind(project: Project, data: DataDir, fetch: bool) -> None:
    """The app's admin mode publishes to GitHub. Building from older local files would undo those edits."""
    is_private_repo = data.path.resolve() == project.private.resolve() and (data.path / ".git").exists()
    if is_private_repo and _behind(data.path, None, fetch):
        raise Fail(
            "private/ is behind its GitHub copy: trip changes were published from the app.\n"
            "Get them first:  git -C private pull"
        )
    if _behind(project.root, "web/trip.enc", fetch):
        raise Fail(
            "web/trip.enc on GitHub is newer than yours: it was published from the app.\n"
            "Get it first:  git pull   (and git -C private pull)"
        )


def _note_hidden_days(trip: dict[str, Any], enc: vault.EncFile) -> None:
    """Say which days the family doesn't see, and if nobody can see them (no admin password yet)."""
    hidden = [day.get("date", "?") for day in trip.get("days", []) if day.get("hidden")]
    if not hidden:
        return
    print(f'Hidden from the family (they see "Plan coming later"): {", ".join(hidden)}.')
    if enc.version == 1:
        print("This trip has only the family password, so nobody sees those days. Add an admin password:")
        print("  trip password admin")


def cmd_build(project: Project, args: argparse.Namespace) -> None:
    data = _data_dir(project, args.data)
    out = project.resolve(args.out) if args.out else project.trip_enc
    report = check(project, data)
    report.print()
    if not report.ok:
        raise Fail(f"Fix the problems above first. {_rel(project, out)} was not changed.")
    if out.resolve() == project.trip_enc.resolve():
        _refuse_if_behind(project, data, fetch=not args.no_fetch)

    payload = bundle.payload(data)
    link_password: str | None = None
    if not out.is_file() or args.new_password:
        if out.is_file() and vault.EncFile.load(out).version == 2:
            raise Fail("This trip has a family and an admin password. Change the family one with: trip password family")
        password = vault.ask_password(
            "New family password: ", confirm=True, env=(vault.NEW_PASSWORD_ENV, vault.PASSWORD_ENV)
        )
        if warning := vault.weak_password_warning(password):
            print("Warning: " + warning)
        enc = vault.new_v1(payload, password)
        link_password = password
    else:
        # the password must open the current file, so a typo can't lock the phones out
        password = vault.ask_password("Password (family or admin): ")
        opened = vault.unlock(vault.EncFile.load(out), password)
        enc = vault.with_payload(opened, payload)
        link_password = password if opened.role == "family" else None
    enc.save(out)
    print(f"Wrote {_rel(project, out)} ({out.stat().st_size // 1024} KB) from {_rel(project, data.path)}.")
    _note_hidden_days(bundle.read_trip(data), enc)
    if out.resolve() == project.trip_enc.resolve():
        print("Commit and push it to update the phones.")
    _warn_if_published(project)
    if args.link:
        if link_password:
            _print_link(args.link, link_password)
        else:
            print("\nNo setup link: you used the admin password. Make one with the family password: trip link URL")


def cmd_link(project: Project, args: argparse.Namespace) -> None:
    password = vault.ask_password("Family password: ")
    opened = vault.unlock(vault.EncFile.load(_enc_path(project, args)), password)  # make sure the link will work
    if opened.role != "family":
        raise Fail("That is the admin password. A setup link must use the family password, so phones don't get admin.")
    _print_link(args.site, password)


def cmd_unpack(project: Project, args: argparse.Namespace) -> None:
    enc = project.resolve(args.enc) if args.enc else project.trip_enc
    out = project.resolve(args.out)
    if out.exists() and any(out.iterdir()) and not args.force:
        raise Fail(f"{out} is not empty. Choose another folder, or add --force to overwrite.")
    opened = vault.open_file(enc)
    files = bundle.unpack(opened.payload, out)
    print(f"Wrote {len(files)} files to {out}. Comments from the original trip.json5 are not in trip.enc.")


def _enc_path(project: Project, args: argparse.Namespace) -> Path:
    return project.resolve(args.enc) if args.enc else project.trip_enc


def _new_password(enc: vault.EncFile, other: vault.Role, prompt: str) -> str:
    password = vault.ask_password(prompt, confirm=True, env=vault.NEW_PASSWORD_ENV)
    if not vault.normalise(password):
        raise Fail("The password is empty. Nothing was changed.")
    if vault.opens_slot(enc, password, other) or (enc.version == 1 and _opens_v1(enc, password)):
        raise Fail(f"The new password is the same as the {other} password. Use a different one.")
    if warning := vault.weak_password_warning(password):
        print("Warning: " + warning)
    return password


def _opens_v1(enc: vault.EncFile, password: str) -> bool:
    return enc.payload.open(enc.password_key(password)) is not None


def cmd_password(project: Project, args: argparse.Namespace) -> None:
    path = _enc_path(project, args)
    enc = vault.EncFile.load(path)
    if args.role == "admin":
        prompt = "Current admin password, or the family password: " if enc.version == 2 else "Family password: "
        opened = vault.unlock(enc, vault.ask_password(prompt))
        if enc.version == 2 and opened.role == "family":
            print("Opened with the family password: the admin settings (GitHub token) start empty.")
            print("Set them again afterwards with: trip admin")
        new = _new_password(enc, "family", "New admin password: ")
        vault.set_admin_password(opened, new).save(path)
        print(f"Saved {_rel(project, path)}. The family password and the phones are not affected.")
        if enc.version == 1:
            print("The trip now has two passwords. Next, give the app your GitHub token: trip admin")
    else:
        prompt = "Admin password: " if enc.version == 2 else "Current family password: "
        opened = vault.unlock(enc, vault.ask_password(prompt))
        if enc.version == 2 and opened.role != "admin":
            raise Fail("Changing the family password of a two-password trip needs the admin password.")
        new = _new_password(enc, "admin", "New family password: ")
        vault.set_family_password(opened, new).save(path)
        print(f"Saved {_rel(project, path)}. Phones will say the password has changed and ask for the new one.")
    print("Commit and push it to update the site.")


def _github_repo(folder: Path) -> str | None:
    """'owner/name' of the folder's origin remote on GitHub, if any."""
    if not folder.is_dir():
        return None
    url = _git(folder, "remote", "get-url", "origin").stdout.strip()
    match = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$", url)
    return match.group(1) if match else None


def _current_branch(folder: Path) -> str | None:
    if not folder.is_dir():
        return None
    branch = _git(folder, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    return branch if branch and branch != "HEAD" else None


def _mask(token: str) -> str:
    return f"{token[:15]}...{token[-4:]}" if len(token) > 24 else "(set)"


def _print_admin(config: dict[str, Any]) -> None:
    site, data = config.get("site", {}), config.get("data", {})
    print("GitHub settings in trip.enc (only the admin password opens them):")
    print(f"  token        {_mask(config['token']) if config.get('token') else '(not set)'}")
    print(f"  site         {site.get('repo', '?')}  branch {site.get('branch', '?')}  file {site.get('path', '?')}")
    folder = data.get("path") or "(root)"
    print(f"  trip data    {data.get('repo', '?')}  branch {data.get('branch', '?')}  folder {folder}")
    if config.get("api", DEFAULT_API) != DEFAULT_API:
        print(f"  api          {config['api']}")


DEFAULT_API = "https://api.github.com"


def cmd_admin(project: Project, args: argparse.Namespace) -> None:
    path = _enc_path(project, args)
    enc = vault.EncFile.load(path)
    if enc.version != 2:
        raise Fail("This trip has only a family password. Add the admin password first: trip password admin")
    opened = vault.unlock(enc, vault.ask_password("Admin password: "))
    if opened.role != "admin":
        raise Fail("That is the family password. The GitHub settings need the admin password.")
    config = opened.admin_config()
    if args.show:
        _print_admin(config)
        return

    site, data = dict(config.get("site", {})), dict(config.get("data", {}))
    site["repo"] = args.site_repo or site.get("repo") or _github_repo(project.root)
    site["branch"] = args.site_branch or site.get("branch") or "master"
    site["path"] = _rel(project, project.trip_enc) if path == project.trip_enc else site.get("path", "web/trip.enc")
    data["repo"] = args.data_repo or data.get("repo") or _github_repo(project.private)
    data["branch"] = args.data_branch or data.get("branch") or _current_branch(project.private) or "main"
    data["path"] = data.get("path", "")
    if not site["repo"] or not data["repo"]:
        raise Fail("Couldn't find the GitHub repositories from git. Give them: --site-repo OWNER/NAME --data-repo …")

    token = vault.ask_password(
        "GitHub token (press Enter to keep the current one): " if config.get("token") else "GitHub token: ",
        env=vault.TOKEN_ENV,
    ).strip()
    if token:
        if not token.startswith(("github_pat_", "ghp_")):
            print("Warning: that doesn't look like a GitHub token (they start with github_pat_).")
        config["token"] = token
    elif not config.get("token"):
        raise Fail("No token given. Nothing was changed.")
    config.update(site=site, data=data, api=args.api or config.get("api", DEFAULT_API))

    vault.set_admin_config(opened, config).save(path)
    _print_admin(config)
    print(f"Saved {_rel(project, path)}. Commit and push it; the app can then publish from admin mode.")


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
    s.add_argument("--new-password", action="store_true", help="set or change the family password (one-password trips)")
    s.add_argument("--link", metavar="SITE_URL", help="also print a setup link for this site")
    s.add_argument("--no-fetch", action="store_true", help="don't check GitHub for trip changes made in the app")
    s.set_defaults(func=cmd_build)

    s = sub.add_parser("password", help="change the family password, or add/change the admin password")
    s.add_argument("role", choices=["family", "admin"])
    s.add_argument("--enc", help="encrypted file (default: web/trip.enc)")
    s.set_defaults(func=cmd_password)

    s = sub.add_parser("admin", help="set the GitHub token and repositories the app's admin mode publishes to")
    s.add_argument("--show", action="store_true", help="only show the current settings (the token is masked)")
    s.add_argument("--enc", help="encrypted file (default: web/trip.enc)")
    s.add_argument("--site-repo", metavar="OWNER/NAME", help="repository of the site (default: this repo's origin)")
    s.add_argument("--site-branch", help="its branch (default: master)")
    s.add_argument(
        "--data-repo", metavar="OWNER/NAME", help="private trip data repository (default: private/'s origin)"
    )
    s.add_argument("--data-branch", help="its branch (default: private/'s current branch)")
    s.add_argument("--api", help=f"GitHub API address (default: {DEFAULT_API}; for testing)")
    s.set_defaults(func=cmd_admin)

    s = sub.add_parser("link", help="print a setup link that opens the app without typing the password")
    s.add_argument("site", metavar="SITE_URL", help="e.g. https://you.github.io/parent-trip-app/")
    s.add_argument("--enc", help="encrypted file (default: web/trip.enc)")
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
