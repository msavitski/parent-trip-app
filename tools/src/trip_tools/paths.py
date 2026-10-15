"""Where things live in the repository."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

MARKER = Path("web") / "sw.js"


class ProjectNotFound(Exception):
    pass


def find_root(start: Path | None = None) -> Path:
    """The repository root: the nearest folder (from `start` upwards) that contains web/sw.js."""
    here = (start or Path.cwd()).resolve()
    for folder in (here, *here.parents):
        if (folder / MARKER).is_file():
            return folder
    raise ProjectNotFound(
        f"No {MARKER.as_posix()} found in {here} or any folder above it. Run this inside the repository."
    )


@dataclass(frozen=True)
class Project:
    root: Path

    @property
    def web(self) -> Path:
        """The published site."""
        return self.root / "web"

    @property
    def trip_enc(self) -> Path:
        return self.web / "trip.enc"

    @property
    def service_worker(self) -> Path:
        return self.web / "sw.js"

    @property
    def private(self) -> Path:
        """Your real trip (git-ignored)."""
        return self.root / "private"

    @property
    def example(self) -> Path:
        """The committed demo trip."""
        return self.root / "example"

    @property
    def schema_file(self) -> Path:
        return self.root / "schema" / "trip.schema.json"

    def app_strings(self, lang: str) -> Path:
        """Interface words (public)."""
        return self.web / "locales" / lang / "app.json"

    def resolve(self, path: str | Path) -> Path:
        """A path given on the command line: absolute, or relative to the current folder, else to the root."""
        p = Path(path)
        if p.is_absolute():
            return p
        if p.exists():
            return p.resolve()
        return self.root / p


@dataclass(frozen=True)
class DataDir:
    """A trip data folder: private/ or example/."""

    path: Path

    @property
    def trip_file(self) -> Path:
        return self.path / "trip.json5"

    def trip_strings(self, lang: str) -> Path:
        """Trip words (encrypted into trip.enc)."""
        return self.path / "locales" / lang / "trip.json"

    def languages_on_disk(self) -> list[str]:
        folder = self.path / "locales"
        return sorted(p.name for p in folder.iterdir() if p.is_dir()) if folder.is_dir() else []
