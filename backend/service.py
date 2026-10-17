"""Durable local initialization, confirmation, jobs and monthly state storage."""
from __future__ import annotations

import calendar
import copy
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import threading
import time
import uuid

from . import engine, snapshots
from .scenario import default_scenario, validate_scenario
from .layout_scenarios import layout_scenario
from .storage import StorageError, atomic_write_json, monthly_state_path, read_json, write_monthly_state


STEPS = {"month": 1, "quarter": 3, "year": 12}
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")


class ServiceError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def parse_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ServiceError("Use a valid ISO date.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ServiceError("Use a valid ISO date.")
    if parsed.isoformat() != value:
        raise ServiceError("Use a valid ISO date.")
    return parsed


def schedule(start, end, step="month", limit=None):
    """Use the original anchor day, including Jan31 → Feb28 → Mar31."""
    origin, last = parse_date(start), parse_date(end)
    if not isinstance(step, str) or step not in STEPS or last < origin:
        raise ServiceError("Use a supported step and an end date on or after start.")
    result = []
    n = 0
    while True:
        absolute = origin.year * 12 + origin.month - 1 + n * STEPS[step]
        year, month0 = divmod(absolute, 12)
        if year > 9999:
            break
        candidate = date(year, month0 + 1, min(origin.day, calendar.monthrange(year, month0 + 1)[1]))
        if candidate > last:
            break
        result.append(candidate.isoformat())
        if limit is not None and len(result) > limit:
            raise ServiceError("This preview supports at most %s snapshots per run." % limit)
        n += 1
    return result


def validate_setup(value, today=None):
    if not isinstance(value, dict):
        raise ServiceError("Metadata must be a JSON object.")
    bounds = value.get("bounds")
    if not isinstance(bounds, dict) or not all(type(bounds.get(k)) in (int, float) and math.isfinite(bounds[k])
                                               for k in ("west", "east", "south", "north")):
        raise ServiceError("Enter all four finite geographic bounds.")
    if not (113.7 <= bounds["west"] < bounds["east"] <= 114.7 and
            22.1 <= bounds["south"] < bounds["north"] <= 22.9):
        raise ServiceError("Select a rectangle within the Hong Kong–Shenzhen study extent.")
    if value.get("constructionScenario", "configured") not in ("configured", "segregated", "mixed"):
        raise ServiceError("Unknown construction scenario.")
    if type(value.get("fiscalEnabled", False)) is not bool:
        raise ServiceError("fiscalEnabled must be boolean")
    if value.get("governmentMode", "fixed") not in ("fixed", "offline-test", "live"):
        raise ServiceError("Unknown government mode")
    if value.get("governmentMode", "fixed") != "fixed" and not value.get("fiscalEnabled"):
        raise ServiceError("Government decisions require the fiscal model")
    start, end = value.get("start"), value.get("end")
    if "policyScope" in value and not isinstance(value["policyScope"], dict):
        raise ServiceError("policyScope must be a JSON object.")
    parsed = parse_date(start)
    today = today or (datetime.now(timezone.utc) + timedelta(hours=8)).date().isoformat()
    if parsed >= parse_date(today):
        raise ServiceError("The simulation start must be before today (Hong Kong time).")
    schedule(start, end, value.get("step"), limit=240)
    result = copy.deepcopy(value)
    result["bounds"] = {k: bounds[k] for k in ("west", "south", "east", "north")}
    result["crs"] = "EPSG:4326"
    result["vertices"] = [[bounds["west"], bounds["north"]], [bounds["east"], bounds["north"]],
                          [bounds["east"], bounds["south"]], [bounds["west"], bounds["south"]]]
    try:
        if len(canonical(result)) > 65536:
            raise ServiceError("Metadata exceeds 64 KB.")
    except (ValueError, TypeError, UnicodeError):
        raise ServiceError("Metadata must contain finite JSON values and valid Unicode.")
    return result


def atomic_write(path, value):
    """Plain catalog writer retained for API compatibility."""
    return atomic_write_json(path, value)


def building_totals_export(world):
    """Small derived tables belong in exports, outside canonical audit worlds."""
    return {"date": world["month"], "buildings": [
        {"id": building["id"], "type": building["type"], "x": building["x"], "y": building["y"],
         **engine.building_totals(world, building["id"])} for building in world["buildings"]]}


def combine_metrics(previous, current):
    """Keep checkpointed usage across resumed provider sessions."""
    old, new = previous.get("summary", {}), current.get("summary", {})
    summary = copy.deepcopy(new or old)
    for key in ("callCount", "attemptCount", "successfulCalls", "inputBytes", "latencyMs"):
        summary[key] = old.get(key, 0) + new.get(key, 0)
    for key in ("statuses", "usage"):
        summary[key] = {name: old.get(key, {}).get(name, 0) + new.get(key, {}).get(name, 0)
                        for name in set(old.get(key, {})) | set(new.get(key, {}))}
    summary["usageAvailable"] = bool(old.get("usageAvailable") or new.get("usageAvailable"))
    summary["interruptedUncheckpointedUsage"] = "unknown; a remote call interrupted before a monthly checkpoint may be repeated on explicit retry"
    return {"attempts": copy.deepcopy(previous.get("attempts", [])) + copy.deepcopy(current.get("attempts", [])),
            "summary": summary}


class NarrativeService:
    """One process owns a data directory. No provider calls occur on restore.

    A restarted in-flight job becomes explicitly recoverable. Repeating its
    POST with the original operation key resumes its exact saved simulation.
    A provider call interrupted before a monthly checkpoint can be repeated;
    remote execution and the filesystem cannot share an atomic transaction.
    """

    def __init__(self, data_dir, provider_factory=None, scenario=None, today=None):
        if provider_factory is None:
            from .ai import OfflineProvider
            provider_factory = OfflineProvider
        self.provider_factory = provider_factory
        self.config = validate_scenario(scenario if scenario is not None else default_scenario())
        self.today = today
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.catalog_path = self.data_dir / "catalog.json"
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.threads = {}
        if self.catalog_path.exists():
            self.catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))
            if self.catalog.get("schemaVersion") != 1:
                raise ValueError("Unsupported backend catalog; existing data was preserved.")
        else:
            self.catalog = {"schemaVersion": 1, "initializations": {}, "jobs": {}, "simulations": {}, "idempotency": {}}
        interrupted = False
        for job in self.catalog["jobs"].values():
            if job["status"] in ("queued", "running"):
                job.update(status="failed", recoverable=True,
                           error="Server restarted during this run. Retry analysis with the same operation key to resume saved months.")
                interrupted = True
        if interrupted or not self.catalog_path.exists():
            self._save()

    def _save(self):
        atomic_write(self.catalog_path, self.catalog)

    def _operation(self, route, key, payload):
        if not isinstance(key, str) or not IDENTIFIER.fullmatch(key):
            raise ServiceError("A valid Idempotency-Key is required.")
        digest = hashlib.sha256(canonical({"route": route, "payload": payload})).hexdigest()
        previous = self.catalog["idempotency"].get(key)
        if previous and previous["fingerprint"] != digest:
            raise ServiceError("This operation key was already used for different input.", 409)
        return digest, previous

    def _remember(self, key, digest, result):
        self.catalog["idempotency"][key] = {"fingerprint": digest, "response": copy.deepcopy(result)}
        self._save()
        return copy.deepcopy(result)

    def initialize(self, metadata, pdf, filename, key):
        setup = validate_setup(metadata, self.today)
        selected = setup.get("constructionScenario", "configured")
        config = copy.deepcopy(self.config) if selected == "configured" else layout_scenario(selected)
        if setup.get("fiscalEnabled"):
            from .fiscal_engine import configured
            try:
                config["fiscal"] = configured(setup)
                mode = setup.get("governmentMode", "fixed")
                if mode != "fixed":
                    if mode == "live" and not getattr(self.provider_factory, "configuration", {}).get("live"):
                        raise ValueError("Live government is not configured. Start the server with a live provider and a backend credential file.")
                    config["fiscal"]["governmentMode"] = mode
                    config["fiscal"]["settings"]["governmentHorizon"] = len(schedule(setup["start"], setup["end"]))
                if len(schedule(setup["start"], setup["end"])) > 120:
                    raise ValueError("Fiscal experiments support at most 120 monthly steps")
            except (ValueError, TypeError, KeyError) as exc:
                raise ServiceError(str(exc)) from None
        if not isinstance(pdf, bytes) or not 0 < len(pdf) <= 20 * 1024 * 1024 or not pdf.startswith(b"%PDF-"):
            raise ServiceError("Choose a PDF with a PDF signature, up to 20 MB.")
        if not isinstance(filename, str) or len(filename) > 200 or not filename.lower().endswith(".pdf"):
            raise ServiceError("The plan needs a .pdf filename up to 200 characters.")
        # Multipart boundary, header order, filename and JSON whitespace do not
        # identify the operation. Browser retries rebuild multipart boundaries.
        fingerprint = {"setup": setup, "pdfSHA256": hashlib.sha256(pdf).hexdigest()}
        with self.lock:
            digest, previous = self._operation("initializations", key, fingerprint)
            if previous:
                return copy.deepcopy(previous["response"])
            identifier, version = "init_" + uuid.uuid4().hex, "review_" + uuid.uuid4().hex
            review = {"initializationId": identifier, "reviewVersion": version,
                      "items": self._review_items(setup, filename, fingerprint["pdfSHA256"], config)}
            self.catalog["initializations"][identifier] = {"setup": setup, "review": review, "confirmed": False,
                                                         "scenario": copy.deepcopy(config), "pdf": {"filename": filename,
                                                         "sha256": fingerprint["pdfSHA256"], "bytes": len(pdf)}}
            return self._remember(key, digest, review)

    def _review_items(self, setup, filename, digest, config=None):
        config = self.config if config is None else config
        if "fiscal" in config:
            f = config["fiscal"]
            settings = f["settings"]
            values = [{"id":"fiscal_model", "field":"Fiscal model / 财政居民实验", "kind":"assumption",
                       "description":"Deterministic monthly model; no AI calls. Frozen 2026/27 tax regime; monthly accrual is not actual tax collection. PDF and policy tags do not set fiscal policy.",
                       "value":config["name"] + "; " + settings["tax_regime"]}]
            for key, value in settings["parameters"].items():
                evidence=settings["parameter_evidence"][key]
                values.append({"id":"fiscal_"+key,"field":key,"kind":"assumption",
                    "description":evidence["status"]+": "+evidence["note"],"value":str(value)})
            for i, limitation in enumerate(settings["limits"]):
                values.append({"id":"fiscal_limit_"+str(i),"field":"Model boundary","kind":"assumption",
                    "description":limitation,"value":"Acknowledged experiment assumption"})
            values.append({"id":"fiscal_dates","field":"Schedule","kind":"assumption",
                "description":"Relative construction months; full layout takes 17 months. Existing population is a separate baseline object.",
                "value":setup["start"]+" through "+setup["end"]+"; sources: "+ ", ".join(settings["sources"].values())})
            mode = f.get("governmentMode", "fixed")
            if mode != "fixed":
                values[0]["description"] = "Government selects monthly project starts; residents, firms, fiscal settlement and construction use deterministic rules. PDF text is not interpreted."
                values[-1]["description"] = "Locations and durations are fixed; government chooses start dates. Completion within the selected horizon is not guaranteed."
                values.append({"id":"government_mode","field":"Government decisions","kind":"assumption",
                               "description":"Only government uses the provider. Failed or invalid decisions stop the job; saved months can be resumed.",
                               "value": "LIVE API: " + str(getattr(self.provider_factory, "configuration", {}).get("model")) if mode == "live" else "OFFLINE TEST — no model calls"})
            return values
        objects = config.get("construction", config.get("buildings", []))
        counts = {kind: sum(obj["type"] == kind for obj in objects) for kind in ("residential", "business", "park", "station")}
        items = [
            ("construction_layout", "政府建设情景 / Construction layout",
             "Two independent layouts; the selected script controls construction. PDF and policy tags do not override it.",
             config["name"] + "; months are relative to the start date. Layout experiments complete in month 17. API maps show completed footprints, not construction meshes."),
            ("authority", "Scenario authority and policy override", "The selected policy and uploaded PDF are request context, not an interpreted construction or economic instruction.",
             "Confirming explicitly runs the configured synthetic construction script instead. Selected policy: %s. Script: %s." %
             (str(setup.get("policyScope", {}).get("policyId", "unspecified"))[:150], ", ".join("%s %s" % (v, k) for k, v in counts.items()))),
            ("upload", "PDF provenance", "The server checked file signature and retained the content digest. It does not extract or interpret PDF text and does not send the PDF to AI.",
             "%s · SHA-256 %s · raw file not retained" % (filename, digest)),
            ("schedule", "Dates and monthly settlement", "Construction month 1 is the first requested date. All months settle internally; output dates follow the original anchor day with month-end clamping.",
             "%s through %s; output step %s; %s output frames." % (setup["start"], setup["end"], setup["step"], len(schedule(setup["start"], setup["end"], setup["step"])))),
            ("people", "Resident groups and jobs", "Four fictional preference profiles make district-wide decisions. Numerical bookkeeping and fixed group sizes belong to code.",
             "%s residents/group, %s potential workers, up to %s groups/tower with at most one group per profile, %s resident places/tower; deterministic job allocation; unemployment is explicit." %
             (config["groupSize"], config["groupWorkers"], config["towerGroupSlots"], config["groupSize"] * config["towerGroupSlots"])),
            ("economy", "Synthetic economic and satisfaction coefficients", "Preset firm GDP, profit, wage and capacity are scenario assumptions. More business towers mechanically increase GDP.",
             "Recomputed rent with next-month firm premiums; static firm capacity and wages; weighted synthetic satisfaction 0–100, null when unpopulated."),
        ]
        for index, limitation in enumerate(snapshots.LIMITATIONS):
            items.append(("limit_%s" % index, "Representation limit %s" % (index + 1), limitation, "Acknowledged scenario assumption; not an observed result."))
        items.append(("overview", "Decorative city overview", "The overview projects saved objects onto existing display sites in stable (y,x,id) order; visible distances and district labels do not represent canonical coordinates. V3 snapshots preserve canonical relative footprints.",
                      "Overview housing labels say homes but values mean resident places. Climate, power and treasury are unmodeled; inherited UI may display unavailable values as zero. Canonical exports retain full state and exact dates."))
        scale = config.get("scale")
        if scale:
            items.append(("regional_scale", "Regional development-cluster scale", scale["label"],
                          "Each modeled object is a development cluster, not a physical tower. Reference housing capacity %s and nominal jobs %s are scenario targets, not forced resident or employment outcomes. Actual residents, offered jobs and filled jobs are computed separately. Model workers without allocated positions are not measured real-world unemployment." %
                          (scale["referenceHousingCapacity"], scale["referenceJobs"])))
        return [{"id": ident, "field": field, "description": description, "kind": "assumption", "value": value}
                for ident, field, description, value in items]

    def confirm(self, initialization_id, body, key):
        if not isinstance(body, dict) or set(body) != {"reviewVersion"}:
            raise ServiceError("Confirmation requires reviewVersion.")
        with self.lock:
            digest, previous = self._operation("initializations/%s/confirm" % initialization_id, key, body)
            if previous:
                return copy.deepcopy(previous["response"])
            record = self.catalog["initializations"].get(initialization_id)
            if not record:
                raise ServiceError("Initialization not found.", 404)
            if body["reviewVersion"] != record["review"]["reviewVersion"]:
                raise ServiceError("The initialization review version changed.", 409)
            record["confirmed"] = True
            return self._remember(key, digest, {"confirmed": True, "reviewVersion": body["reviewVersion"]})

    def simulate(self, body, key, provider_factory=None):
        if not isinstance(body, dict) or set(body) != {"initializationId", "reviewVersion"}:
            raise ServiceError("Simulation requires initializationId and reviewVersion.")
        with self.lock:
            digest, previous = self._operation("simulations", key, body)
            if previous:
                job_id = previous["response"]["jobId"]
                job = self.catalog["jobs"][job_id]
                if job.get("recoverable") and not self.stop.is_set():
                    job.update(status="queued", recoverable=False)
                    job.pop("error", None)
                    self._save()
                    self._launch(job_id, provider_factory)
                return self.job(job_id)
            record = self.catalog["initializations"].get(body["initializationId"])
            if not record:
                raise ServiceError("Initialization not found.", 404)
            if not record["confirmed"] or record["review"]["reviewVersion"] != body["reviewVersion"]:
                raise ServiceError("Confirm this initialization review version first.", 409)
            if self.stop.is_set():
                raise ServiceError("Server is stopping; retry after restart.", 503)
            simulation_id, job_id = "sim_" + uuid.uuid4().hex, "job_" + uuid.uuid4().hex
            self.catalog["simulations"][simulation_id] = {"initializationId": body["initializationId"],
                                                        "reviewVersion": body["reviewVersion"], "months": [],
                                                        "createdOrder": 1 + max((run.get("createdOrder", 0) for run in self.catalog["simulations"].values()), default=0),
                                                        "snapshots": [], "stateStorage": {}, "providerMetrics": {"attempts": [], "summary": {}}}
            self.catalog["jobs"][job_id] = {"jobId": job_id, "status": "queued", "simulationId": simulation_id,
                                           "completedMonths": 0, "totalMonths": len(schedule(record["setup"]["start"], record["setup"]["end"]))}
            result = {"jobId": job_id, "status": "queued"}
            self._remember(key, digest, result)
            self._launch(job_id, provider_factory)
            return result

    def _launch(self, job_id, provider_factory=None):
        if job_id in self.threads and self.threads[job_id].is_alive():
            return
        thread = threading.Thread(target=self._run, args=(job_id, provider_factory), name=job_id, daemon=True)
        self.threads[job_id] = thread
        thread.start()

    def _world_path(self, simulation_id, day):
        return monthly_state_path(self.data_dir / "simulations" / simulation_id, day)

    def _load_world(self, simulation_id, day):
        try:
            world = read_json(self._world_path(simulation_id, day))
            engine.assert_invariants(world)
            return world
        except (StorageError, ValueError, TypeError, KeyError):
            raise ServiceError("Saved monthly state is missing or corrupt; the file was preserved.", 500) from None

    def _run(self, job_id, provider_factory=None):
        provider = None
        try:
            with self.lock:
                job = self.catalog["jobs"][job_id]
                job["status"] = "running"
                simulation_id = job["simulationId"]
                simulation = self.catalog["simulations"][simulation_id]
                initial = self.catalog["initializations"][simulation["initializationId"]]
                setup = copy.deepcopy(initial["setup"])
                completed = list(simulation["months"])
                prior_metrics = copy.deepcopy(simulation["providerMetrics"])
                world = self._load_world(simulation_id, completed[-1]) if completed else engine.create_world(initial["scenario"])
                self._save()
            government_mode = world.get("config", {}).get("fiscal", {}).get("governmentMode", "fixed")
            if government_mode == "live" and not getattr(self.provider_factory, "configuration", {}).get("live"):
                raise ServiceError("Restart with the configured live provider to resume this government run.")
            if government_mode == "offline-test":
                from .government_web import GovernmentTestProvider
                provider = GovernmentTestProvider()
            elif (world.get("model") == "hk-fiscal-v1" and government_mode == "fixed") or (government_mode != "live" and getattr(self.provider_factory, "configuration", {}).get("governmentOnly")):
                from .ai import OfflineProvider
                provider = OfflineProvider()
            else:
                provider = (provider_factory or self.provider_factory)()
            execution_session = uuid.uuid4().hex
            def persist_provider_metrics(row=None):
                with self.lock:
                    current = {"attempts": [{**copy.deepcopy(item), "executionSession": execution_session}
                                             for item in getattr(provider, "metrics", [])],
                               "summary": provider.metrics_summary() if hasattr(provider, "metrics_summary") else {}}
                    simulation["providerMetrics"] = combine_metrics(prior_metrics, current)
                    summary = simulation["providerMetrics"]["summary"]
                    job["providerMetrics"] = copy.deepcopy(summary)
                    job.setdefault("progress", {}).update(completedMonths=len(simulation["months"]),
                        callCount=summary.get("callCount", 0), attemptCount=summary.get("attemptCount", 0),
                        successfulCalls=summary.get("successfulCalls", 0),
                        failedAttempts=summary.get("attemptCount", 0) - summary.get("successfulCalls", 0))
                    if row is not None:
                        # Callback rows are the provider's sanitized metrics,
                        # never payloads, credentials or arbitrary exceptions.
                        job["lastAttempt"] = copy.deepcopy(row)
                    self._save()
            if hasattr(provider, "set_metrics_callback"):
                provider.set_metrics_callback(persist_provider_metrics)
            persist_provider_metrics()
            output_days = set(schedule(setup["start"], setup["end"], setup["step"]))
            months = schedule(setup["start"], setup["end"])
            for day in months[len(completed):]:
                if self.stop.is_set():
                    self._interrupted(job_id)
                    return
                with self.lock:
                    job.setdefault("progress", {})["activeMonth"] = day
                    self._save()
                world = engine.advance_month(world, provider, day)
                # Write world before exposing the month in the durable catalog.
                # A crash between these writes leaves an orphan, never a false
                # completed month. That unsaved transition is retried explicitly.
                storage = write_monthly_state(self.data_dir / "simulations" / simulation_id, day, world)
                with self.lock:
                    simulation["months"].append(day)
                    simulation.setdefault("stateStorage", {})[day] = storage
                    if day in output_days:
                        simulation["snapshots"].append({"id": "frame_" + day.replace("-", ""), "date": day})
                    job["completedMonths"] = len(simulation["months"])
                    persist_provider_metrics()
            with self.lock:
                job["progress"]["activeMonth"] = None
                job.update(status="complete", recoverable=False, result=self._run_result(simulation_id))
                self._save()
        except Exception:
            with self.lock:
                # Provider exception text may contain private transport details.
                if provider is not None:
                    current = {"attempts": [{**copy.deepcopy(row), "executionSession": execution_session}
                                             for row in getattr(provider, "metrics", [])],
                               "summary": provider.metrics_summary() if hasattr(provider, "metrics_summary") else {}}
                    simulation["providerMetrics"] = combine_metrics(prior_metrics, current)
                self.catalog["jobs"][job_id].update(status="failed", recoverable=True,
                    error="Simulation could not complete. Retry analysis with the same operation key to resume the saved months; no completed month will be reapplied.")
                self._save()

    def _interrupted(self, job_id):
        with self.lock:
            self.catalog["jobs"][job_id].update(status="failed", recoverable=True,
                error="Server stopped during this run. Retry analysis with the same operation key to resume saved months.")
            self._save()

    def _run_result(self, simulation_id):
        simulation = self.catalog["simulations"][simulation_id]
        initial = self.catalog["initializations"][simulation["initializationId"]]
        fiscal = initial["scenario"].get("fiscal")
        return {"simulationId": simulation_id, "snapshots": copy.deepcopy(simulation["snapshots"]),
                "provenance": "hk-fiscal-v1-synthetic" if fiscal else "synthetic-narrative-city-scenario", "limitations": copy.deepcopy(fiscal["settings"]["limits"]) if fiscal else list(snapshots.LIMITATIONS),
                "stateStorage": copy.deepcopy(simulation.get("stateStorage", {})),
                "providerMetrics": copy.deepcopy(simulation["providerMetrics"])}

    def job(self, job_id):
        with self.lock:
            if job_id not in self.catalog["jobs"]:
                raise ServiceError("Job not found.", 404)
            return copy.deepcopy(self.catalog["jobs"][job_id])

    def list_simulations(self):
        """Small saved-history index; never hydrates worlds or invokes a provider."""
        with self.lock:
            jobs = {job.get("simulationId"): job for job in self.catalog["jobs"].values()
                    if job.get("simulationId")}
            rows = []
            for identifier, run in self.catalog["simulations"].items():
                months = list(run["months"])
                if not months:
                    continue
                initial = self.catalog["initializations"][run["initializationId"]]
                setup = initial["setup"]
                summary = run.get("providerMetrics", {}).get("summary", {})
                rows.append({"simulationId": identifier, "policyId": setup.get("policyScope", {}).get("policyId"),
                             "status": jobs.get(identifier, {}).get("status", "unknown"),
                             "start": months[0], "end": months[-1], "savedMonths": len(months),
                             "requestedEnd": setup["end"], "createdOrder": run.get("createdOrder", 0),
                             "provider": summary.get("provider"), "sourceType": summary.get("sourceType"),
                             "synthetic": True})
            rows.sort(key=lambda row: row["createdOrder"], reverse=True)
            return {"schema": "nm-analysis-history-v1", "simulations": copy.deepcopy(rows)}

    def get_snapshot(self, simulation_id, frame_id):
        with self.lock:
            simulation = self.catalog["simulations"].get(simulation_id)
            if not simulation:
                raise ServiceError("Simulation not found.", 404)
            frame = next((item for item in simulation["snapshots"] if item["id"] == frame_id), None)
            if not frame:
                raise ServiceError("Snapshot not found.", 404)
            setup = copy.deepcopy(self.catalog["initializations"][simulation["initializationId"]]["setup"])
            world = self._load_world(simulation_id, frame["date"])
        return snapshots.snapshot(world, setup)

    def export(self, simulation_id):
        with self.lock:
            simulation = self.catalog["simulations"].get(simulation_id)
            if not simulation:
                raise ServiceError("Simulation not found.", 404)
            initial = self.catalog["initializations"][simulation["initializationId"]]
            worlds = [self._load_world(simulation_id, day) for day in simulation["months"]]
            return {"schemaVersion": 1, "run": self._run_result(simulation_id),
                    "setup": copy.deepcopy(initial["setup"]), "review": copy.deepcopy(initial["review"]),
                    "scale": copy.deepcopy(initial["scenario"].get("scale")),
                    "monthlyStates": worlds, "monthlyBuildingTotals": [building_totals_export(world) for world in worlds]}

    def close(self):
        self.stop.set()
        # Shutdown is bounded even when a provider request is still in flight.
        deadline = time.monotonic() + 2
        for thread in list(self.threads.values()):
            thread.join(max(0, deadline - time.monotonic()))
