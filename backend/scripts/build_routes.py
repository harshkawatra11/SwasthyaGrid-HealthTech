"""Precomputes road routes between logistics nodes into data/routes.json.

Source: the public OSRM demo server (non-commercial, at most 1 request per
second, so this sleeps 1.1 s between calls). The app never calls OSRM at
runtime. Resumable: keys already present in routes.json are skipped.

Pairs (225 calls): central to each DDW (5), central to each facility (40),
each DDW to each facility in its district (40), and each unordered pair of
facilities inside a district (140), stored in both directions.

Run from backend/ after generate_logistics.py has written seed_logistics.json:
  python scripts/build_routes.py
"""

import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.logistics.polyline import decode, encode

DISTRICTS_PATH = ROOT / "data" / "seed_districts.json"
LOGISTICS_PATH = ROOT / "data" / "seed_logistics.json"
ROUTES_PATH = ROOT / "data" / "routes.json"

OSRM_URL = (
    "https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}"
    "?overview=full&geometries=polyline"
)
USER_AGENT = "SwasthyaGrid-route-precompute/1.0"
SLEEP_SECONDS = 1.1
RETRIES = 2
BACKOFF_SECONDS = 5
ATTRIBUTION = "Routes: OpenStreetMap contributors, OSRM"


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dphi = p2 - p1
    dlmb = math.radians(b[1] - a[1])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def synthetic_route(a: tuple[float, float], b: tuple[float, float]) -> dict:
    """Deterministic fallback: a 7-point path bowed sideways, 35 km/h over 1.35x straight line."""
    dlat = b[0] - a[0]
    dlng = b[1] - a[1]
    length = math.hypot(dlat, dlng)
    # Unit vector perpendicular to the straight line (in degree space).
    px, py = (-dlng / length, dlat / length) if length else (0.0, 0.0)
    points = []
    for k in range(7):
        t = k / 6
        lat = a[0] + dlat * t
        lng = a[1] + dlng * t
        if 1 <= k <= 5:
            off = 0.015 * length * math.sin(k * 1.7)
            lat += px * off
            lng += py * off
        points.append((lat, lng))
    distance_m = haversine_m(a, b) * 1.35
    return {
        "distance_m": round(distance_m),
        "duration_s": round(distance_m / (35000 / 3600)),
        "polyline": encode(points),
        "source": "synthetic",
    }


def fetch_osrm(a: tuple[float, float], b: tuple[float, float]) -> dict:
    url = OSRM_URL.format(lat1=a[0], lng1=a[1], lat2=b[0], lng2=b[1])
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.load(resp)
    if body.get("code") != "Ok" or not body.get("routes"):
        raise RuntimeError(f"OSRM returned {body.get('code')}")
    route = body["routes"][0]
    return {
        "distance_m": round(route["distance"]),
        "duration_s": round(route["duration"]),
        "polyline": route["geometry"],
        "source": "osrm",
    }


def reverse_route(route: dict) -> dict:
    return {**route, "polyline": encode(list(reversed(decode(route["polyline"]))))}


def required_pairs(seed: dict, logistics: dict) -> tuple[list[tuple[str, str]], dict[str, tuple[float, float]]]:
    coords: dict[str, tuple[float, float]] = {}
    for w in logistics["warehouses"]:
        coords[w["id"]] = (w["location"]["lat"], w["location"]["lng"])
    for f in seed["facilities"]:
        coords[f["id"]] = (f["lat"], f["lng"])

    pairs: list[tuple[str, str]] = []
    ddws = [w for w in logistics["warehouses"] if w["type"] == "district"]
    for w in ddws:
        pairs.append(("wh_central", w["id"]))
    for f in seed["facilities"]:
        pairs.append(("wh_central", f["id"]))
    for w in ddws:
        for f in seed["facilities"]:
            if f["district_id"] == w["district_id"]:
                pairs.append((w["id"], f["id"]))
    for d in seed["districts"]:
        fids = [f["id"] for f in seed["facilities"] if f["district_id"] == d["id"]]
        pairs.extend(combinations(fids, 2))
    return pairs, coords


def main() -> None:
    with open(DISTRICTS_PATH, encoding="utf-8") as f:
        seed = json.load(f)
    with open(LOGISTICS_PATH, encoding="utf-8") as f:
        logistics = json.load(f)

    pairs, coords = required_pairs(seed, logistics)
    both_ways = {p for p in pairs if not p[0].startswith(("wh_", "ddw_"))}

    routes: dict[str, dict] = {}
    meta: dict = {}
    if ROUTES_PATH.exists():
        with open(ROUTES_PATH, encoding="utf-8") as f:
            existing = json.load(f)
        routes = existing.get("routes", {})
        meta = existing.get("_meta", {})

    def save() -> None:
        out = {
            "_meta": {
                "source": "OSRM demo server",
                "fetched_at": meta.get("fetched_at") or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "attribution": ATTRIBUTION,
            },
            "routes": routes,
        }
        tmp = ROUTES_PATH.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(out, f, separators=(",", ":"))
            f.write("\n")
        tmp.replace(ROUTES_PATH)

    todo = [
        p for p in pairs
        if f"{p[0]}->{p[1]}" not in routes or (p in both_ways and f"{p[1]}->{p[0]}" not in routes)
    ]
    print(f"{len(pairs)} pairs required, {len(todo)} to fetch.", flush=True)

    calls = 0
    for i, (origin, dest) in enumerate(todo, start=1):
        a, b = coords[origin], coords[dest]
        key = f"{origin}->{dest}"
        route = routes.get(key)
        if route is None:
            route = None
            for attempt in range(RETRIES + 1):
                if calls:
                    time.sleep(SLEEP_SECONDS)
                calls += 1
                try:
                    route = fetch_osrm(a, b)
                    break
                except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError) as exc:
                    print(f"  {key} attempt {attempt + 1} failed: {exc}", flush=True)
                    if attempt < RETRIES:
                        time.sleep(BACKOFF_SECONDS)
            if route is None:
                route = synthetic_route(a, b)
            routes[key] = route
        if (origin, dest) in both_ways:
            routes[f"{dest}->{origin}"] = reverse_route(route)
        save()
        print(f"[{i}/{len(todo)}] {key} {route['source']} {route['distance_m'] / 1000:.1f} km", flush=True)

    synthetic = sum(1 for r in routes.values() if r["source"] == "synthetic")
    print(f"Done: {len(routes)} route keys, synthetic={synthetic}, "
          f"size={ROUTES_PATH.stat().st_size / 1024:.0f} KB.", flush=True)


if __name__ == "__main__":
    main()
