import { useEffect, useMemo, useState } from 'react'
import { Html, Sky, Stars, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js'
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

export const RING = 14 // radius of the building ring around the plaza
export const SPEED = 7 // avatar units / second
export const BOUND = 20 // how far the avatar may wander from centre
export const ENTER_RADIUS = 4.2 // how close counts as "at the door"

// The town is zoned into three neighbourhoods fanning out from the central
// plaza, each its own paved courtyard (see DISTRICTS below):
//   • TOWN CENTRE (north + east) — the civic crescent: Home, Community, Trophy
//     Hall, Observatory and the Fact-Check Lab.
//   • GAMES DISTRICT (south) — Truth Tower, Flappy and the Battle Arena clustered
//     together so the play zone reads as one place.
//   • SHOPPING ROW (west) — the Power-Up Shop + Style Studio, deliberately seated
//     right beside the games (the Power-Up Shop is the closest building to the
//     arena) since that's what you shop for.
// An open lawn to the north-west is left as the town's "entrance" view.
//
// Positions sit on a ~radius-15 circle (the Arena is pushed a touch further out
// for breathing room), spelled out per building so each lands in its district.
export const PLACES: Place[] = [
  // --- Town Centre · civic crescent (north → south-east) ---
  { id: 'profile', name: 'Your Home', badge: 'Profile', icon: '🏠',
    blurb: 'Track your credibility score, streaks and progress over time.',
    cta: 'View profile', to: '/profile', roof: '#e8a05a',
    pos: [0, 15], footprint: 2.6, signY: 5.0 },
  { id: 'community', name: 'Community Town Feed', badge: 'Social', icon: '💬',
    blurb: 'Swap tips and debunk hoaxes with the Newisance community.',
    cta: 'Join in', to: '/community', roof: '#e2823b',
    pos: [8.82, 12.13], footprint: 3.2, signY: 4.8 },
  { id: 'leaderboard', name: 'Trophy Hall', badge: 'Ranks', icon: '🏆',
    blurb: 'See who tops the credibility charts this week — and chase the crown.',
    cta: 'See ranks', to: '/leaderboard', roof: '#f3d15c',
    pos: [14.27, 4.64], footprint: 3.0, signY: 5.8 },
  { id: 'dashboard', name: 'Observatory', badge: 'Trends', icon: '📊',
    blurb: 'Scan live misinformation trends, top scams and community alerts.',
    cta: 'Open dashboard', to: '/dashboard', roof: '#46c8bd',
    pos: [14.27, -4.64], footprint: 2.8, signY: 5.0 },
  { id: 'verify', name: 'Fact-Check Lab', badge: 'Tool', icon: '🔍',
    blurb: 'Paste any headline, image or message for an instant credibility read.',
    cta: 'Investigate', to: '/verify', roof: '#4d89f7',
    pos: [8.82, -12.13], footprint: 2.8, signY: 5.0 },
  // --- Games District · clustered to the south ---
  { id: 'truth-tower', name: 'Truth Tower Game', badge: 'Game', icon: 'TT',
    blurb: 'Stack blocks high, then defend the tower by judging claims as Real or Fake.',
    cta: 'Build tower', to: '/truth-tower', roof: '#233f96',
    pos: [-1.57, -14.92], footprint: 2.8, signY: 7.4 },
  { id: 'timed', name: 'Flappy News Game', badge: 'Game', icon: '🐦',
    blurb: 'Flappy Bird meets fact-checking — fly through the Real or Fake gaps!',
    cta: 'Start flying', to: '/timed-challenge', roof: '#5ccd7d',
    pos: [-7.5, -12.99], footprint: 2.6, signY: 6.6 },
  { id: 'battle', name: 'Battle Arena Game', badge: 'Game', icon: '⚔️',
    blurb: 'Real-time multiplayer fact-checking. Last one standing wins it all.',
    cta: 'Enter arena', to: '/battle-royale', roof: '#d56060',
    pos: [-13.26, -8.95], footprint: 4.0, signY: 4.4 },
  // --- Shopping Row · west, next to the games ---
  { id: 'shop', name: 'Power-Up Shop', badge: 'Shop', icon: '⚡',
    blurb: 'Spend credibility on power-ups that give you an edge in the games.',
    cta: 'Go shopping', to: '/shop', roof: '#9b5de5',
    pos: [-14.92, -1.57], footprint: 2.6, signY: 4.4 },
  { id: 'wardrobe', name: 'Style Studio', badge: 'Style', icon: '👕',
    blurb: 'Switch into avatars you have unlocked — climb the tiers to earn more.',
    cta: 'Open wardrobe', to: '/wardrobe', roof: '#e85d8a',
    pos: [-12.99, 7.5], footprint: 2.6, signY: 4.6 },
]

const DEG = Math.PI / 180

// Each neighbourhood as an annular sector of paving around the plaza. `a0`/`a1`
// are degrees clockwise from due north (matching the building positions) and
// bound the courtyard; `color` tints its ground and `accent` its inner kerb +
// entrance banner. The wedges of grass left between the sectors read as the
// dividers between districts.
const DISTRICTS = [
  { id: 'civic', color: '#e7d6a6', accent: '#46c8bd', a0: -16, a1: 160 },
  { id: 'games', color: '#ead0a0', accent: '#d56060', a0: 174, a1: 246 },
  { id: 'shops', color: '#e4d2bd', accent: '#9b5de5', a0: 252, a1: 312 },
] as const

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function lerpAngle(a: number, b: number, t: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * Math.min(1, t)
}

// ---- Day / night cycle ----------------------------------------------------
// The town's sky and lighting follow the visitor's real local clock: bright and
// blue by day, dark and starlit at night, with a warm glow around dawn/dusk.

export interface SkyState {
  sunPosition: [number, number, number]
  fog: string
  ambient: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  dirColor: string
  dirIntensity: number
  lamp: number
  turbidity: number
  rayleigh: number
  background: string
  night: number // 0 = full day, 1 = full night (drives stars + moon)
}

const _mixA = new THREE.Color()
const _mixB = new THREE.Color()
function mixHex(a: string, b: string, t: number): string {
  return '#' + _mixA.set(a).lerp(_mixB.set(b), clamp(t, 0, 1)).getHexString()
}
const lerpN = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1)

