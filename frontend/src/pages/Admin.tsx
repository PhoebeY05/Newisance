import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../context/AuthContext'
import {
  CATEGORIES,
  buildCaption,
  isMediaPath,
  parseCaption,
  previewContent,
  timeAgo,
} from '../lib/community'
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  TYPE_LABEL,
  type AdminAppeal,
  type AdminQuestion,
  type AdminQuestionFeed,
  type BulkImportResult,
  type Difficulty,
  type QuestionType,
} from '../types/admin'
import type { ContentType, SubmissionDetail, SubmissionFeed, SubmissionOut } from '../types/community'

const PAGE_SIZE = 20
const COMMUNITY_PAGE_SIZE = 20
type AdminTab = 'questions' | 'community'

/**
 * Admin — question library manager (Phase 9). Admins only (non-admins are
 * redirected home). Searchable/filterable table, a create/edit drawer with an
 * AI "Generate Explanation" button, and CSV bulk import with a preview.
 */
export default function Admin() {
  const apiFetch = useApi()
  const { user, loading } = useAuth()

  const [feed, setFeed] = useState<AdminQuestionFeed | null>(null)
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AdminQuestion | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [appeals, setAppeals] = useState<AdminAppeal[]>([])
  const [activeTab, setActiveTab] = useState<AdminTab>('questions')

  const load = useCallback(async () => {
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
      if (type) params.set('type', type)
      if (difficulty) params.set('difficulty', difficulty)
      if (search.trim()) params.set('search', search.trim())
      const res = await apiFetch(`/api/game/admin/questions?${params}`)
      setFeed((await res.json()) as AdminQuestionFeed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load questions.')
    }
  }, [apiFetch, page, type, difficulty, search])

  const loadAppeals = useCallback(async () => {
    try {
      const res = await apiFetch('/api/game/admin/appeals')
      setAppeals((await res.json()) as AdminAppeal[])
    } catch {
      setAppeals([])
    }
  }, [apiFetch])

  useEffect(() => {
    if (user?.is_admin) {
      void load()
      void loadAppeals()
    }
  }, [user, load, loadAppeals])

  if (loading) return <p className="px-6 py-16 text-center text-ink-soft">Loading…</p>
  if (!user?.is_admin) return <Navigate to="/" replace />

  const totalPages = feed ? Math.max(1, Math.ceil(feed.total / feed.page_size)) : 1

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-card sm:text-4xl">Admin Management</h1>
          <p className="mt-2 text-ink-soft">Manage game questions and community verification posts.</p>
        </div>
        {activeTab === 'questions' && <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-bold text-ink transition hover:bg-bg"
          >
            ⬆ Import CSV
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light"
          >
            + New Question
          </button>
        </div>}
      </header>

      <AppealsPanel appeals={appeals} onChanged={() => void loadAppeals()} />

      <div className="mt-6 flex flex-wrap gap-2 border-b border-black/10">
        <AdminTabButton active={activeTab === 'questions'} onClick={() => setActiveTab('questions')}>
          Questions
        </AdminTabButton>
        <AdminTabButton active={activeTab === 'community'} onClick={() => setActiveTab('community')}>
          Community Feeds
        </AdminTabButton>
      </div>

      {activeTab === 'questions' ? (
        <>
      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => {
            setPage(1)
            setSearch(e.target.value)
          }}
          placeholder="Search content…"
          className="min-w-[14rem] flex-1 rounded-xl border border-black/10 bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <select
          value={type}
          onChange={(e) => {
            setPage(1)
            setType(e.target.value)
          }}
          className="rounded-xl border border-black/10 bg-surface px-4 py-2.5 text-sm font-medium text-ink"
        >
          <option value="">All types</option>
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          value={difficulty}
          onChange={(e) => {
            setPage(1)
            setDifficulty(e.target.value)
          }}
          className="rounded-xl border border-black/10 bg-surface px-4 py-2.5 text-sm font-medium text-ink"
        >
          <option value="">All difficulties</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{error}</p>}

      {/* Table */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-black/5 bg-surface shadow-sm">
        <div className="grid grid-cols-[1fr_8rem_6rem_5rem] gap-3 border-b border-black/5 px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-soft sm:grid-cols-[1fr_10rem_7rem_6rem_7rem]">
          <span>Content</span>
          <span>Type</span>
          <span>Difficulty</span>
          <span className="hidden sm:block">Status</span>
          <span className="text-right">Actions</span>
        </div>

        {feed === null ? (
          <p className="px-5 py-8 text-sm text-ink-soft">Loading…</p>
        ) : feed.items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft">No questions match these filters.</p>
        ) : (
          feed.items.map((q) => (
            <div
              key={q.id}
              className="grid grid-cols-[1fr_8rem_6rem_5rem] items-center gap-3 border-b border-black/5 px-5 py-3 text-sm last:border-0 sm:grid-cols-[1fr_10rem_7rem_6rem_7rem]"
            >
              <span className="min-w-0">
                <span className="line-clamp-2 font-medium text-card">{q.content}</span>
                {q.tags.length > 0 && (
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">{q.tags.join(' · ')}</span>
                )}
              </span>
              <span className="text-ink-soft">{TYPE_LABEL[q.type] ?? q.type}</span>
              <span className="capitalize text-ink-soft">{q.difficulty ?? '—'}</span>
              <span className="hidden sm:block">
                {q.is_active ? (
                  <span className="rounded-full bg-risk-low/15 px-2 py-0.5 text-xs font-bold text-risk-low">Active</span>
                ) : (
                  <span className="rounded-full bg-ink-faint/15 px-2 py-0.5 text-xs font-bold text-ink-soft">Inactive</span>
                )}
              </span>
              <span className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(q)}
                  className="rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1 text-xs font-bold text-brand transition hover:bg-brand/10"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(q.id)}
                  className="rounded-lg border border-risk-critical/30 bg-risk-critical/5 px-2.5 py-1 text-xs font-bold text-risk-critical transition hover:bg-risk-critical/10"
                >
                  Delete
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {feed && feed.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
          <span>
            {feed.total} question{feed.total === 1 ? '' : 's'} · page {page} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
        </>
      ) : (
        <CommunityFeedManager />
      )}

      {editing && (
        <QuestionDrawer
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
      {importing && (
        <CsvImport
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false)
            void load()
          }}
        />
      )}
    </div>
  )

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this question permanently? This cannot be undone.')) return
    try {
      await apiFetch(`/api/game/admin/questions/${id}`, { method: 'DELETE' })
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }
}

function AdminTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-3 text-sm font-bold transition ${
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-ink-soft hover:border-black/20 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'url', label: 'URL' },
  { value: 'image', label: 'Image' },
]

const IMPACT_LEVELS = ['Low', 'Medium', 'High']

function CommunityFeedManager() {
  const apiFetch = useApi()
  const [feed, setFeed] = useState<SubmissionFeed | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<SubmissionOut | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(COMMUNITY_PAGE_SIZE) })
      const response = await apiFetch(`/api/community/submissions?${params}`)
      setFeed((await response.json()) as SubmissionFeed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load community feed.')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, page])

  useEffect(() => {
    void load()
  }, [load])

  const filteredItems = (feed?.items ?? []).filter((submission) => {
    const meta = parseCaption(submission.caption)
    const haystack = [
      submission.id,
      submission.content_type,
      submission.content_url,
      submission.status,
      meta.reason,
      meta.category,
      meta.source,
    ]
      .join(' ')
      .toLowerCase()
    return (!status || submission.status === status) && (!search.trim() || haystack.includes(search.trim().toLowerCase()))
  })
  const totalPages = feed ? Math.max(1, Math.ceil(feed.total / feed.page_size)) : 1

  async function deleteSubmission(id: number) {
    if (!window.confirm('Delete this community post? Votes, comments, and AI analysis will also be removed.')) return
    try {
      await apiFetch(`/api/community/submissions/${id}`, { method: 'DELETE' })
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-extrabold text-card">Community Feeds</h2>
          <p className="mt-1 text-sm text-ink-soft">View, update, and remove verification feed submissions.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-bold text-ink transition hover:bg-bg"
        >
          Refresh
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search feed content, source, category..."
          className="min-w-[14rem] flex-1 rounded-xl border border-black/10 bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-xl border border-black/10 bg-surface px-4 py-2.5 text-sm font-medium text-ink"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="analysed">Analysed</option>
          <option value="community_only">Community only</option>
        </select>
      </div>

      {error && <p className="mt-4 rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-3xl border border-black/5 bg-surface shadow-sm">
        <div className="grid grid-cols-[1fr_7rem_7rem_7rem] gap-3 border-b border-black/5 px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-soft lg:grid-cols-[1fr_8rem_8rem_7rem_8rem]">
          <span>Submission</span>
          <span>Type</span>
          <span>Status</span>
          <span className="hidden lg:block">Votes</span>
          <span className="text-right">Actions</span>
        </div>

        {loading && feed === null ? (
          <p className="px-5 py-8 text-sm text-ink-soft">Loading community posts...</p>
        ) : filteredItems.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft">No community posts match these filters.</p>
        ) : (
          filteredItems.map((submission) => {
            const meta = parseCaption(submission.caption)
            const title = meta.reason || previewContent(submission)
            return (
              <div
                key={submission.id}
                className="grid grid-cols-[1fr_7rem_7rem_7rem] items-center gap-3 border-b border-black/5 px-5 py-3 text-sm last:border-0 lg:grid-cols-[1fr_8rem_8rem_7rem_8rem]"
              >
                <span className="min-w-0">
                  <span className="line-clamp-2 font-medium text-card">#{submission.id} {title}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">
                    {meta.category || 'Uncategorised'} · {timeAgo(submission.created_at)}
                  </span>
                </span>
                <span className="capitalize text-ink-soft">{submission.content_type}</span>
                <span>
                  <CommunityStatusPill status={submission.status} />
                </span>
                <span className="hidden text-ink-soft lg:block">{submission.vote_count}</span>
                <span className="flex justify-end gap-2">
                  <Link
                    to={`/community/post/${submission.id}`}
                    className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-bold text-ink transition hover:bg-bg"
                  >
                    View
                  </Link>
                  <button
                    type="button"
                    onClick={() => setEditing(submission)}
                    className="rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1 text-xs font-bold text-brand transition hover:bg-brand/10"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSubmission(submission.id)}
                    className="rounded-lg border border-risk-critical/30 bg-risk-critical/5 px-2.5 py-1 text-xs font-bold text-risk-critical transition hover:bg-risk-critical/10"
                  >
                    Delete
                  </button>
                </span>
              </div>
            )
          })
        )}
      </div>

      {feed && feed.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
          <span>
            {feed.total} post{feed.total === 1 ? '' : 's'} · page {page} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="rounded-lg border border-black/10 px-3 py-1.5 font-semibold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {editing && (
        <CommunitySubmissionDrawer
          submission={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </section>
  )
}

function CommunityStatusPill({ status }: { status: string }) {
  const tone =
    status === 'analysed'
      ? 'bg-risk-low/15 text-risk-low'
      : status === 'community_only'
        ? 'bg-risk-med/15 text-risk-med'
        : 'bg-highlight/20 text-ink'
  const label = status === 'community_only' ? 'Community' : status
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${tone}`}>{label}</span>
}

function CommunitySubmissionDrawer({
  submission,
  onClose,
  onSaved,
}: {
  submission: SubmissionOut
  onClose: () => void
  onSaved: (submission: SubmissionDetail) => void
}) {
  const apiFetch = useApi()
  const parsed = parseCaption(submission.caption)
  const initialType = CONTENT_TYPES.some((option) => option.value === submission.content_type)
    ? (submission.content_type as ContentType)
    : 'text'
  const [contentType, setContentType] = useState<ContentType>(initialType)
  const [content, setContent] = useState(isMediaPath(submission.content_url) ? '' : submission.content_url)
  const [file, setFile] = useState<File | null>(null)
  const [reason, setReason] = useState(parsed.reason)
  const [category, setCategory] = useState(parsed.category)
  const [impactLevel, setImpactLevel] = useState(parsed.impactLevel)
  const [source, setSource] = useState(parsed.source)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const keepingExistingImage = contentType === 'image' && isMediaPath(submission.content_url)

  async function save() {
    if (!reason.trim()) {
      setError('Add a short reason or title for this community post.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        content_type: contentType,
        caption: buildCaption({ reason, category, impactLevel, source }),
      }

      if (contentType === 'image') {
        if (file) {
          body.content = await fileToBase64(file)
        } else if (!keepingExistingImage) {
          setError('Choose an image to upload.')
          setSaving(false)
          return
        }
      } else {
        if (!content.trim()) {
          setError('Content cannot be empty.')
          setSaving(false)
          return
        }
        body.content = content.trim()
      }

      const response = await apiFetch(`/api/community/submissions/${submission.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      onSaved((await response.json()) as SubmissionDetail)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <Drawer title={`Edit Community Post #${submission.id}`} onClose={onClose}>
      <div className="rounded-2xl bg-bg p-4 text-sm text-ink-soft">
        <p>
          Status: <span className="font-semibold text-card">{submission.status}</span> · Votes:{' '}
          <span className="font-semibold text-card">{submission.vote_count}</span>
        </p>
        <p className="mt-1 truncate">Current content: {previewContent(submission)}</p>
      </div>

      {error && <p className="rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{error}</p>}

      <div>
        <span className="text-sm font-semibold text-card">Content type</span>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {CONTENT_TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setContentType(option.value)
                setFile(null)
              }}
              aria-pressed={contentType === option.value}
              className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
                contentType === option.value
                  ? 'border-brand bg-brand/5 text-brand ring-2 ring-brand/15'
                  : 'border-black/10 text-ink hover:border-brand/40'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {contentType === 'image' ? (
        <label className="block">
          <span className="text-sm font-semibold text-card">Image</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          {keepingExistingImage && !file && (
            <p className="mt-1 text-xs text-ink-faint">Current image will be kept unless you choose a replacement.</p>
          )}
        </label>
      ) : (
        <label className="block">
          <span className="text-sm font-semibold text-card">{contentType === 'url' ? 'URL' : 'Text content'}</span>
          <textarea
            rows={contentType === 'url' ? 2 : 5}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className={`${inputClass} resize-none`}
          />
        </label>
      )}

      <label className="block">
        <span className="text-sm font-semibold text-card">Reason / title</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={`${inputClass} resize-none`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-card">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>
            <option value="">Uncategorised</option>
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-card">Impact</span>
          <select value={impactLevel} onChange={(event) => setImpactLevel(event.target.value)} className={inputClass}>
            <option value="">Not set</option>
            {IMPACT_LEVELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-card">Source</span>
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className={inputClass}
          placeholder="Source URL, sender, or context"
        />
      </label>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <Link
          to={`/community/post/${submission.id}`}
          className="rounded-xl border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-bg"
        >
          View Post
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-bg"
        >
          Cancel
        </button>
      </div>
    </Drawer>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

const inputClass =
  'mt-1.5 w-full rounded-xl border border-black/10 bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

function AppealsPanel({ appeals, onChanged }: { appeals: AdminAppeal[]; onChanged: () => void }) {
  const apiFetch = useApi()
  const navigate = useNavigate()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')

  async function resolve(id: number, action: 'uphold' | 'overturn') {
    setBusyId(id)
    setError('')
    try {
      await apiFetch(`/api/game/admin/appeals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update appeal.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-black/5 bg-surface p-5 shadow-sm">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-extrabold text-card">Appeals</h2>
          <p className="mt-1 text-sm text-ink-soft">Pending manual reviews for disputed community verdicts.</p>
        </div>
        <span className="rounded-full bg-bg px-3 py-1 text-xs font-bold text-ink-soft">
          {appeals.length} pending
        </span>
      </div>
      {error && <p className="mt-4 rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{error}</p>}
      {appeals.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-bg p-4 text-sm text-ink-soft">No pending appeals.</p>
      ) : (
        <div className="mt-5 divide-y divide-black/5 overflow-hidden rounded-2xl border border-black/5">
          {appeals.map((appeal) => (
            <div
              key={appeal.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/community/post/${appeal.submission_id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  navigate(`/community/post/${appeal.submission_id}`)
                }
              }}
              title="Open submission for review"
              className="grid cursor-pointer gap-3 bg-white p-4 text-sm transition hover:bg-bg lg:grid-cols-[1fr_9rem_8rem_13rem] lg:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-card">{appeal.submission_title}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Submitter: {appeal.submitter_name ?? 'Unknown'} · Appealed {new Date(appeal.appealed_at).toLocaleString()}
                </p>
              </div>
              <span className="text-ink-soft">AI: {appeal.ai_verdict ?? 'none'}</span>
              <span className="text-ink-soft">
                {appeal.real_votes} real / {appeal.fake_votes} fake
              </span>
              <div className="flex gap-2 lg:justify-end">
                <button
                  type="button"
                  disabled={busyId === appeal.id}
                  onClick={(event) => {
                    event.stopPropagation()
                    void resolve(appeal.id, 'uphold')
                  }}
                  className="rounded-lg border border-black/10 px-3 py-2 text-xs font-bold text-ink transition hover:bg-bg disabled:opacity-60"
                >
                  Uphold Verdict
                </button>
                <button
                  type="button"
                  disabled={busyId === appeal.id}
                  onClick={(event) => {
                    event.stopPropagation()
                    void resolve(appeal.id, 'overturn')
                  }}
                  className="rounded-lg bg-risk-critical px-3 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  Overturn Verdict
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function QuestionDrawer({
  question,
  onClose,
  onSaved,
}: {
  question: AdminQuestion | null
  onClose: () => void
  onSaved: () => void
}) {
  const apiFetch = useApi()
  const isEdit = question !== null
  const [content, setContent] = useState(question?.content ?? '')
  const [type, setType] = useState<QuestionType>((question?.type as QuestionType) ?? 'scam_message')
  const [correct, setCorrect] = useState(question?.correct_answer ?? '')
  const [difficulty, setDifficulty] = useState<Difficulty>((question?.difficulty as Difficulty) ?? 'medium')
  const [tags, setTags] = useState(question?.tags.join(', ') ?? '')
  const [explanation, setExplanation] = useState(question?.explanation ?? '')
  const [media, setMedia] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function generate() {
    if (!content.trim() || !correct.trim()) {
      setErr('Fill in content and the correct answer first.')
      return
    }
    setGenerating(true)
    setErr('')
    try {
      const res = await apiFetch('/api/game/admin/questions/generate-explanation', {
        method: 'POST',
        body: JSON.stringify({ content: content.trim(), correct_answer: correct.trim() }),
      })
      const data = (await res.json()) as { explanation: string }
      setExplanation(data.explanation)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not generate an explanation.')
    } finally {
      setGenerating(false)
    }
  }

  async function save() {
    if (!content.trim() || !correct.trim()) {
      setErr('Content and correct answer are required.')
      return
    }
    setSaving(true)
    setErr('')
    const body: Record<string, unknown> = {
      content: content.trim(),
      type,
      correct_answer: correct.trim(),
      explanation: explanation.trim() || null,
      difficulty,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    }
    if (media) body.media = media
    try {
      if (isEdit) {
        await apiFetch(`/api/game/admin/questions/${question.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch('/api/game/admin/questions', { method: 'POST', body: JSON.stringify(body) })
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <Drawer title={isEdit ? 'Edit Question' : 'New Question'} onClose={onClose}>
      {err && <p className="rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{err}</p>}

      <label className="block">
        <span className="text-sm font-semibold text-card">Content*</span>
        <textarea
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="The headline / message / claim shown to players…"
          className={`${inputClass} resize-none`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-card">Type*</span>
          <select value={type} onChange={(e) => setType(e.target.value as QuestionType)} className={inputClass}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-card">Difficulty</span>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className={inputClass}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-card">Correct answer*</span>
          <input
            value={correct}
            onChange={(e) => setCorrect(e.target.value)}
            placeholder="Fake / Real / Scam / Satire…"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-card">Tags</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma, separated"
            className={inputClass}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-card">Image / Video (optional)</span>
        <input
          type="file"
          accept="image/*,video/*"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            setMedia(f ? await fileToBase64(f) : null)
          }}
          className="mt-1.5 block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        {isEdit && question.media_url && !media && (
          <p className="mt-1 text-xs text-ink-faint">Current: {question.media_url} (choose a file to replace)</p>
        )}
      </label>

      <label className="block">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-card">Explanation</span>
          <button
            type="button"
            disabled={generating}
            onClick={() => void generate()}
            className="rounded-lg bg-secondary/15 px-3 py-1 text-xs font-bold text-secondary transition hover:bg-secondary/25 disabled:opacity-60"
          >
            {generating ? 'Generating…' : '✨ Generate Explanation'}
          </button>
        </div>
        <textarea
          rows={3}
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder="Why is this the answer? (shown after each round)"
          className={`${inputClass} resize-none`}
        />
      </label>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light disabled:opacity-60"
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Question'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-bg"
        >
          Cancel
        </button>
      </div>
    </Drawer>
  )
}

function CsvImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const apiFetch = useApi()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string[][]>([])
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function pick(f: File | null) {
    setFile(f)
    setResult(null)
    setPreview([])
    if (!f) return
    const text = await f.text()
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(0, 6)
      .map((line) => line.split(','))
    setPreview(rows)
  }

  async function upload() {
    if (!file) return
    setBusy(true)
    setErr('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch('/api/game/admin/questions/bulk-import', { method: 'POST', body: form })
      setResult((await res.json()) as BulkImportResult)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer title="Bulk Import (CSV)" onClose={onClose}>
      <p className="text-sm text-ink-soft">
        Columns: <code className="rounded bg-bg px-1">content, type, correct_answer, explanation, difficulty, tags</code>.
        Use <code className="rounded bg-bg px-1">;</code> to separate multiple tags.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => void pick(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
      />

      {err && <p className="rounded-xl bg-risk-high/10 px-4 py-3 text-sm text-risk-high">{err}</p>}

      {preview.length > 0 && !result && (
        <div className="overflow-x-auto rounded-2xl border border-black/5">
          <table className="w-full text-left text-xs">
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className={i === 0 ? 'bg-bg font-bold text-card' : 'border-t border-black/5 text-ink-soft'}>
                  {row.map((cell, j) => (
                    <td key={j} className="max-w-[12rem] truncate px-3 py-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result ? (
        <div className="rounded-2xl bg-bg p-4 text-sm">
          <p className="font-bold text-risk-low">✅ Imported {result.imported} question(s).</p>
          {result.errors.length > 0 && (
            <div className="mt-2">
              <p className="font-semibold text-risk-high">{result.errors.length} row(s) skipped:</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={onDone}
            className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => void upload()}
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-light disabled:opacity-60"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-bg"
          >
            Cancel
          </button>
        </div>
      )}
    </Drawer>
  )
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-extrabold text-card">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full bg-bg text-ink-soft transition hover:bg-black/5"
          >
            ✕
          </button>
        </div>
        <div className="mt-6 space-y-5">{children}</div>
      </div>
    </div>
  )
}
