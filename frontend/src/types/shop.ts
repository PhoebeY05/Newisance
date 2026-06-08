export interface PowerupItem {
  key: string
  name: string
  emoji: string
  description: string
  cost: number
  game: 'timed' | 'battle' | 'both'
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
  both: 'Both games',
}
