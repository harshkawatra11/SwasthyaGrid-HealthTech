"use client";

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { OrbPhase } from "@/lib/audio/levels";
import { OrbFallback } from "./OrbFallback";
import { ORB_GLOW } from "./orb-math";

const OrbScene = lazy(() => import("./OrbScene").then((m) => ({ default: m.OrbScene })));

const WATCHDOG_MS = 1800;

let capabilityCache: boolean | null = null;

/** WebGL2 available and at least four cores. Computed once on the client. */
function detectGlassCapable(): boolean {
  if (capabilityCache !== null) return capabilityCache;
  let ok = true;
  try {
    ok = !!document.createElement("canvas").getContext("webgl2") && !(navigator.hardwareConcurrency < 4);
  } catch {
    ok = false;
  }
  capabilityCache = ok;
  return ok;
}

const noopSubscribe = () => () => {};

/** Test hook: forget the cached capability probe. */
export function resetOrbCapabilityCache() {
  capabilityCache = null;
}

/** The single entry point for the orb. Renders the WebGL glass orb on a dark
 *  stage, or the CSS `OrbFallback` (same size, no layout shift) under reduced
 *  motion, without WebGL2, on low power devices, or when the canvas has not
 *  produced a frame within 1800 ms. `phase` comes from `useVoice().state.phase`. */
export function OrbStage({ phase, size = 380 }: { phase: OrbPhase; size?: number }) {
  const reducedMotion = useReducedMotion();
  // Server snapshot says "not capable" so the server and first client render agree on the fallback.
  const capable = useSyncExternalStore(noopSubscribe, detectGlassCapable, () => false);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const pointer = useRef({ x: 0, y: 0 });

  const useStatic = reducedMotion || !capable;
  // Past the watchdog the CSS orb is shown, but the canvas stays mounted underneath so a slow
  // first load (shader compile, PMREM) still swaps to the glass orb once it renders.
  const showFallback = useStatic || (timedOut && !ready);

  useEffect(() => {
    if (useStatic || ready) return;
    const id = window.setTimeout(() => setTimedOut(true), WATCHDOG_MS);
    return () => window.clearTimeout(id);
  }, [useStatic, ready]);

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (useStatic) return;
    const r = e.currentTarget.getBoundingClientRect();
    pointer.current = { x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 };
  }
  function onPointerLeave() {
    pointer.current = { x: 0, y: 0 };
  }

  const shown = showFallback || ready;

  return (
    <motion.div
      data-testid="orb-stage"
      data-mode={showFallback ? "fallback" : "glass"}
      data-phase={phase}
      className="relative"
      style={{ width: size, height: size }}
      initial={false}
      animate={{ opacity: shown ? 1 : 0, scale: shown ? 1 : 0.97 }}
      transition={{ duration: reducedMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {/* Ambient glow: a CSS radial gradient behind the canvas, not bloom. */}
      <div
        aria-hidden
        className="absolute rounded-full transition-[background] duration-700"
        style={{ inset: "-14%", background: `radial-gradient(circle, ${ORB_GLOW[phase]}, transparent 70%)` }}
      />
      {showFallback && (
        <div className="absolute inset-0 grid place-items-center">
          <OrbFallback phase={phase} size={Math.round(size * 0.78)} />
        </div>
      )}
      {!useStatic && (
        <Suspense fallback={null}>
          <OrbScene phase={phase} reducedMotion={false} compact={size < 96} pointer={pointer} onReady={() => setReady(true)} />
        </Suspense>
      )}
    </motion.div>
  );
}
