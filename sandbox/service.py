"""A continuously running world with immutable history and off-thread AI."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import threading
import time
import uuid

from . import engine


SPEEDS = (0.5, 1, 2, 4, 8)
ROLES = ("government", "business", "residents", "energy")


class CityService:
    def __init__(self, provider=None, save_path=None, seed=42, live_limit=24, start=True):
        self.lock = threading.RLock()
        self.provider = provider
        self.save_path = Path(save_path) if save_path else None
        self._save_lock = threading.Lock()
        self._stop = threading.Event()
        self._dirty = threading.Event()
        self._threads = []
        self.branches = {}
        self.active = ""
        self.viewing = None
        self.playing = True
        self.speed = 1
        self.mode = "rules"
        self.generation = 0
        self._pending = []
        self._role = 0
        self._last_ai_month = -6
        self._suspended = False
        self.storage_error = None
        self.ai = {"available": bool(provider and provider.available),
                   "provider": getattr(provider, "provider", None), "model": getattr(provider, "model", None),
                   "status": "rules", "requests": 0, "limit": live_limit, "errors": 0,
                   "lastError": None, "attempts": [], "lifetimeRequests": 0,
                   "sessionId": uuid.uuid4().hex[:12]}
        if self.save_path and self.save_path.exists():
            self._restore()
        else:
            self._new(seed)
        self._dirty.set()
        if start:
            for target, name in ((self._clock, "city-clock"), (self._ai_worker, "city-ai"),
                                 (self._save_worker, "city-save")):
                thread = threading.Thread(target=target, name=name, daemon=True)
                self._threads.append(thread)
                thread.start()

    def _new(self, seed):
        world = engine.create_world(seed)
        identifier = uuid.uuid4().hex[:12]
        self.branches[identifier] = {"id": identifier, "label": "New horizon" if not self.branches else "Another beginning",
                                     "parentId": None, "history": [world]}
        self.active = identifier
        self.viewing = None
        return world

    def _invalidate(self):
        self.generation += 1
        self._pending = []
        for attempt in self.ai["attempts"]:
            if attempt.get("outcome") == "queued":
                attempt["outcome"] = "discarded_superseded"
        self._last_ai_month = -6
        self._reconcile_ai_status()

    def _reconcile_ai_status(self):
        if self.mode == "rules":
            self.ai["status"] = "rules"
        elif self._suspended:
            self.ai["status"] = "error"
        elif self.ai["requests"] >= self.ai["limit"]:
            self.ai["status"] = "budget_exhausted"
        else:
            self.ai["status"] = "ready"

    def _current(self):
        history = self.branches[self.active]["history"]
        return history[-1] if self.viewing is None else history[self.viewing]

    def _fork(self, month, label=None):
        parent = self.branches[self.active]
        if type(month) is not int or not 0 <= month < len(parent["history"]):
            raise engine.ValidationError("Choose a month that has already been simulated")
        identifier = uuid.uuid4().hex[:12]
        self.branches[identifier] = {"id": identifier, "label": label or "Future %s" % (len(self.branches) + 1),
                                     "parentId": self.active, "history": list(parent["history"][:month + 1])}
        self.active = identifier
        self.viewing = None
        self._invalidate()

    def state(self):
        with self.lock:
            branch = self.branches[self.active]
            return {"id": self.active, "label": branch["label"], "parentId": branch["parentId"],
                    "world": copy.deepcopy(self._current()), "playing": self.playing, "speed": self.speed,
                    "mode": self.mode, "ai": copy.deepcopy(self.ai), "viewingMonth": self.viewing,
                    "storageError": self.storage_error,
                    "timeline": [{"month": item["month"], "population": item["metrics"]["population"],
                                  "buildings": len(item["buildings"]), "happiness": item["metrics"]["happiness"]}
                                 for item in branch["history"]],
                    "branches": [{"id": b["id"], "label": b["label"], "month": b["history"][-1]["month"],
                                  "parentId": b["parentId"]} for b in self.branches.values()]}

    def command(self, action, body):
        if not isinstance(body, dict):
            raise engine.ValidationError("Expected a JSON object")
        try:
            json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (ValueError, TypeError):
            raise engine.ValidationError("Use finite numbers and valid Unicode text")
        with self.lock:
            if action == "control":
                if not body or set(body) - {"playing", "speed"}:
                    raise engine.ValidationError("Control accepts playing and speed")
                if "playing" in body and type(body["playing"]) is not bool:
                    raise engine.ValidationError("playing must be boolean")
                if "speed" in body and (type(body["speed"]) not in (float, int) or body["speed"] not in SPEEDS):
                    raise engine.ValidationError("Choose speed 0.5, 1, 2, 4 or 8")
                if body.get("playing") and self.viewing is not None:
                    self._fork(self.viewing)
                if "playing" in body:
                    self.playing = body["playing"]
                    if not self.playing:
                        self._invalidate()
                self.speed = body.get("speed", self.speed)
            elif action == "intervention":
                if set(body) - {"text", "kind"} or not isinstance(body.get("text"), str):
                    raise engine.ValidationError("Intervention needs text and optional kind")
                if not 1 <= len(body["text"].strip()) <= 600:
                    raise engine.ValidationError("Write an intervention of 1–600 characters")
                if "kind" in body and not isinstance(body["kind"], str):
                    raise engine.ValidationError("kind must be a supported action name")
                result = engine.intervene(self._current(), body["text"], body.get("kind"))
                if self.viewing is not None:
                    self._fork(self.viewing)
                self.branches[self.active]["history"][-1] = result
                self._invalidate()
            elif action == "seek":
                if set(body) != {"month"} or type(body["month"]) is not int:
                    raise engine.ValidationError("Seek needs an integer month")
                month = body["month"]
                if not 0 <= month < len(self.branches[self.active]["history"]):
                    raise engine.ValidationError("That month has not been simulated")
                self.viewing = month
                self.playing = False
                self._invalidate()
            elif action == "branch":
                if set(body) - {"month", "label"}:
                    raise engine.ValidationError("Branch accepts month and label")
                label = body.get("label")
                if label is not None and (not isinstance(label, str) or not 1 <= len(label.strip()) <= 60):
                    raise engine.ValidationError("Branch name must be 1–60 characters")
                self._fork(body.get("month", self._current()["month"]), label)
                self.playing = False
            elif action == "switch":
                if set(body) != {"id"} or not isinstance(body["id"], str) or body["id"] not in self.branches:
                    raise engine.ValidationError("Unknown branch")
                self.active = body["id"]
                self.viewing = None
                self.playing = False
                self._invalidate()
            elif action == "reset":
                if set(body) - {"seed"}:
                    raise engine.ValidationError("New world accepts an optional seed")
                self._new(body.get("seed", 42))
                self.playing = False
                self._invalidate()
            elif action == "mode":
                if set(body) != {"mode"} or body["mode"] not in ("rules", "live"):
                    raise engine.ValidationError("Mode must be rules or live")
                if body["mode"] == "live" and not self.ai["available"]:
                    raise engine.ValidationError("The existing server provider is not configured")
                self.mode = body["mode"]
                self.ai["status"] = "ready" if self.mode == "live" else "rules"
                self.ai["lastError"] = None
                self._suspended = False
                self._invalidate()
            else:
                raise engine.ValidationError("Unknown command")
            self._dirty.set()
            return self.state()

    def advance(self):
        with self.lock:
            if not self.playing or self.viewing is not None:
                return
            decisions = self._pending if self.mode == "live" else None
            updated = engine.step_world(self._current(), decisions=decisions)
            if decisions:
                old_ids = {message["id"] for message in self._current()["messages"]}
                for decision in decisions:
                    settled = next((message for message in reversed(updated["messages"])
                                    if message["id"] not in old_ids and message["source"] == decision["actor"]
                                    and message["action"] in (decision["action"], "rejected:" + decision["action"])), None)
                    for attempt in reversed(self.ai["attempts"]):
                        if (attempt.get("outcome") == "queued" and attempt.get("actor") == decision["actor"]
                                and attempt.get("action") == decision["action"]):
                            attempt["outcome"] = "applied" if settled and not settled["action"].startswith("rejected:") else "rejected"
                            attempt["appliedMonth"] = updated["month"]
                            break
            self._pending = []
            self.branches[self.active]["history"].append(updated)
            self._dirty.set()

    def _clock(self):
        last = time.monotonic()
        accumulated = 0.0
        while not self._stop.wait(0.04):
            now = time.monotonic()
            with self.lock:
                running, speed = self.playing, self.speed
            accumulated = accumulated + (now - last) * speed if running else 0.0
            last = now
            if accumulated >= 1.6:
                accumulated = min(accumulated - 1.6, 1.6)
                try:
                    self.advance()
                except Exception:
                    with self.lock:
                        self.playing = False
                        self.storage_error = "The simulation paused after an internal model error. Your history is preserved."

    def _ai_worker(self):
        while not self._stop.wait(0.1):
            with self.lock:
                if (self.mode != "live" or not self.playing or self._suspended or not self.provider
                        or self.viewing is not None):
                    continue
                if self.ai["requests"] >= self.ai["limit"]:
                    self.ai["status"] = "budget_exhausted"
                    continue
                world = self._current()
                if world["month"] - self._last_ai_month < 3:
                    continue
                actor = ROLES[self._role % len(ROLES)]
                packet = engine.actor_packet(world, actor)
                generation, branch, month = self.generation, self.active, world["month"]
                self._role += 1
                self._last_ai_month = month
                self.ai["status"] = "thinking"
                self.ai["requests"] += 1
                self.ai["lifetimeRequests"] += 1
                ordinal = self.ai["requests"]
                self._dirty.set()
            # Never hold the world lock while doing provider I/O.
            try:
                decision, evidence = self.provider.decide(actor, packet)
                with self.lock:
                    stale = generation != self.generation or branch != self.active or self.mode != "live"
                    stale = stale or self._current()["month"] - month > 24
                    evidence.update({"request": ordinal, "sessionId": self.ai["sessionId"], "action": decision["action"],
                                     "branch": branch, "observedMonth": month,
                                     "receivedMonth": self._current()["month"],
                                     "outcome": "discarded_stale" if stale else "queued"})
                    self.ai["attempts"].append(evidence)
                    if not stale:
                        self._pending.append(decision)
                    self._reconcile_ai_status()
                    self._dirty.set()
            except Exception:
                with self.lock:
                    self.ai["errors"] += 1
                    self.ai["attempts"].append({"request": ordinal, "sessionId": self.ai["sessionId"],
                                                "actor": actor, "branch": branch,
                                                "observedMonth": month, "outcome": "provider_error",
                                                "usage": None})
                    if generation == self.generation and self.mode == "live":
                        self.ai["status"] = "error"
                        self.ai["lastError"] = "Live decisions paused: provider request failed or returned an invalid plan. " \
                                               "The physical city keeps running. Select live mode again to retry."
                        self._suspended = True
                    self._reconcile_ai_status()
                    self._dirty.set()

    def export(self):
        with self.lock:
            # Worlds are immutable replacement values. Copy containers, serialize outside the lock.
            return {"schemaVersion": 2, "active": self.active,
                    "branches": [{**b, "history": list(b["history"])} for b in self.branches.values()],
                    "ai": copy.deepcopy(self.ai), "description": "Synthetic scenario, not a calibrated forecast"}

    def save(self):
        if not self.save_path:
            return
        with self._save_lock:
            payload = json.dumps(self.export(), ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            self.save_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.save_path.with_suffix(".tmp")
            temporary.write_text(payload, encoding="utf-8")
            os.replace(temporary, self.save_path)
            self.storage_error = None

    def _save_worker(self):
        while not self._stop.wait(0.75):
            if not self._dirty.is_set():
                continue
            self._dirty.clear()
            try:
                self.save()
            except OSError:
                self.storage_error = "Autosave failed. Export this world before closing."
                self._dirty.set()

    def _restore(self):
        value = json.loads(self.save_path.read_text(encoding="utf-8"))
        if value.get("schemaVersion") != 2 or not isinstance(value.get("branches"), list):
            raise ValueError("Unsupported city save; original file was preserved")
        restored = {}
        for branch in value["branches"]:
            if not branch.get("history") or branch["id"] in restored:
                raise ValueError("Invalid city history; original file was preserved")
            for month, world in enumerate(branch["history"]):
                engine.validate_world(world)
                if world["month"] != month:
                    raise ValueError("Invalid city chronology; original file was preserved")
            restored[branch["id"]] = branch
        if value.get("active") not in restored:
            raise ValueError("Invalid active city; original file was preserved")
        self.branches = restored
        self.active = value["active"]
        self.playing = False
        saved_ai = value.get("ai", {})
        self.ai["lifetimeRequests"] = max(0, int(saved_ai.get("lifetimeRequests", saved_ai.get("requests", 0))))
        self.ai["errors"] = max(0, int(saved_ai.get("errors", 0)))
        self.ai["attempts"] = saved_ai.get("attempts", [])

    def close(self):
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=0.3)
        self.save()
