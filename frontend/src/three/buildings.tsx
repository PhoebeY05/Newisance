import { useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import type { Place } from './town'

/**
 * Distinct 3D structures for each Newisance Town building, so each reads as the
 * thing it is — a colosseum for the Arena, a domed Observatory, a columned
 * Trophy Hall, a gazebo Town Square, a modern Fact-Check Lab, and a gabled
 * Newsroom — rather than six recoloured huts. All built from primitives (no
 * model assets). Every building faces its door toward local +z (the plaza).
 */

const STONE = '#d8cbac'
const STONE_DARK = '#b7a886'
const MARBLE = '#f1ede2'
const CREAM = '#fbf3e2'
const WOOD = '#7a5230'
const GOLD = '#f3d15c'

/** Dispatch to the right structure for a place. */
export function Building({ place }: { place: Place }) {
  switch (place.id) {
    case 'battle':
      return <Arena accent={place.roof} />
    case 'dashboard':
      return <Observatory accent={place.roof} />
    case 'leaderboard':
      return <TrophyHall accent={place.roof} />
    case 'community':
      return <Gazebo accent={place.roof} />
    case 'verify':
      return <Lab accent={place.roof} />
    case 'shop':
      return <ShopBuilding accent={place.roof} />
    case 'truth-tower':
      return <TruthTowerBuilding accent={place.roof} />
    case 'timed':
    default:
      return <Newsroom accent={place.roof} />
  }
}

/* --------------------------------------------------------------- helpers */

function Column({
  position,
  height = 2.2,
  radius = 0.2,
  color = MARBLE,
}: {
  position: [number, number, number]
  height?: number
  radius?: number
  color?: string
}) {
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, height, 14]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* capital + base */}
      <mesh position={[0, height + 0.06, 0]} castShadow>
        <boxGeometry args={[radius * 2.6, 0.14, radius * 2.6]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[radius * 2.6, 0.14, radius * 2.6]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

/**
 * A gable roof / pediment. Unit triangular prism (apex up, extruded along its
 * run) scaled to width × rise × depth. ridge='z' faces the gable toward +z.
 */
function Gable({
  width,
  rise,
  depth,
  y,
  color,
  ridge = 'z',
}: {
  width: number
  rise: number
  depth: number
  y: number
  color: string
  ridge?: 'z' | 'x'
}) {
  const scale: [number, number, number] =
    ridge === 'z' ? [width / 1.732, rise, depth] : [depth, rise, width / 1.732]
  // Unit triangular prism: orient apex-up, extruded along Z. The two axis
  // rotations must be applied in order (Rx first, then Rz), so they're nested
  // in separate groups rather than combined into one Euler triple.
  return (
    <group position={[0, y + rise * 0.5, 0]} scale={scale} rotation={[0, ridge === 'x' ? Math.PI / 2 : 0, 0]}>
      <group rotation={[0, 0, Math.PI / 2]}>
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[1, 1, 1, 3]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        </group>
      </group>
    </group>
  )
}

function Door() {
  return (
    <mesh position={[0, 0.75, 0.02]} castShadow>
      <boxGeometry args={[0.95, 1.5, 0.12]} />
      <meshStandardMaterial color={WOOD} />
    </mesh>
  )
}

function Window({
  position,
  size = [0.7, 0.7],
}: {
  position: [number, number, number]
  size?: [number, number]
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={[size[0], size[1], 0.06]} />
      <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.4} />
    </mesh>
  )
}

/** A flat 5-pointed star (lies in the XY plane, faces +z). */
function Star({
  position,
  size = 0.3,
  color = '#fff3c4',
  rotation = [0, 0, 0],
  glow = 0.9,
}: {
  position: [number, number, number]
  size?: number
  color?: string
  rotation?: [number, number, number]
  glow?: number
}) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape()
    const points = 5
    const inner = size * 0.45
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? inner : size
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (i === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    }
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [size])
  return (
    <mesh position={position} rotation={rotation} geometry={geo}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** A golden trophy cup. */
function Trophy({ position = [0, 0, 0], scale = 1 }: { position?: [number, number, number]; scale?: number }) {
  const gold = <meshStandardMaterial color={GOLD} metalness={0.75} roughness={0.25} />
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.36, 0.12, 18]} />
        {gold}
      </mesh>
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.34, 0.14, 0.34]} />
        <meshStandardMaterial color="#fff" />
      </mesh>
      <mesh position={[0, 0.34, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.28, 12]} />
        {gold}
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow>
        <cylinderGeometry args={[0.46, 0.18, 0.6, 22]} />
        {gold}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.5, 0.66, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <torusGeometry args={[0.16, 0.045, 8, 18]} />
          {gold}
        </mesh>
      ))}
      <Star position={[0, 0.66, 0.42]} size={0.16} color="#fff3c4" glow={1.1} />
    </group>
  )
}