/** Derive the full sky + lighting palette from a clock time (defaults to now). */
export function getSkyState(date: Date = new Date()): SkyState {
  const h = date.getHours() + date.getMinutes() / 60
  const dayPhase = (h - 6) / 12 // 0 at 06:00, 1 at 18:00
  const sunAngle = dayPhase * Math.PI // the sun arcs 0..π across the day
  const sunY = Math.sin(sunAngle) // > 0 daytime, < 0 night
  const sunX = Math.cos(sunAngle) // + morning (east) → − evening (west)

  // `lit` ramps daylight up through dawn and down through dusk, leaving a little
  // twilight glow just after the sun dips below the horizon.
  const lit = clamp((sunY + 0.1) / 0.42, 0, 1)
  const night = 1 - lit
  // Golden hour: warm tint while the sun sits low above the horizon.
  const golden = clamp(1 - Math.abs(sunY - 0.14) / 0.26, 0, 1) * lit

  const dirBase = mixHex('#9bb8ff', '#fff4dc', lit) // moonlight → daylight white
  const dirColor = mixHex(dirBase, '#ff9d4d', golden * 0.7)
  const fog = mixHex('#0d1430', '#d8f1fb', lit)

  return {
    sunPosition: [sunX * 95, sunY * 90 + 2, 32],
    fog: mixHex(fog, '#f6c98f', golden * 0.35),
    ambient: lerpN(0.34, 0.78, lit),
    hemiSky: mixHex('#2a3a6b', '#cfeeff', lit),
    hemiGround: mixHex('#10203a', '#6ea35a', lit),
    hemiIntensity: lerpN(0.35, 0.6, lit),
    dirColor,
    dirIntensity: lerpN(0.25, 1.3, lit),
    lamp: lerpN(1.8, 0.25, lit),
    turbidity: lerpN(8, 6, lit),
    rayleigh: lerpN(2.4, 1.4, lit) + golden * 1.5,
    background: mixHex('#0a1026', '#bfe9ff', lit),
    night,
  }
}

