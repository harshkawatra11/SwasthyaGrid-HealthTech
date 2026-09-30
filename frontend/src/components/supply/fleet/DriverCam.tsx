"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { fmtClock } from "@/lib/format";
import { SourceFooter } from "../lib/parts";

const SEC = "Supply chain / Fleet";

/** A stand-in in-cab camera feed. There is no real camera hardware behind this
 *  simulator, so the frame is deliberately drawn (not a stock photo) and
 *  labelled as a sample feed rather than presented as a live stream. */
function CameraFrame({ driverName, moving }: { driverName: string | null; moving: boolean }) {
  return (
    <svg viewBox="0 0 400 240" role="img" aria-label="Sample in-cab driver camera view" className="h-auto w-full">
      <defs>
        <radialGradient id="cam-vignette" cx="50%" cy="42%" r="75%">
          <stop offset="55%" stopColor="#0c1116" stopOpacity={0} />
          <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
        </radialGradient>
        <linearGradient id="cam-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1b2530" />
          <stop offset="100%" stopColor="#0c1116" />
        </linearGradient>
      </defs>

      <rect width="400" height="240" fill="url(#cam-sky)" />

      {/* windscreen pillars framing the shot, so it reads as a cab-cam and not a random photo */}
      <path d="M0 0 L46 0 L20 240 L0 240 Z" fill="#05070a" />
      <path d="M400 0 L354 0 L380 240 L400 240 Z" fill="#05070a" />
      <rect x="0" y="0" width="400" height="14" fill="#05070a" />

      {/* road receding to a vanishing point, dashed centre line */}
      <polygon points="150,240 250,240 208,120 192,120" fill="#22262b" />
      <line x1="200" y1="240" x2="200" y2="128" stroke="#c9a227" strokeWidth={3} strokeDasharray="10 10" opacity={0.85} />

      {/* driver silhouette, lower third, dashboard glow */}
      <rect x="60" y="196" width="280" height="44" fill="#11161c" />
      <rect x="60" y="196" width="280" height="6" fill="#1c2733" />
      <circle cx="122" cy="152" r="30" fill="#171d24" stroke="#2a323b" strokeWidth={2} />
      <circle cx="122" cy="144" r="13" fill="#3a4652" />
      <path d="M100 168 Q122 152 144 168 L144 196 L100 196 Z" fill="#2a323b" />
      <rect x="96" y="182" width="52" height="10" rx="3" fill="#3a4652" opacity={0.7} />

      <rect width="400" height="240" fill="url(#cam-vignette)" />

      {/* scanlines for a camera-feed texture */}
      <g opacity={0.06}>
        {Array.from({ length: 30 }).map((_, i) => (
          <line key={i} x1="0" y1={i * 8} x2="400" y2={i * 8} stroke="#fff" strokeWidth={1} />
        ))}
      </g>

      {moving && (
        <g opacity={0.5}>
          <circle cx="200" cy="180" r="3" fill="#fff">
            <animate attributeName="cy" values="180;150;180" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite" />
          </circle>
        </g>
      )}

      <text x="12" y="230" fontSize="11" fill="#8b95a0" fontFamily="var(--font-geist-mono), monospace">
        {driverName ?? "Unassigned"}
      </text>
    </svg>
  );
}

export function DriverCam({ driverName, moving }: { driverName: string | null; moving: boolean }) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(fmtClock(new Date().toISOString()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card
      eyebrow="Driver cam"
      title={driverName ? `${driverName}, sample feed` : "No driver assigned"}
      footer={<SourceFooter source="illustrative sample feed, not a real camera" section={SEC} />}
    >
      <div className="relative overflow-hidden rounded-md border border-border">
        <CameraFrame driverName={driverName} moving={moving} />
        <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
          <span className={moving ? "h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--red)]" : "h-1.5 w-1.5 rounded-full bg-[var(--text-faint)]"} aria-hidden />
          {moving ? "Sample feed" : "Idle"}
        </div>
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-sm bg-black/55 px-2 py-1 text-[10px] text-white/80">
          <Camera size={11} aria-hidden />
          Cab camera
        </div>
        {now && (
          <div className="num absolute bottom-2 right-2 rounded-sm bg-black/55 px-2 py-1 text-[10px] text-white/80">{now}</div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        A drawn placeholder standing in for an in-cab camera. No vehicle in this demo carries real camera hardware.
      </p>
    </Card>
  );
}
