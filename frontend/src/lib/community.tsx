// Shared presentation helpers for the Community Verification hub, used by both
// the feed (Community.tsx) and the post detail page (CommunityPost.tsx).
import type { SubmissionOut } from '../types/community'

export type RiskTone = 'high' | 'med' | 'low' | 'none'

export const riskStyle: Record<RiskTone, string> = {
  high: 'bg-risk-critical/15 text-risk-critical',
  med: 'bg-risk-med/15 text-risk-med',
  low: 'bg-risk-low/15 text-risk-low',
  none: 'bg-ink-faint/15 text-ink-soft',
}

export function riskFor(fakeLikelihood: number | null): { tone: RiskTone; label: string } {
  if (fakeLikelihood == null) return { tone: 'none', label: 'Unrated' }
  if (fakeLikelihood >= 0.66) return { tone: 'high', label: 'High Risk' }
  if (fakeLikelihood >= 0.33) return { tone: 'med', label: 'Medium Risk' }
  return { tone: 'low', label: 'Low Risk' }
}

export function formatLikelihood(value: number | null): string {
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

export function contentEmoji(contentType: string): string {
  if (contentType === 'image') return '🖼️'
  if (contentType === 'url') return '🔗'
  return '📝'
}

export function previewContent(submission: Pick<SubmissionOut, 'content_type' | 'content_url'>): string {
  if (isMediaPath(submission.content_url)) return '[Uploaded media]'
  const text = submission.content_url
  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

// Submissions store uploaded files as content_url = "media_uploads/<file>".
export function isMediaPath(contentUrl: string): boolean {
  return contentUrl.startsWith('media_uploads/')
}

// Full URL to a stored media file, routed through the Vite /api/community proxy.
export function mediaUrl(contentUrl: string): string {
  return `/api/community/${contentUrl}`
}

export function mediaKind(contentUrl: string): 'image' | 'video' | null {
  const ext = contentUrl.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video'
  return null
}

// ---- caption fields (shared by the submit + edit forms) ----
// A submission's caption packs the "why suspicious" note plus structured meta,
// joined by " • ", e.g. "Looks fake • Category: Finance • Impact: High".

export const CATEGORIES = [
  'Health & Medical',
  'Politics',
  'Technology',
  'Finance',
  'Business & Economics',
  'Science & Research',
  'Environment & Climate',
  'Education',
  'Sports',
  'Entertainment',
  'Social Issues',
  'Legal & Justice',
  'Security & Safety',
  'Conspiracy Theories',
  'AI & Automation',
  'Energy & Resources',
  'Real Estate & Housing',
  'Food & Agriculture',
  'Travel & Transportation',
  'Mental Health & Wellness',
] as const
export const IMPACT_LEVELS = ['Low', 'Medium', 'High'] as const

export interface CaptionFields {
  reason: string
  category: string
  impactLevel: string
  source: string
}

export function buildCaption(fields: CaptionFields): string {
  return [
    fields.reason.trim(),
    fields.category ? `Category: ${fields.category}` : '',
    fields.impactLevel ? `Impact: ${fields.impactLevel}` : '',
    fields.source.trim() ? `Source: ${fields.source.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' • ')
}

export function parseCaption(caption: string | null): CaptionFields {
  const fields: CaptionFields = { reason: '', category: '', impactLevel: '', source: '' }
  if (!caption) return fields

  const leftover: string[] = []
  for (const part of caption.split(' • ')) {
    const match = part.match(/^(Category|Impact|Source):\s*(.*)$/i)
    if (!match) {
      leftover.push(part)
      continue
    }
    const value = match[2].trim()
    const key = match[1].toLowerCase()
    if (key === 'category') fields.category = value
    else if (key === 'impact') fields.impactLevel = value
    else fields.source = value
  }
  fields.reason = leftover.join(' • ').trim()
  return fields
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function StatusPill({ status }: { status: string }) {
  const label =
    status === 'analysed' ? 'AI Analysed' : status === 'community_only' ? 'Community Only' : 'Pending AI'
  const tone =
    status === 'analysed'
      ? 'bg-brand/10 text-brand'
      : status === 'community_only'
        ? 'bg-risk-med/15 text-risk-med'
        : 'bg-highlight/20 text-ink'
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
}

export function ImpactStars({ value, inline }: { value: number | null; inline?: boolean }) {
  if (value == null) return <span className="text-ink-faint">{inline ? 'impact —' : 'No impact yet'}</span>
  const rounded = Math.round(value)
  const stars = '★'.repeat(rounded) + '☆'.repeat(Math.max(0, 5 - rounded))
  return (
    <span className="text-highlight" title={`Weighted impact ${value.toFixed(1)} / 5`}>
      {inline ? `impact ${stars}` : stars}
    </span>
  )
}
