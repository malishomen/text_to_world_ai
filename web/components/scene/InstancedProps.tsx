'use client';

// ─── InstancedProps ─────────────────────────────────────────────────────────
// Per-mood low-poly world props scattered across the playable region.
// Pure visual: NO physics, NO colliders, NO interactivity.
//
// Architecture:
//  - Single InstancedMesh per geometry (1- or 2-sub-mesh per mood variant).
//  - Placement is deterministic — seeded by hashString(seed, 13). Same dream
//    string → identical scatter every reload.
//  - Path-exclusion: each candidate position is rejected if it lies within
//    `r` of any entry in `exclusionPath` (XZ distance). Up to 8 retries
//    per slot; on persistent collision the instance is parked off-screen
//    at y=-100 (still in the InstancedMesh — costs nothing extra).
//  - ZERO allocations inside `useFrame`: every Vector3/Quaternion/Object3D/
//    Matrix4 used during animation is owned by a `useRef` outside the loop.
//  - Unknown mood → component returns null (no-op, safe default).

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { makeRng, hashString } from '@/lib/rng';

export interface InstancedPropsProps {
  mood: string;
  levelDepth: number;
  palette: string[];
  seed: string;
  exclusionPath: Array<{ x: number; z: number; r: number }>;
}

// One placed instance: position, Y-rotation, uniform scale.
// Stored as a flat plain object — no THREE wrappers, no GC churn.
interface InstanceTransform {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
}

// Variant descriptor (chosen by mood). `null` ⇒ this component renders nothing.
interface PropVariant {
  kind: 'tree' | 'mushroom' | 'antenna' | 'asteroid' | 'column' | 'spire' | 'obelisk' | 'orb';
  count: number;          // instances per sub-mesh
  baseY: number;          // resting y for the prop's anchor
  yJitter: number;        // additive random range applied per-instance
  scaleMin: number;
  scaleMax: number;
}

function variantFor(mood: string): PropVariant | null {
  switch (mood) {
    case 'nightmare':    return { kind: 'tree',     count: 80,  baseY: -3.8, yJitter: 0.0, scaleMin: 0.8, scaleMax: 1.6 };
    case 'cozy_dream':   return { kind: 'mushroom', count: 80,  baseY: -3.8, yJitter: 0.0, scaleMin: 0.7, scaleMax: 1.4 };
    case 'cyber_dream':  return { kind: 'antenna',  count: 80,  baseY: -3.8, yJitter: 0.0, scaleMin: 0.8, scaleMax: 1.5 };
    case 'cosmic':       return { kind: 'asteroid', count: 140, baseY:  3.0, yJitter: 5.0, scaleMin: 0.6, scaleMax: 1.4 };
    case 'dark_fantasy': return { kind: 'column',   count: 140, baseY: -3.8, yJitter: 0.0, scaleMin: 0.8, scaleMax: 1.5 };
    case 'ethereal':     return { kind: 'spire',    count: 140, baseY: -3.8, yJitter: 0.0, scaleMin: 0.7, scaleMax: 1.3 };
    case 'whimsical':    return { kind: 'obelisk',  count: 80,  baseY: -3.8, yJitter: 0.0, scaleMin: 0.8, scaleMax: 1.4 };
    case 'surreal_calm': return { kind: 'orb',      count: 80,  baseY: -3.8, yJitter: 0.0, scaleMin: 0.8, scaleMax: 1.3 };
    default:             return null;
  }
}

// Scatter region X half-width. Z spans [-levelDepth, +25].
const X_HALF = 65;
const Z_FAR = 25;
const RETRY_LIMIT = 8;
const OFF_SCREEN_Y = -100;

// Reject a candidate iff it lies within any exclusion entry's radius (XZ).
function collides(x: number, z: number, ex: Array<{ x: number; z: number; r: number }>): boolean {
  for (let i = 0; i < ex.length; i++) {
    const dx = x - ex[i].x;
    const dz = z - ex[i].z;
    if (dx * dx + dz * dz < ex[i].r * ex[i].r) return true;
  }
  return false;
}

