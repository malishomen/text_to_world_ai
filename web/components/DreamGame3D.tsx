'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars, Sparkles, Float, Text, useGLTF, useTexture } from '@react-three/drei';
import { Physics, RigidBody, RapierRigidBody } from '@react-three/rapier';
import { useRef, useEffect, useState, useMemo, useCallback, Suspense, Component, ReactNode } from 'react';
import * as THREE from 'three';

// Single source of truth for the GameConfig type lives in `@/lib/fallback-config`.
// Re-exported here for backwards-compatibility of existing imports.
export type { GameConfig } from '@/lib/fallback-config';
import type { GameConfig } from '@/lib/fallback-config';
import type { GameAssets } from '@/lib/game-assets';

// ─── Tiny ErrorBoundary ─────────────────────────────────────────────────────
// React doesn't ship one; we render `fallback` on any child error so a broken
// GLB / texture URL never crashes the canvas. Suspense alone handles "still
// loading" but NOT "loaded then threw" (e.g. parse error, malformed GLB).
interface AssetBoundaryProps { fallback: ReactNode; children: ReactNode }
interface AssetBoundaryState { hasError: boolean }
class AssetBoundary extends Component<AssetBoundaryProps, AssetBoundaryState> {
  state: AssetBoundaryState = { hasError: false };
  static getDerivedStateFromError(): AssetBoundaryState { return { hasError: true }; }
  componentDidCatch(err: Error) {
    if (typeof console !== 'undefined') console.warn('[DreamGame3D] asset failed:', err.message);
  }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

// ─── Keyboard hook ────────────────────────────────────────────────────────────
function useKeys() {
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);
  return keys;
}

// ─── Spring camera that follows player ───────────────────────────────────────
function FollowCamera({ target }: { target: React.RefObject<RapierRigidBody | null> }) {
  const { camera } = useThree();
  const camPos = useRef(new THREE.Vector3(0, 12, -18));
  const lookTarget = useRef(new THREE.Vector3());
  // Cached scratch vectors — avoids `new THREE.Vector3` per frame (GC pressure).
  const desired = useRef(new THREE.Vector3());
  const lookScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!target.current) return;
    const t = target.current.translation();
    desired.current.set(t.x, t.y + 9, t.z - 16);
    camPos.current.lerp(desired.current, 0.07);
    camera.position.copy(camPos.current);
    lookScratch.current.set(t.x, t.y + 1.5, t.z);
    lookTarget.current.lerp(lookScratch.current, 0.1);
    camera.lookAt(lookTarget.current);
  });
  return null;
}

// ─── Character meshes (procedural ball OR loaded GLB) ────────────────────────
function ProceduralBall({ color, meshRef, lightRef }: {
  color: THREE.Color;
  meshRef: React.RefObject<THREE.Mesh | null>;
  lightRef: React.RefObject<THREE.PointLight | null>;
}) {
  return (
    <>
      <mesh ref={meshRef} castShadow>
        <icosahedronGeometry args={[0.55, 2]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.7}
          roughness={0.1}
          metalness={0.4}
        />
      </mesh>
      <pointLight ref={lightRef} color={color} intensity={2.5} distance={6} />
    </>
  );
}

// Sub-component that ALWAYS calls useGLTF — only mounted when `url` is non-null,
// so the hook order is stable across renders.
function GltfCharacter({ url, meshRef }: {
  url: string;
  meshRef: React.RefObject<THREE.Group | null>;
}) {
  const { scene } = useGLTF(url);
  // Clone so multiple instances don't share the same scene graph.
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive ref={meshRef} object={cloned} scale={0.55} />;
}

// ─── Player ──────────────────────────────────────────────────────────────────
interface PlayerProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  color: string;
  characterUrl?: string | null;
  keys: React.RefObject<Record<string, boolean>>;
  goalPos: THREE.Vector3;
  enemyPositions: THREE.Vector3[];
  endedRef: React.MutableRefObject<boolean>;
  onDead: () => void;
  onWin: () => void;
}

