'use client';

// ─── GroundMist ─────────────────────────────────────────────────────────────
// Volumetric-ish low-altitude mist made of camera-facing soft billboards.
// Implementation choice (a): face-camera billboards with a soft circular alpha
// mask. Picked over a custom-shader plane because it's allocation-free per
// frame, sorts cleanly against the existing fogExp2, and reads as drifting
// "slabs" of haze with no GPU pipeline surprises.

import { useRef, useMemo, useEffect, type JSX } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { makeRng, hashString } from '@/lib/rng';

export interface GroundMistProps {
  /** Hex color, tinted from mood (caller passes palette[1] or skyBottomColor). */
  color: string;
  /** Covers the level path (extends in -Z). */
  levelDepth: number;
  /** 0..1, mood-driven multiplier on instance count. */
  density: number;
  /**
   * Seed string for deterministic puff layout. Use generationId so the same
   * dream produces the same mist arrangement on reload. Defaults to a static
   * string if omitted (mist will be identical across all dreams when not passed).
   */
  seed?: string;
}

// State layout per instance: [x, y, z, phase, scale, opacityMul]
const STATE_STRIDE = 6;

// Bounds — mist lives just above ground at y=-4, with platforms starting y=-2.
const X_HALF = 50;
const Y_MIN = -3;
const Y_MAX = 1;
const X_WRAP = 60;
const DRIFT_SPEED = 0.5; // u/s baseline
const SCALE_MIN = 5;
const SCALE_MAX = 12;

// Soft circular alpha mask — generated once, shared across all instances so
// every puff fades smoothly at its edges without needing a custom shader.
function makeSoftDiscTexture(): THREE.Texture {
  const SIZE = 128;
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : null;
  if (!canvas) {
    // SSR fallback — empty texture, will be replaced client-side on hydration.
    return new THREE.Texture();
  }
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export default function GroundMist({ color, levelDepth, density, seed }: GroundMistProps): JSX.Element {
  // count = round(density * 50) clamped to [10, 60]. density=0 short-circuits.
  const count = density <= 0
    ? 0
    : Math.min(60, Math.max(10, Math.round(density * 50)));

  // One-time soft mask shared by all puff materials. Disposed on unmount
  // because the component owns the CanvasTexture (audit HIGH-2 fix).
  const alphaMap = useMemo<THREE.Texture>(() => makeSoftDiscTexture(), []);
  useEffect(() => () => alphaMap.dispose(), [alphaMap]);

  // zHalf reaches from in-front of camera (+10) to far end of level path.
  const zFar = -levelDepth + 10;
  const zNear = 10;

  // Pre-allocated per-instance state — zero allocations during useFrame.
  // Deterministic RNG seeded with `seed` so the same dream reloads to the
  // same puff layout (audit HIGH-1 fix — was Math.random).
  const state = useMemo<Float32Array>(() => {
    const rng = makeRng(hashString(seed ?? 'ground-mist-default', 31));
    const arr = new Float32Array(count * STATE_STRIDE);
    for (let i = 0; i < count; i++) {
      const b = i * STATE_STRIDE;
      arr[b + 0] = (rng() - 0.5) * (X_HALF * 2);                    // x
      arr[b + 1] = Y_MIN + rng() * (Y_MAX - Y_MIN);                 // y
      arr[b + 2] = zFar + rng() * (zNear - zFar);                   // z
      arr[b + 3] = rng() * Math.PI * 2;                             // phase
      arr[b + 4] = SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN);     // scale
      arr[b + 5] = 0.18 + rng() * 0.17;                             // opacity 0.18..0.35
    }
    return arr;
  }, [count, zFar, zNear, seed]);

  // RNG-backed wrap reseed — preserves determinism for the drift loop without
  // calling Math.random inside useFrame. We pre-compute 32 sample z's keyed
  // off seed so wrap-around resets cycle deterministically.
  const wrapPool = useMemo<Float32Array>(() => {
    const rng = makeRng(hashString(seed ?? 'ground-mist-default', 91));
    const arr = new Float32Array(32);
    for (let i = 0; i < 32; i++) arr[i] = zFar + rng() * (zNear - zFar);
    return arr;
  }, [zFar, zNear, seed]);
  const wrapCursor = useRef(0);

  // Refs to each Billboard group — we mutate .position directly in useFrame.
  const groupRefs = useRef<Array<THREE.Group | null>>([]);
  if (groupRefs.current.length !== count) {
    groupRefs.current = new Array<THREE.Group | null>(count).fill(null);
  }

  useFrame((_, delta) => {
    if (count === 0) return;
    for (let i = 0; i < count; i++) {
      const g = groupRefs.current[i];
      if (!g) continue;
      const b = i * STATE_STRIDE;
      // Advance phase, then drift x by sine-modulated DRIFT_SPEED.
      const phase = state[b + 3] + delta * 0.35;
      state[b + 3] = phase;
      const sway = Math.sin(phase) * 0.6 + 1.0; // 0.4..1.6 of base speed
      state[b + 0] += DRIFT_SPEED * sway * delta;
      // Wrap horizontally — when off one side, jump to the opposite side and
      // pick a new z from the pre-computed RNG pool so we don't call
      // Math.random inside useFrame (audit HIGH-1 fix).
      if (state[b + 0] > X_WRAP) {
        state[b + 0] = -X_WRAP;
        state[b + 2] = wrapPool[wrapCursor.current];
        wrapCursor.current = (wrapCursor.current + 1) & 31;
      } else if (state[b + 0] < -X_WRAP) {
        state[b + 0] = X_WRAP;
        state[b + 2] = wrapPool[wrapCursor.current];
        wrapCursor.current = (wrapCursor.current + 1) & 31;
      }
      g.position.set(state[b + 0], state[b + 1], state[b + 2]);
    }
  });

  if (count === 0) return <group />;

  // Build puff elements. Each is a Billboard so it always faces camera.
  // depthWrite=false + NormalBlending lets puffs overlap without z-fighting
  // and lets the scene's fogExp2 still apply naturally.
  const puffs: JSX.Element[] = [];
  for (let i = 0; i < count; i++) {
    const b = i * STATE_STRIDE;
    const scale = state[b + 4];
    const opacity = state[b + 5];
    puffs.push(
      <Billboard
        key={i}
        ref={(g: THREE.Group | null) => { groupRefs.current[i] = g; }}
        position={[state[b + 0], state[b + 1], state[b + 2]]}
      >
        <mesh scale={scale} renderOrder={1}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            color={color}
            alphaMap={alphaMap}
            transparent
            opacity={opacity}
            depthWrite={false}
            blending={THREE.NormalBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </Billboard>
    );
  }

  return <group>{puffs}</group>;
}