/* ---------------------------------------------------------------- Arena */

function Arena({ accent }: { accent: string }) {
  const cols = 20
  const R = 3.15
  const ringYs = [1.55, 2.75]
  return (
    <group>
      {/* stepped stone base */}
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[3.8, 4.0, 0.36, 40]} />
        <meshStandardMaterial color={STONE_DARK} />
      </mesh>
      <mesh position={[0, 0.46, 0]} receiveShadow>
        <cylinderGeometry args={[3.55, 3.6, 0.22, 40]} />
        <meshStandardMaterial color={STONE} />
      </mesh>
      {/* solid backing wall so it doesn't see through */}
      <mesh position={[0, 1.7, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.95, 2.95, 2.6, 40, 1, true]} />
        <meshStandardMaterial color={STONE} side={2} />
      </mesh>
      {/* sand floor */}
      <mesh position={[0, 0.58, 0]} receiveShadow>
        <cylinderGeometry args={[2.6, 2.6, 0.06, 40]} />
        <meshStandardMaterial color="#e7d6a6" />
      </mesh>
      {/* two tiers of columns (arches) */}
      {ringYs.map((y, tier) =>
        Array.from({ length: cols }).map((_, i) => {
          const a = (i / cols) * Math.PI * 2
          return (
            <mesh
              key={`${tier}-${i}`}
              position={[Math.cos(a) * R, y, Math.sin(a) * R]}
              castShadow
            >
              <cylinderGeometry args={[0.17, 0.17, tier === 0 ? 1.4 : 1.1, 10]} />
              <meshStandardMaterial color={STONE} />
            </mesh>
          )
        }),
      )}
      {/* architrave rings */}
      {[0.62, 1.55, 2.75, 3.35].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[R, 0.16, 8, 56]} />
          <meshStandardMaterial color={STONE_DARK} />
        </mesh>
      ))}
      {/* banners in team colour */}
      {[-0.5, 0, 0.5].map((fx, i) => (
        <mesh key={i} position={[fx * 2, 2.1, R - 0.05]} castShadow>
          <boxGeometry args={[0.5, 1.3, 0.06]} />
          <meshStandardMaterial color={accent} />
        </mesh>
      ))}
      {/* entrance pillars + lintel */}
      <mesh position={[0, 1.6, R]} castShadow>
        <boxGeometry args={[1.6, 0.3, 0.4]} />
        <meshStandardMaterial color={STONE_DARK} />
      </mesh>
    </group>
  )
}

/* ----------------------------------------------------------- Observatory */

