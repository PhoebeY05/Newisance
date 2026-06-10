import { ContactShadows, Html } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { useAuth } from '../context/AuthContext'
import {
  ActorBody,
  BOUND,
  PLACES,
  type Place,
  SPEED,
  TownHouse,
  TownScenery,
  TownSky,
  clamp,
  lerpAngle,
  useSkyState,
} from '../three/town'
import { PlayerAvatar, resolveAvatarId, useSelectedAvatarId } from '../three/avatars'
import { useMusic } from '../hooks/useMusic'
import SoundToggle from '../components/SoundToggle'

/** Where the local avatar is, shared so the network layer can broadcast it. */
interface SelfState {
  x: number
  z: number
  rot: number
  walking: boolean
  avatar: string
}

type ActorVariant = 'fox' | 'owl'
type ActorInfo = { id: string; label: string; variant: ActorVariant }

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
  const { token, user } = useAuth()
  const sky = useSkyState()
  useMusic('town')
  // The avatar we're wearing, clamped to what our tier has unlocked (a
  // signed-out/guest visitor is a Newcomer, so only Timmy).
  const [selectedAvatar] = useSelectedAvatarId()
  const avatarId = useMemo(() => resolveAvatarId(selectedAvatar, user?.tier), [selectedAvatar, user?.tier])
  // Latest local-avatar pose, written by Player each frame and read by the
  // presence layer so other visitors see us move.
  const selfState = useRef<SelfState>({ x: 2.5, z: 4, rot: Math.PI, walking: false, avatar: avatarId })
  // Keep the broadcast pose's avatar in sync with our (possibly re-clamped) choice.
  useEffect(() => {
    selfState.current.avatar = avatarId
  }, [avatarId])
  // The server hands us a random empty spawn on connect; Player snaps to it once.
  const spawnRef = useRef<{ x: number; z: number } | null>(null)
  const { remoteRef, remoteIds, chatLog, sendChat, selfBubbleRef } = useTownPresence(
    token,
    selfState,
    spawnRef,
  )
  // The other people in our lobby, for the chat recipient dropdown. Names live in
  // the (re-render-free) remoteRef, so recompute whenever the id set changes.
  const townPlayers = useMemo<TownPlayer[]>(
    () => remoteIds.map((id) => ({ id, name: remoteRef.current.get(id)?.name ?? 'Visitor' })),
    [remoteIds, remoteRef],
  )
  const [near, setNear] = useState<Place | null>(null)
  const [nearActor, setNearActor] = useState<ActorInfo | null>(null)
  const [chatActor, setChatActor] = useState<ActorInfo | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatFact, setChatFact] = useState('')
  const [touch, setTouch] = useState(false)
  const nearRef = useRef<Place | null>(null)
  const keys = useRef<Record<string, boolean>>({})
  // Analog movement from the on-screen joystick (touch); combined with the
  // keyboard input inside the Player loop. fwd/strafe are each in [-1, 1].
  const move = useRef({ fwd: 0, strafe: 0 })
  const playerPosition = useRef(new THREE.Vector3(2.5, 0, 4))
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
  const funFacts = useMemo(
    () => [
      'Clickbait headlines often use emotional words so you react before you think.',
      'Misinformation spreads faster when it feels like a shocking secret.',
      'A quick reverse image search can reveal if a photo has been reused or edited.',
      'Trusted news sources rarely publish all-caps headlines or unnamed quotes.',
      'If a post asks you to share before reading, it is often trying to go viral, not inform.',
      'If something sounds too outrageous to be true, it usually needs extra verification.',
      'Fake quotes are often attributed to famous people to make them seem more believable.',
      'Numbers and statistics can be misleading if taken out of context.',
      'Misinformation often mixes a little truth with false details to seem credible.',
      'Satire websites can look like real news if you do not check the source carefully.',
      'Images can be edited or cropped to tell a completely different story.',
      'Headlines can misrepresent the actual content of an article.',
      'Bots and fake accounts can amplify messages to make them appear popular.',
      'Just because many people share something does not mean it is accurate.',
      'Old news can resurface and be mistaken for current events.',
      'Official-looking logos and layouts can be easily copied to fake credibility.',
      'Misleading posts often avoid linking to verifiable sources.',
      'Emotional reactions like anger or fear can make misinformation harder to spot.',
      'Checking multiple sources can help confirm if information is reliable.',
      'Spelling mistakes and odd formatting can sometimes signal low-credibility content.',
    ],
    [],
  );
  const openChat = useCallback(() => {
    if (!nearActor) return
    setChatFact(funFacts[Math.floor(Math.random() * funFacts.length)])
    setChatActor(nearActor)
    setChatOpen(true)
  }, [funFacts, nearActor])
  const closeChat = useCallback(() => {
    setChatOpen(false)
    setChatActor(null)
  }, [])
  // Clicking a building enters it — unless the press was a camera drag.
  const selectFromWorld = useCallback(
    (p: Place) => {
      if (drag.current.moved) return
      enter(p)
    },
    [enter],
  )

  const obstacles = useMemo(
    () =>
      PLACES.map((p) => ({
        x: p.pos[0],
        z: p.pos[1],
        radius: p.footprint + 1.1,
      })),
    [],
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
      // While typing in the chat box, keys belong to the input — don't walk the
      // avatar or trigger building/actor activation.
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      keys.current[k] = true
      if (k === 'escape' && chatOpen) {
        closeChat()
      }
      if ((k === 'enter' || k === 'e') && nearActor && !chatOpen) {
        e.preventDefault()
        openChat()
        return
      }
      if ((k === 'enter' || k === 'e') && nearRef.current && !chatOpen) {
        e.preventDefault()
        enter(nearRef.current)
      }
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
  }, [enter, openChat, closeChat, nearActor, chatOpen])

  return (
    <div
      className="relative h-[100dvh] w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      style={{ backgroundColor: sky.background }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
    >
      <Canvas shadows camera={{ position: [0, 11, 18], fov: 50 }} style={{ touchAction: 'none' }}>
        <TownSky state={sky} />
        <TownScenery lampIntensity={sky.lamp} />

        {PLACES.map((p) => (
          <TownHouse key={p.id} place={p} active={near?.id === p.id} onSelect={selectFromWorld} />
        ))}

        <RemotePlayers ids={remoteIds} dataRef={remoteRef} />

        <Actor
          variant="fox"
          name="Fact Fox"
          initial={[4, -2]}
          obstacles={obstacles}
          playerPosition={playerPosition}
          onNearby={setNearActor}
          paused={chatOpen}
        />
        <Actor
          variant="owl"
          name="Chick-fil-A"
          initial={[8, -1]}
          obstacles={obstacles}
          playerPosition={playerPosition}
          onNearby={setNearActor}
          paused={chatOpen}
        />

        <Player
          keys={keys}
          move={move}
          orbit={orbit}
          places={PLACES}
          playerPosition={playerPosition}
          selfState={selfState}
          spawnRef={spawnRef}
          avatarId={avatarId}
          bubbleRef={selfBubbleRef}
          onNear={updateNear}
        />

        <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={60} blur={2.4} far={20} />
      </Canvas>

      {/* ---- Back to home (standalone page has no navbar) ---- */}
      <div className="absolute left-3 top-3 z-30 flex items-center gap-1.5 sm:left-4 sm:top-4 sm:gap-2">
        <Link
          to="/"
          className="flex h-9 items-center gap-1.5 rounded-full bg-card/90 px-3 text-xs font-bold text-white shadow-lg ring-1 ring-white/15 backdrop-blur transition hover:bg-card sm:h-10 sm:px-4 sm:text-sm"
        >
          <span aria-hidden>←</span> Home
        </Link>
        <span
          className="flex h-9 items-center gap-1.5 rounded-full bg-card/90 px-3 text-xs font-bold text-white shadow-lg ring-1 ring-white/15 backdrop-blur sm:h-10 sm:text-sm"
          title="People exploring the town right now"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-risk-low shadow-[0_0_6px] shadow-risk-low" aria-hidden />
          {remoteIds.length + 1}
          <span className="hidden sm:inline">in town</span>
        </span>
        <SoundToggle />
      </div>

      {/* ---- Title banner (compact on mobile so it clears the Home pill) ---- */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center px-4 pt-16 text-center sm:pt-6">
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
      {(near || nearActor || !touch) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 sm:p-4">
          <div
            key={near?.id ?? nearActor?.id ?? 'idle'}
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
            ) : nearActor ? (
              <div className="flex items-center gap-3 sm:gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-bg text-2xl sm:h-14 sm:w-14 sm:text-3xl">
                  {nearActor.variant === 'fox' ? '🦊' : '🐥'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-display text-base font-extrabold text-card sm:text-xl">
                      {nearActor.label}
                    </h2>
                    <span className="hidden shrink-0 rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary sm:inline-block">
                      Misinformation guide
                    </span>
                  </div>
                  <p className="mt-0.5 hidden line-clamp-2 text-sm text-ink-soft sm:block">
                    Walk close and tap Chat to learn a fun misinformation fact.
                  </p>
                </div>
                <button
                  onClick={openChat}
                  className="shrink-0 rounded-2xl bg-brand px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light sm:px-5 sm:py-3"
                >
                  Chat
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
      {chatOpen && chatActor && (
        <div
          className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-card/40 px-4 py-6 backdrop-blur-sm"
          onClick={closeChat}
        >
          <div
            className="nz-pop relative w-full max-w-md rounded-[28px] border border-white/50 bg-surface/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeChat}
              aria-label="Close"
              className="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-full bg-bg text-sm font-bold text-ink-soft transition hover:bg-brand hover:text-white"
            >
              ✕
            </button>

            {/* Speaker */}
            <div className="flex items-center gap-3 pr-10">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-2xl ring-1 ring-brand/15">
                {chatActor.variant === 'owl' ? '🐥' : '🦊'}
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-extrabold leading-tight text-card">
                  {chatActor.label}
                </p>
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
                  💡 Misinformation guide
                </span>
              </div>
            </div>

            {/* The fact, as a quoted speech bubble */}
            <div className="relative mt-4 rounded-2xl rounded-tl-md bg-bg p-4 pl-5">
              <span
                aria-hidden
                className="absolute -left-1 -top-4 select-none font-display text-5xl leading-none text-brand/25"
              >
                &ldquo;
              </span>
              <p className="relative text-[15px] font-medium leading-7 text-ink">{chatFact}</p>
            </div>

            {/* Footer */}
            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="hidden text-xs text-ink-muted sm:block">Tap anywhere to dismiss</p>
              <button
                type="button"
                onClick={closeChat}
                className="w-full rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-light sm:w-auto"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Town chat: talk to your whole lobby, or one person 1-to-1 ---- */}
      <ChatPanel log={chatLog} players={townPlayers} onSend={sendChat} />

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

  // The two look fingers currently pinching (camera-role pointers only).
  const camPointers = () => [...pointers.current.values()].filter((p) => p.role === 'cam')

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
      return
    }
    // Two *look* fingers start a pinch — the move finger is untouched so you can
    // keep walking. A single look finger alongside the joystick just orbits.
    const cams = camPointers()
    if (cams.length >= 2) {
      const [a, b] = cams
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y)
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

    // Two look fingers → pinch to zoom. Walking continues via the move finger,
    // whose joystick is handled by its own pointer events below.
    const cams = camPointers()
    if (cams.length >= 2) {
      const [a, b] = cams
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist.current) {
        orbit.current.dist = clamp(orbit.current.dist - (d - pinchDist.current) * 0.03, 8, 32)
      }
      pinchDist.current = d
      if (p.role === 'cam') return // this finger is part of the pinch
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

    // Single look finger → orbit by its delta (runs even while walking).
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
    // Fewer than two look fingers left → no pinch in progress; re-baseline so
    // the next pinch doesn't jump.
    if (camPointers().length < 2) pinchDist.current = 0
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

function Actor({
  variant,
  name,
  initial,
  obstacles,
  playerPosition,
  onNearby,
  paused,
}: {
  variant: ActorVariant
  name: string
  initial: [number, number]
  obstacles: Array<{ x: number; z: number; radius: number }>
  playerPosition: React.RefObject<THREE.Vector3>
  onNearby: (actor: ActorInfo | null) => void
  paused: boolean
}) {
  const root = useRef<THREE.Group>(null)
  const pos = useRef(new THREE.Vector3(initial[0], 0, initial[1]))
  const target = useRef(new THREE.Vector3(initial[0], 0, initial[1]))
  const yaw = useRef(0)
  const step = 1.3
  const isNear = useRef(false)
  const lastTargetTime = useRef(0)
  const stuckFrames = useRef(0)
  const actor = useMemo(
    () => ({ id: `${variant}-${initial[0]}-${initial[1]}`, label: name, variant }),
    [name, variant, initial],
  )

  const chooseTarget = useCallback(() => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = Math.random() * BOUND * 2 - BOUND
      const z = Math.random() * BOUND * 2 - BOUND
      const blocked =
        obstacles.some((obs) => Math.hypot(obs.x - x, obs.z - z) < obs.radius + 0.85) ||
        Math.hypot(x, z) < 2.4
      if (!blocked) {
        target.current.set(x, 0, z)
        return
      }
    }
    const angle = Math.random() * Math.PI * 2
    const radius = 2.6 + Math.random() * (BOUND - 2.6)
    target.current.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
  }, [obstacles])

  useEffect(() => {
    chooseTarget()

    const blockedStart =
      obstacles.some((obs) => Math.hypot(obs.x - initial[0], obs.z - initial[1]) < obs.radius + 0.35) ||
      Math.hypot(initial[0], initial[1]) < 2.4
    if (blockedStart) {
      pos.current.copy(target.current)
      if (root.current) {
        root.current.position.set(pos.current.x, 0, pos.current.z)
      }
    }
  }, [chooseTarget, initial, obstacles])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    if (paused) {
      if (root.current) {
        root.current.position.set(pos.current.x, Math.sin(state.clock.elapsedTime * 6) * 0.04, pos.current.z)
      }
      const near = playerPosition.current.distanceTo(pos.current) < 2.2
      if (near !== isNear.current) {
        isNear.current = near
        onNearby(near ? actor : null)
      }
      return
    }

    const dir = new THREE.Vector3().subVectors(target.current, pos.current)
    const dist = dir.length()
    const elapsed = state.clock.elapsedTime
    const shouldPickNew = dist < 0.35 || elapsed - lastTargetTime.current > 4
    if (shouldPickNew) {
      chooseTarget()
      lastTargetTime.current = elapsed
      stuckFrames.current = 0
      return
    }

    dir.normalize()
    const nextPos = new THREE.Vector3().copy(pos.current).addScaledVector(dir, Math.min(step * dt, dist))
    const blocked = obstacles.some((obs) => Math.hypot(obs.x - nextPos.x, obs.z - nextPos.z) < obs.radius + 0.35)
    if (blocked) {
      chooseTarget()
      lastTargetTime.current = elapsed
      stuckFrames.current = 0
      return
    }

    const moved = nextPos.distanceTo(pos.current) > 0.001
    if (moved) {
      stuckFrames.current = 0
      pos.current.copy(nextPos)
      if (root.current) {
        root.current.position.set(pos.current.x, Math.sin(state.clock.elapsedTime * 6) * 0.04, pos.current.z)
        yaw.current = lerpAngle(yaw.current, Math.atan2(dir.x, dir.z), 4 * dt)
        root.current.rotation.y = yaw.current
      }
    } else {
      stuckFrames.current += 1
      if (stuckFrames.current > 5) {
        chooseTarget()
        lastTargetTime.current = elapsed
        stuckFrames.current = 0
      }
    }

    const near = playerPosition.current.distanceTo(pos.current) < 2.2
    if (near !== isNear.current) {
      isNear.current = near
      onNearby(near ? actor : null)
    }
  })

  return (
    <group ref={root} position={[initial[0], 0, initial[1]]}>
      <ActorBody variant={variant} />
    </group>
  )
}

