"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { STATUS_LABEL, statusVar, tint, type ShipmentStatus } from "@/lib/domain";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { lerpLatLng, tickFraction, type LatLng } from "@/lib/map/geo";
import type { LivePosition, PositionsStore } from "@/lib/live/positions-store";
import type { ChipSpec } from "./helpers";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const BOX =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>' +
  '<path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>';

/**
 * One label chip in the style of the dispatch reference: box glyph, id, then the status word on a
 * tint of its colour, with a small dot below-left marking the exact location.
 */
export type ChipOffset = { dx: number; dy: number; w: number; h: number };

export function chipHtml(id: string, status: ShipmentStatus, opts: { selected?: boolean; live?: boolean; stack?: number; off?: ChipOffset }): string {
  const color = statusVar(status);
  const stack = opts.stack ?? 0;
  const dot = opts.live
    ? `<span style="position:absolute;left:-5px;top:-5px;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid var(--bg);box-shadow:0 0 0 3px ${tint(color, 28)}"></span>`
    : `<span style="position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:var(--text-faint);border:1px solid var(--bg)"></span>`;
  const off = opts.off;
  const lead = leaderSvg(off);
  return (
    `<div style="position:absolute;left:0;top:0;pointer-events:none">${lead}${dot}` +
    `<div data-chip style="${off ? `transform:translate(${off.dx}px,${off.dy}px);` : ""}pointer-events:auto;cursor:pointer;position:absolute;left:-1px;bottom:${6 + stack}px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;` +
    `padding:2px 5px 2px 6px;border-radius:5px;background:color-mix(in srgb, var(--surface-1) 86%, transparent);backdrop-filter:blur(2px);` +
    `border:1px solid ${opts.selected ? "var(--brand)" : "var(--border-strong)"};box-shadow:0 2px 8px rgb(0 0 0 / .25);` +
    `font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:10.5px;line-height:15px;color:var(--text-muted)">` +
    `${BOX}<span style="color:var(--text)">${esc(id)}</span>` +
    `<span style="padding:0 5px;border-radius:3px;background:${tint(color, 16)};color:${color};font-weight:500">${esc(STATUS_LABEL[status])}</span></div></div>`
  );
}

/** Thin leader line from the location dot to the nearest edge of a displaced chip. */
export function leaderTarget(off: ChipOffset): [number, number] {
  const x0 = -1 + off.dx;
  const y0 = -6 + off.dy - off.h;
  return [Math.min(Math.max(0, x0), x0 + off.w), Math.min(Math.max(0, y0), y0 + off.h)];
}

function leaderSvg(off?: ChipOffset): string {
  if (!off || Math.hypot(off.dx, off.dy) < 8) return `<svg data-lead width="1" height="1" style="position:absolute;left:0;top:0;overflow:visible"></svg>`;
  const [x, y] = leaderTarget(off);
  return `<svg data-lead width="1" height="1" style="position:absolute;left:0;top:0;overflow:visible"><line x1="0" y1="0" x2="${x}" y2="${y}" stroke="var(--text-faint)" stroke-width="1"/></svg>`;
}

/** Greedy screen-space label placement: first free slot around the dot, preferring the previous slot. */
export function placeChips(
  items: ReadonlyArray<{ key: string; x: number; y: number; w: number; h: number }>,
  prev: ReadonlyMap<string, { dx: number; dy: number }>,
): Map<string, { dx: number; dy: number }> {
  const placed: Array<{ l: number; t: number; r: number; b: number }> = [];
  const out = new Map<string, { dx: number; dy: number }>();
  const hits = (l: number, t: number, r: number, b: number) =>
    placed.some((p) => l < p.r + 2 && r > p.l - 2 && t < p.b + 2 && b > p.t - 2);
  for (const it of items) {
    const rows = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];
    const cols = [0, it.w * 0.55, -it.w * 0.55, it.w + 10, -(it.w + 10)];
    const cands: Array<{ dx: number; dy: number }> = [];
    const pv = prev.get(it.key);
    if (pv) cands.push(pv);
    for (const r of rows) for (const c of cols) cands.push({ dx: Math.round(c), dy: Math.round(r * (it.h + 3)) });
    const rest = cands.slice(pv ? 1 : 0).sort((a, b) => Math.hypot(a.dx, a.dy * 1.4) - Math.hypot(b.dx, b.dy * 1.4));
    const ordered = pv ? [pv, ...rest] : rest;
    let chosen = ordered[0];
    for (const c of ordered) {
      const l = it.x - 1 + c.dx;
      const b = it.y - 6 + c.dy;
      if (!hits(l, b - it.h, l + it.w, b)) {
        chosen = c;
        break;
      }
    }
    const l = it.x - 1 + chosen.dx;
    const b = it.y - 6 + chosen.dy;
    placed.push({ l, t: b - it.h, r: l + it.w, b });
    out.set(it.key, chosen);
  }
  return out;
}