function Observatory({ accent }: { accent: string }) {
  // A planetarium: a big star-spangled dome on a low navy drum — the dome IS
  // the building, not a cap on a tower.
  const NAVY = '#26345c'
  const R = 2.4
  const BASE = 1.0 // dome springs from here
  // stars across the dome surface (azimuth, elevation, size)
  const domeStars = ([
    [-0.7, 0.5, 0.18], [0.55, 0.75, 0.15], [0.0, 1.05, 0.2], [-1.15, 0.9, 0.14],
    [1.05, 0.5, 0.16], [0.5, 0.35, 0.13], [-0.4, 1.2, 0.13], [1.4, 0.85, 0.14],
  ] as [number, number, number][]).map(([az, e, s]) => {
    const hr = R * Math.cos(e) + 0.04
    return {
      pos: [hr * Math.sin(az), BASE + R * Math.sin(e), hr * Math.cos(az)] as [number, number, number],
      rot: [-e * 0.6, az, 0] as [number, number, number],
      s,
    }
  })
  return (
    <group>
      {/* stone foundation */}
      <mesh position={[0, 0.18, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[2.55, 2.75, 0.36, 40]} />
        <meshStandardMaterial color={STONE} />
      </mesh>
      {/* low navy drum */}
      <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[R, 2.45, 0.85, 40]} />
        <meshStandardMaterial color={NAVY} />
      </mesh>
      {/* gold band where the dome meets the drum */}
      <mesh position={[0, BASE, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[R, 0.08, 8, 44]} />
        <meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.3} />
      </mesh>
      {/* the dome */}
      <mesh position={[0, BASE, 0]} castShadow receiveShadow>
        <sphereGeometry args={[R, 40, 22, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={accent} metalness={0.35} roughness={0.35} />
      </mesh>
      {/* meridian ribs */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, BASE, 0]} rotation={[0, (i / 4) * Math.PI, 0]} castShadow>
          <torusGeometry args={[R, 0.05, 8, 28, Math.PI]} />
          <meshStandardMaterial color="#2f9c93" />
        </mesh>
      ))}
      {/* stars on the dome */}
      {domeStars.map((st, i) => (
        <Star key={i} position={st.pos} rotation={st.rot} size={st.s} color="#ffe98a" glow={1.0} />
      ))}
      {/* observation slit + telescope */}
      <mesh position={[0, BASE + 1.5, 1.0]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.5, 1.9, 0.14]} />
        <meshStandardMaterial color="#0e1730" />
      </mesh>
      <mesh position={[0, BASE + 1.2, 1.7]} rotation={[Math.PI / 3, 0, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 1.5, 12]} />
        <meshStandardMaterial color="#5a6b8c" metalness={0.6} roughness={0.3} />
      </mesh>
      {/* gold star finial + small constellation above */}
      <Star position={[0, BASE + R + 0.35, 0]} size={0.42} color={GOLD} glow={1.1} />
      {([[1.5, BASE + R + 0.5, 0.16], [-1.3, BASE + R + 0.9, 0.13], [0.7, BASE + R + 1.3, 0.18]] as [number, number, number][]).map(
        ([x, y, s], i) => (
          <Star key={i} position={[x, y, 0.3]} size={s} color="#fff3c4" glow={1.2} />
        ),
      )}
      {/* door + lit windows on the drum */}
      <Door />
      <Window position={[1.5, 0.7, 1.45]} size={[0.5, 0.5]} />
      <Window position={[-1.5, 0.7, 1.45]} size={[0.5, 0.5]} />
    </group>
  )
}

/* ------------------------------------------------------------ TrophyHall */