/** Recompute the sky palette from the real clock, re-rendering once a minute. */
export function useSkyState(): SkyState {
  const [state, setState] = useState(() => getSkyState())
  useEffect(() => {
    const id = window.setInterval(() => setState(getSkyState()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return state
}

/** Static scenery: ground, plaza, radial paths, central fountain, lamps,
 *  trees and flowers. */
export function TownScenery({ lampIntensity = 0.9 }: { lampIntensity?: number } = {}) {
  // A belt of trees ringing the town in the outer lawn (radius ~20), framing
  // everything and flanking the open north-west "entrance" gap.
  const trees = useMemo(
    () => [
      [5, 20], [14, 15], [19, 7], [21, -3], [18, -13], [11, -18],
      [2, -21], [-9, -18], [-16, -13], [-20, -4], [-15, 15], [-7, 19], [3, 21],
    ] as [number, number][],
    [],
  )
  // Flower beds inside each courtyard, tucked between the buildings.
  const flowers = useMemo(
    () => [
      [3.4, 10.5, '#e85d8a'], [8.9, 6.5, '#f3d15c'], [11, 0, '#ef6f6f'], [8.9, -6.5, '#c77dff'],
      [3.4, -10.5, '#ffd166'], [-3.4, -10.5, '#7ed957'], [-7.4, -8.2, '#e85d8a'], [-10.8, 2.3, '#9be8b4'],
    ] as [number, number, string][],
    [],
  )
  // Hedges along the two grass wedges that divide the districts (civic|games at
  // ~167°, games|shops at ~249°), stepping out from the plaza.
  const hedges = useMemo(() => {
    const lines: [number, number][] = []
    for (const aDeg of [167, 249]) {
      const a = aDeg * DEG
      for (const r of [8.6, 10.6, 12.6, 14.6]) lines.push([Math.sin(a) * r, Math.cos(a) * r])
    }
    return lines
  }, [])
  return (
    <group>
      {/* grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#7ec96f" />
      </mesh>
      {/* darker grass patches in the outer lawn for variation */}
      {[[16, 17], [-18, 11], [15, -18]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.005, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[4 + (i % 2), 24]} />
          <meshStandardMaterial color="#74bf66" />
        </mesh>
      ))}

      {/* the three district courtyards */}
      {DISTRICTS.map((d) => (
        <DistrictPad key={d.id} a0={d.a0} a1={d.a1} color={d.color} accent={d.accent} />
      ))}

      {/* central plaza */}
      <mesh position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial color="#efe3bf" />
      </mesh>
      <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[6.6, 7, 48]} />
        <meshStandardMaterial color="#cdb888" />
      </mesh>

      <Fountain />

      {/* a gated entrance banner fronting each district */}
      {DISTRICTS.map((d) => (
        <DistrictGate key={d.id} angleDeg={(d.a0 + d.a1) / 2} color={d.accent} />
      ))}

      {/* lamp posts dotted through the courtyards */}
      {[18, 96, 150, 207, 282, 330].map((aDeg, i) => {
        const a = aDeg * DEG
        return <Lamp key={i} position={[Math.sin(a) * 8.4, 0, Math.cos(a) * 8.4]} intensity={lampIntensity} />
      })}

      {hedges.map(([x, z], i) => (
        <Bush key={i} position={[x, 0, z]} />
      ))}
      {trees.map(([x, z], i) => (
        <Tree key={i} position={[x, 0, z]} />
      ))}
      {flowers.map(([x, z, c], i) => (
        <Flower key={i} position={[x, 0, z]} color={c} />
      ))}
    </group>
  )
}

/** A neighbourhood's paved courtyard: an annular sector of sandstone around the
 *  plaza, with a coloured kerb along its inner (plaza-facing) edge. `a0`/`a1`
 *  are degrees clockwise from north; the geometry's theta runs from `a0 - 90°`. */
function DistrictPad({ a0, a1, color, accent }: { a0: number; a1: number; color: string; accent: string }) {
  const start = (a0 - 90) * DEG
  const len = (a1 - a0) * DEG
  return (
    <group>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[7.4, 16.8, 64, 1, start, len]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.011, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[7.4, 7.9, 64, 1, start, len]} />
        <meshStandardMaterial color={accent} />
      </mesh>
    </group>
  )
}

/** A timber gate-arch with a hanging banner, marking the entrance to a district.
 *  Sits just inside the courtyard and faces the plaza. */