function makeIcon(id: string, status: ShipmentStatus, opts: { selected?: boolean; live?: boolean; stack?: number; off?: ChipOffset }): L.DivIcon {
  return L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0], html: chipHtml(id, status, opts) });
}

type Moving = {
  marker: L.Marker;
  from: LatLng;
  to: LatLng;
  current: LatLng;
  receivedAt: number;
  status: ShipmentStatus;
  shipmentId: string;
};

export type ChipLayerProps = {
  store: PositionsStore;
  anchored: readonly ChipSpec[];
  selectedId: string | null;
  onSelect: (shipmentId: string) => void;
  /** null shows everything; otherwise chips whose id is not in the set are dimmed. */
  matchIds: ReadonlySet<string> | null;
  tickMs?: number;
};

export function ChipLayer({ store, anchored, selectedId, onSelect, matchIds, tickMs = 1000 }: ChipLayerProps) {
  const map = useMap();
  const reduced = useReducedMotion();
  const movingRef = useRef(new Map<string, Moving>());
  const staticRef = useRef(new Map<string, { marker: L.Marker; spec: ChipSpec }>());
  const groupRef = useRef<L.LayerGroup | null>(null);
  const selectedRef = useRef(selectedId);
  const matchRef = useRef(matchIds);
  const onSelectRef = useRef(onSelect);
  const offsetsRef = useRef(new Map<string, ChipOffset>());
  const requestRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Label placement: keep chips from covering each other, with a leader line to the true location.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timer = null;
      const entries: Array<{ key: string; marker: L.Marker; priority: number }> = [];
      movingRef.current.forEach((m, k) =>
        entries.push({ key: `m:${k}`, marker: m.marker, priority: m.shipmentId === selectedRef.current ? 0 : 1 }),
      );
      staticRef.current.forEach((v, k) =>
        entries.push({ key: `s:${k}`, marker: v.marker, priority: k === selectedRef.current ? 0 : 2 }),
      );
      entries.sort((a, b) => a.priority - b.priority);
      const items = entries.map((e) => {
        const chip = e.marker.getElement()?.querySelector<HTMLElement>("[data-chip]");
        const pt = map.latLngToContainerPoint(e.marker.getLatLng());
        return { key: e.key, x: pt.x, y: pt.y, w: chip?.offsetWidth || 130, h: chip?.offsetHeight || 19, chip, marker: e.marker };
      });
      const prev = new Map<string, { dx: number; dy: number }>();
      offsetsRef.current.forEach((v, k) => prev.set(k, { dx: v.dx, dy: v.dy }));
      const placed = placeChips(items, prev);
      for (const it of items) {
        const c = placed.get(it.key) ?? { dx: 0, dy: 0 };
        const off: ChipOffset = { dx: c.dx, dy: c.dy, w: it.w, h: it.h };
        offsetsRef.current.set(it.key, off);
        if (it.chip) {
          it.chip.style.transform = c.dx || c.dy ? `translate(${c.dx}px,${c.dy}px)` : "";
          const lead = it.marker.getElement()?.querySelector("[data-lead]");
          if (lead) {
            if (Math.hypot(c.dx, c.dy) < 8) lead.innerHTML = "";
            else {
              const [x, y] = leaderTarget(off);
              lead.innerHTML = `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="var(--text-faint)" stroke-width="1"/>`;
            }
          }
        }
      }
    };
    const request = () => {
      if (timer === null) timer = setTimeout(run, 250);
    };
    requestRef.current = request;
    map.on("zoomend moveend", request);
    return () => {
      map.off("zoomend moveend", request);
      if (timer !== null) clearTimeout(timer);
    };
  }, [map]);

  // Live trucks: markers follow the positions store and are interpolated between ticks every frame.
  useEffect(() => {
    const moving = movingRef.current;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    let raf = 0;

    const opacityFor = (id: string) => (matchRef.current && !matchRef.current.has(id) ? 0.25 : 1);
    const iconFor = (vehicleId: string, id: string, status: ShipmentStatus) =>
      makeIcon(id, status, { live: true, selected: id === selectedRef.current, off: offsetsRef.current.get(`m:${vehicleId}`) });

    const onSnapshot = (snap: { receivedAt: number; items: readonly LivePosition[] }) => {
      const seen = new Set<string>();
      for (const p of snap.items) {
        seen.add(p.vehicle_id);
        const target: LatLng = [p.lat, p.lng];
        const ex = moving.get(p.vehicle_id);
        if (!ex) {
          const m: Moving = {
            marker: L.marker(target, {
              icon: iconFor(p.vehicle_id, p.shipment_id, p.status),
              keyboard: false,
              zIndexOffset: 500,
              opacity: opacityFor(p.shipment_id),
            }),
            from: target,
            to: target,
            current: target,
            receivedAt: snap.receivedAt,
            status: p.status,
            shipmentId: p.shipment_id,
          };
          m.marker.on("click", () => onSelectRef.current(m.shipmentId));
          m.marker.addTo(group);
          moving.set(p.vehicle_id, m);
        } else {
          ex.from = ex.current;
          ex.to = target;
          ex.receivedAt = snap.receivedAt;
          if (p.status !== ex.status || p.shipment_id !== ex.shipmentId) {
            ex.status = p.status;
            ex.shipmentId = p.shipment_id;
            ex.marker.setIcon(iconFor(p.vehicle_id, p.shipment_id, p.status));
            ex.marker.setOpacity(opacityFor(p.shipment_id));
          }
        }
      }
      for (const [id, m] of moving) {
        if (!seen.has(id)) {
          group.removeLayer(m.marker);
          moving.delete(id);
          offsetsRef.current.delete(`m:${id}`);
        }
      }
      requestRef.current();
    };

    const frame = (now: number) => {
      moving.forEach((m) => {
        const f = reduced ? 1 : tickFraction(now, m.receivedAt, tickMs);
        m.current = lerpLatLng(m.from, m.to, f);
        m.marker.setLatLng(m.current);
      });
      raf = requestAnimationFrame(frame);
    };

    onSnapshot(store.getSnapshot());
    const unsubscribe = store.subscribe(onSnapshot);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      moving.clear();
      group.remove();
      groupRef.current = null;
    };
  }, [map, store, tickMs, reduced]);

  // Chips for shipments that are parked (loading, arrived, delivered, cancelled).
  useEffect(() => {
    const group = groupRef.current;
    const statics = staticRef.current;
    if (!group) return;
    statics.forEach((s) => group.removeLayer(s.marker));
    statics.clear();
    for (const spec of anchored) {
      const marker = L.marker([spec.lat, spec.lng], {
        icon: makeIcon(spec.shipmentId, spec.status, {
          selected: spec.shipmentId === selectedRef.current,
          off: offsetsRef.current.get(`s:${spec.shipmentId}`),
        }),
        keyboard: false,
        zIndexOffset: 100,
        opacity: matchRef.current && !matchRef.current.has(spec.shipmentId) ? 0.25 : 1,
      });
      marker.on("click", () => onSelectRef.current(spec.shipmentId));
      marker.addTo(group);
      statics.set(spec.shipmentId, { marker, spec });
    }
    requestRef.current();
    return () => {
      statics.forEach((s) => s.marker.remove());
      statics.clear();
    };
  }, [anchored, map, store, reduced]);

  // Selection and search dimming update icons and opacity in place.
  useEffect(() => {
    selectedRef.current = selectedId;
    matchRef.current = matchIds;
    const op = (id: string) => (matchIds && !matchIds.has(id) ? 0.25 : 1);
    movingRef.current.forEach((m, vehicleId) => {
      m.marker.setIcon(makeIcon(m.shipmentId, m.status, { live: true, selected: m.shipmentId === selectedId, off: offsetsRef.current.get(`m:${vehicleId}`) }));
      m.marker.setOpacity(op(m.shipmentId));
    });
    staticRef.current.forEach(({ marker, spec }) => {
      marker.setIcon(makeIcon(spec.shipmentId, spec.status, { selected: spec.shipmentId === selectedId, off: offsetsRef.current.get(`s:${spec.shipmentId}`) }));
      marker.setOpacity(op(spec.shipmentId));
    });
    requestRef.current();
  }, [selectedId, matchIds, anchored]);

  return null;
}

/** Where a shipment currently is on the map: live position first, then its parked chip. */
export function locateShipment(store: PositionsStore, anchored: readonly ChipSpec[], shipmentId: string): LatLng | null {
  const live = store.getSnapshot().items.find((p) => p.shipment_id === shipmentId);
  if (live) return [live.lat, live.lng];
  const a = anchored.find((c) => c.shipmentId === shipmentId);
  return a ? [a.lat, a.lng] : null;
}