function TrophyHall({ accent }: { accent: string }) {
  // accent = gold. A grand "Hall of Fame": marble hall, gold trim, a giant
  // trophy on the roof, a red carpet, and a winners' podium out front.
  const podium = [
    { x: -1.0, h: 0.7, top: '#c9ccd2' }, // 2nd — silver
    { x: 0, h: 1.05, top: GOLD }, // 1st — gold
    { x: 1.0, h: 0.5, top: '#c08641' }, // 3rd — bronze
  ]
  return (
    <group>
      {/* platform */}
      <mesh position={[0, 0.13, 0]} receiveShadow castShadow>
        <boxGeometry args={[4.4, 0.26, 3.6]} />
        <meshStandardMaterial color={STONE} />
      </mesh>
      <mesh position={[0, 0.34, 0.1]} receiveShadow castShadow>
        <boxGeometry args={[3.9, 0.18, 3.2]} />
        <meshStandardMaterial color={MARBLE} />
      </mesh>
      {/* hall */}
      <RoundedBox args={[3.4, 2.7, 2.8]} radius={0.08} smoothness={3} position={[0, 1.8, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={MARBLE} />
      </RoundedBox>
      {/* gold trim bands */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[3.5, 0.16, 2.9]} />
        <meshStandardMaterial color={accent} metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 3.05, 0]} castShadow>
        <boxGeometry args={[3.6, 0.22, 3.0]} />
        <meshStandardMaterial color={accent} metalness={0.6} roughness={0.3} />
      </mesh>
      {/* corner pilasters */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 1.6, 1.7, 1.35]} castShadow>
          <boxGeometry args={[0.22, 2.5, 0.22]} />
          <meshStandardMaterial color={accent} metalness={0.5} roughness={0.35} />
        </mesh>
      ))}
      {/* tall arched windows + door + stars */}
      <Door />
      <Star position={[0, 2.35, 1.42]} size={0.32} color={accent} glow={0.7} />
      {[-1.1, 1.1].map((x) => (
        <mesh key={x} position={[x, 1.7, 1.42]}>
          <boxGeometry args={[0.6, 1.4, 0.06]} />
          <meshStandardMaterial color="#bfe0ff" emissive="#bfe0ff" emissiveIntensity={0.25} />
        </mesh>
      ))}
      {/* red carpet to the door */}
      <mesh position={[0, 0.45, 2.1]} receiveShadow>
        <boxGeometry args={[1.1, 0.04, 2.0]} />
        <meshStandardMaterial color="#b23a3a" />
      </mesh>
      {/* roof cornice + giant trophy */}
      <mesh position={[0, 3.3, 0]} castShadow>
        <boxGeometry args={[3.0, 0.3, 2.5]} />
        <meshStandardMaterial color={MARBLE} />
      </mesh>
      <Trophy position={[0, 3.45, 0]} scale={1.5} />
      {/* winners' podium out front */}
      {podium.map((p) => (
        <group key={p.x} position={[p.x, 0, 2.5]}>
          <mesh position={[0, 0.45 + p.h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.8, p.h, 0.7]} />
            <meshStandardMaterial color={MARBLE} />
          </mesh>
          <mesh position={[0, 0.45 + p.h + 0.03, 0]}>
            <boxGeometry args={[0.82, 0.08, 0.72]} />
            <meshStandardMaterial color={p.top} metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ---------------------------------------------------------------- Gazebo */

function Gazebo({ accent }: { accent: string }) {
  const cols = 6
  const R = 2.2
  return (
    <group>
      {/* tiered base */}
      <mesh position={[0, 0.1, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[3.0, 3.1, 0.2, 6]} />
        <meshStandardMaterial color={STONE} />
      </mesh>
      <mesh position={[0, 0.32, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[2.6, 2.7, 0.26, 6]} />
        <meshStandardMaterial color={STONE_DARK} />
      </mesh>
      {/* posts */}
      {Array.from({ length: cols }).map((_, i) => {
        const a = (i / cols) * Math.PI * 2 + Math.PI / 6
        return (
          <Column
            key={i}
            position={[Math.cos(a) * R, 0.45, Math.sin(a) * R]}
            height={2.1}
            radius={0.13}
            color={CREAM}
          />
        )
      })}
      {/* roof */}
      <mesh position={[0, 3.1, 0]} rotation={[0, Math.PI / 6, 0]} castShadow>
        <coneGeometry args={[2.9, 1.5, 6]} />
        <meshStandardMaterial color={accent} flatShading />
      </mesh>
      <mesh position={[0, 3.95, 0]} castShadow>
        <sphereGeometry args={[0.18, 14, 14]} />
        <meshStandardMaterial color={GOLD} metalness={0.7} roughness={0.25} />
      </mesh>
      {/* central planter / fountain */}
      <mesh position={[0, 0.65, 0]} castShadow>
        <cylinderGeometry args={[0.7, 0.8, 0.5, 16]} />
        <meshStandardMaterial color={STONE} />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 0.08, 16]} />
        <meshStandardMaterial color="#6fc6e8" transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------- Lab */

function Lab({ accent }: { accent: string }) {
  // accent = blue. A science lab: white block with porthole windows, a giant
  // bubbling flask on the roof, a verified ✓, and a cross-checking dish.
  return (
    <group>
      <RoundedBox args={[3.2, 2.6, 3.0]} radius={0.1} smoothness={3} position={[0, 1.4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={MARBLE} />
      </RoundedBox>
      {/* accent stripe */}
      <mesh position={[0, 1.9, 0]} castShadow>
        <boxGeometry args={[3.25, 0.22, 3.05]} />
        <meshStandardMaterial color={accent} />
      </mesh>
      {/* round porthole windows */}
      {[-0.85, 0, 0.85].map((x) => (
        <group key={x} position={[x, 1.9, 1.51]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.26, 0.26, 0.04, 20]} />
            <meshStandardMaterial color="#7fe3ff" emissive="#7fe3ff" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0, 0.03, 0]}>
            <torusGeometry args={[0.26, 0.04, 10, 22]} />
            <meshStandardMaterial color={accent} metalness={0.4} roughness={0.4} />
          </mesh>
        </group>
      ))}
      <Door />
      {/* flat roof */}
      <mesh position={[0, 2.8, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.2, 3.2]} />
        <meshStandardMaterial color={STONE_DARK} />
      </mesh>
      {/* rooftop Erlenmeyer flask with bubbling liquid */}
      <group position={[-0.6, 2.9, 0.3]}>
        {/* liquid (inside, behind the glass) */}
        <mesh position={[0, 0.32, 0]}>
          <cylinderGeometry args={[0.18, 0.52, 0.55, 20]} />
          <meshStandardMaterial color="#5ccd7d" emissive="#5ccd7d" emissiveIntensity={0.5} />
        </mesh>
        {/* glass body */}
        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.62, 0.9, 20, 1, true]} />
          <meshStandardMaterial color="#dff3ff" transparent opacity={0.35} side={2} roughness={0.1} />
        </mesh>
        {/* neck */}
        <mesh position={[0, 1.0, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.13, 0.32, 16]} />
          <meshStandardMaterial color="#dff3ff" transparent opacity={0.4} />
        </mesh>
        {/* bubbles */}
        {[[0.05, 1.0], [-0.08, 1.2], [0.1, 1.35]].map(([bx, by], i) => (
          <mesh key={i} position={[bx, by, 0]}>
            <sphereGeometry args={[0.05 + i * 0.01, 10, 10]} />
            <meshStandardMaterial color="#9be8b4" emissive="#5ccd7d" emissiveIntensity={0.6} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
      {/* beaker of reagent */}
      <group position={[0.15, 2.9, 0.55]}>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.34, 18]} />
          <meshStandardMaterial color="#e2823b" emissive="#e2823b" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.26, 0.26, 0.62, 18, 1, true]} />
          <meshStandardMaterial color="#dff3ff" transparent opacity={0.35} side={2} roughness={0.1} />
        </mesh>
        <mesh position={[0, 0.61, 0]}>
          <torusGeometry args={[0.26, 0.025, 8, 20]} />
          <meshStandardMaterial color="#cfe6f2" />
        </mesh>
      </group>
      {/* test-tube rack */}
      <group position={[0.85, 2.86, 0.5]}>
        <mesh position={[0, 0.06, 0]} castShadow>
          <boxGeometry args={[0.74, 0.12, 0.24]} />
          <meshStandardMaterial color={WOOD} />
        </mesh>
        {[
          [-0.24, '#d56060'],
          [0, '#4d89f7'],
          [0.24, '#5ccd7d'],
        ].map(([tx, c], i) => (
          <group key={i} position={[tx as number, 0.12, 0]}>
            <mesh position={[0, 0.18, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.22, 12]} />
              <meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={0.4} />
            </mesh>
            <mesh position={[0, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 0.5, 12, 1, true]} />
              <meshStandardMaterial color="#dff3ff" transparent opacity={0.4} side={2} />
            </mesh>
          </group>
        ))}
      </group>
      {/* verified check badge */}
      <group position={[0, 4.05, 0.2]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.1, 24]} />
          <meshStandardMaterial color="#fff" />
        </mesh>
        <mesh position={[-0.08, -0.04, 0.07]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.1, 0.22, 0.05]} />
          <meshStandardMaterial color="#2faa5a" emissive="#2faa5a" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0.06, 0.02, 0.07]} rotation={[0, 0, -Math.PI / 4]}>
          <boxGeometry args={[0.1, 0.42, 0.05]} />
          <meshStandardMaterial color="#2faa5a" emissive="#2faa5a" emissiveIntensity={0.4} />
        </mesh>
      </group>
      {/* cross-checking satellite dish */}
      <group position={[0.9, 2.95, -0.6]} rotation={[0, -0.6, 0.5]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.8, 8]} />
          <meshStandardMaterial color="#888" />
        </mesh>
        <mesh position={[0, 0.8, 0]} rotation={[Math.PI / 2.4, 0, 0]} castShadow>
          <sphereGeometry args={[0.32, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
          <meshStandardMaterial color="#e7ecf2" side={2} metalness={0.3} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

/* --------------------------------------------------------------- Shop */

function ShopBuilding({ accent }: { accent: string }) {
  // A market stall: striped awning, open counter, crates of goods, ⚡ vibe.
  const stripes = 7
  const awningW = 3.4
  return (
    <group>
      {/* shop body */}
      <RoundedBox args={[3.0, 2.3, 2.6]} radius={0.08} smoothness={3} position={[0, 1.15, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={CREAM} />
      </RoundedBox>
      {/* open counter (dark recess) */}
      <mesh position={[0, 1.25, 1.31]}>
        <boxGeometry args={[2.2, 1.1, 0.08]} />
        <meshStandardMaterial color="#3a2c20" />
      </mesh>
      {/* wooden counter ledge */}
      <mesh position={[0, 0.72, 1.45]} castShadow>
        <boxGeometry args={[2.5, 0.16, 0.5]} />
        <meshStandardMaterial color={WOOD} />
      </mesh>
      {/* striped awning */}
      <group position={[0, 2.05, 1.45]} rotation={[0.42, 0, 0]}>
        {Array.from({ length: stripes }).map((_, i) => (
          <mesh key={i} position={[-awningW / 2 + (i + 0.5) * (awningW / stripes), 0, 0]} castShadow>
            <boxGeometry args={[awningW / stripes, 0.06, 1.1]} />
            <meshStandardMaterial color={i % 2 ? accent : '#faf7f0'} />
          </mesh>
        ))}
        {/* scalloped valance */}
        {Array.from({ length: stripes }).map((_, i) => (
          <mesh key={`v${i}`} position={[-awningW / 2 + (i + 0.5) * (awningW / stripes), -0.18, 0.55]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[awningW / stripes / 2, 0.22, 3]} />
            <meshStandardMaterial color={i % 2 ? accent : '#faf7f0'} />
          </mesh>
        ))}
      </group>
      {/* awning posts */}
      {[-1.5, 1.5].map((x) => (
        <mesh key={x} position={[x, 1.0, 1.85]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 2.0, 8]} />
          <meshStandardMaterial color={WOOD} />
        </mesh>
      ))}
      {/* flat roof */}
      <mesh position={[0, 2.35, -0.1]} castShadow>
        <boxGeometry args={[3.2, 0.2, 2.5]} />
        <meshStandardMaterial color={STONE_DARK} />
      </mesh>
      {/* glowing ⚡ sign board over the counter */}
      <mesh position={[0, 2.0, 1.5]} castShadow>
        <boxGeometry args={[1.0, 0.5, 0.1]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
      </mesh>
      {/* lightning bolt */}
      <mesh position={[0, 2.0, 1.57]} rotation={[0, 0, 0.2]}>
        <boxGeometry args={[0.12, 0.34, 0.04]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.7} />
      </mesh>
      {/* crates of goods out front */}
      {([[-1.3, 0.9], [1.35, 1.2], [1.0, 0.6]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3 + (i === 2 ? 0.5 : 0), z]} castShadow receiveShadow>
          <boxGeometry args={[0.55, 0.55, 0.55]} />
          <meshStandardMaterial color={i % 2 ? '#c08a4a' : '#a9763b'} />
        </mesh>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------ TruthTower */

function TruthTowerBuilding({ accent }: { accent: string }) {
  const stack = [
    { y: 0.55, w: 3.2, z: 2.5, x: 0.0, c: '#15264c' },
    { y: 1.25, w: 2.85, z: 2.25, x: -0.1, c: '#46c8bd' },
    { y: 1.95, w: 2.45, z: 2.0, x: 0.14, c: '#f3d15c' },
    { y: 2.65, w: 2.1, z: 1.75, x: -0.06, c: '#e2823b' },
    { y: 3.35, w: 1.7, z: 1.45, x: 0.1, c: '#5ccd7d' },
    { y: 4.05, w: 1.25, z: 1.15, x: -0.04, c: accent },
  ]

  return (
    <group>
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.55, 2.8, 0.24, 32]} />
        <meshStandardMaterial color={STONE_DARK} />
      </mesh>
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.35, 2.45, 0.18, 32]} />
        <meshStandardMaterial color={STONE} />
      </mesh>

      {stack.map((b, i) => (
        <group key={i} position={[b.x, b.y, 0]}>
          <RoundedBox args={[b.w, 0.62, b.z]} radius={0.08} smoothness={3} castShadow receiveShadow>
            <meshStandardMaterial color={b.c} />
          </RoundedBox>
          <mesh position={[0, 0.25, b.z / 2 + 0.02]}>
            <boxGeometry args={[b.w * 0.82, 0.08, 0.05]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.65} />
          </mesh>
          {i > 0 && (
            <mesh position={[0, -0.35, 0]} castShadow>
              <boxGeometry args={[b.w + 0.2, 0.08, b.z + 0.2]} />
              <meshStandardMaterial color="#ffffff" transparent opacity={0.35} />
            </mesh>
          )}
        </group>
      ))}

      {/* entrance pad */}
      <mesh position={[0, 0.42, 2.0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.08, 1.25]} />
        <meshStandardMaterial color="#e7d6a6" />
      </mesh>
      <mesh position={[0, 0.82, 1.28]} castShadow>
        <boxGeometry args={[0.95, 0.82, 0.12]} />
        <meshStandardMaterial color={WOOD} />
      </mesh>

      {/* Real / Fake sign board */}
      <group position={[0, 4.85, 0.72]}>
        <mesh castShadow>
          <boxGeometry args={[2.1, 0.74, 0.12]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[-0.45, 0, 0.08]}>
          <boxGeometry args={[0.72, 0.36, 0.04]} />
          <meshStandardMaterial color="#5ccd7d" emissive="#5ccd7d" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0.45, 0, 0.08]}>
          <boxGeometry args={[0.72, 0.36, 0.04]} />
          <meshStandardMaterial color="#d56060" emissive="#d56060" emissiveIntensity={0.35} />
        </mesh>
      </group>

      {/* approaching bird marker */}
      <group position={[1.65, 5.1, 0.25]} rotation={[0, -0.45, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.32, 18, 18]} />
          <meshStandardMaterial color={GOLD} metalness={0.25} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.02, 0.32]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <coneGeometry args={[0.1, 0.28, 12]} />
          <meshStandardMaterial color="#e2823b" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.28, 0.02, -0.04]} rotation={[0.25, 0, s * 0.6]} castShadow>
            <boxGeometry args={[0.42, 0.06, 0.22]} />
            <meshStandardMaterial color={GOLD} />
          </mesh>
        ))}
      </group>

      <Star position={[0, 5.55, 0.18]} size={0.32} color="#fff3c4" glow={1.1} />
    </group>
  )
}