// Compute deterministic transforms for `count` instances. Rejection sampling
// against the exclusion path; on persistent failure the slot is parked off-screen.
function scatter(
  count: number,
  levelDepth: number,
  baseY: number,
  yJitter: number,
  scaleMin: number,
  scaleMax: number,
  exclusionPath: Array<{ x: number; z: number; r: number }>,
  rng: () => number,
): InstanceTransform[] {
  const out: InstanceTransform[] = new Array(count);
  for (let i = 0; i < count; i++) {
    let x = 0, z = 0, ok = false;
    for (let r = 0; r <= RETRY_LIMIT; r++) {
      x = (rng() * 2 - 1) * X_HALF;
      z = -levelDepth + rng() * (levelDepth + Z_FAR);
      if (!collides(x, z, exclusionPath)) { ok = true; break; }
    }
    if (!ok) {
      out[i] = { x: 0, y: OFF_SCREEN_Y, z: 0, rotY: 0, scale: 1 };
      continue;
    }
    const y = baseY + (yJitter > 0 ? (rng() * 2 - 1) * yJitter : 0);
    const rotY = rng() * Math.PI * 2;
    const scale = scaleMin + rng() * (scaleMax - scaleMin);
    out[i] = { x, y, z, rotY, scale };
  }
  return out;
}

export function InstancedProps(props: InstancedPropsProps): React.JSX.Element | null {
  const { mood, levelDepth, palette, seed, exclusionPath } = props;

  const variant = useMemo(() => variantFor(mood), [mood]);

  // Cached scratch objects — used during the imperative setMatrixAt pass and,
  // for asteroids, the per-frame rotation update. ZERO allocations per frame.
  const scratch = useRef(new THREE.Object3D());
  const matrix = useRef(new THREE.Matrix4());
  const quat = useRef(new THREE.Quaternion());
  const quatDelta = useRef(new THREE.Quaternion());
  const axisVec = useRef(new THREE.Vector3());
  const posVec = useRef(new THREE.Vector3());
  const scaleVec = useRef(new THREE.Vector3());

  // InstancedMesh refs — two slots so 2-sub-mesh variants share one component.
  const meshARef = useRef<THREE.InstancedMesh | null>(null);
  const meshBRef = useRef<THREE.InstancedMesh | null>(null);

  // Compute transforms once per (variant, levelDepth, seed, exclusionPath).
  const transforms = useMemo<InstanceTransform[]>(() => {
    if (!variant) return [];
    const rng = makeRng(hashString(seed, 13));
    return scatter(
      variant.count,
      levelDepth,
      variant.baseY,
      variant.yJitter,
      variant.scaleMin,
      variant.scaleMax,
      exclusionPath,
      rng,
    );
  }, [variant, levelDepth, seed, exclusionPath]);

  // Per-instance rotation axes/speeds for asteroids — typed arrays, no GC.
  // Allocated once per (variant, seed). Empty for non-cosmic variants.
  const asteroidSpin = useMemo<{ axes: Float32Array; speeds: Float32Array } | null>(() => {
    if (!variant || variant.kind !== 'asteroid') return null;
    const rng = makeRng(hashString(seed, 29));
    const n = variant.count;
    const axes = new Float32Array(n * 3);
    const speeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Random unit axis on the sphere.
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      axes[i * 3]     = r * Math.cos(phi);
      axes[i * 3 + 1] = u;
      axes[i * 3 + 2] = r * Math.sin(phi);
      speeds[i] = 0.05 + rng() * 0.25; // rad/sec
    }
    return { axes, speeds };
  }, [variant, seed]);

  // Imperatively set each instance's matrix once whenever transforms change.
  // Sub-mesh "B" gets a per-variant offset applied (e.g. trunk vs crown).
  useEffect(() => {
    if (!variant) return;
    const s = scratch.current;
    const N = transforms.length;

    // Sub-mesh A — always present.
    const A = meshARef.current;
    if (A) {
      for (let i = 0; i < N; i++) {
        const t = transforms[i];
        s.position.set(t.x, t.y + getOffsetA(variant.kind), t.z);
        s.rotation.set(getTiltA(variant.kind, t.rotY), t.rotY, getRollA(variant.kind, t.rotY));
        s.scale.setScalar(t.scale);
        s.updateMatrix();
        A.setMatrixAt(i, s.matrix);
      }
      A.instanceMatrix.needsUpdate = true;
      A.count = N;
    }

    // Sub-mesh B — only for 2-sub-mesh variants.
    const B = meshBRef.current;
    if (B) {
      for (let i = 0; i < N; i++) {
        const t = transforms[i];
        s.position.set(t.x, t.y + getOffsetB(variant.kind), t.z);
        s.rotation.set(0, t.rotY, 0);
        s.scale.setScalar(t.scale);
        s.updateMatrix();
        B.setMatrixAt(i, s.matrix);
      }
      B.instanceMatrix.needsUpdate = true;
      B.count = N;
    }
  }, [variant, transforms]);

  // Per-frame rotation for asteroids ONLY. Trees/columns/spires stay still.
  // ZERO allocations: every THREE object is a cached ref.
  useFrame((_, delta) => {
    if (!variant || variant.kind !== 'asteroid') return;
    const A = meshARef.current;
    const spin = asteroidSpin;
    if (!A || !spin) return;
    const m = matrix.current;
    const q = quat.current;
    const dq = quatDelta.current;
    const axis = axisVec.current;
    const pos = posVec.current;
    const scl = scaleVec.current;
    const N = transforms.length;
    for (let i = 0; i < N; i++) {
      A.getMatrixAt(i, m);
      m.decompose(pos, q, scl);
      const ang = spin.speeds[i] * delta;
      axis.set(spin.axes[i * 3], spin.axes[i * 3 + 1], spin.axes[i * 3 + 2]);
      dq.setFromAxisAngle(axis, ang);
      q.multiply(dq);
      m.compose(pos, q, scl);
      A.setMatrixAt(i, m);
    }
    A.instanceMatrix.needsUpdate = true;
  });

  if (!variant) return null;

  return <PropsBody
    variant={variant}
    palette={palette}
    meshARef={meshARef}
    meshBRef={meshBRef}
  />;
}

