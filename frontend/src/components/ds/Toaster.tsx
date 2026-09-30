"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { dismissToast, getToasts, subscribeToasts, type ToastItem, type ToastTone } from "./toast-store";

export { toast } from "./toast-store";

const TONE: Record<ToastTone, { color: string; Icon: typeof Info }> = {
  info: { color: "var(--info)", Icon: Info },
  success: { color: "var(--green)", Icon: CheckCircle2 },
  warning: { color: "var(--amber)", Icon: AlertTriangle },
  critical: { color: "var(--red)", Icon: OctagonAlert },
};

const EMPTY: ToastItem[] = [];

function ToastCard({ t }: { t: ToastItem }) {
  const { color, Icon } = TONE[t.tone];
  const inner = (
    <>
      <Icon size={16} style={{ color }} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-text">{t.title}</p>
        {t.body && <p className="mt-0.5 text-[12px] text-muted">{t.body}</p>}
      </div>
    </>
  );
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-border-strong bg-surface-2 p-3 shadow-[var(--shadow-overlay)]"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {t.href ? (
        <Link href={t.href} className="flex min-w-0 flex-1 items-start gap-3">
          {inner}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3">{inner}</div>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(t.id)}
        className="rounded-sm p-0.5 text-muted hover:bg-surface-3 hover:text-text"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);
  const reduced = useReducedMotion();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="pointer-events-auto"
          >
            <ToastCard t={t} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
