import { Suspense, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js'
import { useAnimations, useGLTF } from '@react-three/drei'
import { AvatarBody, normalizeAvatarScene } from './town'

/**
 * Avatar system for Newisance Town.
 *
 * Every visitor starts as **Timmy** and unlocks fancier avatars as their
 * credibility tier climbs (Newcomer → Verified → Analyst → Expert). The
 * Wardrobe (`pages/Wardrobe.tsx`) lets you preview the roster, see what's still
 * locked, and switch into anything you've earned; the choice is broadcast to the
 * town so other visitors see you in it.
 *
 * Bodies are primitive meshes (or the shared Timmy glTF), so there are no extra
 * model assets to ship. The walking bob is applied by the parent in
 * `pages/Learn.tsx`, so these components only render the static body.
 */

// Credibility tiers, lowest → highest. Mirrors `shared/credibility.py` /
// `components/TierBadge.tsx`; an unknown or signed-out tier counts as Newcomer.
export const TIER_ORDER = ['Newcomer', 'Verified', 'Analyst', 'Expert'] as const
export type Tier = (typeof TIER_ORDER)[number]

export function tierRank(tier?: string | null): number {
  const i = TIER_ORDER.indexOf((tier ?? 'Newcomer') as Tier)
  return i < 0 ? 0 : i
}

export interface AvatarDef {
  id: string
  name: string
  emoji: string
  blurb: string
  /** Tier you must reach for this avatar to unlock. */
  tier: Tier
  /** Numeric rank of {@link tier} (0 = Newcomer … 3 = Expert). */
  rank: number
}

export const AVATARS: AvatarDef[] = [
  {
    id: 'timmy',
    name: 'Timmy',
    emoji: '🧍',
    blurb: 'The original Newisance explorer — ready for anything from day one.',
    tier: 'Newcomer',
    rank: 0,
  },
  {
    id: 'michelle',
    name: 'Michelle',
    emoji: '💃',
    blurb: 'A sharp, confident investigator who walks the talk.',
    tier: 'Verified',
    rank: 1,
  },
  {
    id: 'zombie',
    name: 'Zombie',
    emoji: '🧟',
    blurb: 'Misinformation never dies — and neither does this one.',
    tier: 'Analyst',
    rank: 2,
  },
  {
    id: 'granny',
    name: 'Granny',
    emoji: '👵',
    blurb: "Don't be fooled — she's been spotting hoaxes since before the internet.",
    tier: 'Expert',
    rank: 3,
  },
]

// glTF models for the unlockable avatars (converted from Mixamo FBX, textures
// shrunk to 512px WebP to match Timmy's footprint). Each carries a single
// looping clip we play while walking and freeze for the idle pose.
const MODEL_URL: Record<string, string> = {
  michelle: '/models/michelle.glb',
  zombie: '/models/zombie.glb',
  granny: '/models/granny.glb',
}

export const DEFAULT_AVATAR_ID = 'timmy'

export function avatarById(id: string): AvatarDef {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0]
}

/** Has a visitor at `tier` earned `avatar`? */
export function isAvatarUnlocked(avatar: AvatarDef, tier?: string | null): boolean {
  return tierRank(tier) >= avatar.rank
}

/** A selected id clamped to what the tier actually allows (falls back to Timmy),
 *  so a demotion or a tampered localStorage value can't show a locked avatar. */
export function resolveAvatarId(id: string, tier?: string | null): string {
  const avatar = avatarById(id)
  return isAvatarUnlocked(avatar, tier) ? avatar.id : DEFAULT_AVATAR_ID
}

// ---- Selected-avatar store ------------------------------------------------
// Persisted in localStorage and shared across the (separately-routed) Wardrobe
// and Town pages. A tiny listener set keeps any mounted `useSelectedAvatarId`
// hooks in sync the instant the choice changes.

const STORAGE_KEY = 'newisance.avatar'
const listeners = new Set<() => void>()

export function getSelectedAvatarId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_AVATAR_ID
  } catch {
    return DEFAULT_AVATAR_ID
  }
}

export function setSelectedAvatarId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Ignore storage failures (private mode, quota) — selection just won't persist.
  }
  listeners.forEach((l) => l())
}

/** `[selectedId, setSelectedId]`, kept in sync with localStorage and other tabs. */
export function useSelectedAvatarId(): [string, (id: string) => void] {
  const [id, setId] = useState(getSelectedAvatarId)
  useEffect(() => {
    const sync = () => setId(getSelectedAvatarId())
    listeners.add(sync)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return [id, setSelectedAvatarId]
}

// ---- Avatar bodies --------------------------------------------------------

/** Render the body for a given avatar id. The caller positions/rotates/bobs it. */
export function PlayerAvatar({ avatarId, walking = false }: { avatarId: string; walking?: boolean }) {
  const modelUrl = MODEL_URL[avatarId]
  return (
    <Suspense fallback={null}>
      {modelUrl ? (
        <ModelAvatar url={modelUrl} walking={walking} />
      ) : (
        <AvatarBody walking={walking} />
      )}
    </Suspense>
  )
}

/**
 * A glTF character model (Michelle / Zombie / Granny). The shared source scene
 * is cloned per instance with {@link cloneSkinnedScene} so each avatar has its
 * own skeleton, then normalised to the standard avatar size. The baked
 * "mixamo.com" clip plays while walking and is paused on its first frame for a
 * settled idle pose.
 */
function ModelAvatar({ url, walking }: { url: string; walking: boolean }) {
  const { scene, animations } = useGLTF(url)
  const avatar = useMemo(() => {
    const cloned = cloneSkinnedScene(scene) as THREE.Group
    normalizeAvatarScene(cloned)
    return cloned
  }, [scene])
  const { actions, names } = useAnimations(animations, avatar)

  useEffect(() => {
    const action = names.length ? actions[names[0]] : null
    if (!action) return
    action.reset().play()
    return () => {
      action.stop()
    }
  }, [actions, names])

  // Walk → let the clip loop; idle → freeze it on the first frame.
  useEffect(() => {
    const action = names.length ? actions[names[0]] : null
    if (!action) return
    action.paused = !walking
    if (!walking) action.time = 0
  }, [actions, names, walking])

  return <primitive object={avatar} />
}

// Warm the cache for the unlockable models so switching avatars is instant.
Object.values(MODEL_URL).forEach((url) => useGLTF.preload(url))