/** Third-person avatar with keyboard + joystick movement and a follow camera. */
function Player({
  keys,
  move,
  orbit,
  places,
  playerPosition,
  selfState,
  spawnRef,
  avatarId,
  bubbleRef,
  onNear,
}: {
  keys: React.RefObject<Record<string, boolean>>
  move: React.RefObject<{ fwd: number; strafe: number }>
  orbit: React.RefObject<{ yaw: number; pitch: number; dist: number }>
  places: Place[]
  playerPosition: React.RefObject<THREE.Vector3>
  selfState: React.RefObject<SelfState>
  spawnRef: React.RefObject<{ x: number; z: number } | null>
  avatarId: string
  bubbleRef: React.RefObject<ChatBubble | null>
  onNear: (p: Place | null) => void
}) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const pos = useRef(new THREE.Vector3(2.5, 0, 4))
  const rotY = useRef(Math.PI)
  const camTarget = useRef(new THREE.Vector3())
  const [walking, setWalking] = useState(false)
  const walkingRef = useRef(false)
  const bubble = useChatBubble(() => bubbleRef.current)
  const { camera } = useThree()

  useFrame((state, delta) => {
    // Snap to the server-assigned spawn the first frame after we connect.
    if (spawnRef.current) {
      pos.current.set(spawnRef.current.x, 0, spawnRef.current.z)
      spawnRef.current = null
    }
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
    if (moving !== walkingRef.current) {
      walkingRef.current = moving
      setWalking(moving)
    }

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
    playerPosition.current.copy(pos.current)
    selfState.current.x = pos.current.x
    selfState.current.z = pos.current.z
    selfState.current.rot = rotY.current
    selfState.current.walking = moving

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
    <>
      <group ref={root}>
        <group ref={body}>
          <PlayerAvatar avatarId={avatarId} walking={walking} />
        </group>
        {/* Special badge marking which avatar is you. */}
        <Html position={[0, 2.45, 0]} center distanceFactor={16} zIndexRange={[6, 0]} pointerEvents="none">
          <div className="flex items-center gap-1 whitespace-nowrap rounded-full bg-highlight px-2.5 py-0.5 text-xs font-extrabold text-card shadow-lg ring-2 ring-white/70">
            <span aria-hidden>★</span> You
          </div>
        </Html>
        {bubble && <ChatBubbleHtml text={bubble.text} whisper={bubble.whisper} y={2.5} />}
      </group>
    </>
  )
}

