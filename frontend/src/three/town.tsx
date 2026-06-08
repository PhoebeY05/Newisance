import { useEffect, useMemo, useState } from 'react'
import { Html } from '@react-three/drei'
import { Building } from './buildings'

/**
 * Shared 3D "Newisance Town" building blocks — meshes, scenery and the place
 * data — used by both the full explorable hub (`pages/Learn.tsx`) and the small
 * auto-rotating preview on the home page (`components/TownPreview.tsx`).
 */

export interface Place {
  id: string
  name: string
  badge: string
  icon: string
  blurb: string
  cta: string
  to: string
  roof: string // accent colour for the structure
  pos: [number, number] // [x, z] on the ground
  footprint: number // ground radius — sizes the highlight ring + enter range
  signY: number // height of the floating name sign (clears the structure)
}

export const RING = 12 // radius of the building ring around the plaza
export const SPEED = 7 // avatar units / second
export const BOUND = 20 // how far the avatar may wander from centre
export const ENTER_RADIUS = 4.2 // how close counts as "at the door"

// Six buildings evenly spaced around the plaza (angles at 0/60/120/…°).
export const PLACES: Place[] = [
  { id: 'timed', name: 'Flappy Newsroom', badge: 'Game', icon: '🐦',
    blurb: 'Flappy Bird meets fact-checking — fly through the Real or Fake gaps!',
    cta: 'Start flying', to: '/timed-challenge', roof: '#5ccd7d',
    pos: [0, RING], footprint: 2.6, signY: 6.6 },
  { id: 'battle', name: 'Battle Arena', badge: 'Game', icon: '⚔️',
    blurb: 'Real-time multiplayer fact-checking. Last one standing wins it all.',
    cta: 'Enter arena', to: '/battle-royale', roof: '#d56060',
    pos: [RING * 0.866, RING * 0.5], footprint: 4.0, signY: 4.4 },
  { id: 'community', name: 'Town Square', badge: 'Social', icon: '💬',
    blurb: 'Swap tips and debunk hoaxes with the Newisance community.',
    cta: 'Join in', to: '/community', roof: '#e2823b',
    pos: [RING * 0.866, -RING * 0.5], footprint: 3.2, signY: 4.8 },
  { id: 'dashboard', name: 'Observatory', badge: 'Stats', icon: '📊',
    blurb: 'Track your credibility score, streaks and progress over time.',
    cta: 'View stats', to: '/dashboard', roof: '#46c8bd',
    pos: [0, -RING], footprint: 2.8, signY: 5.0 },
  { id: 'leaderboard', name: 'Trophy Hall', badge: 'Ranks', icon: '🏆',
    blurb: 'See who tops the credibility charts this week — and chase the crown.',
    cta: 'See ranks', to: '/leaderboard', roof: '#f3d15c',
    pos: [-RING * 0.866, -RING * 0.5], footprint: 3.0, signY: 5.8 },
  { id: 'verify', name: 'Fact-Check Lab', badge: 'Tool', icon: '🔍',
    blurb: 'Paste any headline, image or message for an instant credibility read.',
    cta: 'Investigate', to: '/verify', roof: '#4d89f7',
    pos: [-RING * 0.866, RING * 0.5], footprint: 2.8, signY: 5.0 },
]

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function lerpAngle(a: number, b: number, t: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * Math.min(1, t)
}

/** Static scenery: ground, plaza, radial paths, central fountain, lamps,
 *  trees and flowers. */
export function TownScenery() {
  const trees = useMemo(
    () => [
      [17, 1], [-17, 3], [5, -18], [-8, 18], [19, -11], [-19, -10], [11, 17], [-13, -17],
      [22, 6], [-22, 8], [3, 22], [-4, -22],
    ] as [number, number][],
    [],
  )
  const flowers = useMemo(
    () => [
      [9, 3, '#e85d8a'], [-8, 5, '#f3d15c'], [4, 8, '#ef6f6f'], [-5, -8, '#c77dff'],
      [8, -6, '#f3d15c'], [-9, 2, '#e85d8a'], [2, -9, '#7ed957'], [-3, 9, '#ffd166'],
    ] as [number, number, string][],
    [],
  )
  return (
    <group>
      {/* grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#7ec96f" />
      </mesh>
      {/* darker grass patches for variation */}
      {[[12, 9], [-14, -6], [9, -13]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.005, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[4 + i, 24]} />
          <meshStandardMaterial color="#74bf66" />
        </mesh>
      ))}
      {/* plaza */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial color="#e7d6a6" />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[6.7, 7, 48]} />
        <meshStandardMaterial color="#cdb888" />
      </mesh>
      {/* ring road under the buildings */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[RING - 1.3, RING + 1.3, 64]} />
        <meshStandardMaterial color="#e7d6a6" />
      </mesh>
      {/* radial paths from plaza to each building */}
      {PLACES.map((p) => {
        const a = Math.atan2(p.pos[0], p.pos[1])
        return (
          <mesh
            key={p.id}
            position={[Math.sin(a) * ((RING + 7) / 2), 0.011, Math.cos(a) * ((RING + 7) / 2)]}
            rotation={[-Math.PI / 2, 0, -a]}
            receiveShadow
          >
            <planeGeometry args={[2.4, RING - 6]} />
            <meshStandardMaterial color="#e7d6a6" />
          </mesh>
        )
      })}

      <Fountain />
      {/* lamp posts around the plaza edge */}
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6
        return <Lamp key={i} position={[Math.cos(a) * 6.2, 0, Math.sin(a) * 6.2]} />
      })}

      {trees.map(([x, z], i) => (
        <Tree key={i} position={[x, 0, z]} />
      ))}
      {flowers.map(([x, z, c], i) => (
        <Flower key={i} position={[x, 0, z]} color={c} />
      ))}
    </group>
  )
}

