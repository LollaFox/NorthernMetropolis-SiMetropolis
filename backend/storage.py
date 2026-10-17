"""Lossless monthly JSON storage, with legacy plain-JSON compatibility."""
from __future__ import annotations

from collections import Counter
import copy
import errno
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
import uuid
import zlib


STATE_MAGIC = b"NMSTATE1\n"
FORMAT = "nm-json-dag"
HASH = re.compile(r"[0-9a-f]{64}\Z")
DEFAULT_THRESHOLD = 1024


class StorageError(ValueError):
    """A saved artifact is missing, corrupt, or not valid finite JSON."""


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _atomic_write_bytes(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        # Windows cannot open directories with os.open; file fsync and atomic
        # replacement above still apply. Directory fsync is POSIX-only.
        if os.name == "nt":
            return
        directory = os.open(str(path.parent), os.O_RDONLY)
        try:
            try:
                os.fsync(directory)
            except OSError as exc:
                if exc.errno not in (errno.EINVAL, errno.ENOTSUP):
                    raise
        finally:
            os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


def atomic_write_json(path, value, compress=False):
    """Write complete bytes, fsync, and atomically replace the destination."""
    raw = json_bytes(value)
    payload = gzip.compress(raw, compresslevel=6, mtime=0) if compress else raw
    _atomic_write_bytes(path, payload)
    return {"format": "json+gzip" if compress else "json", "jsonBytes": len(raw),
            "storedBytes": len(payload)}


def _invalid_constant(_value):
    raise ValueError("Nonfinite JSON constant")


def _finite_float(value):
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("Nonfinite JSON number")
    return parsed


def _decode_json(payload):
    return json.loads(payload.decode("utf-8"), parse_constant=_invalid_constant, parse_float=_finite_float)


def read_json(path):
    """Hydrate shared states, full gzip JSON, or legacy plain JSON."""
    path = Path(path)
    try:
        payload = path.read_bytes()
        raw = gzip.decompress(payload) if path.suffix == ".gz" else payload
        if raw.startswith(STATE_MAGIC):
            return _Hydrator(path.parent).envelope(_decode_json(raw[len(STATE_MAGIC):]))
        return _decode_json(raw)
    except StorageError:
        raise
    except (OSError, EOFError, UnicodeError, ValueError, RecursionError, zlib.error):
        raise StorageError("Saved JSON artifact is missing or corrupt; the file was preserved.") from None


def monthly_state_path(directory, day):
    """Prefer an existing gzip state, then legacy JSON; new states use gzip."""
    directory = Path(directory)
    if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ValueError("Monthly state name must be an ISO date")
    compressed = directory / (day + ".json.gz")
    legacy = directory / (day + ".json")
    return compressed if compressed.exists() or not legacy.exists() else legacy


def _load_pool(directory):
    path = directory / "shared-objects.json.gz"
    if not path.exists():
        return {}
    try:
        pool = _decode_json(gzip.decompress(path.read_bytes()))
        if (not isinstance(pool, dict) or set(pool) != {"format", "version", "objects"}
                or pool["format"] != "nm-shared-pool" or type(pool["version"]) is not int
                or pool["version"] != 1 or not isinstance(pool["objects"], dict)):
            raise ValueError()
        for digest, envelope in pool["objects"].items():
            if not HASH.fullmatch(digest) or not isinstance(envelope, dict):
                raise ValueError()
        return pool["objects"]
    except (OSError, EOFError, UnicodeError, ValueError, TypeError, RecursionError, zlib.error):
        raise StorageError("Saved shared-object pool is missing or corrupt; files were preserved.") from None


class _Hydrator:
    def __init__(self, directory):
        self.directory = directory
        self.pool = _load_pool(directory)
        self.cache = {}
        self.resolving = set()

    def object(self, digest):
        if not isinstance(digest, str) or not HASH.fullmatch(digest):
            raise StorageError("Invalid saved shared-object reference; files were preserved.")
        if digest in self.resolving:
            raise StorageError("Cyclic saved shared-object references; files were preserved.")
        if digest in self.cache:
            return copy.deepcopy(self.cache[digest])
        if digest not in self.pool:
            raise StorageError("A saved shared object is missing; files were preserved.")
        self.resolving.add(digest)
        try:
            envelope = copy.deepcopy(self.pool[digest])
            if not isinstance(envelope, dict) or envelope.get("sha256") != digest:
                raise StorageError("Saved shared-object hash mismatch; files were preserved.")
            value = self.envelope(envelope)
            self.cache[digest] = value
            # Independent copies preserve ordinary JSON tree semantics.
            return copy.deepcopy(value)
        except StorageError:
            raise
        except (OSError, EOFError, UnicodeError, ValueError, TypeError, zlib.error):
            raise StorageError("A saved shared object is corrupt; files were preserved.") from None
        finally:
            self.resolving.remove(digest)

    def envelope(self, envelope):
        if (not isinstance(envelope, dict) or set(envelope) != {"format", "version", "payload", "refs", "sha256"}
                or envelope["format"] != FORMAT or type(envelope["version"]) is not int or envelope["version"] != 1
                or not isinstance(envelope["refs"], list) or not isinstance(envelope["sha256"], str)
                or not HASH.fullmatch(envelope["sha256"])):
            raise StorageError("Invalid saved state envelope; files were preserved.")
        value = envelope["payload"]
        paths = []
        for reference in envelope["refs"]:
            if (not isinstance(reference, dict) or set(reference) != {"path", "hash"}
                    or not isinstance(reference["path"], list)):
                raise StorageError("Invalid saved reference path; files were preserved.")
            path = reference["path"]
            if any(type(part) not in (str, int) for part in path):
                raise StorageError("Invalid saved reference path; files were preserved.")
            if any(path[:len(old)] == old or old[:len(path)] == path for old in paths):
                raise StorageError("Overlapping saved reference paths; files were preserved.")
            paths.append(path)
            if not path:
                if value is not None:
                    raise StorageError("Invalid saved root placeholder; files were preserved.")
                value = self.object(reference["hash"])
                continue
            parent = value
            for part in path[:-1]:
                parent = self._child(parent, part)
            last = path[-1]
            if self._child(parent, last) is not None:
                raise StorageError("Invalid saved reference placeholder; files were preserved.")
            parent[last] = self.object(reference["hash"])
        if hashlib.sha256(json_bytes(value)).hexdigest() != envelope["sha256"]:
            raise StorageError("Saved state hash mismatch; files were preserved.")
        return value

    @staticmethod
    def _child(parent, part):
        if isinstance(parent, dict) and isinstance(part, str) and part in parent:
            return parent[part]
        if isinstance(parent, list) and type(part) is int and 0 <= part < len(parent):
            return parent[part]
        raise StorageError("Invalid saved reference path; files were preserved.")


class SharedStateStore:
    """Single-writer run-local immutable shared objects and monthly roots.

    Repeated substantial dict/list subtrees are factored by their canonical
    SHA-256; config is also retained once for reuse in later months. Strings and
    small values stay inline. One compressed pool shares gzip's dictionary
    across objects and avoids tiny files. Pool entries only accumulate; its
    atomic rewrite precedes publication of each monthly root.
    """
    def __init__(self, directory, threshold=DEFAULT_THRESHOLD):
        if type(threshold) is not int or threshold < 256:
            raise ValueError("Shared-object threshold must be an integer >= 256 bytes")
        self.directory = Path(directory)
        self.threshold = threshold
        self.lock = threading.RLock()
        self.pool = _load_pool(self.directory)

    def write(self, day, world):
        with self.lock:
            # Validate the filename independently of caller-side date checks.
            monthly_state_path(self.directory, day)
            raw = json_bytes(world)
            info, counts = {}, Counter()
            def scan(value):
                if not isinstance(value, (dict, list)):
                    return
                encoded = json_bytes(value)
                if len(encoded) < self.threshold:
                    return
                digest = hashlib.sha256(encoded).hexdigest()
                info[id(value)] = (digest, len(encoded))
                counts[digest] += 1
                for child in value.values() if isinstance(value, dict) else value:
                    scan(child)
            scan(world)
            forced = info.get(id(world.get("config")), (None,))[0] if isinstance(world, dict) else None
            selected = {digest for digest, count in counts.items()
                        if count > 1 or digest in self.pool or digest == forced}
            pending, reused = {}, set()

            def envelope(value):
                refs = []
                def encode(node, path, root=False):
                    item = info.get(id(node)) if isinstance(node, (dict, list)) else None
                    if item and item[0] in selected and not root:
                        digest = item[0]
                        if digest in self.pool:
                            reused.add(digest)
                        elif digest not in pending:
                            child = envelope(node)
                            pending[digest] = child
                        refs.append({"path": path, "hash": digest})
                        return None
                    if item is None:
                        return copy.deepcopy(node)
                    if isinstance(node, dict):
                        return {key: encode(child, path + [key]) for key, child in node.items()}
                    return [encode(child, path + [index]) for index, child in enumerate(node)]
                payload = encode(value, [], root=True)
                return {"format": FORMAT, "version": 1, "payload": payload, "refs": refs,
                        "sha256": hashlib.sha256(json_bytes(value)).hexdigest()}

            root = envelope(world)
            # Reuse is conditional on fresh disk verification, never only on
            # an in-memory index/cache that could conceal damaged artifacts.
            if reused:
                verifier = _Hydrator(self.directory)
                for digest in reused:
                    verifier.object(digest)
            self.directory.mkdir(parents=True, exist_ok=True)
            pool_path = self.directory / "shared-objects.json.gz"
            old_size = pool_path.stat().st_size if pool_path.exists() else 0
            pool = {**self.pool, **pending}
            if pending or not pool_path.exists():
                pool_stats = atomic_write_json(pool_path, {"format": "nm-shared-pool", "version": 1,
                                                          "objects": pool}, compress=True)
                self.pool = pool
                pool_size = pool_stats["storedBytes"]
            else:
                pool_size = old_size
            # All referenced objects are durable before publishing the root.
            packed_root = gzip.compress(STATE_MAGIC + json_bytes(root), compresslevel=6, mtime=0)
            _atomic_write_bytes(self.directory / (day + ".json.gz"), packed_root)
            return {"format": "nm-shared-json-v1+gzip", "thresholdBytes": self.threshold,
                    "jsonBytes": len(raw), "storedBytes": len(packed_root) + pool_size - old_size,
                    "manifestBytes": len(packed_root), "sharedPoolChangeBytes": pool_size - old_size,
                    "sharedPoolBytes": pool_size, "objectStore": "shared-pool-v1",
                    "newSharedObjects": len(pending), "reusedSharedObjects": len(reused),
                    "totalSharedObjects": len(pool)}

    def read(self, day):
        return read_json(monthly_state_path(self.directory, day))


def write_monthly_state(directory, day, world):
    return SharedStateStore(directory).write(day, world)
