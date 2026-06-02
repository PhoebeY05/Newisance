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

export interface ConfItem {
  title: string
  confidence: number
  detail: string
}

export interface Metric {
  label: string
  score: number
}

export interface EvidenceCard {
  icon: string
  title: string
  detail: string
  link_label: string | null
  link_url: string | null
}

export interface AnalysisReport {
  credibility_score: number
  summary: string
  source_credibility: ConfItem[]
  fact_checking: Metric[]
  fact_checking_highlight: ConfItem | null
  cross_verification: ConfItem[]
  misinformation_metrics: Metric[]
  misinformation_verdict: string
  evidence: EvidenceCard[]
  cross_reference_count: number
  methodology: Record<string, string>
  ai_assessment: ConfItem | null
}

export interface AiAnalysisOut {
  confidence: number | null
  signals: string[]
  verdict: string | null
  explanation: string | null
  processed_at: string | null
  report: AnalysisReport | null
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
