'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars, Sparkles, Float, Text } from '@react-three/drei';
import { Physics, RigidBody, RapierRigidBody } from '@react-three/rapier';
import { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';

export interface GameConfig {
  mood: string;
  style: string;
  genre?: string;
  color_palette: string[];
  narrative: string;
  goal: string;
  music_prompt?: string;
  main_character: { description: string; color: string };
  background: { sky_color: string; ground_color: string };
  platforms: number;
  enemy_count: number;
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

  useFrame(() => {
    if (!target.current) return;
    const t = target.current.translation();
    const p = new THREE.Vector3(t.x, t.y, t.z);
    const desired = p.clone().add(new THREE.Vector3(0, 9, -16));
    camPos.current.lerp(desired, 0.07);
    camera.position.copy(camPos.current);
    lookTarget.current.lerp(new THREE.Vector3(p.x, p.y + 1.5, p.z), 0.1);
    camera.lookAt(lookTarget.current);
  });
  return null;
}

// ─── Player ──────────────────────────────────────────────────────────────────
interface PlayerProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  color: string;
  keys: React.RefObject<Record<string, boolean>>;
  goalPos: THREE.Vector3;
  enemyRefs: React.RefObject<THREE.Vector3[]>;
  onDead: () => void;
  onWin: () => void;
}

function Player({ bodyRef, color, keys, goalPos, enemyRefs, onDead, onWin }: PlayerProps) {
  const grounded = useRef(false);
  const canJump = useRef(true);
  const ended = useRef(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((_, delta) => {
    if (!bodyRef.current || ended.current) return;

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

    // Mesh bob
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 2;
    }
    // Player light pulse
    if (lightRef.current) {
      lightRef.current.intensity = 2.5 + Math.sin(Date.now() * 0.004) * 0.8;
    }

    // Death by falling
    if (pos.y < -12 && !ended.current) {
      ended.current = true;
      onDead();
      return;
    }

    // Enemy collision (distance-based, avoids rapier event complexity)
    const playerVec = new THREE.Vector3(pos.x, pos.y, pos.z);
    if (enemyRefs.current) {
      for (const ep of enemyRefs.current) {
        if (playerVec.distanceTo(ep) < 1.4) {
          ended.current = true;
          onDead();
          return;
        }
      }
    }

    // Win
    if (playerVec.distanceTo(goalPos) < 2.8 && !ended.current) {
      ended.current = true;
      onWin();
    }
  });

  const col = useMemo(() => new THREE.Color(color), [color]);

  return (
    <RigidBody
      ref={bodyRef}
      colliders="ball"
      restitution={0.05}
      friction={2}
      linearDamping={0.8}
      position={[0, 4, 0]}
      onCollisionEnter={() => { grounded.current = true; }}
      onCollisionExit={() => { setTimeout(() => { grounded.current = false; }, 120); }}
    >
      <mesh ref={meshRef} castShadow>
        <icosahedronGeometry args={[0.55, 2]} />
        <meshStandardMaterial
          color={col}
          emissive={col}
          emissiveIntensity={0.7}
          roughness={0.1}
          metalness={0.4}
        />
      </mesh>
      <pointLight ref={lightRef} color={col} intensity={2.5} distance={6} />
    </RigidBody>
  );
}

// ─── Platform ────────────────────────────────────────────────────────────────
function Platform({ position, size, color, index }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  index: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const col = useMemo(() => new THREE.Color(color), [color]);
  const offset = useRef(index * 0.7);

  useFrame(() => {
    if (!meshRef.current) return;
    // Subtle breathing glow via emissiveIntensity
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.12 + Math.sin(Date.now() * 0.001 + offset.current) * 0.06;
  });

  return (
    <RigidBody type="fixed" position={position} colliders="cuboid">
      <mesh ref={meshRef} receiveShadow castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={col}
          emissive={col}
          emissiveIntensity={0.12}
          roughness={0.3}
          metalness={0.3}
        />
      </mesh>
    </RigidBody>
  );
}

