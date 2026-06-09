import { useEffect, useMemo, useState } from 'react'
import { Html, useAnimations, useGLTF } from '@react-three/drei'
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

export const RING = 12 // radius of the building ring around the plaza
export const SPEED = 7 // avatar units / second
export const BOUND = 20 // how far the avatar may wander from centre
export const ENTER_RADIUS = 4.2 // how close counts as "at the door"

// Laid out by function, not a ring: the GAMES district (Flappy + Arena) and
// the Power-Up Shop cluster together on the west side (you gear up, then play);
// the info/social buildings (Town Square, Trophy Hall, Observatory, Lab) are
// scattered around the rest of the town.
export const PLACES: Place[] = [
  // --- games district + shop (west) ---
  { id: 'battle', name: 'Battle Arena Game', badge: 'Game', icon: '⚔️',
    blurb: 'Real-time multiplayer fact-checking. Last one standing wins it all.',
    cta: 'Enter arena', to: '/battle-royale', roof: '#d56060',
    pos: [-11.5, -3], footprint: 4.0, signY: 4.4 },
  { id: 'timed', name: 'Flappy News Game', badge: 'Game', icon: '🐦',
    blurb: 'Flappy Bird meets fact-checking — fly through the Real or Fake gaps!',
    cta: 'Start flying', to: '/timed-challenge', roof: '#5ccd7d',
    pos: [-5, 3.5], footprint: 2.6, signY: 6.6 },
  { id: 'truth-tower', name: 'Truth Tower Game', badge: 'Game', icon: 'TT',
    blurb: 'Stack blocks high, then defend the tower by judging claims as Real or Fake.',
    cta: 'Build tower', to: '/truth-tower', roof: '#233f96',
    pos: [-5.5, 10.5], footprint: 2.8, signY: 7.4 },
  { id: 'shop', name: 'Power-Up Shop', badge: 'Shop', icon: '⚡',
    blurb: 'Spend credibility on power-ups that give you an edge in the games.',
    cta: 'Go shopping', to: '/shop', roof: '#9b5de5',
    pos: [-12, 6], footprint: 2.6, signY: 4.4 },
  // --- info & social (scattered) ---
  { id: 'community', name: 'Community Town Feed', badge: 'Social', icon: '💬',
    blurb: 'Swap tips and debunk hoaxes with the Newisance community.',
    cta: 'Join in', to: '/community', roof: '#e2823b',
    pos: [10, 5], footprint: 3.2, signY: 4.8 },
  { id: 'leaderboard', name: 'Trophy Hall', badge: 'Ranks', icon: '🏆',
    blurb: 'See who tops the credibility charts this week — and chase the crown.',
    cta: 'See ranks', to: '/leaderboard', roof: '#f3d15c',
    pos: [13, -4.5], footprint: 3.0, signY: 5.8 },
  { id: 'dashboard', name: 'Observatory', badge: 'Stats', icon: '📊',
    blurb: 'Track your credibility score, streaks and progress over time.',
    cta: 'View stats', to: '/dashboard', roof: '#46c8bd',
    pos: [4, -13], footprint: 2.8, signY: 5.0 },
  { id: 'verify', name: 'Fact-Check Lab', badge: 'Tool', icon: '🔍',
    blurb: 'Paste any headline, image or message for an instant credibility read.',
    cta: 'Investigate', to: '/verify', roof: '#4d89f7',
    pos: [-4.5, -12], footprint: 2.8, signY: 5.0 },
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
      {/* a path winding from the plaza out to each building */}
      {PLACES.map((p) => {
        const [x, z] = p.pos
        const dist = Math.hypot(x, z)
        if (dist < 7) return null
        const a = Math.atan2(x, z)
        const start = 6
        const mid = (start + dist) / 2
        return (
          <mesh
            key={p.id}
            position={[Math.sin(a) * mid, 0.011, Math.cos(a) * mid]}
            rotation={[-Math.PI / 2, 0, -a]}
            receiveShadow
          >
            <planeGeometry args={[2.2, dist - start]} />
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

/** Normalise the loaded model: ~1.85 units tall, centred on the ground, with
 *  shadows enabled and frustum culling off (the avatar is always on screen). */
function prepareTimmyScene(scene: THREE.Group) {
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
    prepareTimmyScene(cloned)
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