function DistrictGate({ angleDeg, color }: { angleDeg: number; color: string }) {
  const a = angleDeg * DEG
  const x = Math.sin(a) * 8.4
  const z = Math.cos(a) * 8.4
  const rotY = Math.atan2(-x, -z)
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      {[-2.1, 2.1].map((px) => (
        <group key={px} position={[px, 0, 0]}>
          <mesh position={[0, 1.55, 0]} castShadow>
            <cylinderGeometry args={[0.13, 0.16, 3.1, 12]} />
            <meshStandardMaterial color="#b98c52" />
          </mesh>
          <mesh position={[0, 3.2, 0]} castShadow>
            <sphereGeometry args={[0.18, 12, 12]} />
            <meshStandardMaterial color="#f3d15c" metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* cross-beam */}
      <mesh position={[0, 3.05, 0]} castShadow>
        <boxGeometry args={[4.7, 0.3, 0.34]} />
        <meshStandardMaterial color="#a87c46" />
      </mesh>
      {/* hanging banner in the district colour */}
      <mesh position={[0, 2.45, 0.02]} castShadow>
        <boxGeometry args={[2.4, 0.86, 0.06]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* scalloped lower edge */}
      {[-0.8, 0, 0.8].map((bx) => (
        <mesh key={bx} position={[bx, 1.98, 0.02]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.4, 0.34, 3]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  )
}

/** A small rounded hedge bush — used to fence off the lanes between districts. */
function Bush({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.52, 12, 12]} />
        <meshStandardMaterial color="#4f9e57" />
      </mesh>
      <mesh position={[0.36, 0.26, 0.12]} castShadow>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshStandardMaterial color="#5fb368" />
      </mesh>
      <mesh position={[-0.34, 0.24, -0.06]} castShadow>
        <sphereGeometry args={[0.36, 12, 12]} />
        <meshStandardMaterial color="#57a85f" />
      </mesh>
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

function Lamp({ position, intensity = 0.9 }: { position: [number, number, number]; intensity?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 2.2, 10]} />
        <meshStandardMaterial color="#3c4a63" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 2.3, 0]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color="#fff3c4" emissive="#ffe07a" emissiveIntensity={intensity} />
      </mesh>
      {/* a pointed glow that only really shows once the lamps brighten at dusk */}
      <pointLight position={[0, 2.3, 0]} color="#ffe7a8" intensity={intensity * 0.7} distance={9} decay={2} />
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

// A compact, web-optimised glTF of the Mixamo "Timmy" character — converted from
// a 34 MB FBX down to ~1.2 MB by shrinking its 4K textures to 512px and
// re-encoding to WebP. It carries the walk-cycle clip (played while moving). For
// the idle we show the model's rest pose — a T-pose whose legs are already
// straight + together — and just swing the arms down to the sides. (The separate
// "stand" FBX was unusable: no animation, exported as a bare T-pose.)
const TIMMY_WALK_URL = '/models/timmy-walk.glb'

// Target world directions (bone → child) for the upper arms in the idle pose:
// mostly straight down, with a slight outward + forward splay to clear the torso.
const IDLE_ARM_DIR = {
  left: new THREE.Vector3(0.22, -1, 0.08),
  right: new THREE.Vector3(-0.22, -1, 0.08),
}

/** Normalise a loaded character model: ~1.85 units tall, centred on the ground,
 *  with shadows enabled and frustum culling off (the avatar is always on
 *  screen). Shared by every glTF avatar (Timmy + the unlockable models). */
export function normalizeAvatarScene(scene: THREE.Group) {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    child.frustumCulled = false
  })

  const initialBox = new THREE.Box3().setFromObject(scene)
  const initialSize = initialBox.getSize(new THREE.Vector3())
  const maxDimension = Math.max(initialSize.x, initialSize.y, initialSize.z, 1)
  scene.scale.setScalar(1.85 / maxDimension)

  const scaledBox = new THREE.Box3().setFromObject(scene)
  const center = scaledBox.getCenter(new THREE.Vector3())
  scene.position.x -= center.x
  scene.position.z -= center.z
  scene.position.y -= scaledBox.min.y
}

/** Reorient a bone so the vector to its (bone) child points along `targetWorld`,
 *  working in world space and converting the result back into the bone's local
 *  frame. Robust to whatever the rig's bind-pose axes happen to be. */
function aimBoneAlong(bone: THREE.Bone, targetWorld: THREE.Vector3) {
  const child = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined
  if (!child) return
  bone.updateWorldMatrix(true, true)
  const from = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)
  const to = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld)
  const current = to.sub(from).normalize()
  const delta = new THREE.Quaternion().setFromUnitVectors(current, targetWorld.clone().normalize())

  const boneWorldQuat = new THREE.Quaternion()
  bone.getWorldQuaternion(boneWorldQuat)
  const parentWorldQuat = new THREE.Quaternion()
  bone.parent?.getWorldQuaternion(parentWorldQuat)

  const newWorldQuat = delta.multiply(boneWorldQuat)
  bone.quaternion.copy(parentWorldQuat.invert().multiply(newWorldQuat))
  bone.updateWorldMatrix(false, true)
}

