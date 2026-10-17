"""One-command local host for unchanged frontend and durable narrative API.

python3 -m backend.server --port 8877
Default startup includes a clearly labelled, fully offline 12-month demo.
"""
from __future__ import annotations

import argparse
from email import policy
from email.parser import BytesParser
from http.server import ThreadingHTTPServer
import hashlib
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import unquote, urlsplit

try:
    from sandbox.server import Handler as StaticHandler
except ModuleNotFoundError as exc:
    if exc.name not in ("sandbox", "sandbox.server"):
        raise
    from frontend.sandbox.server import Handler as StaticHandler
from . import engine
from .ai import OfflineProvider
from .cli import add_pacing_arguments, add_provider_arguments, add_scenario_arguments, configured_provider_factory, configured_scenario, default_run_end
from .service import NarrativeService, ServiceError, canonical


MAX_UPLOAD = 21 * 1024 * 1024
KINDS = {"residential": "housing", "business": "office", "park": "park", "station": "transit"}
DISPLAY_LIMITS = [
    "The city overview is a decorative projection of canonical saved states onto the existing 132 frontend sites. Stable (y,x,id) order preserves placement when schedules change, but visible distances and district labels are not simulation coordinates.",
    "Tower mesh heights are synthetic display units, not terrain elevations or measured building heights. V3 results show footprint zones only.",
    "The inherited housing capacity label says homes; its number here means resident places, not households or dwelling units. Station and park display capacity is zero because their effect is not a passenger/area capacity model.",
    "Climate, emissions, electricity and public treasury are unmodeled. Null canonical display values may appear as zero in the inherited UI; those zeros are presentation fallbacks, not observations.",
    "The existing policy/rules overlays are separate legacy demos. Narrative scenario controls replay saved months and never invoke the old dynamic engine. Use Team API plus review/confirmation to run the narrative model.",
]


def seed_offline_demo(service):
    """Idempotently produce the default illustrative saved city without live AI."""
    digest = hashlib.sha256(canonical(service.config)).hexdigest()[:16]
    setup = {"bounds": {"west": 114.0, "south": 22.45, "east": 114.2, "north": 22.6},
             "start": "2025-01-01", "end": default_run_end("2025-01-01", service.config), "step": "month",
             "policyScope": {"policyId": "offline-narrative-demo", "tags": ["housing-affordability"]}}
    review = service.initialize(setup, b"%PDF-1.4\nSynthetic offline demo; no policy extraction.\n", "offline-demo.pdf", "demo_init_" + digest)
    service.confirm(review["initializationId"], {"reviewVersion": review["reviewVersion"]}, "demo_confirm_" + digest)
    result = service.simulate({"initializationId": review["initializationId"], "reviewVersion": review["reviewVersion"]},
                              "demo_run_" + digest, provider_factory=OfflineProvider)
    deadline = time.monotonic() + 60
    while result["status"] in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.02)
        result = service.job(result["jobId"])
    if result["status"] != "complete":
        raise RuntimeError("Offline demo could not complete; inspect the saved job state.")
    return result["result"]["simulationId"]


