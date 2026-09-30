"""Road route data (section 5.4) and geometry helpers."""

import json
import math
from functools import lru_cache
from itertools import pairwise
from pathlib import Path
from typing import Any

from app.logistics import polyline

ROUTES_PATH = Path(__file__).resolve().parents[2] / "data" / "routes.json"

Routes = dict[str, dict[str, Any]]


@lru_cache
def load_routes() -> Routes:
    """Precomputed routes keyed `"{origin_id}->{dest_id}"`. The app never calls OSRM."""
    with open(ROUTES_PATH, encoding="utf-8") as f:
        return json.load(f)["routes"]


def route_key(origin_id: str, dest_id: str) -> str:
    return f"{origin_id}->{dest_id}"


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial bearing from point 1 to point 2, 0 to 360 degrees."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


@lru_cache(maxsize=4096)
def decoded(encoded: str) -> tuple[tuple[polyline.Coord, ...], tuple[float, ...]]:
    """Decode a polyline once and cache `(coords, cumulative_metres)`."""
    coords = tuple(polyline.decode(encoded))
    cum = [0.0]
    for a, b in pairwise(coords):
        cum.append(cum[-1] + haversine_m(a[0], a[1], b[0], b[1]))
    return coords, tuple(cum)


def point_at(encoded: str, fraction: float) -> tuple[float, float, float, float]:
    """`(lat, lng, bearing, distance_m)` at `fraction` (0..1) of the polyline length."""
    coords, cum = decoded(encoded)
    total = cum[-1]
    fraction = min(1.0, max(0.0, fraction))
    if len(coords) < 2 or total <= 0:
        lat, lng = coords[0]
        return lat, lng, 0.0, 0.0
    d = fraction * total
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cum[mid] <= d:
            lo = mid
        else:
            hi = mid
    seg_len = cum[hi] - cum[lo]
    f = 0.0 if seg_len <= 0 else (d - cum[lo]) / seg_len
    (la1, ln1), (la2, ln2) = coords[lo], coords[hi]
    return (
        la1 + (la2 - la1) * f,
        ln1 + (ln2 - ln1) * f,
        bearing_deg(la1, ln1, la2, ln2),
        d,
    )


def route_geometry_m(encoded: str) -> float:
    return decoded(encoded)[1][-1]


def road_km(routes: Routes, origin_id: str, dest_id: str) -> float | None:
    r = routes.get(route_key(origin_id, dest_id))
    return None if r is None else r["distance_m"] / 1000.0
