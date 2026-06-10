import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import type * as THREE from 'three'
import { useAuth } from '../context/AuthContext'
import TierBadge from '../components/TierBadge'
import {
  AVATARS,
  type AvatarDef,
  PlayerAvatar,
  TIER_ORDER,
  isAvatarUnlocked,
  tierRank,
  useSelectedAvatarId,
} from '../three/avatars'

/**
 * Style Studio — the town's wardrobe. Browse every avatar, see which ones your
 * credibility tier has unlocked, preview them on a rotating turntable, and wear
 * the ones you've earned. Reached from the Style Studio building in Newisance
 * Town (or `/wardrobe`). The choice is saved locally and broadcast to the town
 * so other visitors see you in it.
 */

// Credibility needed to reach each tier (mirrors `shared/credibility.py`).
const TIER_THRESHOLD: Record<string, number> = {
  Newcomer: 0,
  Verified: 31,
  Analyst: 61,
  Expert: 81,
}

export default function Wardrobe() {
  const { user } = useAuth()
  const tier = user?.tier ?? 'Newcomer'
  const score = user ? Math.floor(user.credibility_score) : 0
  const [selected, setSelected] = useSelectedAvatarId()
  const [preview, setPreview] = useState(selected)

  const previewAvatar = useMemo(() => AVATARS.find((a) => a.id === preview) ?? AVATARS[0], [preview])
  const previewUnlocked = isAvatarUnlocked(previewAvatar, tier)
  const unlockedCount = AVATARS.filter((a) => isAvatarUnlocked(a, tier)).length

  // The closest avatar still locked, for the "keep going" nudge.
  const nextLocked = useMemo(
    () => AVATARS.filter((a) => !isAvatarUnlocked(a, tier)).sort((a, b) => a.rank - b.rank)[0],
    [tier],
  )
  const pointsToNext = nextLocked ? Math.max(0, (TIER_THRESHOLD[nextLocked.tier] ?? 0) - score) : 0

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/learn" className="text-sm font-bold text-brand hover:underline">
            ← Back to town
          </Link>
          <h1 className="mt-1 font-display text-3xl font-extrabold text-card sm:text-4xl">
            👕 Style Studio
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            Climb the credibility tiers to unlock new avatars, then wear the ones you've earned.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 shadow ring-1 ring-black/5">
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">Your tier</p>
            <p className="text-sm font-bold text-card">{unlockedCount} of {AVATARS.length} unlocked</p>
          </div>
          <TierBadge tier={tier} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* 3D preview turntable */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#dce9ff] to-[#f3ecff] shadow-xl ring-1 ring-black/5">
          <div className="h-[360px] sm:h-[440px]">
            <Canvas shadows camera={{ position: [0, 1.5, 3.4], fov: 45 }}>
              <AvatarStage avatarId={preview} dimmed={!previewUnlocked} />
            </Canvas>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-card/80 via-card/20 to-transparent p-5">
            <div>
              <p className="font-display text-xl font-extrabold text-white drop-shadow">
                {previewAvatar.emoji} {previewAvatar.name}
              </p>
              <p className="max-w-xs text-xs text-white/85">{previewAvatar.blurb}</p>
            </div>
          </div>
          {!previewUnlocked && (
            <div className="absolute right-4 top-4 rounded-full bg-card/85 px-3 py-1 text-xs font-bold text-white shadow ring-1 ring-white/20">
              🔒 Unlocks at {previewAvatar.tier}
            </div>
          )}
        </div>

        {/* Avatar roster */}
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {AVATARS.map((a) => (
              <AvatarCard
                key={a.id}
                avatar={a}
                unlocked={isAvatarUnlocked(a, tier)}
                worn={selected === a.id}
                active={preview === a.id}
                onPreview={() => setPreview(a.id)}
                onWear={() => setSelected(a.id)}
              />
            ))}
          </div>

          {/* Wear action for the previewed avatar */}
          <div className="mt-4">
            {previewUnlocked ? (
              <button
                type="button"
                disabled={selected === previewAvatar.id}
                onClick={() => setSelected(previewAvatar.id)}
                className="w-full rounded-2xl bg-brand px-5 py-3 text-sm font-bold text-white shadow-lg shadow-brand/25 transition enabled:hover:bg-brand-light disabled:cursor-default disabled:opacity-60"
              >
                {selected === previewAvatar.id ? `✓ Wearing ${previewAvatar.name}` : `Wear ${previewAvatar.name}`}
              </button>
            ) : (
              <div className="rounded-2xl bg-surface px-5 py-3 text-center text-sm font-medium text-ink-soft ring-1 ring-black/5">
                🔒 Reach <span className="font-bold text-card">{previewAvatar.tier}</span> to wear this
                {nextLocked?.id === previewAvatar.id && pointsToNext > 0 && (
                  <> · <span className="font-bold text-brand">{pointsToNext}</span> more credibility to go</>
                )}
              </div>
            )}
          </div>

          {/* Tier ladder hint */}
          <p className="mt-4 text-center text-xs text-ink-muted">
            Tiers: {TIER_ORDER.map((t, i) => (
              <span key={t} className={tierRank(tier) >= i ? 'font-bold text-card' : ''}>
                {t}{i < TIER_ORDER.length - 1 ? ' → ' : ''}
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  )
}

/** One avatar tile in the roster grid. */
function AvatarCard({
  avatar,
  unlocked,
  worn,
  active,
  onPreview,
  onWear,
}: {
  avatar: AvatarDef
  unlocked: boolean
  worn: boolean
  active: boolean
  onPreview: () => void
  onWear: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onPreview()
        if (unlocked) onWear()
      }}
      className={`group relative flex flex-col items-center gap-1 rounded-2xl p-3 text-center transition ${
        active ? 'bg-brand/10 ring-2 ring-brand' : 'bg-surface ring-1 ring-black/5 hover:ring-brand/40'
      } ${unlocked ? '' : 'opacity-75'}`}
    >
      {worn && (
        <span className="absolute right-2 top-2 rounded-full bg-risk-low px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white">
          Worn
        </span>
      )}
      <span className={`text-3xl ${unlocked ? '' : 'grayscale'}`}>{unlocked ? avatar.emoji : '🔒'}</span>
      <span className="text-sm font-bold text-card">{avatar.name}</span>
      {unlocked ? (
        <span className="text-[11px] font-medium text-ink-muted">{worn ? 'Wearing' : 'Tap to wear'}</span>
      ) : (
        <span className="text-[11px] font-bold text-ink-soft">Unlock at {avatar.tier}</span>
      )}
    </button>
  )
}

/** The lit turntable: a soft studio with a slowly rotating avatar on a podium. */
function AvatarStage({ avatarId, dimmed }: { avatarId: string; dimmed: boolean }) {
  return (
    <>
      <ambientLight intensity={dimmed ? 0.45 : 0.8} />
      <hemisphereLight args={['#ffffff', '#cdb6e8', 0.5]} />
      <directionalLight
        position={[4, 8, 5]}
        intensity={dimmed ? 0.5 : 1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <Turntable>
        {/* podium */}
        <mesh position={[0, 0.05, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[0.95, 1.05, 0.1, 36]} />
          <meshStandardMaterial color="#efe7fb" />
        </mesh>
        <mesh position={[0, 0.12, 0]} receiveShadow>
          <cylinderGeometry args={[0.82, 0.82, 0.04, 36]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <group position={[0, 0.14, 0]}>
          <PlayerAvatar avatarId={avatarId} />
        </group>
      </Turntable>
      <ContactShadows position={[0, 0.14, 0]} opacity={0.3} scale={6} blur={2.2} far={3} />
    </>
  )
}

/** Slowly rotates its children about Y so you can see the avatar from all sides. */
function Turntable({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.6
  })
  return <group ref={ref}>{children}</group>
}