/** Turn the rest T-pose into a standing idle: swing the upper arms down to the
 *  sides (the forearms/hands follow rigidly; the legs are already together).
 *  glTF bone names look like "mixamorig6LeftArm" (the loader strips the ':'),
 *  so we match by suffix. */
function poseStandingIdle(scene: THREE.Group) {
  scene.updateMatrixWorld(true)
  const findBone = (suffix: string) => {
    let found: THREE.Bone | undefined
    scene.traverse((c) => {
      if (!found && (c as THREE.Bone).isBone && c.name.endsWith(suffix)) found = c as THREE.Bone
    })
    return found
  }
  const leftArm = findBone('LeftArm')
  const rightArm = findBone('RightArm')
  if (leftArm) aimBoneAlong(leftArm, IDLE_ARM_DIR.left)
  if (rightArm) aimBoneAlong(rightArm, IDLE_ARM_DIR.right)
}

/** A clone of the walk model, normalised + (optionally) posed. SkeletonUtils.clone
 *  is required for skinned meshes so our transforms don't mutate the cached
 *  source shared by the drei loader. */
function useTimmyClone(scene: THREE.Group, pose?: (s: THREE.Group) => void) {
  return useMemo(() => {
    const cloned = cloneSkinnedScene(scene) as THREE.Group
    normalizeAvatarScene(cloned)
    pose?.(cloned)
    return cloned
  }, [scene, pose])
}

/** Standing idle: the rest pose with arms lowered, no animation mixer (so the
 *  posed bones aren't overwritten each frame). */
function TimmyIdle({ scene, visible }: { scene: THREE.Group; visible: boolean }) {
  const avatar = useTimmyClone(scene, poseStandingIdle)
  return <primitive object={avatar} visible={visible} />
}

/** Looping walk cycle. */
function TimmyWalking({
  scene,
  animations,
  visible,
}: {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
  visible: boolean
}) {
  const avatar = useTimmyClone(scene)
  const { actions, names } = useAnimations(animations, avatar)

  useEffect(() => {
    const action = names.length ? actions[names[0]] : null
    if (!action) return
    action.reset().play()
    return () => {
      action.stop()
    }
  }, [actions, names])

  return <primitive object={avatar} visible={visible} />
}

/**
 * The avatar's mesh content (no transform group - the caller positions it).
 * Both the idle and walking clones stay mounted and we toggle visibility, so
 * starting/stopping never re-clones or rebuilds the mixer. Suspends while the
 * (small) model loads, so wrap it in a <Suspense> boundary.
 */
export function AvatarBody({ walking = false }: { walking?: boolean }) {
  const { scene, animations } = useGLTF(TIMMY_WALK_URL)
  return (
    <>
      <TimmyIdle scene={scene} visible={!walking} />
      <TimmyWalking scene={scene} animations={animations} visible={walking} />
    </>
  )
}

// Warm the cache as soon as this module is imported, so the avatar is ready by
// the time the town mounts (no placeholder flash on entry).
useGLTF.preload(TIMMY_WALK_URL)

