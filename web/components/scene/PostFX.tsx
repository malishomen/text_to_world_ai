'use client';

import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { useEffect, useState, Component, type ReactElement, type ReactNode } from 'react';

/**
 * Strictly-typed subset of {@link import('postprocessing').BloomEffect} options
 * we actually expose. The R3F wrapper's prop type is `any`, so we define our
 * own interface to keep this call site type-safe (no `any`).
 *
 * @see https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/BloomEffect.js~BloomEffect.html
 */
interface BloomOptions {
  /** Overall bleed strength. Raise for more glow, lower for subtler bloom. */
  intensity: number;
  /** Pixels brighter than this luminance bloom. Raise to bloom fewer sources. */
  luminanceThreshold: number;
  /** Softness of the threshold edge. */
  luminanceSmoothing: number;
  /** Use mipmap-based blur (cheap, soft, modern look). */
  mipmapBlur: boolean;
  /** Blur radius. Only applies when {@link mipmapBlur} is true. */
  radius: number;
}

// Starting values — tune these. NOT final.
const BLOOM: BloomOptions = {
  intensity: 0.6,
  luminanceThreshold: 0.55,
  luminanceSmoothing: 0.3,
  mipmapBlur: true,
  radius: 0.85,
};

// ── Boundary: silently disable PostFX if Bloom internals throw ───────────────
// @react-three/postprocessing v3 + R3F v9 has a race where Bloom reads the
// renderer's clear color before it's been populated (`null.alpha`). Catching
// the error in a tiny boundary keeps the scene rendering with no Bloom rather
// than blanking the canvas.
class BloomBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) {
    if (typeof console !== 'undefined') {
      console.warn('[PostFX] Bloom disabled (init race):', err.message);
    }
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

/**
 * Cinematic bloom postprocessing pass for the DreamCraft R3F scene.
 *
 * Place as a child of `<Canvas>` AFTER the scene tree. Does not need to wrap
 * children — modern `EffectComposer` intercepts render automatically.
 *
 * Bloom params (tuning guide):
 * - `intensity` (0.6): raise for more bleed/glow, lower for subtler bloom.
 * - `luminanceThreshold` (0.55): raise for fewer sources to bloom (only the
 *   brightest emissives), lower to let mid-tones bleed too.
 * - `luminanceSmoothing` (0.3): higher = softer threshold edge, no popping.
 * - `mipmapBlur` (true): cheap, soft, "filmic" blur — keep on.
 * - `radius` (0.85): wider halo when raised; only effective with mipmapBlur.
 */
export default function PostFX(): ReactElement | null {
  // Defer mount by one tick so the renderer's clear color is committed before
  // EffectComposer reads it. Fixes `Cannot read properties of null (reading 'alpha')`.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return null;

  return (
    <BloomBoundary>
      <EffectComposer>
        <Bloom
          intensity={BLOOM.intensity}
          luminanceThreshold={BLOOM.luminanceThreshold}
          luminanceSmoothing={BLOOM.luminanceSmoothing}
          mipmapBlur={BLOOM.mipmapBlur}
          radius={BLOOM.radius}
        />
      </EffectComposer>
    </BloomBoundary>
  );
}