/* -------------------------------------------------------------- Newsroom */

function Newsroom({ accent }: { accent: string }) {
  return (
    <group>
      {/* two-storey building */}
      <RoundedBox args={[2.8, 3.2, 2.6]} radius={0.06} smoothness={3} position={[0, 1.6, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={CREAM} />
      </RoundedBox>
      {/* storey band */}
      <mesh position={[0, 1.65, 1.31]}>
        <boxGeometry args={[2.8, 0.12, 0.04]} />
        <meshStandardMaterial color={accent} />
      </mesh>
      {/* window grid */}
      {[2.3, 1.0].map((y) =>
        [-0.7, 0.7].map((x) => <Window key={`${x}-${y}`} position={[x, y, 1.32]} size={[0.7, 0.7]} />),
      )}
      {/* awning over the door */}
      <mesh position={[0, 1.55, 1.5]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[1.3, 0.06, 0.6]} />
        <meshStandardMaterial color={accent} />
      </mesh>
      <Door />
      {/* chimney */}
      <mesh position={[0.9, 3.6, -0.4]} castShadow>
        <boxGeometry args={[0.4, 0.9, 0.4]} />
        <meshStandardMaterial color="#9a6a45" />
      </mesh>
      {/* gable roof */}
      <Gable width={3.0} rise={1.0} depth={2.8} y={3.2} color={accent} ridge="z" />
      {/* rooftop pole + bird weathervane (ties to Flappy) */}
      <mesh position={[0, 5.0, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.2, 8]} />
        <meshStandardMaterial color="#5a5a5a" metalness={0.6} roughness={0.3} />
      </mesh>
      <group position={[0, 5.7, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.04, 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <coneGeometry args={[0.07, 0.18, 10]} />
          <meshStandardMaterial color="#e2823b" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.22, 0.02, -0.05]} rotation={[0, 0, s * 0.5]} castShadow>
            <boxGeometry args={[0.3, 0.04, 0.18]} />
            <meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
