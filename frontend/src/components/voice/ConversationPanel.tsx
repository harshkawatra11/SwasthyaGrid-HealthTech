"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { cn } from "@/lib/cn";
import type { TranscriptLine } from "@/lib/voice/protocol";
import { FactCard } from "./FactCard";

export function TranscriptBubble({ line }: { line: TranscriptLine }) {
  const officer = line.speaker === "officer";
  return (
    <li className={cn("flex flex-col gap-1.5", officer ? "items-end" : "items-start")} data-speaker={line.speaker}>
      {!officer && line.trace.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Data checked">
          {line.trace.map((t, i) => (
            <li
              key={`${t.name}-${i}`}
              className={cn(
                "rounded-sm border px-1.5 py-0.5 text-[11px]",
                t.ok ? "border-border bg-surface-2 text-muted" : "border-[var(--risk-critical)] text-[var(--risk-critical)]",
              )}
            >
              {t.label}
            </li>
          ))}
        </ul>
      )}
      <div
        className={cn(
          "max-w-[92%] whitespace-pre-wrap rounded-md px-3 py-2 text-[13px] leading-relaxed",
          officer ? "bg-brand-soft text-text" : "border border-border bg-surface-2 text-text",
          line.partial && "italic text-muted",
          line.interrupted && "opacity-70",
        )}
      >
        {line.text || (line.streaming ? "..." : "")}
        {line.interrupted && <span className="ml-1 text-[11px] text-muted">(stopped)</span>}
      </div>
      {!officer && line.cards.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          {line.cards.map((c, i) => (
            <FactCard key={`${c.type}-${i}`} card={c} />
          ))}
        </div>
      )}
    </li>
  );
}

export function ConversationPanel({
  lines,
  onSend,
  sendLabel = "Send",
}: {
  lines: TranscriptLine[];
  onSend: (text: string) => void;
  sendLabel?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <Card title="Conversation" className="flex h-full flex-col lg:absolute lg:inset-0 [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-1" role="log" aria-label="Conversation transcript">
        {lines.length === 0 ? (
          <p className="text-[13px] text-muted">
            Ask about a district, a facility, stock or a shipment. Answers appear here with the data they used.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((l) => (
              <TranscriptBubble key={l.id} line={l} />
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={submit} className="mt-3 flex gap-2 border-t border-border pt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Type a question"
          placeholder="Type a question"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text placeholder:text-faint focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label={sendLabel}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-[12px] font-semibold text-bg disabled:opacity-40"
        >
          <Send size={14} aria-hidden />
          {sendLabel}
        </button>
      </form>
    </Card>
  );
}
