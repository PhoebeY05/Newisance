import { useEffect } from 'react'
import { startMusic, stopMusic, unlockAudio, type TrackName } from '../lib/audio'

/**
 * Play a looping background track for as long as the component is mounted.
 * Browsers block audio until the user interacts, so we both try to start
 * immediately (works once the context was unlocked on an earlier page) and
 * arm a one-shot gesture listener that unlocks + starts on the first
 * pointer/key/touch event.
 */
export function useMusic(track: TrackName) {
  useEffect(() => {
    startMusic(track)

    const begin = () => {
      unlockAudio()
      startMusic(track)
    }
    const opts = { once: true } as const
    window.addEventListener('pointerdown', begin, opts)
    window.addEventListener('keydown', begin, opts)
    window.addEventListener('touchstart', begin, opts)

    return () => {
      window.removeEventListener('pointerdown', begin)
      window.removeEventListener('keydown', begin)
      window.removeEventListener('touchstart', begin)
      stopMusic()
    }
  }, [track])
}
