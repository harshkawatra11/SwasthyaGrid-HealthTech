"use client";

import { useEffect, useRef } from "react";
import { analyserRms, orbAudio, type OrbPhase } from "@/lib/audio/levels";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { envelopeTarget, orbScales, stepEnvelope, ORB_CSS_COLORS, ORB_GLOW } from "./orb-math";

/** The CSS orb: a radial gradient of the phase colours on a 1px border circle.
 *  Used when WebGL is unavailable, on low power devices, under reduced motion,
 *  and as the compact orb in the topbar (never a second WebGL canvas). Its
 *  scale follows the same audio envelope as the glass orb, written straight to
 *  the element from a requestAnimationFrame loop (no React state per frame). */
export function OrbFallback({ phase, size = 320, className }: { phase: OrbPhase; size?: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const envelope = useRef(0);
  const colors = ORB_CSS_COLORS[phase];

  useEffect(() => {
    if (reduced) {
      if (ref.current) ref.current.style.transform = "";
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      const el = ref.current;
      if (!el || document.hidden) return;
      const analyser = phase === "speaking" ? orbAudio.ttsAnalyser : phase === "thinking" ? null : orbAudio.micAnalyser;
      const raw = analyser ? analyserRms(analyser) : 0;
      envelope.current = stepEnvelope(envelope.current, envelopeTarget(raw, phase), delta);
      // A larger swing than the glass orb: the CSS orb has no refraction to carry the motion.
      const s = 1 + (orbScales(envelope.current, phase, now / 1000).group - 1) * 3;
      el.style.transform = `scale(${s.toFixed(4)})`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, reduced]);

  return (
    <div
      ref={ref}
      data-testid="orb-fallback"
      data-phase={phase}
      aria-hidden
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        border: "1px solid rgb(255 255 255 / 0.22)",
        background: `radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.55) 0%, transparent 22%), radial-gradient(circle at 50% 60%, ${colors.top} 0%, ${colors.bottom} 62%, transparent 100%)`,
        boxShadow: `0 0 ${Math.round(size * 0.35)}px ${ORB_GLOW[phase]}, inset 0 0 ${Math.round(size * 0.18)}px rgb(255 255 255 / 0.14)`,
        opacity: phase === "idle" ? 0.7 : 1,
        transition: "opacity 0.4s, background 0.4s, box-shadow 0.4s",
        willChange: reduced ? undefined : "transform",
      }}
    />
  );
}
