export type PowerupKind = 'round' | 'armed'

export interface PowerupMeta {
  key: 'shield' | 'slowmo' | 'double' | 'shrink'
  emoji: string
  name: string
  kind: PowerupKind
  timedEffect: string
  truthTowerEffect: string
}

export const POWERUP_META: PowerupMeta[] = [
  {
    key: 'shield',
    emoji: '🛡️',
    name: 'Shield',
    kind: 'armed',
    timedEffect: 'Absorbs one pillar crash.',
    truthTowerEffect: 'Absorbs one missed stack or wrong fact-check damage.',
  },
  {
    key: 'slowmo',
    emoji: '⏱️',
    name: 'Slow Motion',
    kind: 'round',
    timedEffect: 'Slows incoming pillars for the round.',
    truthTowerEffect: 'Slows the moving block for the round.',
  },
  {
    key: 'double',
    emoji: '⭐',
    name: 'Double Points',
    kind: 'round',
    timedEffect: 'Doubles points from correct answers.',
    truthTowerEffect: 'Doubles points from placed blocks.',
  },
  {
    key: 'shrink',
    emoji: '🪶',
    name: 'Featherweight',
    kind: 'round',
    timedEffect: 'Shrinks your collision hitbox.',
    truthTowerEffect: 'Reduces damage from wrong fact-checks.',
  },
]

export const EMPTY_POWERUPS: Record<PowerupMeta['key'], boolean> = {
  shield: false,
  slowmo: false,
  double: false,
  shrink: false,
}
