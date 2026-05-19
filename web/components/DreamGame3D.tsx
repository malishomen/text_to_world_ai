'use client';

import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { Stars, Sparkles, Float, Text, useGLTF, useTexture } from '@react-three/drei';
import { Physics, RigidBody, RapierRigidBody, BallCollider, CuboidCollider } from '@react-three/rapier';
import { useRef, useEffect, useState, useMemo, useCallback, Suspense, Component, ReactNode } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three-stdlib';
import { makeRng, hashString } from '@/lib/rng';
import PostFX from './scene/PostFX';
import { InstancedProps } from './scene/InstancedProps';
import GroundMist from './scene/GroundMist';
import DistantRidges from './scene/DistantRidges';

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
  const camPos = useRef(new THREE.Vector3(0, 12, 18));
  const lookTarget = useRef(new THREE.Vector3());
  // Cached scratch vectors — avoids `new THREE.Vector3` per frame (GC pressure).
  const desired = useRef(new THREE.Vector3());
  const lookScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!target.current) return;
    const t = target.current.translation();
    desired.current.set(t.x, t.y + 9, t.z + 16);
    camPos.current.lerp(desired.current, 0.07);
    camera.position.copy(camPos.current);
    lookScratch.current.set(t.x, t.y + 1.5, t.z);
    lookTarget.current.lerp(lookScratch.current, 0.1);
    camera.lookAt(lookTarget.current);
  });
  return null;
}

// ─── Character meshes (procedural ball OR loaded GLB) ────────────────────────
function ProceduralBall({ color, shape, meshRef, lightRef }: {
  color: THREE.Color;
  shape: PlayerShape;
  meshRef: React.RefObject<THREE.Mesh | null>;
  lightRef: React.RefObject<THREE.PointLight | null>;
}) {
  const geometry = (() => {
    switch (shape) {
      case 'tetrahedron': return <tetrahedronGeometry args={[0.7, 0]} />;
      case 'octahedron': return <octahedronGeometry args={[0.65, 0]} />;
      case 'dodecahedron': return <dodecahedronGeometry args={[0.6, 0]} />;
      case 'sphere': return <sphereGeometry args={[0.55, 24, 16]} />;
      case 'icosahedron':
      default: return <icosahedronGeometry args={[0.55, 1]} />;
    }
  })();
  return (
    <>
      <mesh ref={meshRef} castShadow>
        {geometry}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.9}
          roughness={0.1}
          metalness={0.4}
        />
      </mesh>
      <pointLight ref={lightRef} color={color} intensity={4} distance={8} />
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

// LLaMA-Mesh output: standard OBJ with integer coords ~0..64. We center the
// bounding box at origin and scale to a ~1.2-unit diameter so it matches the
// procedural ball footprint. Material is overridden to inherit the player
// color (LLaMA-Mesh does not emit materials).
function ObjCharacter({ url, color, meshRef }: {
  url: string;
  color: THREE.Color;
  meshRef: React.RefObject<THREE.Group | null>;
}) {
  const obj = useLoader(OBJLoader, url);
  const prepared = useMemo(() => {
    const cloned = obj.clone(true);
    // Compute bbox to center + uniform-scale.
    const bbox = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
    const targetDiameter = 1.2;
    const s = targetDiameter / maxDim;
    cloned.position.set(-center.x * s, -center.y * s, -center.z * s);
    cloned.scale.setScalar(s);
    // Override every material so the mesh inherits the dream's character color
    // (OBJLoader produces default white MeshPhongMaterial without textures).
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.25,
      metalness: 0.4,
      // OBJ may be one-sided; render both sides so thin meshes still look solid.
      side: THREE.DoubleSide,
      // Recompute normals would be ideal; flatShading hides interpolation gaps.
      flatShading: true,
    });
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = mat;
        if (child.geometry && !child.geometry.attributes.normal) {
          child.geometry.computeVertexNormals();
        }
      }
    });
    return cloned;
  }, [obj, color]);
  return <primitive ref={meshRef} object={prepared} />;
}

