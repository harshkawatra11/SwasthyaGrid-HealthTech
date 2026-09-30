export type HeatScale = {
  thresholds: [number, number, number, number];
  higherIsWorse: boolean;
};

/** 5 bins, index 0 = best, 4 = worst. null is the empty colour. */
export function heatBin(v: number | null, scale: HeatScale): number | null {
  if (v === null || Number.isNaN(v)) return null;
  const { thresholds, higherIsWorse } = scale;
  return higherIsWorse
    ? thresholds.filter((t) => v > t).length
    : thresholds.filter((t) => v < t).length;
}

export function heatColor(v: number | null, scale: HeatScale): string {
  const bin = heatBin(v, scale);
  return bin === null ? "var(--heat-empty)" : `var(--heat-${bin})`;
}

/** Legend labels for the five stops, in bin order 0..4. */
export function heatLegend(scale: HeatScale, format: (v: number) => string = String): string[] {
  const t = scale.thresholds.map(format);
  return scale.higherIsWorse
    ? [`<= ${t[0]}`, `<= ${t[1]}`, `<= ${t[2]}`, `<= ${t[3]}`, `> ${t[3]}`]
    : [`>= ${t[0]}`, `>= ${t[1]}`, `>= ${t[2]}`, `>= ${t[3]}`, `< ${t[3]}`];
}
