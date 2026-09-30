"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { STATUS_LABEL, statusVar, type ShipmentStatus } from "@/lib/domain";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { lerpLatLng, tickFraction, type LatLng } from "@/lib/map/geo";
import type { LivePosition, PositionsStore } from "@/lib/live/positions-store";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Markup for one truck: a 20px truck glyph (rotated by data-rot) above a compact label chip. */
export function truckIconHtml(shipmentId: string, status: ShipmentStatus, selected: boolean): string {
  const color = statusVar(status);
  return (
    `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;transform:translateY(-6px)">` +
    `<svg data-rot width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" style="transition:none;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .5))">` +
    `<rect x="7" y="1.5" width="6" height="5.5" rx="1.5" fill="${color}" stroke="var(--bg)" stroke-width="1"/>` +
    `<rect x="6" y="8" width="8" height="10.5" rx="1.5" fill="${color}" stroke="var(--bg)" stroke-width="1"/>` +
    `</svg>` +
    `<div style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;padding:1px 5px;border-radius:4px;background:var(--surface-2);` +
    `border:1px solid ${selected ? "var(--brand)" : "var(--border-strong)"};color:var(--text);font-size:10px;font-weight:600;line-height:14px">` +
    `<span>${esc(shipmentId)}</span>` +
    `<span style="width:6px;height:6px;border-radius:50%;background:${color}"></span>` +
    `<span style="color:${color};font-weight:500">${esc(STATUS_LABEL[status])}</span></div></div>`
  );
}

type Truck = {
  marker: L.Marker;
  from: LatLng;
  to: LatLng;
  current: LatLng;
  receivedAt: number;
  bearing: number;
  status: ShipmentStatus;
  shipmentId: string;
};

function makeIcon(t: Pick<Truck, "shipmentId" | "status">, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%)">${truckIconHtml(t.shipmentId, t.status, selected)}</div>`,
  });
}

function applyBearing(marker: L.Marker, deg: number): void {
  const el = marker.getElement()?.querySelector<SVGElement>("[data-rot]");
  if (el) el.style.transform = `rotate(${deg}deg)`;
}

export type LiveTruckLayerProps = {
  store: PositionsStore;
  onSelect?: (shipmentId: string) => void;
  selectedShipmentId?: string | null;
  delayedOnly?: boolean;
  /** Expected interval between ticks, used to scale interpolation. */
  tickMs?: number;
};

export function LiveTruckLayer({ store, onSelect, selectedShipmentId = null, delayedOnly = false, tickMs = 1000 }: LiveTruckLayerProps) {
  const map = useMap();
  const reduced = useReducedMotion();
  const trucksRef = useRef(new Map<string, Truck>());
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selectedShipmentId);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    selectedRef.current = selectedShipmentId;
    trucksRef.current.forEach((t) => {
      t.marker.setIcon(makeIcon(t, t.shipmentId === selectedShipmentId));
      applyBearing(t.marker, t.bearing);
    });
  }, [selectedShipmentId]);

  useEffect(() => {
    const trucks = trucksRef.current;
    const group = L.layerGroup().addTo(map);
    let raf = 0;

    const onSnapshot = (snap: { receivedAt: number; items: readonly LivePosition[] }) => {
      const seen = new Set<string>();
      for (const p of snap.items) {
        if (delayedOnly && p.status !== "delayed") continue;
        seen.add(p.vehicle_id);
        const target: LatLng = [p.lat, p.lng];
        const existing = trucks.get(p.vehicle_id);
        if (!existing) {
          const t: Truck = {
            marker: L.marker(target, { icon: makeIcon({ shipmentId: p.shipment_id, status: p.status }, p.shipment_id === selectedRef.current), keyboard: false }),
            from: target,
            to: target,
            current: target,
            receivedAt: snap.receivedAt,
            bearing: p.bearing,
            status: p.status,
            shipmentId: p.shipment_id,
          };
          t.marker.on("click", () => onSelectRef.current?.(t.shipmentId));
          t.marker.addTo(group);
          applyBearing(t.marker, p.bearing);
          trucks.set(p.vehicle_id, t);
        } else {
          existing.from = existing.current;
          existing.to = target;
          existing.receivedAt = snap.receivedAt;
          if (Number.isFinite(p.bearing) && p.bearing !== existing.bearing) {
            existing.bearing = p.bearing;
            applyBearing(existing.marker, p.bearing);
          }
          if (p.status !== existing.status || p.shipment_id !== existing.shipmentId) {
            existing.status = p.status;
            existing.shipmentId = p.shipment_id;
            existing.marker.setIcon(makeIcon(existing, p.shipment_id === selectedRef.current));
            applyBearing(existing.marker, existing.bearing);
          }
        }
      }
      for (const [id, t] of trucks) {
        if (!seen.has(id)) {
          group.removeLayer(t.marker);
          trucks.delete(id);
        }
      }
    };

    const frame = (now: number) => {
      trucks.forEach((t) => {
        const f = reduced ? 1 : tickFraction(now, t.receivedAt, tickMs);
        t.current = lerpLatLng(t.from, t.to, f);
        t.marker.setLatLng(t.current);
      });
      raf = requestAnimationFrame(frame);
    };

    onSnapshot(store.getSnapshot());
    const unsubscribe = store.subscribe(onSnapshot);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      trucks.clear();
      group.remove();
    };
  }, [map, store, delayedOnly, tickMs, reduced]);

  return null;
}