function Player({ bodyRef, color, characterUrl, keys, goalPos, enemyPositions, endedRef, onDead, onWin }: PlayerProps) {
  const grounded = useRef(false);
  const canJump = useRef(true);
  const contacts = useRef(0);
  const meshRef = useRef<THREE.Mesh>(null);
  const gltfRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  // Cached scratch vector — eliminates `new THREE.Vector3` allocation per frame.
  const playerVec = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (!bodyRef.current || endedRef.current) return;

    const vel = bodyRef.current.linvel();
    const pos = bodyRef.current.translation();
    const k = keys.current;
    const speed = 8;

    // WASD movement in world-space XZ
    let vx = 0, vz = 0;
    if (k['KeyW'] || k['ArrowUp'])    vz += speed;
    if (k['KeyS'] || k['ArrowDown'])  vz -= speed;
    if (k['KeyA'] || k['ArrowLeft'])  vx -= speed;
    if (k['KeyD'] || k['ArrowRight']) vx += speed;
    bodyRef.current.setLinvel({ x: vx, y: vel.y, z: vz }, true);

    // Jump
    if ((k['Space']) && grounded.current && canJump.current) {
      bodyRef.current.applyImpulse({ x: 0, y: 16, z: 0 }, true);
      grounded.current = false;
      canJump.current = false;
      setTimeout(() => { canJump.current = true; }, 250);
    }

    // Mesh bob (works for both procedural ball and GLB group)
    if (meshRef.current) meshRef.current.rotation.y += delta * 2;
    if (gltfRef.current) gltfRef.current.rotation.y += delta * 2;
    // Player light pulse
    if (lightRef.current) {
      lightRef.current.intensity = 2.5 + Math.sin(Date.now() * 0.004) * 0.8;
    }

    // Death by falling
    if (pos.y < -12 && !endedRef.current) {
      endedRef.current = true;
      onDead();
      return;
    }

    // Enemy collision (distance-based, avoids rapier event complexity)
    playerVec.current.set(pos.x, pos.y, pos.z);
    for (const ep of enemyPositions) {
      if (playerVec.current.distanceTo(ep) < 1.4) {
        endedRef.current = true;
        onDead();
        return;
      }
    }

    // Win
    if (playerVec.current.distanceTo(goalPos) < 2.8 && !endedRef.current) {
      endedRef.current = true;
      onWin();
    }
  });

  const col = useMemo(() => new THREE.Color(color), [color]);
  const procedural = <ProceduralBall color={col} meshRef={meshRef} lightRef={lightRef} />;

  return (
    <RigidBody
      ref={bodyRef}
      colliders="ball"
      restitution={0.05}
      friction={2}
      linearDamping={0.8}
      position={[0, 4, 0]}
      onCollisionEnter={() => {
        contacts.current++;
        grounded.current = true;
      }}
      onCollisionExit={() => {
        contacts.current = Math.max(0, contacts.current - 1);
        if (contacts.current === 0) grounded.current = false;
      }}
    >
      {characterUrl ? (
        <AssetBoundary fallback={procedural}>
          <Suspense fallback={procedural}>
            <GltfCharacter url={characterUrl} meshRef={gltfRef} />
            <pointLight ref={lightRef} color={col} intensity={2.5} distance={6} />
          </Suspense>
        </AssetBoundary>
      ) : procedural}
    </RigidBody>
  );
}

// ─── Platform ────────────────────────────────────────────────────────────────
// Sub-component that ALWAYS calls useTexture — only mounted when url is non-null
// (keeps Rules of Hooks happy across renders).
function TexturedPlatformMaterial({ url, fallbackColor, matRef }: {
  url: string;
  fallbackColor: THREE.Color;
  matRef: React.RefObject<THREE.MeshStandardMaterial | null>;
}) {
  // Configure tiling inside `useTexture`'s onLoad callback — this is the
  // documented escape hatch and avoids the `react-hooks/immutability` rule
  // that forbids mutating values returned from hooks at the call site.
  const tex = useTexture(url, (t) => {
    const apply = (single: THREE.Texture) => {
      single.wrapS = THREE.RepeatWrapping;
      single.wrapT = THREE.RepeatWrapping;
      single.repeat.set(2, 2);
      single.needsUpdate = true;
    };
    if (t instanceof THREE.Texture) apply(t);
  });
  return (
    <meshStandardMaterial
      ref={matRef}
      map={tex}
      color="#ffffff"
      emissive={fallbackColor}
      emissiveIntensity={0.12}
      roughness={0.6}
      metalness={0.1}
    />
  );
}

