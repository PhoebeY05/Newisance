// Mirrors backend/game-service/app/schemas.py admin shapes (Phase 9).

export const QUESTION_TYPES = [
  'misleading_headline',
  'deepfake',
  'manipulated_media',
  'scam_message',
  'satire',
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export interface AdminQuestion {
  id: number
  content: string
  type: string
  media_url: string | null
  correct_answer: string | null
  explanation: string | null
  difficulty: string | null
  tags: string[]
  is_active: boolean
  created_at: string | null
}

export interface AdminQuestionFeed {
  items: AdminQuestion[]
  page: number
  page_size: number
  total: number
}

export interface BulkImportResult {
  imported: number
  errors: { row: number; reason: string }[]
}

export interface AdminAppeal {
  id: number
  submission_id: number
  submission_title: string
  submitter_name: string | null
  ai_verdict: string | null
  real_votes: number
  fake_votes: number
  appealed_at: string
}

export const TYPE_LABEL: Record<string, string> = {
  misleading_headline: 'Misleading Headline',
  deepfake: 'Deepfake',
  manipulated_media: 'Manipulated Media',
  scam_message: 'Scam Message',
  satire: 'Satire',
}
