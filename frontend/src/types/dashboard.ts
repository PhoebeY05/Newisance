// Mirrors the Pydantic schemas in backend/dashboard-service/app/schemas.py
// (which in turn mirror shared/dashboard.py).

export interface TrendingItem {
  id: number
  content_type: string
  content_url: string
  caption: string | null
  status: string
  created_at: string | null
  final_score: number
  fake_likelihood: number | null
  weighted_impact: number | null
  vote_count: number
  verdict: string | null
  explanation: string | null
  rank_score: number
}

export interface VerdictCount {
  verdict: string
  count: number
}

export interface ContentTypeCount {
  content_type: string
  count: number
}

export interface CategoryCount {
  category: string
  count: number
}

export interface WeeklyBucket {
  week: string
  likely_fake: number
  likely_real: number
  uncertain: number
}

export interface ScamTypes {
  by_verdict: VerdictCount[]
  by_content_type: ContentTypeCount[]
  by_category: CategoryCount[]
  weekly: WeeklyBucket[]
}

export interface Stats {
  submissions_this_week: number
  pct_fake: number
  most_common_type: string | null
  active_users_this_week: number
}

export type LeaderboardScope = 'weekly' | 'alltime'

export interface LeaderboardEntry {
  rank: number
  user_id: number
  username: string
  score: number
  credibility_score: number
  tier: string
}
