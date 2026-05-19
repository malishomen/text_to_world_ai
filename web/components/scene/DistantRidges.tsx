'use client';

import { useEffect, useMemo } from 'react';
import type { JSX } from 'react';
import * as THREE from 'three';

// ─── DistantRidges ──────────────────────────────────────────────────────────
// A static, vertical heightmap-displaced plane standing far behind the level.
// Read as a smoky silhouette of mountains thanks to the scene's fogExp2.
// Faces +Z (toward the camera at +Z relative to the level), peaks only on the
// upper half (y > 0), base edge (y <= 0) stays perfectly flat at z = 0 so the
// silhouette has a clean horizon line.

export interface DistantRidgesProps {
  color: string;        // hex, tinted from skyBottomColor or palette[2]
  levelDepth: number;
  intensity: number;    // 0..1, height multiplier (sharp jagged peaks for nightmare, soft for cozy)
}

// Deterministic 2D value-noise. Pure integer-mix hash + bilinear interpolation
// with a smoothstep fade — cheap, no Math.random, no external dep, stable
// across re-mounts for a given vertex index pair.
function hash2(ix: number, iy: number): number {
  // 32-bit integer scramble; output in [0, 1).
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffffff) / 0xffffffff;
}

function fade(t: number): number {
  // Smoothstep — softens cell boundaries so ridges feel mountain-shaped, not
  // pixel-quantised. Cheaper than perlin's 6t^5-15t^4+10t^3 and good enough
  // for a background silhouette.
  return t * t * (3 - 2 * t);
}

function valueNoise2D(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const v00 = hash2(x0,     y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0,     y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

export default function DistantRidges(props: DistantRidgesProps): JSX.Element {
  const { color, levelDepth, intensity } = props;

  const geometry = useMemo(() => {
    // 300 wide × 60 tall, 80×20 segments. PlaneGeometry's default normal is
    // +Z, so it already faces the camera (which sits at +Z relative to the
    // level). We never rotate it.
    const geom = new THREE.PlaneGeometry(300, 60, 80, 20);

    const pos = geom.attributes.position;
    const peak = intensity * 8; // max push BACK along -Z

    // Two octaves of value noise — a broad ridge silhouette plus a finer
    // jagged top edge. Frequency tuned so ~6-10 main peaks fit across 300u.
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);

      // Lower half is the ground/base — flat horizon line.
      if (vy <= 0) {
        pos.setZ(i, 0);
        continue;
      }

      // Normalised height factor in [0, 1] across the upper half — taller
      // ridges in the middle of the upper edge, tapering near base & top.
      const yNorm = vy / 30; // upper half spans y in (0, 30]
      const heightMask = Math.sin(Math.min(yNorm, 1) * Math.PI * 0.5); // 0 at base → 1 at top

      const n1 = valueNoise2D(vx * 0.04, vy * 0.06);            // broad ridges
      const n2 = valueNoise2D(vx * 0.18 + 11.3, vy * 0.22 + 7.7); // jagged detail
      // Mix toward the upper extreme so peaks are sharp, valleys closer to 0.
      const ridge = n1 * 0.75 + n2 * 0.25;

      // Push BACK along -Z (away from camera). Negative Z = into the screen
      // for a plane standing at default orientation.
      pos.setZ(i, -ridge * heightMask * peak);
    }

    pos.needsUpdate = true;
    geom.computeVertexNormals();
    return geom;
  }, [intensity]);

  // Dispose on unmount to avoid leaking GPU buffers between scene rebuilds.
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <mesh
      position={[0, 0, -levelDepth - 80]}
      geometry={geometry}
      frustumCulled={false}
    >
      <meshStandardMaterial
        color={color}
        roughness={1.0}
        metalness={0}
        flatShading
      />
    </mesh>
  );
}
