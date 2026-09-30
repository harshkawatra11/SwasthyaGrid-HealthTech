"""Latency sweep over every GET endpoint of a running backend (Appendix E.3 item 2).

Reads `/openapi.json`, calls each GET route that has no required path parameter, plus one
id-substituted call each for shipments, vehicles, drivers, warehouses, facility inbound,
facility profile and causal chain, N times sequentially. Prints status, p50 and p95 per
endpoint and exits non-zero if any response is not 200 or any p95 is over the limit.

    python scripts/endpoint_sweep.py --base http://127.0.0.1:8095 --n 20 --limit-ms 250
"""

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request

SKIP = {"/api/v1/logistics/stream"}  # server-sent events never end
ID_ROUTES = {
    "/api/v1/logistics/shipments/{shipment_id}": "shipment",
    "/api/v1/logistics/vehicles/{vehicle_id}": "vehicle",
    "/api/v1/logistics/drivers/{driver_id}": "driver",
    "/api/v1/logistics/warehouses/{warehouse_id}": "warehouse",
    "/api/v1/logistics/facilities/{facility_id}/inbound": "facility",
    "/api/v1/facilities/{facility_id}/profile": "facility",
    "/api/v1/analytics/causal-chain/{facility_id}": "facility",
}


def fetch(url: str, timeout: float = 30.0) -> tuple[int, float, bytes]:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read()
            code = resp.status
    except urllib.error.HTTPError as exc:
        body, code = exc.read(), exc.code
    except Exception:
        body, code = b"", 0
    return code, (time.perf_counter() - started) * 1000.0, body


def first_id(base: str, path: str, key: str | None = None) -> str | None:
    code, _, body = fetch(base + path)
    if code != 200:
        return None
    data = json.loads(body)
    rows = data
    if isinstance(data, dict):  # `{"items": [...]}`, `{"facilities": [...]}` and the like
        rows = next((v for v in data.values() if isinstance(v, list)), [])
    if not rows:
        return None
    row = rows[0]
    return row.get(key or "id") if isinstance(row, dict) else None


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8095")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--limit-ms", type=float, default=250.0)
    ap.add_argument("--warmup", type=int, default=1, help="untimed requests per endpoint first")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    code, _, body = fetch(base + "/openapi.json")
    if code != 200:
        print(f"cannot read {base}/openapi.json (status {code})")
        return 2
    paths = json.loads(body)["paths"]

    ids = {
        "shipment": first_id(base, "/api/v1/logistics/shipments?limit=1"),
        "vehicle": first_id(base, "/api/v1/logistics/vehicles"),
        "driver": first_id(base, "/api/v1/logistics/drivers"),
        "warehouse": first_id(base, "/api/v1/logistics/warehouses"),
        "facility": first_id(base, "/api/v1/facilities"),
    }

    targets: list[tuple[str, str]] = []
    for path, ops in sorted(paths.items()):
        if "get" not in ops or path in SKIP:
            continue
        if "{" not in path:
            targets.append((path, path))
        elif path in ID_ROUTES:
            ident = ids.get(ID_ROUTES[path])
            if ident is None:
                print(f"no id available for {path}")
                return 2
            placeholder = path[path.index("{") : path.index("}") + 1]
            targets.append((path, path.replace(placeholder, ident)))

    print(f"{'endpoint':62} {'status':>6} {'p50ms':>8} {'p95ms':>8} {'max':>8}")
    failed = False
    for template, url in targets:
        times: list[float] = []
        codes: set[int] = set()
        for _ in range(args.warmup):  # fill per-endpoint caches (the briefing calls Sarvam once)
            fetch(base + url)
        for _ in range(args.n):
            code, ms, _ = fetch(base + url)
            codes.add(code)
            times.append(ms)
        p50, p95 = statistics.median(times), percentile(times, 0.95)
        status = "200" if codes == {200} else ",".join(str(c) for c in sorted(codes))
        bad = codes != {200} or p95 > args.limit_ms
        failed = failed or bad
        print(f"{template:62} {status:>6} {p50:8.1f} {p95:8.1f} {max(times):8.1f}{'  <-- FAIL' if bad else ''}")
    print("FAIL" if failed else "OK", f"({len(targets)} endpoints, n={args.n}, limit {args.limit_ms:.0f} ms)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
