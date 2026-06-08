import { Link } from 'react-router-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Sky, ContactShadows } from '@react-three/drei'
import { AvatarBody, PLACES, TownHouse, TownLighting, TownScenery } from '../three/town'

/**
 * A compact, auto-rotating, non-interactive 3D view of Newisance Town used as
 * the home-page hero element. The whole card is a link into the full
 * explorable hub at `/learn`. Lazy-loaded by Home so three.js only ships when
 * the landing page actually renders it.
 */
export default function TownPreview() {
  return (
    <Link
      to="/learn"
      aria-label="Explore Newisance Town"
      className="group relative block h-[420px] overflow-hidden rounded-3xl shadow-xl shadow-card/20 ring-1 ring-black/5"
    >
      <div className="pointer-events-none absolute inset-0">
        <Canvas shadows camera={{ position: [0, 12, 20], fov: 50 }}>
          <Sky sunPosition={[60, 25, 30]} turbidity={6} rayleigh={1.4} />
          <TownLighting />
          <TownScenery />
          {PLACES.map((p) => (
            <TownHouse key={p.id} place={p} />
          ))}
          {/* a little resident standing in the plaza for scale + life */}
          <group position={[0, 0, 3]} rotation={[0, Math.PI, 0]}>
            <AvatarBody />
          </group>
          <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={60} blur={2.4} far={20} />
          <SpinCamera />
        </Canvas>
      </div>

      {/* overlay call-to-action */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-card/85 via-card/30 to-transparent p-5">
        <div>
          <p className="font-display text-lg font-extrabold text-white drop-shadow">
            🏙️ Newisance Town
          </p>
          <p className="text-sm text-white/80">Walk in and pick your challenge · 6 places</p>
        </div>
        <span className="rounded-full bg-white/95 px-4 py-2 text-sm font-bold text-brand shadow transition group-hover:bg-white">
          Explore →
        </span>
      </div>
    </Link>
  )
}

/** Slowly orbits the camera around the town centre. */
function SpinCamera() {
  const { camera } = useThree()
  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.12
    const r = 21
    camera.position.set(Math.sin(t) * r, 12, Math.cos(t) * r)
    camera.lookAt(0, 1.5, 0)
  })
  return null
}
