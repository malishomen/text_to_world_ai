// Deterministic LCG RNG + cheap string hash.
//
// Extracted from web/components/DreamGame3D.tsx so multiple scene helpers
// can share the same seeded RNG and produce reproducible scatter, terrain,
// and enemy patterns for a given dream/generationId.
//
// The functions are pure and side-effect-free. The RNG closure keeps its
// state in an owned object because react-hooks/immutability rejects
// closures that mutate captured primitives during render.

/** Linear-congruential generator. Returns a callable that yields [0,1). */
export function makeRng(seed: number): () => number {
  const state = { s: seed | 0 };
  return () => {
    state.s = (state.s * 1664525 + 1013904223) & 0x7fffffff;
    return state.s / 0x7fffffff;
  };
}

/** Cheap, deterministic, non-cryptographic string hash. */
export function hashString(s: string, salt = 0): number {
  return s.split('').reduce((acc, c) => acc + c.charCodeAt(0), salt);
}