// ---- Multiplayer presence -------------------------------------------------
// A lightweight WebSocket layer that lets visitors see the other people walking
// around their five-person lobby. It is purely cosmetic — positions are
// relayed, never stored — and has no bearing on Battle Royale matchmaking.

const MAX_REMOTE = 4
const BUBBLE_MS = 6000 // how long a chat line floats above an avatar
const CHAT_MAX_LEN = 200 // mirrors town.CHAT_MAX_LEN on the backend
const CHAT_LOG_MAX = 50 // recent lines kept in the chat panel

/** A chat line floating above an avatar, until `until` (ms, Date.now clock). */
type ChatBubble = { text: string; until: number; private?: boolean }

/** One line in the chat panel's scrollback. */
interface ChatEntry {
  key: string
  name: string
  text: string
  self: boolean
  private?: boolean
  toName?: string // for our own whispers: who we sent it to
}

/** A fellow visitor we can pick from the chat recipient dropdown. */
interface TownPlayer {
  id: string
  name: string
}

let chatEntrySeq = 0

interface RemotePlayerData {
  name: string
  avatar: string
  // Latest target from the server.
  tx: number
  tz: number
  trot: number
  walking: boolean
  // Smoothed values rendered each frame.
  x: number
  z: number
  rot: number
  // Their most recent chat line, shown as a floating bubble until it expires.
  bubble?: ChatBubble
}

