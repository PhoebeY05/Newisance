// Mirrors the Pydantic schemas in backend/community-service/app/schemas.py.

export type ContentType = 'image' | 'url' | 'text'
export type Verdict = 'real' | 'fake'

export interface SubmissionOut {
  id: number
  user_id: number | null
  content_type: string
  content_url: string
  caption: string | null
  status: string
  created_at: string
  fake_likelihood: number | null
  weighted_impact: number | null
  vote_count: number
}

export interface AiAnalysisOut {
  confidence: number | null
  signals: string[]
  verdict: string | null
  explanation: string | null
  processed_at: string | null
}

export interface SubmissionDetail extends SubmissionOut {
  final_score: number | null
  ai_analysis: AiAnalysisOut | null
  your_vote: { verdict: Verdict; impact_score: number } | null
  submitter: string | null
  fake_votes: number
  real_votes: number
  can_delete: boolean
  can_edit: boolean
}

export interface SubmissionFeed {
  items: SubmissionOut[]
  page: number
  page_size: number
  total: number
}

export interface VoteResult {
  fake_likelihood: number | null
  weighted_impact: number | null
  vote_count: number
  your_vote_weight: number
}
