"""`trip serve`: the site on http://localhost for trying it out.

Differences from `python -m http.server`:
- correct content types everywhere (some Windows setups serve .js as text/plain, which breaks modules);
- no browser caching, so every reload shows your latest change;
- `--enc FILE` serves another trip.enc (for example a demo build) without touching web/trip.enc.
"""

from __future__ import annotations

import contextlib
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar
from urllib.parse import urlsplit

TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".enc": "application/octet-stream",
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map: ClassVar[dict[str, str]] = {**SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def __init__(self, *args, enc: Path | None = None, **kwargs):
        self.enc = enc
        super().__init__(*args, **kwargs)

    def translate_path(self, path: str) -> str:
        if self.enc and urlsplit(path).path.endswith("/trip.enc"):
            return str(self.enc)
        return super().translate_path(path)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(web: Path, host: str = "127.0.0.1", port: int = 8000, enc: Path | None = None) -> None:
    handler = functools.partial(Handler, directory=str(web), enc=enc)
    with ThreadingHTTPServer((host, port), handler) as server:
        shown = "localhost" if host in ("127.0.0.1", "0.0.0.0") else host
        print(f"Serving {web} at http://{shown}:{port}/" + (f" (trip.enc from {enc})" if enc else ""))
        print("Press Ctrl+C to stop.")
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()