// ─── Player ──────────────────────────────────────────────────────────────────
interface PlayerProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  color: string;
  shape: PlayerShape;
  characterUrl?: string | null;
  characterObjUrl?: string | null;
  keys: React.RefObject<Record<string, boolean>>;
  goalPos: THREE.Vector3;
  enemyPositions: THREE.Vector3[];
  endedRef: React.MutableRefObject<boolean>;
  onDead: () => void;
  onWin: () => void;
}

function Player({ bodyRef, color, shape, characterUrl, characterObjUrl, keys, goalPos, enemyPositions, endedRef, onDead, onWin }: PlayerProps) {
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
    if (k['KeyW'] || k['ArrowUp'])    vz -= speed;
    if (k['KeyS'] || k['ArrowDown'])  vz += speed;
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
  const procedural = <ProceduralBall color={col} shape={shape} meshRef={meshRef} lightRef={lightRef} />;

  return (
    <RigidBody
      ref={bodyRef}
      // Explicit BallCollider below — never let Rapier auto-derive from the
      // visual mesh. GLB/OBJ characters have unpredictable bounds (LLaMA-Mesh
      // in particular emits stretched 0..64 coords) and auto-derivation would
      // either oversize the collider (player clips through platforms or gets
      // stuck on edges) or undersize it (visual mesh pokes through geometry).
      colliders={false}
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
      <BallCollider args={[0.55]} />
      {characterUrl ? (
        <AssetBoundary fallback={procedural}>
          <Suspense fallback={procedural}>
            <GltfCharacter url={characterUrl} meshRef={gltfRef} />
            <pointLight ref={lightRef} color={col} intensity={2.5} distance={6} />
          </Suspense>
        </AssetBoundary>
      ) : characterObjUrl ? (
        <AssetBoundary fallback={procedural}>
          <Suspense fallback={procedural}>
            <ObjCharacter url={characterObjUrl} color={col} meshRef={gltfRef} />
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

function Platform({ position, size, color, index, textureUrl, decoration, isSpawn }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  index: number;
  textureUrl?: string | null;
  decoration: PlatformDecoration;
  isSpawn: boolean;
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
  const halfSize: [number, number, number] = [size[0] / 2, size[1] / 2, size[2] / 2];

  return (
    <>
      <RigidBody type="fixed" position={position} colliders={false}>
        {/* Explicit single cuboid collider matching the box geometry. With
            colliders="cuboid" Rapier auto-derived ONE collider per child mesh
            — meaning decorations (crystal/spire/orb/torus) added extra
            invisible blockers on top of every platform, causing the player
            to get stuck approaching the last-platform portal. */}
        <CuboidCollider args={halfSize} />
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
      {/* Decoration lives OUTSIDE the RigidBody — purely visual, never a
          physics blocker. Position mirrors the platform so the decoration's
          own local offset (y=0.5..1.2 above origin) lands above the platform. */}
      {!isSpawn && (
        <group position={position}>
          <PlatformDecoration kind={decoration} color={col} seed={index * 1.3} />
        </group>
      )}
    </>
  );
}

// ─── Enemy ───────────────────────────────────────────────────────────────────
function Enemy({ position, posRef, phaseSeed, shape, color }: {
  position: [number, number, number];
  posRef: THREE.Vector3;
  phaseSeed: number;
  shape: EnemyShape;
  color: string;
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

  const geom = (() => {
    switch (shape) {
      case 'tetrahedron': return <tetrahedronGeometry args={[0.65, 0]} />;
      case 'cone': return <coneGeometry args={[0.5, 1.0, 6]} />;
      case 'sphere': return <sphereGeometry args={[0.5, 16, 12]} />;
      case 'octahedron':
      default: return <octahedronGeometry args={[0.55, 0]} />;
    }
  })();

  return (
    <group>
      <mesh ref={meshRef} position={position} castShadow>
        {geom}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.2}
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

// makeRng + hashString moved to web/lib/rng.ts so scene helpers can share
// the same seeded RNG. Imported above.

// ─── Mood preset ─────────────────────────────────────────────────────────────
type PlayerShape = 'icosahedron' | 'tetrahedron' | 'octahedron' | 'dodecahedron' | 'sphere';
type PlatformDecoration = 'crystal' | 'mushroom' | 'neon' | 'spire' | 'orb';
type EnemyShape = 'octahedron' | 'tetrahedron' | 'cone' | 'sphere';
type TerrainType = 'none' | 'hills' | 'spikes' | 'grid' | 'cracks' | 'rolling';
type ParticleType = 'sparkle' | 'snow' | 'sakura' | 'neon_rain' | 'embers' | 'cosmic_dust';

interface MoodPreset {
  fogDensity: number;
  starsCount: number;
  sparklesCount: number;
  ambientIntensity: number;
  directionalIntensity: number;
  playerShape: PlayerShape;
  platformDecoration: PlatformDecoration;
  enemyShape: EnemyShape;
  enemyColor: string;
  skyTopColor: string;
  skyBottomColor: string;
  groundColor: string | null;
  terrainType: TerrainType;
  particleType: ParticleType;
}

function moodPresetFor(mood: string | undefined): MoodPreset {
  if (mood === 'nightmare') {
    return {
      fogDensity: 0.03,
      starsCount: 1500,
      sparklesCount: 40,
      ambientIntensity: 1.0,
      directionalIntensity: 3.5,
      playerShape: 'tetrahedron',
      platformDecoration: 'spire',
      enemyShape: 'tetrahedron',
      enemyColor: '#ff2244',
      skyTopColor: '#1a0008',
      skyBottomColor: '#080010',
      groundColor: '#15050a',
      terrainType: 'spikes',
      particleType: 'embers',
    };
  }
  if (mood === 'cozy_dream') {
    return {
      fogDensity: 0.006,
      starsCount: 800,
      sparklesCount: 180,
      ambientIntensity: 2.0,
      directionalIntensity: 6.0,
      playerShape: 'sphere',
      platformDecoration: 'mushroom',
      enemyShape: 'cone',
      enemyColor: '#ff8855',
      skyTopColor: '#f5b985',
      skyBottomColor: '#7d4a8a',
      groundColor: '#1a3a1a',
      terrainType: 'rolling',
      particleType: 'sakura',
    };
  }
  if (mood === 'cyber_dream') {
    return {
      fogDensity: 0.012,
      starsCount: 1200,
      sparklesCount: 80,
      ambientIntensity: 1.2,
      directionalIntensity: 4.0,
      playerShape: 'octahedron',
      platformDecoration: 'neon',
      enemyShape: 'octahedron',
      enemyColor: '#00ffaa',
      skyTopColor: '#001a3a',
      skyBottomColor: '#06b6d4',
      groundColor: '#02041a',
      terrainType: 'grid',
      particleType: 'neon_rain',
    };
  }
  if (mood === 'cosmic') {
    return {
      fogDensity: 0.008,
      starsCount: 5000,
      sparklesCount: 200,
      ambientIntensity: 1.2,
      directionalIntensity: 4.5,
      playerShape: 'dodecahedron',
      platformDecoration: 'crystal',
      enemyShape: 'octahedron',
      enemyColor: '#e879f9',
      skyTopColor: '#0a0033',
      skyBottomColor: '#020010',
      groundColor: null,
      terrainType: 'none',
      particleType: 'cosmic_dust',
    };
  }
  if (mood === 'dark_fantasy') {
    return {
      fogDensity: 0.02,
      starsCount: 2000,
      sparklesCount: 60,
      ambientIntensity: 1.0,
      directionalIntensity: 4.0,
      playerShape: 'icosahedron',
      platformDecoration: 'spire',
      enemyShape: 'tetrahedron',
      enemyColor: '#ff3366',
      skyTopColor: '#15082a',
      skyBottomColor: '#080015',
      groundColor: '#1a0a1f',
      terrainType: 'cracks',
      particleType: 'embers',
    };
  }
  if (mood === 'ethereal') {
    return {
      fogDensity: 0.01,
      starsCount: 1500,
      sparklesCount: 250,
      ambientIntensity: 2.2,
      directionalIntensity: 5.5,
      playerShape: 'octahedron',
      platformDecoration: 'crystal',
      enemyShape: 'sphere',
      enemyColor: '#f0a8ff',
      skyTopColor: '#d1baf0',
      skyBottomColor: '#a085c5',
      groundColor: null,
      terrainType: 'none',
      particleType: 'snow',
    };
  }
  if (mood === 'whimsical') {
    return {
      fogDensity: 0.008,
      starsCount: 1000,
      sparklesCount: 200,
      ambientIntensity: 2.0,
      directionalIntensity: 5.5,
      playerShape: 'sphere',
      platformDecoration: 'mushroom',
      enemyShape: 'sphere',
      enemyColor: '#ffaa00',
      skyTopColor: '#ffd5b0',
      skyBottomColor: '#a07ad8',
      groundColor: '#2a1a3a',
      terrainType: 'rolling',
      particleType: 'sakura',
    };
  }
  // surreal_calm and default
  return {
    fogDensity: 0.015,
    starsCount: 3000,
    sparklesCount: 120,
    ambientIntensity: 1.5,
    directionalIntensity: 5.0,
    playerShape: 'icosahedron',
    platformDecoration: 'crystal',
    enemyShape: 'octahedron',
    enemyColor: '#ff0044',
    skyTopColor: '#2a0a55',
    skyBottomColor: '#0a0015',
    groundColor: '#1a0030',
    terrainType: 'hills',
    particleType: 'sparkle',
  };
}

// ─── Gradient sky dome ───────────────────────────────────────────────────────
const skyVert = `
varying vec3 vWorldPosition;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPosition = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const skyFrag = `
uniform vec3 topColor;
uniform vec3 bottomColor;
varying vec3 vWorldPosition;
void main() {
  float h = normalize(vWorldPosition).y;
  float t = clamp((h + 0.15) * 1.2, 0.0, 1.0);
  vec3 col = mix(bottomColor, topColor, t);
  gl_FragColor = vec4(col, 1.0);
}`;

function SkyDome({ topColor, bottomColor }: { topColor: string; bottomColor: string }) {
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color(topColor) },
      bottomColor: { value: new THREE.Color(bottomColor) },
    }),
    [topColor, bottomColor],
  );
  return (
    <mesh scale={[400, 400, 400]}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        attach="material"
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={skyVert}
        fragmentShader={skyFrag}
      />
    </mesh>
  );
}

// ─── Displaced ground — per-mood relief instead of a flat fill ──────────────
// Visual-only mesh (no collider; the death plane at y=-12 still ends the run
// if the player falls off the platforms). Sits low enough that the player
// cannot interact with it; mood-driven displacement gives the floor character
// instead of just a colored fill the user noticed felt sterile.
function DisplacedGround({ color, levelDepth, terrain }: {
  color: string;
  levelDepth: number;
  terrain: TerrainType;
}) {
  const geom = useMemo(() => {
    const width = 220;
    const depth = levelDepth + 100;
    const wSeg = terrain === 'grid' ? 60 : 80;
    const dSeg = terrain === 'grid' ? 60 : 80;
    const g = new THREE.PlaneGeometry(width, depth, wSeg, dSeg);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const seed = terrain.charCodeAt(0) * 7919;
    const rng = makeRng(seed);
    // We pre-bake a hash table of noise samples so the displacement is stable
    // across re-renders (no Math.random in geometry construction).
    const noise = (x: number, z: number): number => {
      // Cheap value-noise — lattice cells sampled deterministically.
      const ix = Math.floor(x * 0.2);
      const iz = Math.floor(z * 0.2);
      const fx = x * 0.2 - ix;
      const fz = z * 0.2 - iz;
      const sample = (a: number, b: number) =>
        ((Math.sin(a * 12.9898 + b * 78.233 + seed) * 43758.5453) % 1 + 1) % 1;
      const n00 = sample(ix, iz);
      const n10 = sample(ix + 1, iz);
      const n01 = sample(ix, iz + 1);
      const n11 = sample(ix + 1, iz + 1);
      // Smoothstep blend
      const u = fx * fx * (3 - 2 * fx);
      const v = fz * fz * (3 - 2 * fz);
      return (
        n00 * (1 - u) * (1 - v) +
        n10 * u * (1 - v) +
        n01 * (1 - u) * v +
        n11 * u * v
      );
    };

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getY(i); // plane is XY before rotation; we treat Y as Z
      let y = 0;
      switch (terrain) {
        case 'spikes': {
          // High-frequency aggressive peaks — sharp jagged terrain.
          const n = noise(x * 1.8, z * 1.8);
          y = Math.pow(n, 3) * 6 - 0.5;
          break;
        }
        case 'cracks': {
          // Wide low-frequency undulation with occasional sharp drops.
          const n = noise(x * 0.6, z * 0.6);
          const c = noise(x * 0.15, z * 0.15);
          y = n * 1.5 + (c < 0.25 ? -2 : 0);
          break;
        }
        case 'grid': {
          // Repeated tile cells with edges raised — neon-floor look.
          const cellSize = 6;
          const fx = (((x % cellSize) + cellSize) % cellSize) / cellSize;
          const fz = (((z % cellSize) + cellSize) % cellSize) / cellSize;
          const edge = Math.min(fx, 1 - fx, fz, 1 - fz);
          y = edge < 0.05 ? 0.7 : 0;
          break;
        }
        case 'hills': {
          // Calm sine waves — surreal but anchored.
          y = Math.sin(x * 0.2) * 0.9 + Math.cos(z * 0.18) * 0.7;
          break;
        }
        case 'rolling': {
          // Softer rolling hills — cozy / whimsical.
          y =
            Math.sin(x * 0.1) * 1.5 +
            Math.cos(z * 0.13) * 1.2 +
            noise(x * 0.4, z * 0.4) * 0.6;
          break;
        }
        case 'none':
        default: {
          y = 0;
          break;
        }
      }
      // PlaneGeometry: original position is in (x, y, 0). Push z = y after
      // rotation, but Three.js applies rotation to attribute, so set Z here
      // (we'll rotate the mesh to lay flat).
      pos.setZ(i, y);
    }
    // Suppress reference to rng so it isn't tree-shaken as dead — used inside noise().
    void rng;
    g.computeVertexNormals();
    return g;
  }, [terrain, levelDepth]);

  // Cleanup the BufferGeometry on unmount/dep-change to avoid leaks.
  useEffect(() => () => geom.dispose(), [geom]);

  return (
    <mesh
      geometry={geom}
      position={[0, -4, -levelDepth / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        roughness={0.85}
        metalness={terrain === 'grid' ? 0.6 : 0.0}
        emissive={terrain === 'grid' ? color : '#000000'}
        emissiveIntensity={terrain === 'grid' ? 0.15 : 0}
        flatShading={terrain === 'spikes' || terrain === 'cracks'}
      />
    </mesh>
  );
}

// ─── Atmospheric particles — falling snow / sakura / neon rain / embers ────
// All four use a single InstancedMesh with per-instance position state driven
// by useFrame. Cheap (~200-400 instances) and visually substantial.
function AtmosphericParticles({ kind, palette, levelDepth }: {
  kind: ParticleType;
  palette: string[];
  levelDepth: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const COUNT =
    kind === 'cosmic_dust' ? 500 :
    kind === 'neon_rain' ? 250 :
    kind === 'snow' ? 350 :
    kind === 'sakura' ? 200 :
    kind === 'embers' ? 150 :
    0;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const halfW = 70;
  const halfD = levelDepth / 2 + 40;
  const cz = -levelDepth / 2;

  // Per-instance state: x/y/z position, speed, sway phase.
  const state = useMemo(() => {
    const arr = new Float32Array(COUNT * 5);
    for (let i = 0; i < COUNT; i++) {
      arr[i * 5 + 0] = (Math.random() - 0.5) * (halfW * 2);                // x
      arr[i * 5 + 1] = Math.random() * 40 - 5;                              // y
      arr[i * 5 + 2] = cz + (Math.random() - 0.5) * (halfD * 2);            // z
      arr[i * 5 + 3] = 0.5 + Math.random() * 1.5;                           // speed
      arr[i * 5 + 4] = Math.random() * Math.PI * 2;                         // phase
    }
    return arr;
  }, [COUNT, halfW, halfD, cz]);

  useFrame((_, delta) => {
    const m = meshRef.current;
    if (!m) return;
    for (let i = 0; i < COUNT; i++) {
      const base = i * 5;
      const speedBase = state[base + 3];
      let fallSpeed = 0;
      let swayAmp = 0;
      let rise = false;
      switch (kind) {
        case 'snow':        fallSpeed = 1.2 * speedBase; swayAmp = 0.6; break;
        case 'sakura':      fallSpeed = 0.8 * speedBase; swayAmp = 1.4; break;
        case 'neon_rain':   fallSpeed = 14  * speedBase; swayAmp = 0;   break;
        case 'embers':      fallSpeed = -1.5 * speedBase; swayAmp = 0.8; rise = true; break;
        case 'cosmic_dust': fallSpeed = 0.3 * speedBase; swayAmp = 0.4; break;
        default: break;
      }
      state[base + 1] -= fallSpeed * delta;
      state[base + 4] += delta * 1.2;
      const swayX = Math.sin(state[base + 4]) * swayAmp * delta * 4;
      state[base + 0] += swayX;
      // Reset when below ground (or above sky for embers).
      if (rise && state[base + 1] > 35) {
        state[base + 0] = (Math.random() - 0.5) * (halfW * 2);
        state[base + 1] = -4;
        state[base + 2] = cz + (Math.random() - 0.5) * (halfD * 2);
      } else if (!rise && state[base + 1] < -4) {
        state[base + 0] = (Math.random() - 0.5) * (halfW * 2);
        state[base + 1] = 32;
        state[base + 2] = cz + (Math.random() - 0.5) * (halfD * 2);
      }
      dummy.position.set(state[base + 0], state[base + 1], state[base + 2]);
      // Per-kind orientation
      if (kind === 'neon_rain') {
        dummy.scale.set(1, 6, 1);
        dummy.rotation.set(0, 0, 0);
      } else if (kind === 'sakura') {
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(state[base + 4], state[base + 4] * 0.7, 0);
      } else {
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  if (COUNT === 0) return null;

  const colorHex = (() => {
    switch (kind) {
      case 'snow':        return '#ffffff';
      case 'sakura':      return '#ffc0cb';
      case 'neon_rain':   return palette[0] || '#06b6d4';
      case 'embers':      return palette[0] || '#ff5522';
      case 'cosmic_dust': return palette[1] || '#a855f7';
      default:            return '#ffffff';
    }
  })();
  const sizePx =
    kind === 'snow' ? 0.06 :
    kind === 'sakura' ? 0.12 :
    kind === 'neon_rain' ? 0.04 :
    kind === 'embers' ? 0.08 :
    /* cosmic_dust */ 0.05;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      {kind === 'sakura' ? (
        <planeGeometry args={[sizePx * 2, sizePx * 2]} />
      ) : (
        <sphereGeometry args={[sizePx, 6, 4]} />
      )}
      <meshStandardMaterial
        color={colorHex}
        emissive={colorHex}
        emissiveIntensity={kind === 'neon_rain' || kind === 'embers' ? 4 : 1.2}
        transparent
        opacity={kind === 'cosmic_dust' ? 0.55 : 0.9}
        side={kind === 'sakura' ? THREE.DoubleSide : THREE.FrontSide}
      />
    </instancedMesh>
  );
}

// ─── Platform decoration (non-physics flair on top of each platform) ────────
function PlatformDecoration({ kind, color, seed }: {
  kind: PlatformDecoration;
  color: THREE.Color;
  seed: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const phase = useRef(seed);
  useFrame((_, dt) => {
    if (!ref.current) return;
    phase.current += dt;
    if (kind === 'crystal' || kind === 'spire' || kind === 'orb') {
      ref.current.rotation.y += dt * 0.6;
      ref.current.position.y = 1.2 + Math.sin(phase.current * 1.5) * 0.15;
    }
    if (kind === 'neon') {
      ref.current.rotation.z = phase.current * 0.4;
    }
  });

  const matCommon = {
    color: '#ffffff',
    emissive: color,
    emissiveIntensity: 1.4,
    roughness: 0.15,
    metalness: 0.5,
  };

  if (kind === 'crystal') {
    return (
      <mesh ref={ref} position={[0, 1.2, 0]} castShadow>
        <octahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial {...matCommon} />
      </mesh>
    );
  }
  if (kind === 'spire') {
    return (
      <mesh ref={ref} position={[0, 1.2, 0]} castShadow>
        <coneGeometry args={[0.25, 1.4, 6]} />
        <meshStandardMaterial {...matCommon} emissiveIntensity={1.0} />
      </mesh>
    );
  }
  if (kind === 'orb') {
    return (
      <mesh ref={ref} position={[0, 1.2, 0]} castShadow>
        <sphereGeometry args={[0.35, 16, 12]} />
        <meshStandardMaterial {...matCommon} emissiveIntensity={2.0} />
      </mesh>
    );
  }
  if (kind === 'mushroom') {
    return (
      <group ref={ref as unknown as React.RefObject<THREE.Group>} position={[0, 0.6, 0]}>
        <mesh position={[0, 0.25, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.1, 0.5, 8]} />
          <meshStandardMaterial color="#f5e6c8" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.6, 0]} castShadow>
          <sphereGeometry args={[0.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.6} />
        </mesh>
      </group>
    );
  }
  if (kind === 'neon') {
    return (
      <mesh ref={ref} position={[0, 0.5, 0]} castShadow>
        <torusGeometry args={[0.7, 0.05, 8, 32]} />
        <meshStandardMaterial color="#ffffff" emissive={color} emissiveIntensity={3.5} roughness={0.0} metalness={0.0} />
      </mesh>
    );
  }
  return null;
}

// ─── Level generator ─────────────────────────────────────────────────────────
function generateLevel(config: GameConfig, palette: string[], seedStr: string) {
  const count = Math.max(5, Math.min(config.platforms || 6, 12));
  const platforms: { pos: [number, number, number]; size: [number, number, number]; color: string }[] = [
    { pos: [0, 0, 0], size: [7, 0.8, 7], color: palette[0] },
  ];

  const rng = makeRng(hashString(seedStr));

  let x = 0, z = -7, y = 0;
  for (let i = 0; i < count; i++) {
    x += (rng() - 0.5) * 6;
    z -= 5 + rng() * 4;
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

  const mp = useMemo(() => moodPresetFor(config.mood), [config.mood]);
  // Sky uses mood preset's gradient; LLM's sky_color (if any) blends as bottomColor when richer.
  const skyTop = mp.skyTopColor;
  const skyBottom = config.background?.sky_color || mp.skyBottomColor;
  const fogColorHex = skyBottom;
  const p0 = useMemo(() => new THREE.Color(palette[0]), [palette]);
  const p1 = useMemo(() => new THREE.Color(palette[1] || palette[0]), [palette]);
  const p2 = useMemo(() => new THREE.Color(palette[2] || palette[0]), [palette]);
  const levelDepth = useMemo(() => Math.abs(last.pos[2]) + 40, [last]);

  // Per-mood mist density (Tier 1 atmosphere). Cosmic/ethereal lean toward
  // open void so we keep their density low; nightmare/dark_fantasy get the
  // most fog-of-war feel.
  const mistDensity = useMemo(() => {
    switch (config.mood) {
      case 'nightmare':    return 0.9;
      case 'dark_fantasy': return 0.8;
      case 'cozy_dream':   return 0.55;
      case 'whimsical':    return 0.45;
      case 'cyber_dream':  return 0.25;
      case 'cosmic':
      case 'ethereal':     return 0.0;
      default:             return 0.4;
    }
  }, [config.mood]);

  // Distant-ridges intensity (0..1) — height multiplier per mood.
  const ridgeIntensity = useMemo(() => {
    switch (config.mood) {
      case 'nightmare':    return 0.95;
      case 'dark_fantasy': return 0.85;
      case 'cosmic':       return 0.7;
      case 'cyber_dream':  return 0.55;
      case 'cozy_dream':
      case 'whimsical':    return 0.4;
      case 'ethereal':     return 0.3;
      default:             return 0.5;
    }
  }, [config.mood]);

  // Exclusion regions on the XZ plane (platform footprints + buffer) so
  // InstancedProps don't scatter under floating platforms or block the player.
  const platformExclusions = useMemo(
    () =>
      platforms.map((p) => ({
        x: p.pos[0],
        z: p.pos[2],
        // Half-width of the longer horizontal side + 1.5u clearance buffer.
        r: Math.max(p.size[0], p.size[2]) / 2 + 1.5,
      })),
    [platforms],
  );

  return (
    <>
      <SkyDome topColor={skyTop} bottomColor={skyBottom} />
      <fogExp2 attach="fog" args={[fogColorHex, mp.fogDensity]} />

      {/* Lighting */}
      <ambientLight intensity={mp.ambientIntensity} color={p1} />
      <directionalLight position={[15, 30, 10]} intensity={mp.directionalIntensity} color={p0} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[-20, 15, -10]} color={p2} intensity={80} distance={60} />
      <pointLight position={[20, 5, 30]} color={p0} intensity={60} distance={50} />

      {/* Environment — order matters: opaque (far → near) BEFORE transparent. */}
      <Stars radius={120} depth={60} count={mp.starsCount} factor={5} fade speed={0.4} />

      {/* Far-horizon silhouette ridges (opaque, heavily fog-dimmed). Use
          `skyBottom` not `mp.skyBottomColor` so the ridges follow the LLM's
          background.sky_color override when present (audit HIGH-3 fix). */}
      <DistantRidges
        color={skyBottom}
        levelDepth={levelDepth}
        intensity={ridgeIntensity}
      />

      {/* Ground with mood-driven displacement (opaque). */}
      {mp.groundColor && (
        <DisplacedGround
          color={mp.groundColor}
          levelDepth={levelDepth}
          terrain={mp.terrainType}
        />
      )}

      {/* Per-mood instanced world props (mostly opaque; ethereal glass-spire
          uses transparent material — render before the explicit-transparent
          mist/particles below). */}
      <InstancedProps
        mood={config.mood}
        levelDepth={levelDepth}
        palette={palette}
        seed={levelSeed}
        exclusionPath={platformExclusions}
      />

      {/* Low-altitude mist billboards (transparent, depthWrite false).
          seed=levelSeed makes the puff layout reproducible per dream. */}
      <GroundMist
        color={palette[1] || skyBottom}
        levelDepth={levelDepth}
        density={mistDensity}
        seed={levelSeed}
      />

      {/* Atmospheric particles (transparent, instanced). */}
      {mp.particleType === 'sparkle' ? (
        <Sparkles
          count={mp.sparklesCount}
          scale={[platforms.length * 5, 20, platforms.length * 7]}
          position={[0, 6, -platforms.length * 3.5]}
          size={2}
          speed={0.15}
          color={palette[0]}
        />
      ) : (
        <AtmosphericParticles kind={mp.particleType} palette={palette} levelDepth={levelDepth} />
      )}

      {/* Floating narrative */}
      <Float speed={0.8} floatIntensity={0.3} rotationIntensity={0.05}>
        <Text
          position={[0, 7, 4]}
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
          shape={mp.playerShape}
          characterUrl={assets?.character_3d ?? null}
          characterObjUrl={assets?.character_obj ?? null}
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
            decoration={mp.platformDecoration}
            isSpawn={i === 0}
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
          shape={mp.enemyShape}
          color={mp.enemyColor}
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
export default function DreamGame3D({ config, generationId, assets, onWinHook, onDeadHook }: {
  config: GameConfig;
  generationId?: string;
  assets?: GameAssets;
  /** Optional side-effect fired before setState('won') — wire stinger SFX here. */
  onWinHook?: () => void;
  /** Optional side-effect fired before setState('dead') — wire stinger SFX here. */
  onDeadHook?: () => void;
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

  // Enter / Space restarts the run from the win or dead overlay.
  useEffect(() => {
    if (state === 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault();
        restart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

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
        camera={{ fov: 65, near: 0.1, far: 600, position: [0, 12, 18] }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ gl }) => { gl.toneMappingExposure = 1.2; }}
      >
        <DreamScene
          config={config}
          generationId={generationId}
          assets={assets}
          restartToken={restartToken}
          onWin={() => { onWinHook?.(); setState('won'); }}
          onDead={() => { onDeadHook?.(); setState('dead'); }}
        />
        {/* Bloom postprocessing — intercepts the render after the scene tree. */}
        <PostFX />
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
