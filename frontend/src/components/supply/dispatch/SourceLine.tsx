import { PROVENANCE } from "./helpers";

/** Card footer line: `Source: ...` on the left, the sub-section label on the right (consulting bar item 9). */
export function SourceLine({ source, sub }: { source: string; sub: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate">Source: {source}</span>
      <span className="shrink-0">{sub}</span>
    </div>
  );
}

/** Provenance footer that ends every supply page (plan 4.1 item 6). */
export function ProvenanceFooter() {
  return (
    <p data-testid="provenance-footer" className="mt-6 border-t border-border pt-3 text-[11px] text-faint">
      {PROVENANCE}
    </p>
  );
}
