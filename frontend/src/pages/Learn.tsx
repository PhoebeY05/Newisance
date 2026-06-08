import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Sky, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import {
  AvatarBody,
  BOUND,
  PLACES,
  type Place,
  SPEED,
  TownHouse,
  TownLighting,
  TownScenery,
  clamp,
  lerpAngle,
} from '../three/town'

/**
 * Newisance Town — the app's 3D navigation hub (standalone, no navbar/footer).
 *
 * Walk a third-person avatar around the plaza with WASD / arrow keys; a follow
 * camera trails behind. Approach a building and press Enter (or click it) to
 * travel to that feature. This page IS the main menu — every screen is reached
 * by entering its house. Built with react-three-fiber; meshes are primitives so
 * there are no model assets to load.
 */
export default function Learn() {
  const navigate = useNavigate()
  const [near, setNear] = useState<Place | null>(null)
  const nearRef = useRef<Place | null>(null)
  const keys = useRef<Record<string, boolean>>({})
  // Press-and-drag to orbit the view; scroll to zoom. Movement is relative to
  // this yaw, so "forward" always follows where you're looking.
  const orbit = useRef({ yaw: 0, pitch: 0.56, dist: 16.6 })
  const drag = useRef({ active: false, moved: false, x: 0, y: 0 })

  const updateNear = useCallback((p: Place | null) => {
    if (nearRef.current?.id === p?.id) return
    nearRef.current = p
    setNear(p)
  }, [])

  const enter = useCallback((p: Place) => navigate(p.to), [navigate])
  // Clicking a building enters it — unless the press was a camera drag.
  const selectFromWorld = useCallback(
    (p: Place) => {
      if (drag.current.moved) return
      enter(p)
    },
    [enter],
  )

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Don't hijack clicks on the overlay controls (Home link, HUD button).
    if ((e.target as HTMLElement).closest('a, button')) return
    drag.current = { active: true, moved: false, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.x = e.clientX
    d.y = e.clientY
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    orbit.current.yaw -= dx * 0.005
    orbit.current.pitch = clamp(orbit.current.pitch - dy * 0.004, 0.12, 1.3)
  }, [])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current.active && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drag.current.active = false
  }, [])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    orbit.current.dist = clamp(orbit.current.dist + e.deltaY * 0.02, 8, 32)
  }, [])

  // Keyboard: movement keys feed the rAF loop; Enter activates the near house.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      keys.current[k] = true
      if ((k === 'enter' || k === 'e') && nearRef.current) enter(nearRef.current)
    }
    const up = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [enter])

  return (
    <div
      className="relative h-[100dvh] w-full cursor-grab touch-none select-none overflow-hidden bg-[#bfe9ff] active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onWheel={onWheel}
    >
      <Canvas shadows camera={{ position: [0, 11, 18], fov: 50 }}>
        <Sky sunPosition={[60, 25, 30]} turbidity={6} rayleigh={1.4} />
        <TownLighting />
        <TownScenery />

        {PLACES.map((p) => (
          <TownHouse key={p.id} place={p} active={near?.id === p.id} onSelect={selectFromWorld} />
        ))}

        <Player keys={keys} orbit={orbit} places={PLACES} onNear={updateNear} />

        <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={60} blur={2.4} far={20} />
      </Canvas>

      {/* ---- Back to home (standalone page has no navbar) ---- */}
      <Link
        to="/"
        className="absolute left-5 top-5 z-10 flex items-center gap-2 rounded-full bg-card/90 px-4 py-2 text-sm font-bold text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-card"
      >
        <span aria-hidden>←</span> Home
      </Link>

      {/* ---- Title banner ---- */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center px-6 pt-6 text-center">
        <h1 className="font-display text-3xl font-extrabold text-card drop-shadow-[0_2px_8px_rgba(255,255,255,0.6)] sm:text-4xl">
          Newisance Town
        </h1>
        <p className="mt-1 rounded-full bg-card/85 px-4 py-1 text-sm font-medium text-white shadow">
          <Key>W A S D</Key> / arrows to walk · drag to look · scroll to zoom · walk up to enter
        </p>
      </header>

      {/* ---- Inspector HUD ---- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
        <div
          key={near?.id ?? 'idle'}
          className="nz-pop pointer-events-auto w-full max-w-lg rounded-3xl border border-white/40 bg-surface/95 p-5 shadow-2xl backdrop-blur"
        >
          {near ? (
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-bg text-3xl">
                {near.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-display text-xl font-extrabold text-card">
                    {near.name}
                  </h2>
                  <span className="shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
                    {near.badge}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{near.blurb}</p>
              </div>
              <button
                onClick={() => enter(near)}
                className="shrink-0 rounded-2xl bg-brand px-5 py-3 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light"
              >
                {near.cta} <span className="ml-1 opacity-70">↵</span>
              </button>
            </div>
          ) : (
            <p className="text-center text-sm font-medium text-ink-soft">
              🚶 Walk around the plaza — approach any of the six buildings to see what's inside.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-bold tracking-widest">
      {children}
    </kbd>
  )
}

/** Third-person avatar with keyboard movement + a trailing follow camera. */
function Player({
  keys,
  orbit,
  places,
  onNear,
}: {
  keys: React.RefObject<Record<string, boolean>>
  orbit: React.RefObject<{ yaw: number; pitch: number; dist: number }>
  places: Place[]
  onNear: (p: Place | null) => void
}) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const pos = useRef(new THREE.Vector3(0, 0, 6))
  const rotY = useRef(Math.PI)
  const camTarget = useRef(new THREE.Vector3())
  const { camera } = useThree()

  useFrame((state, delta) => {
    const k = keys.current
    const dt = Math.min(delta, 0.05) // guard against tab-restore jumps
    const fwd = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0)
    const strafe = (k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0)
    // Resolve input relative to the camera yaw so "forward" follows the view.
    const yaw = orbit.current.yaw
    let mx = -Math.sin(yaw) * fwd + Math.cos(yaw) * strafe
    let mz = -Math.cos(yaw) * fwd - Math.sin(yaw) * strafe
    const len = Math.hypot(mx, mz)
    const moving = len > 0

    if (moving) {
      mx /= len
      mz /= len
      pos.current.x = clamp(pos.current.x + mx * SPEED * dt, -BOUND, BOUND)
      pos.current.z = clamp(pos.current.z + mz * SPEED * dt, -BOUND, BOUND)
      rotY.current = lerpAngle(rotY.current, Math.atan2(mx, mz), 14 * dt)
    }

    if (root.current) {
      root.current.position.set(pos.current.x, 0, pos.current.z)
      root.current.rotation.y = rotY.current
    }
    if (body.current) {
      const t = state.clock.elapsedTime
      body.current.position.y = moving ? Math.abs(Math.sin(t * 11)) * 0.18 : Math.sin(t * 2) * 0.04
    }

    // Follow camera — orbits the avatar by the drag-controlled yaw/pitch at
    // the scroll-controlled distance, smoothed.
    const o = orbit.current
    const cp = Math.cos(o.pitch)
    camTarget.current.set(
      pos.current.x + Math.sin(o.yaw) * cp * o.dist,
      Math.sin(o.pitch) * o.dist,
      pos.current.z + Math.cos(o.yaw) * cp * o.dist,
    )
    camera.position.lerp(camTarget.current, 1 - Math.pow(0.001, dt))
    camera.lookAt(pos.current.x, 1.2, pos.current.z)

    // Nearest building within reach of its own footprint (bigger structures
    // like the arena trigger from farther out).
    let best: Place | null = null
    let bestMargin = Infinity
    for (const p of places) {
      const d = Math.hypot(p.pos[0] - pos.current.x, p.pos[1] - pos.current.z)
      const reach = p.footprint + 1.7
      if (d < reach && d - reach < bestMargin) {
        bestMargin = d - reach
        best = p
      }
    }
    onNear(best)
  })

  return (
    <group ref={root}>
      <group ref={body}>
        <AvatarBody />
      </group>
    </group>
  )
}
