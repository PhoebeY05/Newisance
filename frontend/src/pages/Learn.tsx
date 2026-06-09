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
  const [touch, setTouch] = useState(false)
  const nearRef = useRef<Place | null>(null)
  const keys = useRef<Record<string, boolean>>({})
  // Analog movement from the on-screen joystick (touch); combined with the
  // keyboard input inside the Player loop. fwd/strafe are each in [-1, 1].
  const move = useRef({ fwd: 0, strafe: 0 })
  // Press-and-drag to orbit the view; scroll / pinch to zoom. Movement is
  // relative to this yaw, so "forward" always follows where you're looking.
  const orbit = useRef({ yaw: 0, pitch: 0.56, dist: 16.6 })
  const drag = useRef({ active: false, moved: false, x: 0, y: 0 })
  // All active pointers on the canvas, so we can tell a one-finger orbit from a
  // two-finger pinch-zoom.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchDist = useRef(0)

  // Show the touch controls (joystick) on coarse-pointer devices.
  useEffect(() => {
    setTouch(window.matchMedia?.('(pointer: coarse)').matches ?? 'ontouchstart' in window)
  }, [])

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
    // Don't hijack the overlay controls (Home link, HUD button, joystick).
    if ((e.target as HTMLElement).closest('a, button, [data-joystick]')) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    if (pointers.current.size === 1) {
      drag.current = { active: true, moved: false, x: e.clientX, y: e.clientY }
    } else if (pointers.current.size === 2) {
      // Second finger down → start a pinch-zoom; stop orbiting.
      drag.current.active = false
      drag.current.moved = true
      const [a, b] = [...pointers.current.values()]
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId)
    if (p) {
      p.x = e.clientX
      p.y = e.clientY
    }
    // Two fingers → pinch to zoom.
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist.current) {
        orbit.current.dist = clamp(orbit.current.dist - (d - pinchDist.current) * 0.03, 8, 32)
      }
      pinchDist.current = d
      return
    }
    // One finger / mouse → orbit the camera.
    const dr = drag.current
    if (!dr.active) return
    const dx = e.clientX - dr.x
    const dy = e.clientY - dr.y
    dr.x = e.clientX
    dr.y = e.clientY
    if (Math.abs(dx) + Math.abs(dy) > 2) dr.moved = true
    orbit.current.yaw -= dx * 0.005
    orbit.current.pitch = clamp(orbit.current.pitch - dy * 0.004, 0.12, 1.3)
  }, [])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchDist.current = 0
    if (pointers.current.size === 1) {
      // Dropped from a pinch back to one finger — re-baseline orbit so the view
      // doesn't jump.
      const [pt] = [...pointers.current.values()]
      drag.current = { active: true, moved: true, x: pt.x, y: pt.y }
    } else if (pointers.current.size === 0) {
      drag.current.active = false
    }
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
      onPointerCancel={endDrag}
      onWheel={onWheel}
    >
      <Canvas shadows camera={{ position: [0, 11, 18], fov: 50 }} style={{ touchAction: 'none' }}>
        <Sky sunPosition={[60, 25, 30]} turbidity={6} rayleigh={1.4} />
        <TownLighting />
        <TownScenery />

        {PLACES.map((p) => (
          <TownHouse key={p.id} place={p} active={near?.id === p.id} onSelect={selectFromWorld} />
        ))}

        <Player keys={keys} move={move} orbit={orbit} places={PLACES} onNear={updateNear} />

        <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={60} blur={2.4} far={20} />
      </Canvas>

      {/* ---- Back to home (standalone page has no navbar) ---- */}
      <Link
        to="/"
        className="absolute left-4 top-4 z-30 flex items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs font-bold text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-card sm:px-4 sm:py-2 sm:text-sm"
      >
        <span aria-hidden>←</span> Home
      </Link>

      {/* ---- Title banner (compact on mobile so it clears the Home pill) ---- */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center px-4 pt-3 text-center sm:pt-6">
        <h1 className="font-display text-base font-extrabold text-card drop-shadow-[0_2px_8px_rgba(255,255,255,0.7)] sm:text-4xl">
          Newisance Town
        </h1>
        <p className="mt-1.5 max-w-full truncate rounded-full bg-card/85 px-3 py-1 text-[11px] font-medium text-white shadow sm:text-sm">
          {touch ? (
            <>Left to move · right to look · pinch to zoom</>
          ) : (
            <>
              <Key>W A S D</Key> / arrows to walk · drag to look · scroll to zoom · walk up to enter
            </>
          )}
        </p>
      </header>

      {/* ---- Inspector HUD. On touch it floats above the joystick and only
           appears at a building; on desktop it sits at the bottom with a hint. ---- */}
      {(near || !touch) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 sm:p-4">
          <div
            key={near?.id ?? 'idle'}
            className="nz-pop pointer-events-auto w-full max-w-md rounded-3xl border border-white/40 bg-surface/95 p-3 shadow-2xl backdrop-blur sm:max-w-lg sm:p-5"
          >
            {near ? (
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-bg text-2xl sm:h-14 sm:w-14 sm:text-3xl">
                  {near.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-display text-base font-extrabold text-card sm:text-xl">
                      {near.name}
                    </h2>
                    <span className="hidden shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary sm:inline-block">
                      {near.badge}
                    </span>
                  </div>
                  <p className="mt-0.5 hidden line-clamp-2 text-sm text-ink-soft sm:block">{near.blurb}</p>
                </div>
                <button
                  onClick={() => enter(near)}
                  className="shrink-0 rounded-2xl bg-brand px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light sm:px-5 sm:py-3"
                >
                  {near.cta} <span className="ml-1 opacity-70">↵</span>
                </button>
              </div>
            ) : (
              <p className="text-center text-sm font-medium text-ink-soft">
                🚶 Walk around the plaza — approach any of the buildings to see what's inside.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Touch controls (mobile): floating joystick + look + pinch ---- */}
      {touch && <TouchControls move={move} orbit={orbit} />}
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

const JOY_R = 44 // px — max joystick knob travel from where the thumb landed

/**
 * Touch controls (mobile). A single full-screen surface that handles every
 * gesture itself — rather than relying on the r3f canvas to bubble pointer
 * events, which is unreliable on iOS:
 *   • left half  → a *floating* joystick that appears wherever the thumb lands
 *                  (invisible until then) and steers the avatar (analog).
 *   • right half → drag to look (orbit the camera).
 *   • any two fingers → pinch to zoom (works anywhere; movement pauses).
 * Sits above the canvas but below the on-screen UI (Home / info card), which
 * stay tappable.
 */
function TouchControls({
  move,
  orbit,
}: {
  move: React.RefObject<{ fwd: number; strafe: number }>
  orbit: React.RefObject<{ yaw: number; pitch: number; dist: number }>
}) {
  // Per-pointer state: current {x,y} (updated every move) + the joystick origin
  // {ox,oy} for the move pointer.
  const pointers = useRef<Map<number, { x: number; y: number; ox: number; oy: number; role: 'move' | 'cam' }>>(
    new Map(),
  )
  const moveId = useRef<number | null>(null)
  const pinchDist = useRef(0)
  // The floating joystick's screen position + knob offset (null = hidden).
  const [joy, setJoy] = useState<{ ox: number; oy: number; kx: number; ky: number } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    // First finger in the left half drives the joystick; everything else looks.
    const role: 'move' | 'cam' =
      moveId.current === null && e.clientX < window.innerWidth * 0.5 ? 'move' : 'cam'
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, role })
    if (role === 'move') {
      moveId.current = e.pointerId
      setJoy({ ox: e.clientX, oy: e.clientY, kx: 0, ky: 0 })
      move.current = { fwd: 0, strafe: 0 }
    }
    // Any second finger (regardless of which half) starts a pinch.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y)
      move.current = { fwd: 0, strafe: 0 }
      setJoy(null) // hide the joystick while zooming
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    e.stopPropagation()
    const prevX = p.x
    const prevY = p.y
    p.x = e.clientX
    p.y = e.clientY

    // Two or more fingers anywhere → pinch to zoom (suspends walking).
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist.current) {
        orbit.current.dist = clamp(orbit.current.dist - (d - pinchDist.current) * 0.03, 8, 32)
      }
      pinchDist.current = d
      move.current = { fwd: 0, strafe: 0 }
      return
    }

    if (p.role === 'move') {
      // Offset from where the thumb landed → analog vector (up = forward).
      let dx = e.clientX - p.ox
      let dy = e.clientY - p.oy
      const len = Math.hypot(dx, dy)
      if (len > JOY_R) {
        dx = (dx / len) * JOY_R
        dy = (dy / len) * JOY_R
      }
      setJoy({ ox: p.ox, oy: p.oy, kx: dx, ky: dy })
      move.current = { strafe: dx / JOY_R, fwd: -dy / JOY_R }
      return
    }

    // Single look finger → orbit by its delta.
    orbit.current.yaw -= (e.clientX - prevX) * 0.005
    orbit.current.pitch = clamp(orbit.current.pitch - (e.clientY - prevY) * 0.004, 0.12, 1.3)
  }

  const onUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    e.stopPropagation()
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    pointers.current.delete(e.pointerId)
    if (p.role === 'move') {
      moveId.current = null
      move.current = { fwd: 0, strafe: 0 }
      setJoy(null)
    }
    if (pointers.current.size < 2) pinchDist.current = 0
    // Pinch ended but a move finger is still down → bring its joystick back.
    if (pointers.current.size === 1 && moveId.current !== null) {
      const mp = pointers.current.get(moveId.current)
      if (mp) {
        let dx = mp.x - mp.ox
        let dy = mp.y - mp.oy
        const len = Math.hypot(dx, dy)
        if (len > JOY_R) {
          dx = (dx / len) * JOY_R
          dy = (dy / len) * JOY_R
        }
        setJoy({ ox: mp.ox, oy: mp.oy, kx: dx, ky: dy })
        move.current = { strafe: dx / JOY_R, fwd: -dy / JOY_R }
      }
    }
  }

  return (
    <>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="absolute inset-0 z-10 touch-none"
      />
      {joy && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: joy.ox, top: joy.oy }}
        >
          <div className="grid h-32 w-32 place-items-center rounded-full border border-white/45 bg-card/25 backdrop-blur-sm">
            <div
              className="h-14 w-14 rounded-full bg-surface/95 shadow-lg ring-2 ring-white/70"
              style={{ transform: `translate(${joy.kx}px, ${joy.ky}px)` }}
            />
          </div>
        </div>
      )}
    </>
  )
}

/** Third-person avatar with keyboard + joystick movement and a follow camera. */
function Player({
  keys,
  move,
  orbit,
  places,
  onNear,
}: {
  keys: React.RefObject<Record<string, boolean>>
  move: React.RefObject<{ fwd: number; strafe: number }>
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
    // Blend keyboard (digital) with the joystick (analog), clamped to [-1, 1].
    const j = move.current
    const fwd = clamp((k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0) + j.fwd, -1, 1)
    const strafe = clamp((k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0) + j.strafe, -1, 1)
    // Resolve input relative to the camera yaw so "forward" follows the view.
    const yaw = orbit.current.yaw
    let mx = -Math.sin(yaw) * fwd + Math.cos(yaw) * strafe
    let mz = -Math.cos(yaw) * fwd - Math.sin(yaw) * strafe
    const len = Math.hypot(mx, mz)
    const moving = len > 0.05

    if (moving) {
      // Keep analog magnitude (joystick) but cap diagonal keyboard at unit speed.
      if (len > 1) {
        mx /= len
        mz /= len
      }
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
