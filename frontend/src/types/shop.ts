export interface PowerupItem {
  key: string
  name: string
  emoji: string
  description: string
  cost: number
  game: 'timed' | 'battle' | 'truth_tower' | 'both' | 'all'
}

export interface PurchaseResult {
  key: string
  quantity: number
  credibility_score: number
  tier: string
}

export type Inventory = Record<string, number>

export const GAME_LABEL: Record<PowerupItem['game'], string> = {
  timed: 'Flappy',
  battle: 'Battle Royale',
  truth_tower: 'Truth Tower',
  both: 'Both games',
  all: 'All games',
}
