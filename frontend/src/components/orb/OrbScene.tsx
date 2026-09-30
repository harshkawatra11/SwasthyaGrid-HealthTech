"use client";

import { useRef } from "react";
import type { RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import type { OrbPhase } from "@/lib/audio/levels";
import { Orb } from "./Orb";
import { ORB_CAMERA } from "./orb-scene-config";

/** Calls `onReady` after the second rendered frame, so the stage only fades in
 *  once real pixels exist (onCreated fires before the first frame is drawn). */
function FrameCounter({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 2) onReady?.();
  });
  return null;
}

/** The R3F canvas. The glass shell needs a real PMREM environment to refract
 *  and reflect, built from hand-placed Lightformers. No postprocessing bloom
 *  (it fills the canvas opaque); the glow is a CSS gradient behind the canvas. */
export function OrbScene({
  phase,
  reducedMotion,
  compact = false,
  pointer,
  onReady,
}: {
  phase: OrbPhase;
  reducedMotion: boolean;
  compact?: boolean;
  pointer?: RefObject<{ x: number; y: number }>;
  onReady?: () => void;
}) {
  return (
    <Canvas
      dpr={compact ? 1 : [1, 1.5]}
      camera={{ position: [0, 0, ORB_CAMERA.distance], fov: ORB_CAMERA.fov, near: 0.1, far: 30 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.1,
      }}
      style={{ position: "absolute", inset: 0, background: "transparent" }}
    >
      <FrameCounter onReady={onReady} />
      <ambientLight intensity={0.22} />
      <Orb phase={phase} reducedMotion={reducedMotion} pointer={pointer} />
      {!reducedMotion && (
        <>
          <ContactShadows position={[0, -1.14, 0]} opacity={0.18} scale={2.3} blur={2.8} far={0.7} color="#2dd4a7" />
          {/* background={false}: the environment only lights and refracts, it must not fill the canvas. */}
          <Environment resolution={256} background={false} environmentIntensity={1}>
            <Lightformer form="rect" intensity={4.5} color="#ffffff" position={[-3.2, 2.1, 3]} rotation={[0, 0.45, 0.18]} scale={[1.1, 3.8, 1]} />
            <Lightformer form="rect" intensity={2.8} color="#2dd4a7" position={[3.4, 0.9, 2]} rotation={[0, -0.65, -0.12]} scale={[0.7, 2.8, 1]} />
            <Lightformer form="rect" intensity={2.4} color="#4cc9e8" position={[-1.8, -3, 1.5]} rotation={[0.35, 0.15, 0]} scale={[2.4, 0.55, 1]} />
            <Lightformer form="rect" intensity={1.2} color="#9b87f5" position={[0, 3, -2]} scale={[4, 2, 1]} />
          </Environment>
        </>
      )}
    </Canvas>
  );
}
