export type LatLng = [number, number];

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Linear interpolation between two points (fine at the scale of a district). t is clamped to 0..1. */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Initial great-circle bearing from a to b in degrees, 0 = north, clockwise, range [0, 360). */
export function bearing(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const phi1 = a[0] * rad;
  const phi2 = b[0] * rad;
  const dLng = (b[1] - a[1]) * rad;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** Fraction of a tick interval that has elapsed, clamped to 0..1. */
export function tickFraction(nowMs: number, receivedAtMs: number, intervalMs = 1000): number {
  return clamp01((nowMs - receivedAtMs) / intervalMs);
}

/** Split a route polyline at the travelled index: the travelled part includes that point. */
export function splitRoute(path: LatLng[], travelledIndex: number): { travelled: LatLng[]; remaining: LatLng[] } {
  const i = Math.max(0, Math.min(path.length - 1, Math.floor(travelledIndex)));
  return { travelled: path.slice(0, i + 1), remaining: path.slice(i) };
}