class SavedCity:
    """Legacy frontend envelope sourced only from new engine saved states."""
    def __init__(self, service):
        self.service = service
        self.lock = threading.RLock()
        self.active = None
        self.viewing = None
        self.playing = False
        self.speed = 1
        self.last_tick = time.monotonic()
        self.follow_latest = True
        self._world_cache = {}

    def _world(self, simulation_id, day):
        key = (simulation_id, day)
        if key not in self._world_cache:
            self._world_cache[key] = self.service._load_world(simulation_id, day)
        return self._world_cache[key]

    def _runs(self):
        with self.service.lock:
            return [(identifier, {"months": list(run["months"])}) for identifier, run in sorted(
                    self.service.catalog["simulations"].items(), key=lambda pair: pair[1].get("createdOrder", 0))
                    if run["months"]]

    def _select(self):
        runs = self._runs()
        if not runs:
            return None, []
        if self.active is None or self.follow_latest:
            newest = runs[-1][0]
            if newest != self.active:
                self.active, self.viewing, self.playing = newest, 0, False
        run = next((run for identifier, run in runs if identifier == self.active), None)
        if run is None:
            self.active, run = runs[-1]
        return run, runs

    def _project(self, world):
        month = max(0, world["step"] - 1)
        source_date = world.get("month") or "2025-01-01"
        year = int(source_date[:4])
        # Frontend uses zero-based months relative to the year, independent of
        # canonical date anchor. Extra sourceDate preserves exact date.
        absolute_start = year * 12 + int(source_date[5:7]) - 1 - month
        origin_month = absolute_start % 12
        display_month = month + origin_month
        columns = [-44, -36, -28, -20, -12, -4, 4, 12, 28, 36, 44]
        sites = [(x, -44 + row * 8) for x in columns for row in range(12)]
        ordered = sorted(world["config"]["buildings"], key=lambda b: (b["y"], b["x"], b["id"]))
        positions = {b["id"]: sites[index] for index, b in enumerate(ordered[:len(sites)])}
        buildings = []
        firms = {firm["towerId"]: firm for firm in world["firms"]}
        for building in world["buildings"]:
            if building["status"] == "planned" or building["id"] not in positions:
                continue
            x, z = positions[building["id"]]
            firm = firms.get(building["id"])
            kind = building["type"]
            span = max(1, building["completionMonth"] - building["startMonth"] + 1)
            progress = 1 if building["status"] == "complete" else min(.95, max(.08, (world["step"] - building["startMonth"] + .5) / span))
            capacity = (world["config"]["groupSize"] * world["config"]["towerGroupSlots"] if kind == "residential"
                        else firm["jobCapacity"] if firm else 0)
            buildings.append({"id": building["id"], "kind": KINDS[kind], "x": x, "z": z,
                              "height": {"residential": 18, "business": 26, "park": .6, "station": 3.2}[kind],
                              "progress": progress, "capacity": capacity, "baseCapacity": capacity,
                              "owner": "business" if kind == "business" else "government", "upgrades": 0,
                              "createdMonth": building["startMonth"] - 1 + origin_month,
                              "startedMonth": building["startMonth"] - 1 + origin_month,
                              "constructionMonths": span, "constructionCostM": 0,
                              "canonicalCell": [building["x"], building["y"]], "syntheticNarrative": building.get("narrative")})
        metrics = world["metrics"]
        visible = {"population": metrics["population"], "jobs": metrics["jobCapacity"],
                   "homes": metrics["residentialTowers"] * world["config"]["groupSize"] * world["config"]["towerGroupSlots"],
                   "happiness": metrics["meanSatisfaction"], "treasuryM": None, "businessCashM": None,
                   "airQuality": None, "emissions": None, "powerDemand": None, "powerCapacity": None}
        message = {"id": "display_limits", "month": display_month, "source": "system", "action": "projection",
                   "sourceType": "offline", "text": "Synthetic narrative scenario: saved monthly replay. Display sites are decorative; housing capacity means resident places. Climate/finance panels are unmodeled. Canonical state is available via /api/v3/simulations/{id}/export."}
        if world.get("model") == "hk-fiscal-v1":
            visible["homes"] = sum(engine.building_totals(world,b)["housingCapacity"] for b in world["buildings"])
            visible["treasuryM"] = (world["fiscal"]["closing_project_budget"] if world["fiscal"] else world["config"]["fiscal"]["settings"]["parameters"]["initial_budget"])/1e6
            message["text"] = "Fiscal experiment replay. Treasury means the hypothetical project budget, not a Northern Metropolis government treasury. Full fiscal results are in Team API results."
        return {"version": "narrative-display-1", "seed": 42, "month": display_month, "year": year,
                "sourceDate": source_date, "sourceStep": world["step"], "buildings": buildings,
                "metrics": visible, "policies": {}, "actors": [], "messages": [message], "events": [],
                "objectives": [], "ledger": [], "displayLimitations": DISPLAY_LIMITS,
                "unrenderedBuildings": max(0, len(ordered) - len(sites))}

    def state(self):
        with self.lock:
            run, runs = self._select()
            if run is None:
                world = engine.create_world(self.service.config)
                worlds = [world]
            else:
                worlds = [self._world(self.active, day) for day in run["months"]]
                if self.playing:
                    elapsed = int((time.monotonic() - self.last_tick) * self.speed / 1.6)
                    if elapsed:
                        self.viewing = min(len(worlds) - 1, (self.viewing or 0) + elapsed)
                        self.last_tick = time.monotonic()
                        if self.viewing == len(worlds) - 1:
                            self.playing, self.viewing = False, None
                world = worlds[-1] if self.viewing is None else worlds[self.viewing]
            projected = self._project(world)
            timeline = [{"month": self._project(item)["month"], "population": item["metrics"]["population"],
                         "buildings": len([b for b in item["buildings"] if b["status"] != "planned"]),
                         "happiness": item["metrics"]["meanSatisfaction"]} for item in worlds]
            return {"id": self.active or "empty", "label": "Narrative scenario · synthetic saved replay",
                    "parentId": None, "world": projected, "playing": self.playing, "speed": self.speed,
                    "mode": "rules", "ai": {"available": False, "status": "rules", "requests": 0, "errors": 0},
                    "viewingMonth": projected["month"] if self.viewing is not None else None, "storageError": None,
                    "timeline": timeline, "branches": [{"id": ident, "label": "Narrative saved run · %s" % ident[-6:],
                                                        "month": len(item["months"]) - 1, "parentId": None} for ident, item in runs]}

    def command(self, action, body):
        if not isinstance(body, dict):
            raise ServiceError("Expected a JSON object.")
        with self.lock:
            run, runs = self._select()
            if action == "control":
                if not body or set(body) - {"playing", "speed"}:
                    raise ServiceError("Control accepts playing and speed.")
                if "playing" in body and type(body["playing"]) is not bool:
                    raise ServiceError("playing must be boolean.")
                if "speed" in body and (type(body["speed"]) not in (int, float) or body["speed"] not in (.5, 1, 2, 4, 8)):
                    raise ServiceError("Choose speed 0.5, 1, 2, 4 or 8.")
                self.speed = body.get("speed", self.speed)
                if "playing" in body:
                    if body["playing"] and not run:
                        raise ServiceError("Run a confirmed Team API scenario before replaying saved months.")
                    self.playing = body["playing"]
                    if self.playing and self.viewing is None:
                        self.viewing = 0
                    # An explicit playback command belongs to the selected run.
                    # Pausing an older saved run must not switch to the newest.
                    self.follow_latest = False
                self.last_tick = time.monotonic()
            elif action == "seek":
                if set(body) != {"month"} or type(body["month"]) is not int or not run:
                    raise ServiceError("Seek requires a saved month.")
                first = self._project(self._world(self.active, run["months"][0]))["month"]
                index = body["month"] - first
                if not 0 <= index < len(run["months"]):
                    raise ServiceError("That month has not been saved.")
                self.viewing, self.playing, self.follow_latest = index, False, False
            elif action == "switch":
                if set(body) != {"id"} or body["id"] not in {ident for ident, _ in runs}:
                    raise ServiceError("Unknown saved run.")
                self.active, self.viewing, self.playing, self.follow_latest = body["id"], None, False, False
            elif action == "mode" and body == {"mode": "rules"}:
                pass
            else:
                raise ServiceError("This overview replays the narrative engine's saved states. Use Team API setup and confirmation for a new scenario; legacy interventions, branches and autonomous modes are unavailable.", 409)
            return self.state()

    def export(self):
        with self.lock:
            self._select()
            if self.active is None:
                return {"displayLimitations": DISPLAY_LIMITS, "monthlyStates": []}
            return self.service.export(self.active)

    def close(self):
        self.playing = False


