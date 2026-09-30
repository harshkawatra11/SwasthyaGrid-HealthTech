export const PROVENANCE_TEXT =
  "Simulated operational data. Routes: OpenStreetMap contributors via OSRM. Boundaries: geoBoundaries (ODbL).";

/** Footer required on every supply page (plan 4.1 item 6). */
export function ProvenanceFooter() {
  return (
    <footer data-testid="provenance-footer" className="mt-6 border-t border-border pt-3 text-[11px] text-faint">
      {PROVENANCE_TEXT}
    </footer>
  );
}
