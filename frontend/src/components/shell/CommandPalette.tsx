"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as RD from "@radix-ui/react-dialog";
import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useEntityIndex } from "@/lib/entity-index";
import { searchPalette, type PaletteEntry } from "@/lib/palette-search";
import { useScope, withScope } from "@/lib/scope";

type Props = { open: boolean; onClose: () => void };

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const index = useEntityIndex();
  const { scope } = useScope();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const entries = useMemo(() => searchPalette(index, query), [index, query]);
  const askText = query.trim();
  const rows: (PaletteEntry | { id: "ask"; group: "Ask"; label: string; href: string })[] = askText
    ? [...entries, { id: "ask", group: "Ask", label: `Ask SwasthyaGrid: ${askText}`, href: `/voice?ask=${encodeURIComponent(askText)}` }]
    : entries;
  const activeRow = rows[Math.min(active, rows.length - 1)];

  function go(href: string) {
    router.push(href.startsWith("/voice") ? href : withScope(href, scope));
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeRow) {
      e.preventDefault();
      go(activeRow.href);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search size={15} className="text-muted" aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={activeRow ? `palette-${activeRow.id}` : undefined}
          aria-label="Search pages, districts, facilities, shipments"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search pages, facilities, shipments, or ask a question"
          className="h-11 w-full bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
      </div>
      <div id="palette-list" role="listbox" className="max-h-80 overflow-y-auto py-1">
        {rows.length === 0 && <p className="px-4 py-3 text-[13px] text-muted">No matches.</p>}
        {rows.map((r, i) => {
          const header = rows[i - 1]?.group !== r.group ? r.group : null;
          return (
            <div key={r.id} role="presentation">
              {header && <p className="eyebrow px-4 pb-1 pt-2">{header}</p>}
              <div
                id={`palette-${r.id}`}
                role="option"
                aria-selected={i === active}
                onClick={() => go(r.href)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-4 py-2 text-[13px]",
                  i === active ? "bg-surface-3 text-text" : "text-muted",
                )}
              >
                {r.group === "Ask" && <Sparkles size={13} className="text-brand" aria-hidden />}
                <span className="truncate">{r.label}</span>
                {"sub" in r && r.sub && <span className="truncate text-[11px] text-faint">{r.sub}</span>}
                {i === active && <CornerDownLeft size={12} className="ml-auto text-faint" aria-hidden />}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function CommandPalette({ open, onClose }: Props) {
  return (
    <RD.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RD.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-lg border border-border-strong bg-surface-1 shadow-[var(--shadow-overlay)]"
        >
          <RD.Title className="sr-only">Command palette</RD.Title>
          <PaletteBody onClose={onClose} />
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
