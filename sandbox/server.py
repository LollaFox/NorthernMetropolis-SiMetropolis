"""Run locally with python3 -m sandbox.server --port 8877."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

# Direct script execution resolves the package from this file, regardless of cwd.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "sandbox"

from . import engine
from . import v3_gateway
from .ai import Provider
from .service import CityService


WEB = Path(__file__).resolve().parent / "web"


class Handler(BaseHTTPRequestHandler):
    server_version = "LivingCity/2.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(8)

    def log_message(self, format, *args):
        # Do not print request bodies, provider errors, user text or credentials.
        pass

    def _json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _local_request(self):
        host = self.headers.get("Host", "")
        allowed = {"127.0.0.1:%s" % self.server.server_port, "localhost:%s" % self.server.server_port}
        if host not in allowed:
            self._json(403, {"error": "This game accepts local requests only"})
            return False
        origin = self.headers.get("Origin")
        if origin and origin != "http://" + host:
            self._json(403, {"error": "Use the game's own local page"})
            return False
        return True

    def do_GET(self):
        if not self._local_request():
            return
        path = urlsplit(self.path).path
        if path.startswith("/api/v3/"):
            v3_gateway.handle(self)
            return
        if path == "/api/state":
            self._json(200, self.server.city.state())
        elif path == "/api/model":
            self._json(200, engine.model_document())
        elif path == "/api/export":
            self._json(200, self.server.city.export())
        elif path == "/api/health":
            self._json(200, {"version": "2.0.0", "ok": True})
        elif path.startswith("/api/"):
            self._json(404, {"error": "API endpoint not found"})
        else:
            self._static(path)

    def do_POST(self):
        if not self._local_request():
            return
        path = urlsplit(self.path).path
        if path.startswith("/api/v3/"):
            v3_gateway.handle(self)
            return
        actions = {"/api/" + name: name for name in ("control", "intervention", "seek", "branch", "switch", "reset", "mode")}
        if path not in actions:
            self._json(404, {"error": "API endpoint not found"})
            return
        try:
            if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                raise engine.ValidationError("Content-Type must be application/json")
            length = int(self.headers.get("Content-Length", "-1"))
            if not 0 <= length <= 16_384:
                raise engine.ValidationError("Request must contain no more than 16 KB")
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise engine.ValidationError("Request body was incomplete")
            body = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Use finite numbers")))
            result = self.server.city.command(actions[path], body)
            self._json(200, result)
        except (ValueError, UnicodeDecodeError, TimeoutError) as exc:
            message = str(exc) if isinstance(exc, engine.ValidationError) else "Invalid JSON request"
            self._json(400, {"error": message})
        except Exception:
            self._json(500, {"error": "The action could not be completed. Your saved history remains available."})

    def _static(self, path):
        target = (WEB / ("index.html" if path == "/" else unquote(path).lstrip("/"))).resolve()
        try:
            target.relative_to(WEB.resolve())
            if not target.is_file():
                raise ValueError()
        except ValueError:
            self._json(404, {"error": "File not found"})
            return
        data = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)


def make_server(port=8877, service=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.city = service if service is not None else CityService(provider=Provider())
    return server


def main():
    parser = argparse.ArgumentParser(description="Northern Metropolis living city v2")
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--save", default=str(Path(__file__).resolve().parent / ".data" / "city.json"))
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--live-request-limit", type=int, default=24)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 0 <= args.live_request_limit <= 100:
        parser.error("port must be 1–65535 and live-request-limit 0–100")
    try:
        city = CityService(provider=Provider(), save_path=None if args.no_save else args.save,
                           live_limit=args.live_request_limit)
    except (ValueError, OSError):
        print("Could not load the existing save. It was preserved. Use --no-save to inspect a new city.", file=sys.stderr)
        return 1
    server = make_server(args.port, city)
    print("Living City v2: http://127.0.0.1:%s (rules mode; live decisions require explicit selection)" % args.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        city.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
