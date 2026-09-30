"use client";

import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import * as THREE from "three";
import { analyserRms, orbAudio, type OrbPhase } from "@/lib/audio/levels";
import { createOrbGeometry } from "./orb-geometry";
import { colorLerpFactor, envelopeTarget, orbScales, phaseColors, stepEnvelope } from "./orb-math";

const VERTEX = `varying vec3 vNormal; varying vec3 vPosition; varying vec3 vView; void main(){ vNormal=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vPosition=position; vView=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;

const FRAGMENT = `uniform float uTime; uniform float uAmplitude; uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vNormal; varying vec3 vPosition; varying vec3 vView; void main(){ float drift=sin(vPosition.x*2.4+uTime*.32)*.07; float blend=smoothstep(-.62,.62,vPosition.y+drift); vec3 col=mix(uBottom,uTop,blend); float fresnel=pow(1.0-max(dot(normalize(vNormal),normalize(vView)),0.0),2.4); float core=.13+uAmplitude*.1; float alpha=core*(.72+fresnel*.6); gl_FragColor=vec4(col*(.72+fresnel*.5),alpha); }`;

/** The glass orb. Unit-radius geometry at every size (the camera frames it,
 *  CSS size never scales world geometry), and `useFrame` is the only writer of
 *  scale: no GSAP, no second transform owner. Motion follows measured audio. */
export function Orb({
  phase,
  reducedMotion,
  pointer,
}: {
  phase: OrbPhase;
  reducedMotion: boolean;
  pointer?: RefObject<{ x: number; y: number }>;
}) {
  const group = useRef<THREE.Group>(null);
  const volume = useRef<THREE.Mesh>(null);
  const volumeMaterial = useRef<THREE.ShaderMaterial>(null);
  const envelope = useRef(0);
  const elapsed = useRef(0);
  const geometry = useMemo(() => createOrbGeometry(reducedMotion), [reducedMotion]);
  // Stable uniforms: a fresh object per render would make R3F reset the lerped colours.
  const uniforms = useMemo(() => {
    const c = phaseColors("idle");
    return { uTime: { value: 0 }, uAmplitude: { value: 0 }, uTop: { value: c.top }, uBottom: { value: c.bottom } };
  }, []);

  useFrame((_state, delta) => {
    // Freeze the work while the tab is hidden; audio and the socket keep running elsewhere.
    if (document.hidden || !group.current) return;
    elapsed.current += delta * (phase === "thinking" ? 1.8 : 1);

    const analyser = phase === "speaking" ? orbAudio.ttsAnalyser : phase === "thinking" ? null : orbAudio.micAnalyser;
    const raw = analyser ? analyserRms(analyser) : 0;
    envelope.current = stepEnvelope(envelope.current, envelopeTarget(raw, phase), delta);
    const a = envelope.current;

    const px = pointer?.current.x ?? 0;
    const py = pointer?.current.y ?? 0;
    const g = group.current;
    g.rotation.x += (py * 0.18 + Math.sin(elapsed.current * 0.32) * 0.025 - g.rotation.x) * Math.min(1, delta * 4);
    g.rotation.y += (-px * 0.24 + Math.sin(elapsed.current * 0.21) * 0.08 - g.rotation.y) * Math.min(1, delta * 4);
    g.rotation.z = Math.sin(elapsed.current * 0.27) * 0.018;

    const scales = orbScales(a, phase, elapsed.current);
    g.scale.setScalar(scales.group);
    volume.current?.scale.setScalar(scales.volume);

    const mat = volumeMaterial.current;
    if (mat) {
      mat.uniforms.uTime.value = elapsed.current;
      mat.uniforms.uAmplitude.value = a;
      const target = phaseColors(phase);
      const k = colorLerpFactor(delta);
      (mat.uniforms.uTop.value as THREE.Color).lerp(target.top, k);
      (mat.uniforms.uBottom.value as THREE.Color).lerp(target.bottom, k);
    }
  });

  return (
    <group ref={group}>
      <mesh geometry={geometry} renderOrder={2}>
        <MeshTransmissionMaterial
          color="#f8fffd"
          transmission={1}
          roughness={0.06}
          ior={1.48}
          thickness={1.05}
          backside
          backsideThickness={0.42}
          samples={reducedMotion ? 2 : 6}
          resolution={reducedMotion ? 128 : 256}
          chromaticAberration={0.035}
          anisotropicBlur={0.08}
          distortion={0.025}
          distortionScale={0.22}
          temporalDistortion={reducedMotion ? 0 : 0.012}
          attenuationColor="#bfeee0"
          attenuationDistance={2.6}
          envMapIntensity={1.3}
          clearcoat={1}
          clearcoatRoughness={0.04}
        />
      </mesh>
      <mesh ref={volume} scale={0.78} renderOrder={0}>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial
          ref={volumeMaterial}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={uniforms}
          vertexShader={VERTEX}
          fragmentShader={FRAGMENT}
        />
      </mesh>
      <mesh position={[-0.48, 0.45, 0.78]} scale={[0.11, 0.42, 0.07]} rotation={[0.2, 0.25, -0.45]} renderOrder={3}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.48} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[0.42, -0.54, 0.7]} scale={[0.22, 0.08, 0.06]} rotation={[0, 0, 0.2]} renderOrder={3}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.46} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