function PlainPlatformMaterial({ color, matRef }: {
  color: THREE.Color;
  matRef: React.RefObject<THREE.MeshStandardMaterial | null>;
}) {
  return (
    <meshStandardMaterial
      ref={matRef}
      color={color}
      emissive={color}
      emissiveIntensity={0.12}
      roughness={0.3}
      metalness={0.3}
    />
  );
}

function Platform({ position, size, color, index, textureUrl }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  index: number;
  textureUrl?: string | null;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const col = useMemo(() => new THREE.Color(color), [color]);
  const offset = useRef(index * 0.7);

  useFrame(() => {
    if (!matRef.current) return;
    // Subtle breathing glow via emissiveIntensity
    matRef.current.emissiveIntensity = 0.12 + Math.sin(Date.now() * 0.001 + offset.current) * 0.06;
  });

  const plain = <PlainPlatformMaterial color={col} matRef={matRef} />;

  return (
    <RigidBody type="fixed" position={position} colliders="cuboid">
      <mesh ref={meshRef} receiveShadow castShadow>
        <boxGeometry args={size} />
        {textureUrl ? (
          <AssetBoundary fallback={plain}>
            <Suspense fallback={plain}>
              <TexturedPlatformMaterial url={textureUrl} fallbackColor={col} matRef={matRef} />
            </Suspense>
          </AssetBoundary>
        ) : plain}
      </mesh>
    </RigidBody>
  );
}

// ─── Enemy ───────────────────────────────────────────────────────────────────
function Enemy({ position, posRef, phaseSeed }: {
  position: [number, number, number];
  posRef: THREE.Vector3;
  phaseSeed: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Phase offset is supplied deterministically by the parent (DreamScene) so
  // each Enemy starts at a different point in its orbit without calling
  // impure functions inside `useRef`. See `enemies` useMemo in DreamScene.
  const t = useRef(phaseSeed);
  const basePos = useRef(new THREE.Vector3(...position));

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    t.current += delta * 1.5;
    meshRef.current.position.set(
      basePos.current.x + Math.sin(t.current * 0.8) * 1.2,
      basePos.current.y + Math.sin(t.current) * 0.7,
      basePos.current.z + Math.cos(t.current * 0.5) * 0.5,
    );
    meshRef.current.rotation.x += delta * 1.2;
    meshRef.current.rotation.y += delta * 2;
    posRef.copy(meshRef.current.position);
  });

  return (
    <group>
      <mesh ref={meshRef} position={position} castShadow>
        <octahedronGeometry args={[0.55, 0]} />
        <meshStandardMaterial
          color="#ff0044"
          emissive="#ff0044"
          emissiveIntensity={0.8}
          roughness={0.1}
          metalness={0.6}
        />
      </mesh>
    </group>
  );
}

// ─── Goal Portal ─────────────────────────────────────────────────────────────
// Procedural rings (the original look) — kept as Suspense / Error fallback.
function ProceduralPortalRings() {
  const groupRef = useRef<THREE.Group>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    t.current += delta;
    groupRef.current.rotation.y += delta * 0.6;
    groupRef.current.children.forEach((child, i) => {
      if (child instanceof THREE.Mesh) {
        child.rotation.x = t.current * (0.4 + i * 0.25);
        child.rotation.z = t.current * (0.25 + i * 0.15);
      }
    });
  });

  return (
    <group ref={groupRef}>
      {[1.4, 1.9, 2.4].map((r, i) => (
        <mesh key={i}>
          <torusGeometry args={[r, 0.07, 10, 48]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#ffffff"
            emissiveIntensity={2}
            transparent
            opacity={0.85 - i * 0.2}
          />
        </mesh>
      ))}
    </group>
  );
}

function GltfPortal({ url }: { url: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.6;
  });
  return <primitive ref={groupRef} object={cloned} scale={1.5} />;
}

function GoalPortal({ position, portalUrl }: {
  position: [number, number, number];
  portalUrl?: string | null;
}) {
  const fallback = <ProceduralPortalRings />;
  return (
    <group position={position}>
      {portalUrl ? (
        <AssetBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <GltfPortal url={portalUrl} />
          </Suspense>
        </AssetBoundary>
      ) : fallback}
      <pointLight color="#ffffff" intensity={8} distance={12} />
      <pointLight color="#a855f7" intensity={4} distance={20} />
      <Sparkles count={40} scale={5} size={2.5} speed={0.5} color="#ffffff" />
      <Float speed={2} floatIntensity={0.4}>
        <Text
          position={[0, 3.2, 0]}
          fontSize={0.45}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#a855f7"
        >
          ✨ PORTAL ✨
        </Text>
      </Float>
    </group>
  );
}