// ─── Per-sub-mesh anchor offsets ────────────────────────────────────────────
// Y offset applied on top of the instance's `t.y`. Encodes "where on the prop
// the named sub-mesh sits, given the prop's anchor is at ground level".
function getOffsetA(kind: PropVariant['kind']): number {
  switch (kind) {
    case 'tree':     return 0.6;   // trunk centre = 0.6 above ground
    case 'mushroom': return 0.7;   // stem centre = half-height of 1.4
    case 'antenna':  return 1.5;   // pole centre = half-height of 3.0
    case 'column':   return 1.25;  // half-height of 2.5
    case 'spire':    return 2.0;   // half-height of 4.0
    case 'obelisk':  return 1.1;   // half-height of 2.2
    case 'orb':      return 0.5;   // stalk centre = half-height of 1.0
    case 'asteroid': return 0;     // anchor IS the centre (free-float)
  }
}

function getOffsetB(kind: PropVariant['kind']): number {
  switch (kind) {
    case 'tree':     return 2.4;   // crown sits on top of trunk
    case 'mushroom': return 1.5;   // cap sits at top of stem
    case 'antenna':  return 3.05;  // emissive cube at top of pole
    case 'obelisk':  return 2.3;   // spherical cap on top of cylinder
    case 'orb':      return 1.4;   // floating sphere above stalk
    // Single-mesh variants — getOffsetB is unused; return 0 for safety.
    case 'asteroid':
    case 'column':
    case 'spire':
      return 0;
  }
}

// Sub-mesh A X-axis tilt. Reserved for future per-kind lean; currently 0.
function getTiltA(_kind: PropVariant['kind'], _rotY: number): number {
  return 0;
}
// Sub-mesh A Z-axis roll. dark_fantasy broken-column gets a small lean
// derived from rotY so each column tilts differently but deterministically.
function getRollA(kind: PropVariant['kind'], rotY: number): number {
  // Map rotY ∈ [0, 2π) → roll ∈ [-0.2, 0.2] rad (spec: "rng*0.4 - 0.2").
  if (kind === 'column') return ((rotY / (Math.PI * 2)) * 0.4) - 0.2;
  return 0;
}