def parse_multipart(content_type, body):
    message = BytesParser(policy=policy.default).parsebytes(("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode("ascii") + body)
    if not message.is_multipart() or message.defects:
        raise ServiceError("Invalid multipart form upload.")
    fields = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if part.get_content_disposition() != "form-data" or name not in ("metadata", "plan") or name in fields or part.is_multipart() or part.defects:
            raise ServiceError("Upload exactly metadata and plan fields.")
        fields[name] = (part.get_payload(decode=True), part.get_filename())
    if set(fields) != {"metadata", "plan"} or len(fields["metadata"][0]) > 65536:
        raise ServiceError("Upload metadata up to 64 KB and one PDF plan.")
    metadata = json.loads(fields["metadata"][0].decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    return metadata, fields["plan"][0], fields["plan"][1]


class Handler(StaticHandler):
    server_version = "NarrativeCity/1.0"

    def _body(self, expected, maximum):
        if self.headers.get("Transfer-Encoding"):
            raise ServiceError("Transfer-Encoding is unsupported; send Content-Length.")
        length = int(self.headers.get("Content-Length", "-1"))
        if not 0 < length <= maximum:
            raise ServiceError("Missing or oversized request body.", 413)
        content_type = self.headers.get("Content-Type", "")
        if content_type.split(";", 1)[0].strip().lower() != expected:
            raise ServiceError("Unexpected request content type.", 415)
        body = self.rfile.read(length)
        if len(body) != length:
            raise ServiceError("Incomplete request body.")
        return content_type, body

    def _json_body(self):
        _, body = self._body("application/json", 65536)
        return json.loads(body.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))

    def _api(self, path):
        service = self.server.narrative
        key = self.headers.get("Idempotency-Key", "")
        if self.command == "GET" and path == "/config":
            return 200, {"schema": "nm-v3-draft-1", "backendConfigured": True, "transport": "local-narrative-scenario",
                         "tileURL": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "synthetic": True,
                         "productVersion": "government-integrated-1",
                         "governmentLiveAvailable": bool(getattr(service.provider_factory, "configuration", {}).get("live")),
                         "governmentModel": getattr(service.provider_factory, "configuration", {}).get("model")}
        if self.command == "POST" and path == "/initializations":
            content_type, raw = self._body("multipart/form-data", MAX_UPLOAD)
            return 200, service.initialize(*parse_multipart(content_type, raw), key)
        match = re.fullmatch(r"/initializations/([A-Za-z0-9_-]{1,100})/confirm", path)
        if self.command == "POST" and match:
            return 200, service.confirm(match.group(1), self._json_body(), key)
        if self.command == "GET" and path == "/simulations":
            return 200, service.list_simulations()
        if self.command == "POST" and path == "/simulations":
            return 202, service.simulate(self._json_body(), key)
        match = re.fullmatch(r"/jobs/([A-Za-z0-9_-]{1,100})", path)
        if self.command == "GET" and match:
            return 200, service.job(match.group(1))
        match = re.fullmatch(r"/simulations/([A-Za-z0-9_-]{1,100})/snapshots/([A-Za-z0-9_-]{1,100})", path)
        if self.command == "GET" and match:
            return 200, service.get_snapshot(*match.groups())
        match = re.fullmatch(r"/simulations/([A-Za-z0-9_-]{1,100})/export", path)
        if self.command == "GET" and match:
            return 200, service.export(match.group(1))
        raise ServiceError("API endpoint not found.", 404)

    def _dispatch(self):
        if not self._local_request():
            return
        path = urlsplit(self.path).path
        try:
            if path.startswith("/api/v3/"):
                status, result = self._api(path[len("/api/v3"):])
            elif path.startswith(("/initializations", "/simulations", "/jobs/")) or path == "/config":
                status, result = self._api(path)
            elif self.command == "GET" and path == "/api/state":
                status, result = 200, self.server.city.state()
            elif self.command == "GET" and path == "/api/model":
                status, result = 200, {"version": "narrative-city-1", "assumptions": DISPLAY_LIMITS,
                                       "description": "Synthetic narrative scenario and saved replay. Canonical numbers are owned by backend.engine.",
                                       "scale": self.server.narrative.config.get("scale"),
                                       "populationAccounting": ["Housing capacity is available resident places; actual population is the settled groups, never forced to a reference target.",
                                                                "Offered jobs, filled jobs and vacancies are distinct. Potential workers without an allocated modeled position are not measured real-world unemployment.",
                                                                "Regional objects represent development clusters, not individual physical towers; display locations remain schematic."],
                                       "limitations": DISPLAY_LIMITS}
            elif self.command == "GET" and path == "/api/export":
                status, result = 200, self.server.city.export()
            elif self.command == "GET" and path == "/api/health":
                status, result = 200, {"ok": True, "version": "narrative-city-1", "synthetic": True}
            elif self.command == "POST" and path.startswith("/api/"):
                status, result = 200, self.server.city.command(path[len("/api/"):], self._json_body())
            elif path.startswith("/api/") or self.command != "GET":
                raise ServiceError("API endpoint not found.", 404)
            else:
                self._static(unquote(path))
                return
            self._json(status, result)
        except ServiceError as exc:
            self._json(exc.status, {"error": str(exc)})
        except (ValueError, UnicodeError, TypeError, KeyError, TimeoutError):
            self._json(400, {"error": "Invalid or incomplete request."})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._json(500, {"error": "The action could not complete. Saved monthly states remain available."})

    def do_GET(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()


def make_server(port=8877, service=None, data_dir=None, demo=True):
    service = service or NarrativeService(data_dir or Path(__file__).resolve().parent / ".data")
    if demo:
        seed_offline_demo(service)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.narrative = service
    server.city = SavedCity(service)
    return server


def main():
    parser = argparse.ArgumentParser(description="Narrative Northern Metropolis exploratory sandbox")
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--data-dir", default=str(Path(__file__).resolve().parent / ".data"))
    add_scenario_arguments(parser)
    add_provider_arguments(parser)
    add_pacing_arguments(parser)
    parser.add_argument("--no-demo", action="store_true", help="Skip the labelled offline 12-month startup demonstration")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be 0–65535")
    try:
        scenario = configured_scenario(args)
        factory = configured_provider_factory(args)
        factory.configuration["governmentOnly"] = True
        service = NarrativeService(args.data_dir, provider_factory=factory, scenario=scenario)
        server = make_server(args.port, service=service, demo=not args.no_demo)
    except Exception as exc:
        print(json.dumps({"status": "startup_failed", "failureType": type(exc).__name__}))
        return 1
    print("Narrative city: http://127.0.0.1:%s · %s · synthetic, not a forecast" %
          (server.server_port, "%s %s · %s credential slots; startup demo remains offline" %
           (factory.configuration["provider"], factory.configuration["model"], factory.configuration["credentialSlots"])), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        service.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