// ─── Deterministic RNG (LCG) — top-level, side-effect-free ─────────────────
// `react-hooks/immutability` rejects closures that mutate captured vars
// during render, so we keep the seed in an object owned by the caller.
function makeRng(seed: number) {
  const state = { s: seed | 0 };
  return () => {
    state.s = (state.s * 1664525 + 1013904223) & 0x7fffffff;
    return state.s / 0x7fffffff;
  };
}

function hashString(s: string, salt = 0): number {
  return s.split('').reduce((acc, c) => acc + c.charCodeAt(0), salt);
}

// ─── Mood preset ─────────────────────────────────────────────────────────────
interface MoodPreset {
  fogDensity: number;
  starsCount: number;
  sparklesCount: number;
  ambientIntensity: number;
  directionalIntensity: number;
}

function moodPresetFor(mood: string | undefined): MoodPreset {
  if (mood === 'nightmare') {
    return {
      fogDensity: 0.03,
      starsCount: 1500,
      sparklesCount: 40,
      ambientIntensity: 0.25,
      directionalIntensity: 1.2,
    };
  }
  if (mood === 'cozy_dream') {
    return {
      fogDensity: 0.006,
      starsCount: 800,
      sparklesCount: 180,
      ambientIntensity: 0.7,
      directionalIntensity: 2.5,
    };
  }
  return {
    fogDensity: 0.015,
    starsCount: 3000,
    sparklesCount: 120,
    ambientIntensity: 0.5,
    directionalIntensity: 2,
  };
}

// ─── Level generator ─────────────────────────────────────────────────────────
function generateLevel(config: GameConfig, palette: string[], seedStr: string) {
  const count = Math.max(5, Math.min(config.platforms || 6, 12));
  const platforms: { pos: [number, number, number]; size: [number, number, number]; color: string }[] = [
    { pos: [0, 0, 0], size: [7, 0.8, 7], color: palette[0] },
  ];

  const rng = makeRng(hashString(seedStr));

  let x = 0, z = 7, y = 0;
  for (let i = 0; i < count; i++) {
    x += (rng() - 0.5) * 6;
    z += 5 + rng() * 4;
    y += (rng() - 0.2) * 3.5;
    y = Math.max(-2, Math.min(y, 14));
    const w = 3.5 + rng() * 3.5;
    const d = 3.5 + rng() * 3.5;
    platforms.push({
      pos: [x, y, z],
      size: [w, 0.7, d],
      color: palette[(i + 1) % palette.length],
    });
  }
  return platforms;
}

