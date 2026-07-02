"""In-memory mock ops fleet — shared process-wide store, no persistence.
Resets on server restart; intentional for a POC (every thread shares one
fleet — a demo of a live shared system, not per-conversation state)."""
import json
from pathlib import Path
from threading import Lock

_DATA_PATH = Path(__file__).parent / "data" / "services.json"
_lock = Lock()


def _load() -> dict[str, dict]:
    return {s["name"]: s for s in json.loads(_DATA_PATH.read_text(encoding="utf-8"))}


_services: dict[str, dict] = _load()


def reset() -> None:
    """Reload the fleet from disk, discarding in-memory mutations. Test-only."""
    with _lock:
        _services.clear()
        _services.update(_load())


def snapshot() -> list[dict]:
    """All services, current state."""
    with _lock:
        return [dict(s) for s in _services.values()]


def get(name: str) -> dict | None:
    with _lock:
        s = _services.get(name)
        return dict(s) if s else None


def restart(name: str) -> dict:
    """Clear a service's error state and bring it back to healthy."""
    with _lock:
        s = _services[name]
        s["status"] = "healthy"
        s["error_rate_pct"] = 0.1
        s["uptime_pct"] = 100.0
        if s["replicas"] == 0:
            s["replicas"] = 1
        return dict(s)


def scale(name: str, replicas: int) -> dict:
    with _lock:
        s = _services[name]
        s["replicas"] = replicas
        return dict(s)


def rollback(name: str, version: str) -> dict:
    with _lock:
        s = _services[name]
        s["version"] = version
        s["status"] = "healthy"
        return dict(s)