type RemoteMap = Map<string, RemotePlayerData>

let fallbackTownClientId: string | null = null
const TOWN_PAGE_ID = createTownClientId()

function createTownClientId(): string {
  return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 12)
}

/**
 * A stable id for this tab, persisted in sessionStorage. Sent with the town
 * socket so a reload/reconnect reclaims the same avatar, while another tab gets
 * its own character and can fill a separate lobby slot.
 */
function getTownClientId(): string {
  try {
    let id = sessionStorage.getItem('town-cid')
    if (!id) {
      id = createTownClientId()
      sessionStorage.setItem('town-cid', id)
    }
    return id
  } catch {
    fallbackTownClientId ??= createTownClientId()
    return fallbackTownClientId
  }
}

/** Build the ws:// URL for the town presence socket (mirrors the battle one).
 *  The avatar is sent up front so others see the right one from the first frame,
 *  not just after the first position update. */
function townSocketUrl(token: string | null, avatar: string) {
  const directBase = import.meta.env.DEV
    ? ((import.meta.env.VITE_GAME_SERVICE_URL as string | undefined) ?? 'http://localhost:8001')
    : ''
  const base = directBase
    ? directBase.replace(/^http/, 'ws').replace(/\/$/, '')
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/game`
  const params = new URLSearchParams({ cid: getTownClientId(), pid: TOWN_PAGE_ID, avatar })
  if (token) params.set('token', token)
  return `${base}/town/ws?${params.toString()}`
}

function sameMembership(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * Connect to the town presence socket: broadcast our pose ~12×/sec and collect
 * the roster of nearby visitors. Positions live in a ref (read per-frame, no
 * re-render); React state only tracks the *set* of visible ids so avatars mount
 * and unmount cleanly. Reconnects automatically if the socket drops.
 */
function useTownPresence(
  token: string | null,
  selfState: React.RefObject<SelfState>,
  spawnRef: React.RefObject<{ x: number; z: number } | null>,
) {
  const remoteRef = useRef<RemoteMap>(new Map())
  const [remoteIds, setRemoteIds] = useState<string[]>([])
  const [chatLog, setChatLog] = useState<ChatEntry[]>([])
  // The live socket (so sendChat can reach it) and our own floating bubble.
  const wsRef = useRef<WebSocket | null>(null)
  const selfBubbleRef = useRef<ChatBubble | null>(null)

  // `to`/`toName` set → a 1-to-1 whisper to that visitor; omitted → whole lobby.
  const sendChat = useCallback((raw: string, to?: string, toName?: string) => {
    const text = raw.trim().slice(0, CHAT_MAX_LEN)
    if (!text) return
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', text, ...(to ? { to } : {}) }))
    }
    // Echo our own line locally — snappier than waiting for a round-trip, and the
    // server intentionally doesn't relay it back to us.
    selfBubbleRef.current = { text, until: Date.now() + BUBBLE_MS, private: !!to }
    setChatLog((prev) =>
      [
        ...prev,
        { key: `c${chatEntrySeq++}`, name: 'You', text, self: true, private: !!to, toName },
      ].slice(-CHAT_LOG_MAX),
    )
  }, [])

  useEffect(() => {
    let stopped = false
    let ws: WebSocket | null = null
    let sendTimer: number | undefined
    let reconnectTimer: number | undefined

    const connect = () => {
      if (stopped) return
      ws = new WebSocket(townSocketUrl(token, selfState.current.avatar))
      wsRef.current = ws

      ws.onopen = () => {
        sendTimer = window.setInterval(() => {
          if (ws?.readyState !== WebSocket.OPEN) return
          const s = selfState.current
          ws.send(
            JSON.stringify({ type: 'move', x: s.x, z: s.z, rot: s.rot, walking: s.walking, avatar: s.avatar }),
          )
        }, 80)
      }

      ws.onmessage = (event) => {
        let msg: any
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        // On connect the server assigns a random empty spawn — let Player snap to it.
        if (msg?.type === 'welcome' && typeof msg.x === 'number' && typeof msg.z === 'number') {
          spawnRef.current = { x: msg.x, z: msg.z }
          return
        }
        // A chat line from someone else in our lobby: log it and float a bubble
        // over their avatar (the bubble auto-expires in RemotePlayer).
        if (msg?.type === 'chat' && typeof msg.text === 'string') {
          const name = typeof msg.name === 'string' ? msg.name : 'Visitor'
          const text = msg.text.slice(0, CHAT_MAX_LEN)
          // A `to` field means the server sent this only to us — a private whisper.
          const isPrivate = typeof msg.to === 'string'
          setChatLog((prev) =>
            [...prev, { key: `c${chatEntrySeq++}`, name, text, self: false, private: isPrivate }].slice(
              -CHAT_LOG_MAX,
            ),
          )
          const rp = remoteRef.current.get(msg.id)
          if (rp) rp.bubble = { text, until: Date.now() + BUBBLE_MS, private: isPrivate }
          return
        }
        if (!msg || msg.type !== 'players' || !Array.isArray(msg.players)) return
        const map = remoteRef.current
        const incoming = new Set<string>()
        for (const p of msg.players.slice(0, MAX_REMOTE)) {
          incoming.add(p.id)
          const existing = map.get(p.id)
          if (existing) {
            existing.name = p.name
            existing.avatar = p.avatar ?? 'timmy'
            existing.tx = p.x
            existing.tz = p.z
            existing.trot = p.rot
            existing.walking = !!p.walking
          } else {
            map.set(p.id, {
              name: p.name,
              avatar: p.avatar ?? 'timmy',
              tx: p.x,
              tz: p.z,
              trot: p.rot,
              walking: !!p.walking,
              x: p.x,
              z: p.z,
              rot: p.rot,
            })
          }
        }
        for (const id of [...map.keys()]) if (!incoming.has(id)) map.delete(id)
        const next = [...map.keys()]
        setRemoteIds((prev) => (sameMembership(prev, next) ? prev : next))
      }

      ws.onclose = () => {
        if (sendTimer) window.clearInterval(sendTimer)
        if (wsRef.current === ws) wsRef.current = null
        remoteRef.current.clear()
        setRemoteIds((prev) => (prev.length ? [] : prev))
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1500)
      }

      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      stopped = true
      if (sendTimer) window.clearInterval(sendTimer)
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [token, selfState, spawnRef])

  return { remoteRef, remoteIds, chatLog, sendChat, selfBubbleRef }
}

/**
 * Track a floating chat bubble: returns the text to show while it's still within
 * its lifetime, then null once it expires. Driven off the render loop so it
 * clears itself; `read` is polled live so a stale closure is harmless.
 */
function useChatBubble(read: () => ChatBubble | null) {
  const [bubble, setBubble] = useState<{ text: string; whisper: boolean } | null>(null)
  const shown = useRef<string | null>(null)
  useFrame(() => {
    const b = read()
    const active = b && b.until > Date.now() ? b : null
    // Re-render only when the visible content changes (text or whisper styling).
    const key = active ? `${active.private ? 'w' : 'p'}:${active.text}` : null
    if (key !== shown.current) {
      shown.current = key
      setBubble(active ? { text: active.text, whisper: !!active.private } : null)
    }
  })
  return bubble
}

/** A speech bubble that floats diagonally up beside an avatar's head (in-world
 *  Html), with a tail pointing back down toward the character. A soft white card
 *  that stays a tidy shape even for one-word messages; whispers get a brand tint
 *  + lock. */
function ChatBubbleHtml({ text, whisper, y }: { text: string; whisper: boolean; y: number }) {
  return (
    <Html position={[0, y, 0]} distanceFactor={12} zIndexRange={[8, 0]} pointerEvents="none">
      {/* Anchored at name-badge height (head centre). A diagonal trail of growing
          dots climbs up-right from the side of the badge to the bubble, which
          floats clear above-right of the head — like a comic speech bubble.
          Everything is placed absolutely off the (zero-size) anchor point. */}
      <div className="relative select-none">
        {/* Dot trail: small by the badge → larger → the bubble. Offsets keep it
            clear of the (wider) name badge below. */}
        <span
          aria-hidden
          className={`absolute bottom-2 left-10 h-1.5 w-1.5 rounded-full shadow-sm ${
            whisper ? 'bg-brand' : 'bg-white'
          }`}
        />
        <span
          aria-hidden
          className={`absolute bottom-4 left-[3.25rem] h-2 w-2 rounded-full shadow-sm ${
            whisper ? 'bg-brand' : 'bg-white'
          }`}
        />
        <div
          className={`absolute bottom-6 left-[4.25rem] w-max min-w-[2.25rem] max-w-[12.5rem] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-left text-[13px] font-semibold leading-snug shadow-[0_8px_24px_rgba(20,38,76,0.22)] ring-1 ${
            whisper ? 'bg-brand text-white ring-white/20' : 'bg-white text-card ring-black/[0.06]'
          }`}
        >
          {whisper && (
            <span aria-hidden className="mr-1 opacity-90">
              🔒
            </span>
          )}
          {text}
        </div>
      </div>
    </Html>
  )
}

/** Two-tone initials avatar for a chat author (deterministic colour from name). */
const CHAT_AVATAR_TINTS = [
  'bg-brand-light',
  'bg-secondary',
  'bg-highlight text-card',
  'bg-risk-low',
  'bg-risk-med',
]
function chatTint(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return CHAT_AVATAR_TINTS[h % CHAT_AVATAR_TINTS.length]
}
function Initials({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <span
      className={`grid h-6 w-6 shrink-0 select-none place-items-center rounded-full text-[11px] font-extrabold text-white shadow ${chatTint(name)}`}
    >
      {initial}
    </span>
  )
}

/**
 * Town chat (top-right). Talk to the up-to-four others sharing your lobby — the
 * whole lobby or one person 1-to-1 — and each line also floats above the
 * sender's avatar. Styled like a chat app: own messages right, others left,
 * with a recipient picker for whispers. Collapsible; pointer/scroll events are
 * kept from the canvas so typing or scrolling the log doesn't pan the camera.
 */
function ChatPanel({
  log,
  players,
  onSend,
}: {
  log: ChatEntry[]
  players: TownPlayer[]
  onSend: (text: string, to?: string, toName?: string) => void
}) {
  // Start collapsed on small screens so the panel doesn't blanket the town;
  // open by default on desktop where there's room beside the canvas.
  const [open, setOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 640,
  )
  const [text, setText] = useState('')
  const [target, setTarget] = useState('all') // 'all' or a player's roster id
  const [pickerOpen, setPickerOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, open])

  // If the person we picked walks off (leaves the lobby), fall back to everyone.
  useEffect(() => {
    if (target !== 'all' && !players.some((p) => p.id === target)) setTarget('all')
  }, [players, target])

  // Close the recipient popover on an outside click (panel clicks are stopped
  // from bubbling, so this only fires for clicks elsewhere on the page).
  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  const targetName = players.find((p) => p.id === target)?.name
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (target === 'all' || !targetName) onSend(text)
    else onSend(text, target, targetName)
    setText('')
  }

  return (
    <>
      {/* On mobile the open panel is a centered modal, so dim the scene and let a
          tap outside close it. Desktop keeps the anchored top-right panel. */}
      {open && (
        <div
          className="absolute inset-0 z-40 bg-card/40 backdrop-blur-sm sm:hidden"
          onClick={() => setOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
      <div
        data-chat
        className={`pointer-events-auto cursor-auto ${
          open
            ? 'absolute left-1/2 top-1/2 z-50 w-[88vw] max-w-sm -translate-x-1/2 -translate-y-1/2 sm:left-auto sm:right-3 sm:top-3 sm:z-40 sm:w-[min(64vw,19rem)] sm:max-w-none sm:translate-x-0 sm:translate-y-0'
            : 'absolute right-3 top-3 z-30 w-auto'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex max-h-[70vh] w-full flex-col overflow-hidden rounded-3xl border border-white/15 bg-card/85 shadow-[0_18px_50px_rgba(8,16,38,0.45)] ring-1 ring-black/10 backdrop-blur-xl sm:max-h-[min(70vh,28rem)]">
        {/* Header — a compact pill when collapsed, a full bar when open. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center text-left transition hover:bg-white/[0.06] ${
            open ? 'gap-2.5 px-3.5 py-2.5' : 'gap-2 py-2 pl-2 pr-3'
          }`}
        >
          <span
            className={`grid shrink-0 place-items-center rounded-2xl bg-brand text-base shadow-inner ${
              open ? 'h-8 w-8' : 'h-7 w-7 text-sm'
            }`}
          >
            💬
          </span>
          <span className={`min-w-0 ${open ? 'flex-1' : 'hidden flex-1 sm:block'}`}>
            <span className="block text-sm font-extrabold leading-tight text-white">Town chat</span>
            {open && (
              <span className="flex items-center gap-1 text-[10.5px] font-medium text-white/55">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-risk-low shadow-[0_0_5px] shadow-risk-low" />
                {players.length + 1} {players.length === 0 ? 'here' : 'in your town'}
              </span>
            )}
          </span>
          {!open && (
            <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-bold text-white/55">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-risk-low shadow-[0_0_5px] shadow-risk-low" />
              {players.length + 1}
            </span>
          )}
          <span className="shrink-0 text-white/45">{open ? '▾' : '▸'}</span>
        </button>

        {open && (
          <>
            {/* Messages */}
            <div
              ref={logRef}
              className="flex-1 space-y-2.5 overflow-y-auto border-t border-white/10 px-3 py-3"
            >
              {log.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-6 text-center">
                  <span className="text-2xl">👋</span>
                  <p className="text-[11.5px] font-medium text-white/55">
                    Say hi to the others exploring your town.
                  </p>
                </div>
              ) : (
                log.map((m) => <ChatMessage key={m.key} m={m} />)
              )}
            </div>

            {/* Composer — recipient picker on its own row so the input keeps
                full width (otherwise the placeholder truncates on mobile). */}
            <form
              onSubmit={submit}
              className="flex flex-col gap-2 border-t border-white/10 bg-black/10 p-2.5"
            >
              {/* Recipient picker */}
              <div ref={pickerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((o) => !o)}
                  className={`flex w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                    targetName
                      ? 'bg-brand text-white hover:bg-brand-light'
                      : 'bg-white/12 text-white/80 hover:bg-white/20'
                  }`}
                  title="Choose who to message"
                >
                  <span aria-hidden>{targetName ? '🔒' : '🌐'}</span>
                  <span className="truncate">
                    {targetName ? `${targetName}` : 'Everyone'}
                  </span>
                  <span className="ml-auto shrink-0 opacity-70">▾</span>
                </button>
                {pickerOpen && (
                  <div className="absolute bottom-full left-0 z-10 mb-2 max-h-48 w-full overflow-y-auto rounded-2xl border border-white/15 bg-card shadow-2xl ring-1 ring-black/20">
                    <PickerOption
                      icon="🌐"
                      label="Everyone"
                      active={target === 'all'}
                      onClick={() => {
                        setTarget('all')
                        setPickerOpen(false)
                      }}
                    />
                    {players.length > 0 && <div className="mx-3 my-1 h-px bg-white/10" />}
                    {players.map((p) => (
                      <PickerOption
                        key={p.id}
                        icon="🔒"
                        label={p.name}
                        active={target === p.id}
                        onClick={() => {
                          setTarget(p.id)
                          setPickerOpen(false)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Input + send */}
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={CHAT_MAX_LEN}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                  placeholder={targetName ? `Whisper to ${targetName}…` : 'Message everyone…'}
                  className="min-w-0 flex-1 rounded-full bg-white/12 px-3.5 py-2 text-[12.5px] text-white placeholder:text-white/40 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-brand-light"
                />
                <button
                  type="submit"
                  disabled={!text.trim()}
                  aria-label="Send"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 -translate-x-px" fill="currentColor">
                    <path d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2z" />
                  </svg>
                </button>
              </div>
            </form>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** One row in the recipient popover. */
function PickerOption({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold transition hover:bg-white/10 ${
        active ? 'text-white' : 'text-white/75'
      }`}
    >
      <span aria-hidden className="text-[11px]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <span className="text-brand-light">✓</span>}
    </button>
  )
}

/** A single chat line: own messages align right (brand), others left (light). */
function ChatMessage({ m }: { m: ChatEntry }) {
  const caption = m.self
    ? m.private
      ? `to ${m.toName ?? '?'}`
      : null
    : m.private
      ? `${m.name} · whisper`
      : m.name

  const bubble = m.self
    ? `rounded-br-md ${m.private ? 'bg-brand ring-1 ring-highlight/60' : 'bg-brand'} text-white`
    : `rounded-bl-md ${m.private ? 'bg-white ring-1 ring-brand/40' : 'bg-white'} text-card`

  return (
    <div className={`flex items-end gap-1.5 ${m.self ? 'flex-row-reverse' : ''}`}>
      {!m.self && <Initials name={m.name} />}
      <div className={`flex min-w-0 max-w-[78%] flex-col ${m.self ? 'items-end' : 'items-start'}`}>
        {caption && (
          <span className="mb-0.5 px-1 text-[10px] font-semibold text-white/45">
            {m.private && <span aria-hidden>🔒 </span>}
            {caption}
          </span>
        )}
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[12.5px] font-medium leading-snug shadow-md ${bubble}`}
        >
          {m.text}
        </div>
      </div>
    </div>
  )
}

function RemotePlayers({ ids, dataRef }: { ids: string[]; dataRef: React.RefObject<RemoteMap> }) {
  return (
    <>
      {ids.map((id) => (
        <RemotePlayer key={id} id={id} dataRef={dataRef} />
      ))}
    </>
  )
}

/** One other visitor's avatar, smoothly interpolated toward the latest snapshot. */
function RemotePlayer({ id, dataRef }: { id: string; dataRef: React.RefObject<RemoteMap> }) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const [walking, setWalking] = useState(false)
  const walkingRef = useRef(false)
  const [avatar, setAvatar] = useState(() => dataRef.current.get(id)?.avatar ?? 'timmy')
  const avatarRef = useRef(avatar)
  const name = dataRef.current.get(id)?.name ?? ''
  const bubble = useChatBubble(() => dataRef.current.get(id)?.bubble ?? null)

  useFrame((state, delta) => {
    const d = dataRef.current.get(id)
    if (!d || !root.current) return
    const dt = Math.min(delta, 0.05)
    const t = 1 - Math.pow(0.0015, dt)
    d.x += (d.tx - d.x) * t
    d.z += (d.tz - d.z) * t
    d.rot = lerpAngle(d.rot, d.trot, 12 * dt)
    root.current.position.set(d.x, 0, d.z)
    root.current.rotation.y = d.rot
    if (d.walking !== walkingRef.current) {
      walkingRef.current = d.walking
      setWalking(d.walking)
    }
    if (d.avatar !== avatarRef.current) {
      avatarRef.current = d.avatar
      setAvatar(d.avatar)
    }
    if (body.current) {
      const tm = state.clock.elapsedTime
      body.current.position.y = d.walking ? Math.abs(Math.sin(tm * 11)) * 0.18 : Math.sin(tm * 2) * 0.04
    }
  })

  return (
    <group ref={root}>
      <group ref={body}>
        <PlayerAvatar avatarId={avatar} walking={walking} />
      </group>
      <Html position={[0, 2.25, 0]} center distanceFactor={16} zIndexRange={[4, 0]} pointerEvents="none">
        <div className="whitespace-nowrap rounded-full bg-brand/90 px-2.5 py-0.5 text-xs font-bold text-white shadow ring-1 ring-white/20">
          {name}
        </div>
      </Html>
      {bubble && <ChatBubbleHtml text={bubble.text} whisper={bubble.whisper} y={2.25} />}
    </group>
  )
}