// ─── Main scene ──────────────────────────────────────────────────────────────
function DreamScene({ config, generationId, assets, restartToken, onWin, onDead }: {
  config: GameConfig;
  generationId?: string;
  assets?: GameAssets;
  restartToken: number;
  onWin: () => void;
  onDead: () => void;
}) {
  const playerRef = useRef<RapierRigidBody>(null);
  const keys = useKeys();
  const endedRef = useRef(false);

  // Seed string: prefer caller-provided generationId so same-id-same-level;
  // fall back to mood so legacy callers without an id still get a sensible
  // (mood-grouped) layout.
  const levelSeed = generationId ?? (config.mood || 'dream');

  const palette = useMemo(
    () => (config.color_palette?.length ? config.color_palette : ['#a855f7', '#7c3aed', '#4c1d95', '#1e1b4b']),
    [config.color_palette],
  );

  const platforms = useMemo(
    () => generateLevel(config, palette, levelSeed),
    [config, palette, levelSeed],
  );
  const last = platforms[platforms.length - 1];
  const goalPos = useMemo(
    () => new THREE.Vector3(last.pos[0], last.pos[1] + 3.5, last.pos[2]),
    [last],
  );

  const enemies = useMemo(() => {
    const count = Math.min(config.enemy_count || 3, platforms.length - 1);
    // Deterministic phase seed per enemy — derived from levelSeed so the
    // orbit pattern is reproducible for a given dream. Avoids Math.random()
    // inside `useRef` initializers (impure during render).
    const rng = makeRng(hashString(levelSeed, 17));
    return Array.from({ length: count }, (_, i) => {
      const p = platforms[Math.max(1, Math.round(1 + (i * (platforms.length - 2)) / Math.max(count - 1, 1)))];
      const pos: [number, number, number] = [p.pos[0], p.pos[1] + 1.5, p.pos[2]];
      return { id: i, pos, posRef: new THREE.Vector3(...pos), phaseSeed: rng() * Math.PI * 2 };
    });
  }, [config.enemy_count, levelSeed, platforms]);

  // Stable array of enemy Vector3 refs for Player collision sampling.
  // Each Vector3 instance is owned by the corresponding Enemy and mutated in place;
  // the array identity only changes when `enemies` itself is recomputed.
  const enemyPositions = useMemo(() => enemies.map(e => e.posRef), [enemies]);

  // Restart: reset player transform + ended flag without remounting the Canvas.
  // Skip on initial mount (restartToken === 0) — the body is still spawning.
  useEffect(() => {
    if (restartToken === 0) return;
    endedRef.current = false;
    playerRef.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerRef.current?.setAngvel({ x: 0, y: 0, z: 0 }, true);
    playerRef.current?.setTranslation({ x: 0, y: 4, z: 0 }, true);
    playerRef.current?.wakeUp();
  }, [restartToken]);

  const skyHex = config.background?.sky_color || '#0a0015';
  const mp = useMemo(() => moodPresetFor(config.mood), [config.mood]);
  const p0 = useMemo(() => new THREE.Color(palette[0]), [palette]);
  const p1 = useMemo(() => new THREE.Color(palette[1] || palette[0]), [palette]);
  const p2 = useMemo(() => new THREE.Color(palette[2] || palette[0]), [palette]);

  return (
    <>
      <color attach="background" args={[skyHex]} />
      <fogExp2 attach="fog" args={[skyHex, mp.fogDensity]} />

      {/* Lighting */}
      <ambientLight intensity={mp.ambientIntensity} color={p1} />
      <directionalLight position={[15, 30, 10]} intensity={mp.directionalIntensity} color={p0} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[-20, 15, -10]} color={p2} intensity={3} distance={60} />
      <pointLight position={[20, 5, 30]} color={p0} intensity={2} distance={50} />

      {/* Environment */}
      <Stars radius={120} depth={60} count={mp.starsCount} factor={5} fade speed={0.4} />
      <Sparkles
        count={mp.sparklesCount}
        scale={[platforms.length * 5, 20, platforms.length * 7]}
        position={[0, 6, platforms.length * 3.5]}
        size={2}
        speed={0.15}
        color={palette[0]}
      />

      {/* Floating narrative */}
      <Float speed={0.8} floatIntensity={0.3} rotationIntensity={0.05}>
        <Text
          position={[0, 7, -4]}
          fontSize={0.28}
          color="white"
          anchorX="center"
          anchorY="middle"
          maxWidth={10}
          textAlign="center"
          outlineWidth={0.015}
          outlineColor={palette[1] || '#7c3aed'}
        >
          {config.narrative || 'A dream unfolds...'}
        </Text>
      </Float>

      <Physics gravity={[0, -22, 0]}>
        {/* Player */}
        <Player
          bodyRef={playerRef}
          color={config.main_character?.color || palette[0]}
          characterUrl={assets?.character_3d ?? null}
          keys={keys}
          goalPos={goalPos}
          enemyPositions={enemyPositions}
          endedRef={endedRef}
          onDead={onDead}
          onWin={onWin}
        />

        {/* Platforms */}
        {platforms.map((p, i) => (
          <Platform
            key={i}
            position={p.pos}
            size={p.size}
            color={p.color}
            index={i}
            textureUrl={assets?.platform_2d ?? null}
          />
        ))}
      </Physics>

      {/* Enemies (kinematic, distance-based collision) */}
      {enemies.map((e) => (
        <Enemy
          key={e.id}
          position={e.pos}
          posRef={e.posRef}
          phaseSeed={e.phaseSeed}
        />
      ))}

      {/* Goal */}
      <GoalPortal
        position={[goalPos.x, goalPos.y, goalPos.z]}
        portalUrl={assets?.portal_3d ?? null}
      />

      {/* Camera */}
      <FollowCamera target={playerRef} />
    </>
  );
}