// ─── Body: chooses geometry + material per variant ──────────────────────────
function PropsBody({
  variant,
  palette,
  meshARef,
  meshBRef,
}: {
  variant: PropVariant;
  palette: string[];
  meshARef: React.RefObject<THREE.InstancedMesh | null>;
  meshBRef: React.RefObject<THREE.InstancedMesh | null>;
}) {
  const solid = palette[2] || palette[3] || '#444444';
  const accent = palette[1] || palette[0] || '#8888ff';
  const emissive = palette[0] || '#88ffff';
  const N = variant.count;

  switch (variant.kind) {
    case 'tree':
      // Two cones: wide short trunk + tall thin crown.
      return (
        <>
          <instancedMesh ref={meshARef} args={[undefined, undefined, N]} castShadow>
            <coneGeometry args={[0.5, 1.2, 6]} />
            <meshStandardMaterial color={solid} roughness={0.95} />
          </instancedMesh>
          <instancedMesh ref={meshBRef} args={[undefined, undefined, N]} castShadow>
            <coneGeometry args={[0.2, 2.8, 6]} />
            <meshStandardMaterial color={solid} roughness={0.95} />
          </instancedMesh>
        </>
      );

    case 'mushroom':
      // Cylinder stem (0.15r × 1.4h) + hemisphere cap (0.7r).
      return (
        <>
          <instancedMesh ref={meshARef} args={[undefined, undefined, N]} castShadow>
            <cylinderGeometry args={[0.15, 0.18, 1.4, 10]} />
            <meshStandardMaterial color={'#f5e6d3'} roughness={0.7} />
          </instancedMesh>
          <instancedMesh ref={meshBRef} args={[undefined, undefined, N]} castShadow>
            <sphereGeometry args={[0.7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={solid} roughness={0.6} />
          </instancedMesh>
        </>
      );

    case 'antenna':
      // Thin pole + small emissive cube at top.
      return (
        <>
          <instancedMesh ref={meshARef} args={[undefined, undefined, N]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 3.0, 6]} />
            <meshStandardMaterial color={solid} roughness={0.4} metalness={0.6} />
          </instancedMesh>
          <instancedMesh ref={meshBRef} args={[undefined, undefined, N]}>
            <boxGeometry args={[0.18, 0.18, 0.18]} />
            <meshStandardMaterial
              color={emissive}
              emissive={emissive}
              emissiveIntensity={3}
            />
          </instancedMesh>
        </>
      );

    case 'asteroid':
      return (
        <instancedMesh ref={meshARef} args={[undefined, undefined, N]} castShadow>
          <icosahedronGeometry args={[0.6, 0]} />
          <meshStandardMaterial color={solid} roughness={0.85} />
        </instancedMesh>
      );

    case 'column':
      return (
        <instancedMesh ref={meshARef} args={[undefined, undefined, N]} castShadow>
          <cylinderGeometry args={[0.3, 0.32, 2.5, 10]} />
          <meshStandardMaterial color={solid} roughness={0.85} />
        </instancedMesh>
      );

    case 'spire':
      // Thin tall transparent cone.
      return (
        <instancedMesh ref={meshARef} args={[undefined, undefined, N]}>
          <coneGeometry args={[0.25, 4.0, 8]} />
          <meshStandardMaterial
            color={accent}
            transparent
            opacity={0.45}
            roughness={0.2}
            metalness={0.1}
          />
        </instancedMesh>
      );

    case 'obelisk':
      return (
        <>
          <instancedMesh ref={meshARef} args={[undefined, undefined, N]} castShadow>
            <cylinderGeometry args={[0.35, 0.38, 2.2, 8]} />
            <meshStandardMaterial color={accent} roughness={0.5} />
          </instancedMesh>
          <instancedMesh ref={meshBRef} args={[undefined, undefined, N]} castShadow>
            <sphereGeometry args={[0.38, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={emissive} roughness={0.4} />
          </instancedMesh>
        </>
      );

    case 'orb':
      // Floating sphere on a thin cylinder stalk.
      return (
        <>
          <instancedMesh ref={meshARef} args={[undefined, undefined, N]}>
            <cylinderGeometry args={[0.05, 0.05, 1.0, 6]} />
            <meshStandardMaterial color={solid} roughness={0.6} />
          </instancedMesh>
          <instancedMesh ref={meshBRef} args={[undefined, undefined, N]}>
            <sphereGeometry args={[0.4, 14, 10]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={0.6}
              roughness={0.3}
            />
          </instancedMesh>
        </>
      );
  }
}
