import { useEffect, useState } from 'react'
import { isMuted, onMuteChange, setMuted, unlockAudio } from '../lib/audio'

/**
 * A small floating mute/unmute button for the town and game screens. Reflects
 * and drives the shared audio engine's mute state (persisted across pages and
 * reloads). Tapping it also unlocks the audio context, satisfying the browser's
 * autoplay gesture requirement.
 */
export default function SoundToggle({ className = '' }: { className?: string }) {
  const [muted, setMutedState] = useState(isMuted)

  useEffect(() => onMuteChange(setMutedState), [])

  return (
    <button
      type="button"
      aria-label={muted ? 'Sound off — tap to unmute' : 'Sound on — tap to mute'}
      aria-pressed={!muted}
      title={muted ? 'Sound off' : 'Sound on'}
      onClick={() => {
        unlockAudio()
        setMuted(!muted)
      }}
      className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-bold shadow-lg ring-1 backdrop-blur transition ${
        muted
          ? 'bg-risk-high/85 text-white ring-white/30 hover:bg-risk-high'
          : 'bg-risk-low/85 text-white ring-white/30 hover:bg-risk-low'
      } ${className}`}
    >
      {muted ? <MutedIcon /> : <SoundIcon />}
      <span className="leading-none">{muted ? 'Off' : 'On'}</span>
    </button>
  )
}

/** Universal speaker icon with sound waves (sound on). */
function SoundIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 11 5Z" />
      <path
        d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Universal speaker icon with an ✕ (muted). */
function MutedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 11 5Z" />
      <path
        d="m16 9 5 6m0-6-5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