// ─── Exported component ───────────────────────────────────────────────────────
export default function DreamGame3D({ config, generationId, assets }: {
  config: GameConfig;
  generationId?: string;
  assets?: GameAssets;
}) {
  const [state, setState] = useState<'playing' | 'won' | 'dead'>('playing');
  const [restartToken, setRestartToken] = useState(0);
  const [showFocusHint, setShowFocusHint] = useState(true);
  // P2.12 — touch-only device hint. Detected once on mount via lazy initializer,
  // dismissible by tap. State-only (no localStorage) so each session reminds once.
  // Using a lazy initializer keeps the matchMedia probe SSR-safe AND avoids
  // calling setState inside an effect (which violates react-hooks/set-state-in-effect).
  const [showMobileHint, setShowMobileHint] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  });
  const wrapperRef = useRef<HTMLDivElement>(null);

  const restart = () => {
    setState('playing');
    // The actual transform reset happens inside DreamScene via a restartToken effect.
    setRestartToken(t => t + 1);
  };

  const focusWrapper = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.focus();
  }, []);

  // Hide the focus hint after the first control-key press.
  useEffect(() => {
    if (!showFocusHint) return;
    const controlCodes = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space',
    ]);
    const onKey = (e: KeyboardEvent) => {
      if (controlCodes.has(e.code)) setShowFocusHint(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showFocusHint]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full"
      style={{ outline: 'none' }}
      tabIndex={0}
      onClick={focusWrapper}
    >
      <Canvas
        shadows
        camera={{ fov: 65, near: 0.1, far: 600, position: [0, 12, -18] }}
        gl={{ antialias: true, toneMapping: 3 /* ACESFilmic */ }}
      >
        <DreamScene
          config={config}
          generationId={generationId}
          assets={assets}
          restartToken={restartToken}
          onWin={() => setState('won')}
          onDead={() => setState('dead')}
        />
      </Canvas>

      {/* Mobile / touch hint (P2.12) */}
      {showMobileHint && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 max-w-[90%] text-white text-xs bg-purple-900/80 backdrop-blur px-4 py-2 rounded-xl border border-purple-500/50 shadow-lg cursor-pointer text-center leading-relaxed"
          onClick={(e) => { e.stopPropagation(); setShowMobileHint(false); }}
          role="button"
          aria-label="Dismiss mobile hint"
        >
          Touch controls coming soon — this demo is designed for desktop keyboard.
          <br />
          <span className="text-purple-200/80">WASD or Arrow keys + Space. Tap to dismiss.</span>
        </div>
      )}

      {/* Focus hint (fades out after first valid keypress) */}
      {showFocusHint && state === 'playing' && !showMobileHint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/60 text-xs bg-black/40 backdrop-blur px-3 py-1.5 rounded-full pointer-events-none">
          Click here to give canvas focus, then use WASD / arrows / Space
        </div>
      )}

      {/* Controls hint */}
      {state === 'playing' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-xs pointer-events-none text-center">
          WASD · Arrow Keys — Move &nbsp;|&nbsp; Space — Jump &nbsp;|&nbsp; Goal: {config.goal}
        </div>
      )}

      {/* Win screen */}
      {state === 'won' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 backdrop-blur-md">
          <div className="text-7xl mb-5 animate-bounce">✨</div>
          <h2 className="text-4xl font-bold text-white mb-3">Dream Conquered!</h2>
          <p className="text-purple-300/80 mb-8 text-center max-w-sm px-6 text-sm leading-relaxed">
            {config.narrative}
          </p>
          <button onClick={restart}
            className="px-8 py-3 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white rounded-2xl font-semibold text-lg transition-all shadow-lg shadow-purple-900/40">
            Dream Again
          </button>
        </div>
      )}

      {/* Dead screen */}
      {state === 'dead' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-md">
          <div className="text-7xl mb-5">💀</div>
          <h2 className="text-4xl font-bold text-red-300 mb-3">Lost in the Dream...</h2>
          <p className="text-purple-400/60 mb-8 text-sm">The void swallowed you whole.</p>
          <button onClick={restart}
            className="px-8 py-3 bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 text-red-200 rounded-2xl font-semibold text-lg transition-all">
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