function Fountain() {
  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.6, 1.8, 0.5, 24]} />
        <meshStandardMaterial color="#cfc3a3" />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[1.45, 1.45, 0.12, 24]} />
        <meshStandardMaterial color="#6fc6e8" transparent opacity={0.85} metalness={0.2} roughness={0.1} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.3, 0.9, 16]} />
        <meshStandardMaterial color="#cfc3a3" />
      </mesh>
      <mesh position={[0, 1.35, 0]}>
        <cylinderGeometry args={[0.7, 0.7, 0.1, 20]} />
        <meshStandardMaterial color="#6fc6e8" transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 1.7, 0]} castShadow>
        <sphereGeometry args={[0.18, 14, 14]} />
        <meshStandardMaterial color="#9fe0f5" transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

function Lamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 2.2, 10]} />
        <meshStandardMaterial color="#3c4a63" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 2.3, 0]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color="#fff3c4" emissive="#ffe07a" emissiveIntensity={0.9} />
      </mesh>
    </group>
  )
}

function Tree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.24, 1.4, 8]} />
        <meshStandardMaterial color="#8a5a2b" />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow>
        <coneGeometry args={[1.1, 2, 10]} />
        <meshStandardMaterial color="#4f9e57" />
      </mesh>
      <mesh position={[0, 2.7, 0]} castShadow>
        <coneGeometry args={[0.8, 1.5, 10]} />
        <meshStandardMaterial color="#5fb368" />
      </mesh>
    </group>
  )
}

function Flower({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.5, 6]} />
        <meshStandardMaterial color="#4f9e57" />
      </mesh>
      <mesh position={[0, 0.55, 0]} castShadow>
        <sphereGeometry args={[0.16, 10, 10]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

/**
 * A 3D building with a floating name sign. Pass `onSelect` to make it
 * interactive (click / hover-to-scale + pointer cursor); omit it for the
 * non-interactive preview.
 */
export function TownHouse({
  place,
  active = false,
  onSelect,
}: {
  place: Place
  active?: boolean
  onSelect?: (p: Place) => void
}) {
  const [hovered, setHovered] = useState(false)
  const interactive = !!onSelect
  const [x, z] = place.pos
  // Face the door (local +z) toward the plaza centre.
  const rotY = Math.atan2(-x, -z)

  useEffect(() => {
    if (!interactive) return
    document.body.style.cursor = hovered ? 'pointer' : 'auto'
    return () => {
      document.body.style.cursor = 'auto'
    }
  }, [hovered, interactive])

  const lifted = active || hovered
  const fp = place.footprint

  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      {active && (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[fp + 0.2, fp + 0.7, 56]} />
          <meshBasicMaterial color="#f3d15c" transparent opacity={0.85} />
        </mesh>
      )}

      <group
        onClick={
          interactive
            ? (e) => {
                e.stopPropagation()
                onSelect!(place)
              }
            : undefined
        }
        onPointerOver={
          interactive
            ? (e) => {
                e.stopPropagation()
                setHovered(true)
              }
            : undefined
        }
        onPointerOut={interactive ? () => setHovered(false) : undefined}
        scale={lifted ? 1.04 : 1}
      >
        <Building place={place} />
      </group>

      <Html position={[0, place.signY, 0]} center distanceFactor={14} zIndexRange={[5, 0]} pointerEvents="none">
        <div
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-full bg-card/90 px-3 py-1 text-sm font-bold text-white shadow-lg ring-1 ring-white/15 transition-transform ${
            active ? 'scale-110' : ''
          }`}
        >
          <span>{place.icon}</span>
          {place.name}
        </div>
      </Html>
    </group>
  )
}

/** The avatar's mesh content (no transform group — the caller animates it). */
export function AvatarBody() {
  return (
    <>
      <mesh position={[0, 0.85, 0]} castShadow>
        <capsuleGeometry args={[0.42, 0.7, 8, 16]} />
        <meshStandardMaterial color="#233f96" />
      </mesh>
      <mesh position={[0, 1.75, 0]} castShadow>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshStandardMaterial color="#fbf3e2" />
      </mesh>
      {/* beak / nose marks the facing direction (local +z) */}
      <mesh position={[0, 1.72, 0.4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.12, 0.28, 12]} />
        <meshStandardMaterial color="#f3a73b" />
      </mesh>
      <mesh position={[0.16, 1.84, 0.34]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#15264c" />
      </mesh>
      <mesh position={[-0.16, 1.84, 0.34]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#15264c" />
      </mesh>
    </>
  )
}

/** Shared lighting + sky setup for both canvases. */
export function TownLighting() {
  return (
    <>
      <fog attach="fog" args={['#d8f1fb', 34, 85]} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#cfeeff', '#6ea35a', 0.6]} />
      <directionalLight
        position={[14, 20, 8]}
        intensity={1.25}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />
    </>
  )
}