// ─── Enemy ───────────────────────────────────────────────────────────────────
function Enemy({ position, onUpdate }: {
  position: [number, number, number];
  onUpdate: (v: THREE.Vector3) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const t = useRef(Math.random() * Math.PI * 2);
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
    onUpdate(meshRef.current.position.clone());
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
function GoalPortal({ position }: { position: [number, number, number] }) {
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
    <group position={position}>
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

// ─── Level generator ─────────────────────────────────────────────────────────
function generateLevel(config: GameConfig, palette: string[]) {
  const count = Math.max(5, Math.min(config.platforms || 6, 12));
  const platforms: { pos: [number, number, number]; size: [number, number, number]; color: string }[] = [
    { pos: [0, 0, 0], size: [7, 0.8, 7], color: palette[0] },
  ];

  // Seeded RNG using mood string
  let seed = config.mood.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };

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
function DreamScene({ config, onWin, onDead }: {
  config: GameConfig;
  onWin: () => void;
  onDead: () => void;
}) {
  const playerRef = useRef<RapierRigidBody>(null);
  const keys = useKeys();
  const enemyPositions = useRef<THREE.Vector3[]>([]);

  const palette = useMemo(
    () => (config.color_palette?.length ? config.color_palette : ['#a855f7', '#7c3aed', '#4c1d95', '#1e1b4b']),
    [config.color_palette],
  );

  const platforms = useMemo(() => generateLevel(config, palette), [config, palette]);
  const last = platforms[platforms.length - 1];
  const goalPos = useMemo(
    () => new THREE.Vector3(last.pos[0], last.pos[1] + 3.5, last.pos[2]),
    [last],
  );

  const enemies = useMemo(() => {
    const count = Math.min(config.enemy_count || 3, platforms.length - 1);
    return Array.from({ length: count }, (_, i) => {
      const p = platforms[Math.max(1, Math.round(1 + (i * (platforms.length - 2)) / Math.max(count - 1, 1)))];
      return { id: i, pos: [p.pos[0], p.pos[1] + 1.5, p.pos[2]] as [number, number, number] };
    });
  }, [config.enemy_count, platforms]);

  // Initialize enemy positions array
  useEffect(() => {
    enemyPositions.current = enemies.map(e => new THREE.Vector3(...e.pos));
  }, [enemies]);

  const skyHex = config.background?.sky_color || '#0a0015';
  const fogDensity = config.mood === 'nightmare' ? 0.03 : config.mood === 'cozy_dream' ? 0.006 : 0.015;
  const p0 = useMemo(() => new THREE.Color(palette[0]), [palette]);
  const p1 = useMemo(() => new THREE.Color(palette[1] || palette[0]), [palette]);
  const p2 = useMemo(() => new THREE.Color(palette[2] || palette[0]), [palette]);

  return (
    <>
      <color attach="background" args={[skyHex]} />
      <fogExp2 attach="fog" args={[skyHex, fogDensity]} />

      {/* Lighting */}
      <ambientLight intensity={0.5} color={p1} />
      <directionalLight position={[15, 30, 10]} intensity={2} color={p0} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[-20, 15, -10]} color={p2} intensity={3} distance={60} />
      <pointLight position={[20, 5, 30]} color={p0} intensity={2} distance={50} />

      {/* Environment */}
      <Stars radius={120} depth={60} count={4000} factor={5} fade speed={0.4} />
      <Sparkles
        count={120}
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
          keys={keys}
          goalPos={goalPos}
          enemyRefs={enemyPositions}
          onDead={onDead}
          onWin={onWin}
        />

        {/* Platforms */}
        {platforms.map((p, i) => (
          <Platform key={i} position={p.pos} size={p.size} color={p.color} index={i} />
        ))}
      </Physics>

      {/* Enemies (kinematic, distance-based collision) */}
      {enemies.map((e, i) => (
        <Enemy
          key={e.id}
          position={e.pos}
          onUpdate={(v) => { enemyPositions.current[i] = v; }}
        />
      ))}

      {/* Goal */}
      <GoalPortal position={[goalPos.x, goalPos.y, goalPos.z]} />

      {/* Camera */}
      <FollowCamera target={playerRef} />
    </>
  );
}

// ─── Exported component ───────────────────────────────────────────────────────
export default function DreamGame3D({ config }: { config: GameConfig }) {
  const [state, setState] = useState<'playing' | 'won' | 'dead'>('playing');
  const [sceneKey, setSceneKey] = useState(0);

  const restart = () => { setState('playing'); setSceneKey(k => k + 1); };

  return (
    <div className="relative w-full h-full" style={{ outline: 'none' }} tabIndex={0}>
      <Canvas
        key={sceneKey}
        shadows
        camera={{ fov: 65, near: 0.1, far: 600, position: [0, 12, -18] }}
        gl={{ antialias: true, toneMapping: 3 /* ACESFilmic */ }}
      >
        <DreamScene config={config} onWin={() => setState('won')} onDead={() => setState('dead')} />
      </Canvas>

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