export function DogBody() {
  return (
    <>
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.9, 0.4, 0.5]} />
        <meshStandardMaterial color="#a56b3c" />
      </mesh>
      <mesh position={[0.42, 0.45, 0.18]} castShadow>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial color="#a56b3c" />
      </mesh>
      <mesh position={[0.62, 0.55, 0.08]} rotation={[0, 0, 0.5]} castShadow>
        <boxGeometry args={[0.16, 0.1, 0.18]} />
        <meshStandardMaterial color="#3d2b1f" />
      </mesh>
      <mesh position={[-0.35, 0.8, 0.12]} rotation={[0, 0, 0.35]} castShadow>
        <coneGeometry args={[0.12, 0.28, 8]} />
        <meshStandardMaterial color="#a56b3c" />
      </mesh>
      <mesh position={[0.14, 0.9, 0.16]} castShadow>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#15264c" />
      </mesh>
      <mesh position={[0.03, 0.85, 0.28]} castShadow>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#15264c" />
      </mesh>
      <mesh position={[-0.4, 0.3, -0.2]} rotation={[0.4, 0, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.05, 0.9, 10]} />
        <meshStandardMaterial color="#a56b3c" />
      </mesh>
    </>
  )
}

export function ActorBody({ variant }: { variant: 'owl' | 'fox' }) {
  if (variant === 'owl') {
    return (
      <>
        <mesh position={[0, 1.28, 0]} castShadow>
          <boxGeometry args={[0.66, 0.66, 0.66]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>

        <mesh position={[0, 0.72, 0]} castShadow>
          <boxGeometry args={[0.88, 0.58, 0.7]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>

        <mesh position={[0, 0.28, -0.16]} castShadow>
          <boxGeometry args={[0.88, 0.16, 0.32]} />
          <meshStandardMaterial color="#47a257" />
        </mesh>

        <mesh position={[0, 1.76, 0]} castShadow>
          <boxGeometry args={[0.3, 0.18, 0.14]} />
          <meshStandardMaterial color="#d62828" />
        </mesh>

        <mesh position={[0, 1.56, 0.3]} castShadow>
          <boxGeometry args={[0.16, 0.12, 0.16]} />
          <meshStandardMaterial color="#ff8b2d" />
        </mesh>

        <mesh position={[-0.18, 1.18, 0.3]} castShadow>
          <boxGeometry args={[0.15, 0.15, 0.15]} />
          <meshStandardMaterial color="#1f1f1f" />
        </mesh>
        <mesh position={[0.18, 1.18, 0.3]} castShadow>
          <boxGeometry args={[0.15, 0.15, 0.15]} />
          <meshStandardMaterial color="#1f1f1f" />
        </mesh>

        <mesh position={[-0.08, 1.14, 0.38]} castShadow>
          <boxGeometry args={[0.05, 0.05, 0.08]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.08, 1.14, 0.38]} castShadow>
          <boxGeometry args={[0.05, 0.05, 0.08]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>

        <mesh position={[0.32, 0.48, 0.26]} rotation={[0.1, 0, 0]} castShadow>
          <boxGeometry args={[0.18, 0.12, 0.28]} />
          <meshStandardMaterial color="#47a257" />
        </mesh>
        <mesh position={[-0.32, 0.48, 0.26]} rotation={[0.1, 0, 0]} castShadow>
          <boxGeometry args={[0.18, 0.12, 0.28]} />
          <meshStandardMaterial color="#47a257" />
        </mesh>

        <mesh position={[0.18, 0, 0.24]} castShadow>
          <boxGeometry args={[0.18, 0.14, 0.14]} />
          <meshStandardMaterial color="#ff8b2d" />
        </mesh>
        <mesh position={[-0.18, 0, 0.24]} castShadow>
          <boxGeometry args={[0.18, 0.14, 0.14]} />
          <meshStandardMaterial color="#ff8b2d" />
        </mesh>
      </>
    )
  }

  return (
    <>
      <mesh position={[0, 0.82, 0]} castShadow>
        <boxGeometry args={[0.82, 0.6, 0.55]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
      <mesh position={[0, 1.28, 0]} castShadow>
        <boxGeometry args={[0.5, 0.5, 0.45]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
      <mesh position={[0.24, 1.52, 0.05]} rotation={[0, 0, 0.2]} castShadow>
        <boxGeometry args={[0.18, 0.22, 0.12]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
      <mesh position={[-0.24, 1.52, 0.05]} rotation={[0, 0, -0.2]} castShadow>
        <boxGeometry args={[0.18, 0.22, 0.12]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
      <mesh position={[0, 1.12, 0.28]} castShadow>
        <boxGeometry args={[0.18, 0.1, 0.18]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 1.0, 0.35]} castShadow>
        <sphereGeometry args={[0.04, 12, 12]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <mesh position={[0.16, 1.28, 0.22]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[-0.16, 1.28, 0.22]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.16, 1.28, 0.32]} castShadow>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <mesh position={[-0.16, 1.28, 0.32]} castShadow>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <mesh position={[0.32, 1.32, -0.02]} rotation={[0, 0, 0.25]} castShadow>
        <boxGeometry args={[0.16, 0.18, 0.1]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
      <mesh position={[-0.32, 1.32, -0.02]} rotation={[0, 0, -0.25]} castShadow>
        <boxGeometry args={[0.16, 0.18, 0.1]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
      <mesh position={[0, 0.76, -0.28]} rotation={[0.8, 0, 0]} castShadow>
        <boxGeometry args={[0.18, 0.48, 0.24]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
      <mesh position={[-0.2, 0.9, 0]} rotation={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.2, 0.12, 0.18]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.2, 0.9, 0]} rotation={[0, -0.2, 0]} castShadow>
        <boxGeometry args={[0.2, 0.12, 0.18]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.28, -0.28]} rotation={[0.8, 0, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.04, 0.8, 12]} />
        <meshStandardMaterial color="#ff7b38" />
      </mesh>
    </>
  )
}

export function PetBody({ variant }: { variant: 'cat' | 'dog' }) {
  const bodyColor = variant === 'cat' ? '#b86a4f' : '#7f5a30'
  const accentColor = variant === 'cat' ? '#f7e1c5' : '#d8b37a'

  return (
    <>
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.86, 0.32, 0.46]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[0.42, 0.5, 0.16]} castShadow>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[-0.28, 0.72, 0.2]} rotation={[0, 0, -0.45]} castShadow>
        <coneGeometry args={[0.1, 0.24, 8]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[0.24, 0.72, 0.2]} rotation={[0, 0, 0.45]} castShadow>
        <coneGeometry args={[0.1, 0.24, 8]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[0.12, 0.74, 0.28]} castShadow>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#15264c" />
      </mesh>
      <mesh position={[-0.02, 0.72, 0.34]} castShadow>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#15264c" />
      </mesh>
      <mesh position={[-0.5, 0.26, -0.18]} rotation={[0.4, 0, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.05, 0.76, 10]} />
        <meshStandardMaterial color={accentColor} />
      </mesh>
      <mesh position={[0.5, 0.3, -0.18]} rotation={[-0.3, 0, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.04, 0.72, 10]} />
        <meshStandardMaterial color={accentColor} />
      </mesh>
    </>
  )
}

function Moon({ position, opacity }: { position: [number, number, number]; opacity: number }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[5, 24, 24]} />
      <meshBasicMaterial color="#eaf2ff" transparent opacity={opacity} />
    </mesh>
  )
}

/**
 * Shared sky + lighting for both canvases, driven by a {@link SkyState}. Renders
 * the gradient sky, fog, ambient/hemisphere/directional lights and — at night —
 * a field of stars and a moon. Pass the state from {@link useSkyState} so it
 * tracks the real time of day.
 */
export function TownSky({ state }: { state: SkyState }) {
  return (
    <>
      <Sky sunPosition={state.sunPosition} turbidity={state.turbidity} rayleigh={state.rayleigh} />
      {state.night > 0.45 && (
        <>
          <Stars radius={140} depth={50} count={1400} factor={4} saturation={0} fade speed={0.6} />
          <Moon
            position={[-state.sunPosition[0] * 0.6, 46, -64]}
            opacity={clamp((state.night - 0.45) / 0.4, 0, 1)}
          />
        </>
      )}
      <fog attach="fog" args={[state.fog, 34, 92]} />
      <ambientLight intensity={state.ambient} />
      <hemisphereLight args={[state.hemiSky, state.hemiGround, state.hemiIntensity]} />
      <directionalLight
        position={[14, 22, 8]}
        color={state.dirColor}
        intensity={state.dirIntensity}
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
