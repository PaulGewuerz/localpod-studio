'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { startTour } from '@/lib/tour'
import AdsView from './AdsView'

const API_URL = process.env.NEXT_PUBLIC_API_URL

// ─── Types ────────────────────────────────────────────────────────────────────

interface Voice {
  id: string
  name: string
  elevenLabsId: string
  description: string | null
  previewUrl: string | null
}

interface Episode {
  id: string
  title: string
  status: string
  audioUrl: string | null
  publishedUrl: string | null
  megaphoneEpisodeId: string | null
  characterCount: number | null
  scheduledAt: string | null
  createdAt: string
  voice: { name: string } | null
  source?: 'megaphone'
}


interface ShowData {
  id: string
  name: string
  description: string | null
  coverArtUrl: string | null
  megaphoneShowId: string | null
  megaphoneRssUrl: string | null
  feedUrl: string | null
  sourceType: string | null
  sourceConfig: { linkSelector?: string | null } | null
  automationEnabled: boolean
  automationVoiceId: string | null
  automationIntervalDays: number | null
  automationStartAt: string | null
  automationAdSelections: AutomationAdSelections | null
}

interface AutomationAdSelections {
  preRollCampaignId: string | null
  postRollCampaignId: string | null
  midRollCampaignIds: string[]
}

interface AdCampaignLite {
  id: string
  name: string
  type: string
  status: string
  audioUrl: string | null
}

interface MeData {
  user: { id: string; email: string; name: string | null; onboardedAt: string | null }
  org: { id: string; name: string; defaultVoice: Voice | null }
  shows: ShowData[]
  subscription: { stripeCustomerId: string | null; status: string; plan: string | null; trialEndsAt: string | null; cancelAtPeriodEnd?: boolean; cancelAt?: string | null } | null
}

type NavKey = 'dashboard' | 'new' | 'episodes' | 'analytics' | 'billing' | 'shows' | 'dist' | 'settings' | 'ads'
type NewEpStage = 'form' | 'processing'

const NAV_TITLES: Record<NavKey, string> = {
  dashboard: 'Dashboard', new: 'New Episode', episodes: 'Episodes',
  analytics: 'Analytics', billing: 'Billing', shows: 'Shows',
  dist: 'Distribution', settings: 'Settings', ads: 'Ad Manager',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Per-plan cap on podcast feeds (shows). Solo = 1, everything else gets the
// Publisher allowance of 3 (same fail-open convention as the backend: unknown/
// null plans are NOT downgraded). This is a UI hint only — the real cap is
// enforced server-side by showLimitForPlan in backend/src/utils/planLimits.js
// (the single source of truth). Keep this in sync with that file if the limits
// change; the backend is authoritative.
function showLimitForPlan(plan: string | null | undefined): number {
  return plan === 'solo' ? 1 : 3
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  return session.access_token
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// <input type="datetime-local"> works in local time with a "YYYY-MM-DDTHH:mm" value.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function EmbedCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="absolute top-2 right-2 px-3 py-1 text-[11px] font-[family-name:var(--font-dm-mono)] bg-white border border-[var(--rule)] rounded-[3px] text-[var(--ink-light)] hover:text-[var(--ink)] transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    published: { cls: 'bg-[var(--green-light)] text-[var(--green)]', label: 'Live' },
    scheduled:  { cls: 'bg-[var(--blue-light)] text-[var(--blue)]',  label: 'Scheduled' },
    draft:      { cls: 'bg-[var(--bg-warm)] text-[var(--ink-faint)]', label: 'Draft' },
    pending:    { cls: 'bg-[var(--gold-light)] text-[var(--gold)]',   label: 'Processing' },
  }
  const { cls, label } = map[status] ?? { cls: 'bg-[var(--bg-warm)] text-[var(--ink-faint)]', label: status }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[10px] font-medium font-[family-name:var(--font-dm-mono)] uppercase tracking-[0.04em] ${cls}`}>
      <span className="w-[5px] h-[5px] rounded-full bg-current inline-block" />
      {label}
    </span>
  )
}

// ─── Episode Table ─────────────────────────────────────────────────────────────

function EpisodeTable({ episodes, onNew, onDelete }: {
  episodes: Episode[]
  onNew?: () => void
  onDelete?: (ids: string[]) => Promise<void>
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const allSelected = episodes.length > 0 && selected.size === episodes.length

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(episodes.map(e => e.id)))
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleDelete() {
    if (!onDelete || selected.size === 0) return
    const count = selected.size
    if (!window.confirm(`Delete ${count} episode${count > 1 ? 's' : ''}? This cannot be undone.`)) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete([...selected])
      setSelected(new Set())
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  if (episodes.length === 0) {
    return (
      <div className="bg-white border border-[var(--rule)] rounded-[2px] p-10 text-center">
        <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">No episodes yet.</p>
        {onNew && (
          <button onClick={onNew} className="mt-4 px-4 py-2 bg-[var(--ink)] text-white text-sm font-semibold rounded-[2px] hover:bg-[#2a2825] transition-colors">
            + New Episode
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      {deleteError && (
        <p className="text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)] mb-2">{deleteError}</p>
      )}
      {onDelete && selected.size > 0 && (
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
            {selected.size} selected
          </span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1 text-[12px] font-medium text-white bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 rounded-[2px] transition-opacity"
          >
            {deleting ? 'Deleting…' : `Delete ${selected.size}`}
          </button>
        </div>
      )}
      <table className="w-full border-collapse bg-white border border-[var(--rule)] rounded-[2px]">
        <thead>
          <tr>
            {onDelete && (
              <th className="w-8 px-3 py-2.5 border-b border-[var(--rule)] bg-[var(--bg-warm)]">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" />
              </th>
            )}
            {(['Episode', 'Date', 'Voice', 'Status', ''] as const).map(h => (
              <th key={h} className={`text-left px-4 py-2.5 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] font-normal border-b border-[var(--rule)] bg-[var(--bg-warm)]${h === 'Date' || h === 'Voice' ? ' hidden sm:table-cell' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {episodes.map(ep => (
            <tr key={ep.id} className="hover:bg-[var(--bg)] group">
              {onDelete && (
                <td className="w-8 px-3 py-3 border-b border-[var(--rule)]">
                  {ep.source !== 'megaphone' && (
                    <input type="checkbox" checked={selected.has(ep.id)} onChange={() => toggle(ep.id)} className="cursor-pointer" />
                  )}
                </td>
              )}
              <td className="px-4 py-3 border-b border-[var(--rule)]">
                {ep.source === 'megaphone' ? (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[13px] text-[var(--ink)]">{ep.title}</span>
                    <span className="text-[10px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] bg-[var(--bg-warm)] px-1.5 py-0.5 rounded-[2px]">imported</span>
                  </div>
                ) : (
                  <a href={`/episodes/${ep.id}/review`} className="font-medium text-[13px] text-[var(--ink)] hover:text-[var(--accent)] transition-colors">{ep.title}</a>
                )}
              </td>
              <td className="hidden sm:table-cell px-4 py-3 border-b border-[var(--rule)] text-[12px] text-[var(--ink-light)] font-[family-name:var(--font-dm-mono)]">
                {ep.status === 'draft' ? '—' : ep.scheduledAt ? fmtDate(ep.scheduledAt) : fmtDate(ep.createdAt)}
              </td>
              <td className="hidden sm:table-cell px-4 py-3 border-b border-[var(--rule)] text-[12px] text-[var(--ink-light)] font-[family-name:var(--font-dm-mono)]">
                {ep.voice?.name ?? '—'}
              </td>
              <td className="px-4 py-3 border-b border-[var(--rule)]">
                <StatusBadge status={ep.status} />
                {ep.status === 'scheduled' && ep.scheduledAt && (
                  <div className="text-[10px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-0.5">
                    {new Date(ep.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                    {new Date(ep.scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 border-b border-[var(--rule)]">
                <div className="flex items-center gap-3">
                  {(ep.status === 'published' || ep.status === 'scheduled') && ep.publishedUrl && (
                    <a
                      href={ep.publishedUrl}
                      target="_blank" rel="noreferrer"
                      className="text-[12px] text-[var(--ink-faint)] hover:text-[var(--accent)] transition-colors"
                    >
                      View ↗
                    </a>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Analytics View ────────────────────────────────────────────────────────────

function AnalyticsView({ showId }: { showId: string | null }) {
  const [data, setData] = useState<{
    available: boolean
    reason?: string
    totalDownloads?: number
    episodes?: { id: string | null; megaphoneId: string; title: string; pubdate: string; duration: number; downloads: number }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const token = await getToken()
        const url = showId ? `${API_URL}/analytics?showId=${showId}` : `${API_URL}/analytics`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        setData(await res.json())
      } catch {
        setData({ available: false, reason: 'Failed to load analytics.' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [showId])

  if (loading) return <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">Loading analytics…</p>

  if (!data?.available) {
    return (
      <div className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-[13px] py-10">
        {data?.reason ?? 'Analytics unavailable.'}
      </div>
    )
  }

  const episodes = data.episodes ?? []
  const hasDownloadData = (data.totalDownloads ?? 0) > 0 || episodes.some(e => e.downloads > 0)
  const maxDownloads = Math.max(...episodes.map(e => e.downloads), 1)

  return (
    <div>
      {/* Stat cards */}
      {hasDownloadData && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white border border-[var(--rule)] rounded-[2px] p-5">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">Total Downloads</div>
            <div className="font-[family-name:var(--font-nunito)] text-[28px] font-bold leading-none my-1.5 text-[var(--ink)]">
              {(data.totalDownloads ?? 0).toLocaleString()}
            </div>
            <div className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">All time</div>
          </div>
          <div className="bg-white border border-[var(--rule)] rounded-[2px] p-5">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">Episodes</div>
            <div className="font-[family-name:var(--font-nunito)] text-[28px] font-bold leading-none my-1.5 text-[var(--ink)]">{episodes.length}</div>
            <div className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Published</div>
          </div>
          <div className="bg-white border border-[var(--rule)] rounded-[2px] p-5">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">Avg Downloads</div>
            <div className="font-[family-name:var(--font-nunito)] text-[28px] font-bold leading-none my-1.5 text-[var(--ink)]">
              {episodes.length ? Math.round((data.totalDownloads ?? 0) / episodes.length).toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Per episode</div>
          </div>
        </div>
      )}

      {/* Episode breakdown */}
      <div className="bg-white border border-[var(--rule)] rounded-[2px]">
        <div className="px-5 py-4 border-b border-[var(--rule)] flex items-baseline justify-between">
          <span className="font-[family-name:var(--font-nunito)] font-bold text-[14px] text-[var(--ink)]">
            {hasDownloadData ? 'Downloads by Episode' : 'Episodes'}
          </span>
          {!hasDownloadData && (
            <button
              onClick={async () => {
                setRequesting(true)
                try {
                  const token = await getToken()
                  await fetch(`${API_URL}/analytics/request-report`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ showId }),
                  })
                  setRequested(true)
                } finally {
                  setRequesting(false)
                }
              }}
              disabled={requesting || requested}
              className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--accent)] hover:opacity-70 disabled:opacity-50 transition-opacity"
            >
              {requested ? 'Request sent ✓' : requesting ? 'Sending…' : 'Request analytics report'}
            </button>
          )}
        </div>
        {episodes.length === 0 ? (
          <p className="px-5 py-8 text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-[13px]">No episodes yet.</p>
        ) : (
          <div className="divide-y divide-[var(--rule)]">
            {episodes.map((ep, i) => {
              const inner = (
                <>
                  <div className="w-5 text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] shrink-0">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[var(--ink)] truncate">{ep.title}</div>
                    <div className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-0.5">
                      {ep.pubdate ? fmtDate(ep.pubdate) : '—'}
                    </div>
                    {hasDownloadData && (
                      <div className="mt-1.5 h-1.5 bg-[var(--bg-warm)] rounded-full overflow-hidden w-full max-w-xs">
                        <div
                          className="h-full bg-[var(--accent)] rounded-full"
                          style={{ width: `${(ep.downloads / maxDownloads) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {hasDownloadData && (
                    <div className="text-[13px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-light)] shrink-0">
                      {ep.downloads.toLocaleString()}
                    </div>
                  )}
                </>
              )
              return ep.id ? (
                <a key={ep.megaphoneId} href={`/episodes/${ep.id}/review`} className="px-5 py-3.5 flex items-center gap-4 hover:bg-[var(--bg)] transition-colors">
                  {inner}
                </a>
              ) : (
                <div key={ep.megaphoneId} className="px-5 py-3.5 flex items-center gap-4">
                  {inner}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

function StudioInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [me, setMe] = useState<MeData | null>(null)
  const [activeShowId, setActiveShowId] = useState<string | null>(null)
  const [newShowName, setNewShowName] = useState('')
  const [creatingShow, setCreatingShow] = useState(false)
  const [addShowError, setAddShowError] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard')
  const [voices, setVoices] = useState<Voice[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(true)
  const [episodeRefreshKey, setEpisodeRefreshKey] = useState(0)
  const [monthlyCharacters, setMonthlyCharacters] = useState(0)
  const [characterLimit, setCharacterLimit] = useState<number | null>(null)

  // New Episode form state
  const [epMode, setEpMode] = useState<'ai' | 'url' | 'upload'>('ai')
  const [urlInput, setUrlInput] = useState('')
  const [epTitle, setEpTitle] = useState('')
  const [selectedVoiceId, setSelectedVoiceId] = useState('')
  const [script, setScript] = useState('')
  const [showNotes, setShowNotes] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [newEpStage, setNewEpStage] = useState<NewEpStage>('form')
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [limitExceeded, setLimitExceeded] = useState(false)
  const [processingStep, setProcessingStep] = useState(0) // 0-3
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  // Mobile nav
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Billing
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)

  // Distribution

  // Settings
  const [settingsName, setSettingsName] = useState('')
  const [settingsDescription, setSettingsDescription] = useState('')
  const [settingsCoverFile, setSettingsCoverFile] = useState<File | null>(null)
  const [settingsCoverPreview, setSettingsCoverPreview] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsFeedUrl, setSettingsFeedUrl] = useState('')
  const [settingsSourceType, setSettingsSourceType] = useState<string | null>(null)
  const [settingsLinkSelector, setSettingsLinkSelector] = useState('')
  const [testingSource, setTestingSource] = useState(false)
  const [sourceTestResult, setSourceTestResult] = useState<{ ok: boolean; sourceType?: string; resolvedUrl?: string; itemCount?: number; sampleTitles?: string[]; error?: string } | null>(null)
  const [settingsAutomationEnabled, setSettingsAutomationEnabled] = useState(false)
  const [settingsAutomationVoiceId, setSettingsAutomationVoiceId] = useState('')
  const [settingsIntervalDays, setSettingsIntervalDays] = useState(1)
  const [settingsStartAt, setSettingsStartAt] = useState('')
  const [settingsPreRollId, setSettingsPreRollId] = useState('')
  const [settingsPostRollId, setSettingsPostRollId] = useState('')
  const [settingsMidRollIds, setSettingsMidRollIds] = useState<string[]>([])
  const [adCampaigns, setAdCampaigns] = useState<AdCampaignLite[]>([])
  const settingsCoverRef = useRef<HTMLInputElement>(null)
  const settingsDescriptionRef = useRef<HTMLDivElement>(null)

  // Voice preview
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)

  // New-user product tour
  const tourStartedRef = useRef(false)

const showNotesRef = useRef<HTMLDivElement>(null)
  const audioFileRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0

  async function handlePdfUpload(file: File) {
    setPdfLoading(true)
    setPdfError(null)
    try {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) =>
          pdf.getPage(i + 1).then(p => p.getTextContent()).then(tc =>
            tc.items.map((item) => ('str' in item ? item.str : '') ?? '').join(' ')
          )
        )
      )
      setScript(pages.join('\n\n').trim())
    } catch (err: unknown) {
      setPdfError(err instanceof Error ? err.message : 'Failed to extract PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  // ── Auth + initial data load ────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }

      const fromCheckout = searchParams.get('checkout') === 'success'
      const maxAttempts = fromCheckout ? 6 : 1
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

      try {
        let subscription = null
        let meData: MeData | null = null
        for (let i = 0; i < maxAttempts; i++) {
          if (i > 0) await delay(2000)
          const res = await fetch(`${API_URL}/me`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          if (!res.ok) { router.replace('/login'); return }
          meData = await res.json()
          subscription = meData!.subscription
          if (subscription?.stripeCustomerId) break
        }
        const activeStatuses = ['active', 'trial']
        // Card-on-file trials are converted/canceled by Stripe webhooks; only
        // card-less trials are locked out locally at expiry.
        const trialExpired = subscription?.status === 'trial' && !subscription.stripeCustomerId && !!subscription.trialEndsAt && new Date() > new Date(subscription.trialEndsAt)
        if (!subscription?.status || !activeStatuses.includes(subscription.status) || trialExpired) { router.replace('/onboarding'); return }

        setMe(meData)
        if (meData!.shows.length > 0) setActiveShowId(meData!.shows[0].id)
        if (meData!.org.defaultVoice) setSelectedVoiceId(meData!.org.defaultVoice.id)

        // Honor ?nav= query param (e.g. return from Stripe billing portal)
        const navParam = searchParams.get('nav') as NavKey | null
        const validNavKeys: NavKey[] = ['dashboard', 'new', 'episodes', 'analytics', 'billing', 'shows', 'dist', 'settings', 'ads']
        if (navParam && validNavKeys.includes(navParam)) setActiveNav(navParam)

        // Load voices
        const vRes = await fetch(`${API_URL}/voices`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (vRes.ok) setVoices(await vRes.json())
      } catch {
        router.replace('/login')
      }
    })
  }, [router, searchParams])

  // ── Load episodes ────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoadingEpisodes(true)
      try {
        const token = await getToken()
        const url = activeShowId
          ? `${API_URL}/episodes?showId=${activeShowId}`
          : `${API_URL}/episodes`
        const [epRes, usageRes] = await Promise.all([
          fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/episodes/usage`, { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (epRes.ok) setEpisodes(await epRes.json())
        if (usageRes.ok) {
          const data = await usageRes.json()
          setMonthlyCharacters(data.monthlyCharacters)
          if (typeof data.characterLimit === 'number') setCharacterLimit(data.characterLimit)
        }
      } catch { /* silent */ }
      finally { setLoadingEpisodes(false) }
    }
    load()
  }, [episodeRefreshKey, activeShowId])

  // ── New-user product tour ─────────────────────────────────────────────────────

  async function markOnboarded() {
    // Optimistically flip local state so the tour never re-triggers this session.
    setMe(prev => prev?.user && !prev.user.onboardedAt
      ? { ...prev, user: { ...prev.user, onboardedAt: new Date().toISOString() } }
      : prev)
    try {
      const token = await getToken()
      await fetch(`${API_URL}/me/onboarded`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch { /* best-effort: tour state is non-critical */ }
  }

  function launchTour() {
    startTour(() => markOnboarded())
  }

  // ── Create an additional show (podcast feed) ──────────────────────────────────
  async function createShow() {
    if (creatingShow) return
    setAddShowError(null)
    setCreatingShow(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/me/shows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newShowName.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      const show = data.show as ShowData
      // Append to local state and jump to the new show so the user can fill in
      // its details in Settings right away.
      setMe(prev => prev ? { ...prev, shows: [...prev.shows, show] } : prev)
      setActiveShowId(show.id)
      setNewShowName('')
      setActiveNav('settings')
    } catch (err) {
      setAddShowError(err instanceof Error ? err.message : 'Could not add show.')
    } finally {
      setCreatingShow(false)
    }
  }

  // Auto-launch once for users who haven't seen the tour yet.
  useEffect(() => {
    // Guard against an old backend that doesn't return `user` yet (deploy race).
    if (!me?.user || me.user.onboardedAt || tourStartedRef.current) return
    tourStartedRef.current = true
    // Let the sidebar/header tour targets paint first.
    const t = setTimeout(() => launchTour(), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  // ── Sync settings form from me when tab opens ────────────────────────────────

  useEffect(() => {
    const activeShow = me?.shows.find(s => s.id === activeShowId) ?? me?.shows[0] ?? null
    if (activeNav === 'settings' && activeShow) {
      setSettingsName(activeShow.name ?? '')
      const raw = activeShow.description ?? ''
      setSettingsDescription(raw)
      if (settingsDescriptionRef.current) settingsDescriptionRef.current.innerHTML = raw
      setSettingsCoverPreview(activeShow.coverArtUrl ?? null)
      setSettingsCoverFile(null)
      setSettingsFeedUrl(activeShow.feedUrl ?? '')
      setSettingsSourceType(activeShow.sourceType ?? null)
      setSettingsLinkSelector(activeShow.sourceConfig?.linkSelector ?? '')
      setSourceTestResult(null)
      setSettingsAutomationEnabled(activeShow.automationEnabled ?? false)
      setSettingsAutomationVoiceId(activeShow.automationVoiceId ?? '')
      setSettingsIntervalDays(activeShow.automationIntervalDays ?? 1)
      setSettingsStartAt(isoToLocalInput(activeShow.automationStartAt))
      setSettingsPreRollId(activeShow.automationAdSelections?.preRollCampaignId ?? '')
      setSettingsPostRollId(activeShow.automationAdSelections?.postRollCampaignId ?? '')
      setSettingsMidRollIds(activeShow.automationAdSelections?.midRollCampaignIds ?? [])
      setSettingsError(null)
      setSettingsSaved(false)
    }
  }, [activeNav, me, activeShowId])

  // Load active ad campaigns (with audio) for the automation ad selectors.
  useEffect(() => {
    if (activeNav !== 'settings') return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(`${API_URL}/ad-campaigns`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const all: AdCampaignLite[] = await res.json()
        if (!cancelled) setAdCampaigns(all.filter(c => c.status === 'active' && c.audioUrl))
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  }, [activeNav])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleDeleteEpisodes(ids: string[]) {
    const token = await getToken()
    const results = await Promise.all(ids.map(id =>
      fetch(`${API_URL}/episodes/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    ))
    const failed = results.filter(r => !r.ok)
    if (failed.length) throw new Error(`Failed to delete ${failed.length} episode(s)`)
    setEpisodeRefreshKey(k => k + 1)
  }

  async function handleGenerate() {
    if (!script.trim()) { setGenerateError('Please enter a script.'); return }
    if (!selectedVoiceId) { setGenerateError('Please select a voice.'); return }
    const voice = voices.find(v => v.id === selectedVoiceId)
    if (!voice) return

    setGenerateError(null)
    setLimitExceeded(false)
    setNewEpStage('processing')
    setProcessingStep(0)

    // Animate step progression while API runs
    const stepTimer1 = setTimeout(() => setProcessingStep(1), 600)
    const stepTimer2 = setTimeout(() => setProcessingStep(2), 1800)

    try {
      const token = await getToken()
      const genRes = await fetch(`${API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          articleText: script,
          voiceId: voice.elevenLabsId,
          title: epTitle || 'Untitled Episode',
          description: showNotes || undefined,
          showId: activeShowId || undefined,
        }),
      })

      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)

      if (genRes.status === 402) {
        setLimitExceeded(true)
        setNewEpStage('form')
        return
      }

      if (!genRes.ok) {
        const d = await genRes.json().catch(() => ({}))
        throw new Error(d.error || `Generate failed (${genRes.status})`)
      }

      const genData = await genRes.json()
      setEpisodeId(genData.episodeId)
      setAudioUrl(genData.audioUrl)
      setProcessingStep(3)

      router.push(`/episodes/${genData.episodeId}/review`)
    } catch (err: unknown) {
      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      setGenerateError(err instanceof Error ? err.message : 'Something went wrong.')
      setLimitExceeded(false)
      setNewEpStage('form')
    }
  }

  async function handleGenerateFromUrls() {
    const urls = urlInput.split(/[\s,]+/).map(u => u.trim()).filter(Boolean)
    if (urls.length === 0) { setGenerateError('Paste at least one article URL.'); return }
    if (!selectedVoiceId) { setGenerateError('Please select a voice.'); return }
    const voice = voices.find(v => v.id === selectedVoiceId)
    if (!voice) return

    setGenerateError(null)
    setLimitExceeded(false)
    setNewEpStage('processing')
    setProcessingStep(0)
    const stepTimer1 = setTimeout(() => setProcessingStep(1), 600)
    const stepTimer2 = setTimeout(() => setProcessingStep(2), 1800)

    try {
      const token = await getToken()
      const genRes = await fetch(`${API_URL}/generate/from-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          urls,
          voiceId: voice.elevenLabsId,
          title: epTitle || undefined,
          showId: activeShowId || undefined,
        }),
      })

      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)

      if (genRes.status === 402) {
        setLimitExceeded(true)
        setNewEpStage('form')
        return
      }
      if (!genRes.ok) {
        const d = await genRes.json().catch(() => ({}))
        throw new Error(d.error || `Generate failed (${genRes.status})`)
      }

      const genData = await genRes.json()
      setEpisodeId(genData.episodeId)
      setAudioUrl(genData.audioUrl)
      setProcessingStep(3)
      router.push(`/episodes/${genData.episodeId}/review`)
    } catch (err: unknown) {
      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      setGenerateError(err instanceof Error ? err.message : 'Something went wrong.')
      setLimitExceeded(false)
      setNewEpStage('form')
    }
  }

  async function handleUpload() {
    if (!uploadFile) { setGenerateError('Please select an audio file.'); return }
    setGenerateError(null)
    setNewEpStage('processing')
    setProcessingStep(0)

    try {
      const token = await getToken()
      const params = new URLSearchParams({ title: epTitle || 'Untitled Episode' })
      if (showNotes) params.set('description', showNotes)
      if (activeShowId) params.set('showId', activeShowId)

      setProcessingStep(1)
      const upRes = await fetch(`${API_URL}/upload-audio?${params}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': uploadFile.type },
        body: uploadFile,
      })
      if (!upRes.ok) {
        const d = await upRes.json().catch(() => ({}))
        throw new Error(d.error || `Upload failed (${upRes.status})`)
      }
      const { episodeId: epId, audioUrl: epAudioUrl } = await upRes.json()
      setEpisodeId(epId)
      setAudioUrl(epAudioUrl)
      setProcessingStep(2)

      router.push(`/episodes/${epId}/review`)
    } catch (err: unknown) {
      setGenerateError(err instanceof Error ? err.message : 'Something went wrong.')
      setNewEpStage('form')
    }
  }

  function resetNewEpisode() {
    setEpMode('ai')
    setEpTitle('')
    setScript('')
    setUrlInput('')
    setShowNotes('')
    setUploadFile(null)
    setNewEpStage('form')
    setGenerateError(null)
    setProcessingStep(0)
    setEpisodeId(null)
    setAudioUrl(null)
  }

  async function handlePortal() {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/billing/portal-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal')
      window.location.href = data.url
    } catch (err: unknown) {
      setPortalError(err instanceof Error ? err.message : 'Something went wrong')
      setPortalLoading(false)
    }
  }

  async function handleCheckout() {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const token = await getToken()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/billing/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: session!.user.email, plan: 'publisher', interval: 'monthly' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout')
      window.location.href = data.url
    } catch (err: unknown) {
      setPortalError(err instanceof Error ? err.message : 'Something went wrong')
      setPortalLoading(false)
    }
  }

  async function handleTestSource() {
    setTestingSource(true)
    setSourceTestResult(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/me/test-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          url: settingsFeedUrl.trim(),
          selector: settingsLinkSelector.trim() || undefined,
        }),
      })
      const result = await res.json()
      setSourceTestResult(result)
      // On success, adopt the resolved source URL + detected type for saving.
      if (result.ok) {
        if (result.resolvedUrl) setSettingsFeedUrl(result.resolvedUrl)
        setSettingsSourceType(result.sourceType ?? 'rss')
      }
    } catch {
      setSourceTestResult({ ok: false, error: 'Could not reach the server. Try again.' })
    } finally {
      setTestingSource(false)
    }
  }

  async function handleSettingsSave() {
    setSettingsSaving(true)
    setSettingsError(null)
    setSettingsSaved(false)
    try {
      const token = await getToken()
      let coverArtUrl: string | undefined

      if (settingsCoverFile) {
        const uploadRes = await fetch(`${API_URL}/me/cover-art`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': settingsCoverFile.type },
          body: settingsCoverFile,
        })
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}))
          throw new Error('Cover art upload failed: ' + (d.error ?? uploadRes.statusText))
        }
        const { url } = await uploadRes.json()
        coverArtUrl = url
      }

      const patchRes = await fetch(`${API_URL}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          showId: activeShowId || undefined,
          showName: settingsName || undefined,
          description: settingsDescription || undefined,
          ...(coverArtUrl ? { coverArtUrl } : {}),
          feedUrl: settingsFeedUrl.trim(),
          sourceType: settingsSourceType,
          sourceConfig: settingsLinkSelector.trim() ? { linkSelector: settingsLinkSelector.trim() } : null,
          automationEnabled: settingsAutomationEnabled,
          automationVoiceId: settingsAutomationVoiceId || null,
          automationIntervalDays: settingsIntervalDays,
          automationStartAt: localInputToIso(settingsStartAt),
          automationAdSelections: {
            preRollCampaignId: settingsPreRollId || null,
            postRollCampaignId: settingsPostRollId || null,
            midRollCampaignIds: settingsMidRollIds,
          },
        }),
      })
      if (!patchRes.ok) {
        const d = await patchRes.json().catch(() => ({}))
        throw new Error(d.error ?? patchRes.statusText)
      }

      const cacheBustedUrl = coverArtUrl ? `${coverArtUrl}?t=${Date.now()}` : undefined

      // Update local me state so sidebar/shows tab reflect the change immediately
      setMe(prev => prev ? {
        ...prev,
        shows: prev.shows.map(s => s.id === activeShowId ? {
          ...s,
          name: settingsName || s.name,
          description: settingsDescription || s.description,
          ...(cacheBustedUrl ? { coverArtUrl: cacheBustedUrl } : {}),
          feedUrl: settingsFeedUrl.trim() || null,
          sourceType: settingsSourceType,
          sourceConfig: settingsLinkSelector.trim() ? { linkSelector: settingsLinkSelector.trim() } : null,
          automationEnabled: settingsAutomationEnabled,
          automationVoiceId: settingsAutomationVoiceId || null,
          automationIntervalDays: settingsIntervalDays,
          automationStartAt: localInputToIso(settingsStartAt),
          automationAdSelections: {
            preRollCampaignId: settingsPreRollId || null,
            postRollCampaignId: settingsPostRollId || null,
            midRollCampaignIds: settingsMidRollIds,
          },
        } : s),
      } : prev)

      setSettingsCoverFile(null)
      if (cacheBustedUrl) setSettingsCoverPreview(cacheBustedUrl)
      setSettingsSaved(true)
    } catch (err: unknown) {
      setSettingsError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSettingsSaving(false)
    }
  }

  function insertLink() {
    const div = showNotesRef.current
    if (!div) return
    const url = window.prompt('URL:', 'https://')
    if (!url) return
    div.focus()
    document.execCommand('createLink', false, url)
    // Ensure all links open in a new tab
    div.querySelectorAll('a').forEach(a => {
      a.target = '_blank'
      a.rel = 'noreferrer noopener'
    })
    setShowNotes(div.innerHTML)
  }

  function insertDescriptionLink() {
    const div = settingsDescriptionRef.current
    if (!div) return
    const url = window.prompt('URL:', 'https://')
    if (!url) return
    div.focus()
    document.execCommand('createLink', false, url)
    div.querySelectorAll('a').forEach(a => {
      a.target = '_blank'
      a.rel = 'noreferrer noopener'
    })
    setSettingsDescription(div.innerHTML)
  }

  function toggleVoicePreview(voice: Voice) {
    if (!voice.previewUrl) return
    if (playingVoiceId === voice.id) {
      audioPreviewRef.current?.pause()
      setPlayingVoiceId(null)
      return
    }
    audioPreviewRef.current?.pause()
    const a = new Audio(voice.previewUrl)
    audioPreviewRef.current = a
    a.play()
    setPlayingVoiceId(voice.id)
    a.onended = () => setPlayingVoiceId(null)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const publishedCount = episodes.filter(e => e.status === 'published').length
  const nextScheduled = episodes.find(e => e.status === 'scheduled')
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthlyPublishedCount = episodes.filter(e =>
    e.status === 'published' && new Date(e.createdAt) >= startOfMonth
  ).length
  const isSolo = me?.subscription?.plan === 'solo'
  const isTrial = me?.subscription?.status === 'trial'
  const trialDaysLeft = me?.subscription?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(me.subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null
  const cancelPending = me?.subscription?.cancelAtPeriodEnd === true
  const cancelDateStr = me?.subscription?.cancelAt
    ? new Date(me.subscription.cancelAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null
  // Prefer the limit reported by the backend (single source of truth in
  // planLimits.js). Fall back to a plan map — defaulting to the publisher cap so
  // legacy/unknown plans are never downgraded — if usage hasn't loaded yet.
  const CHARACTER_LIMIT = characterLimit ?? (isSolo ? 50_000 : 150_000)
  const monthlyCharCount = monthlyCharacters

  // ── Sidebar nav item ──────────────────────────────────────────────────────────

  function NavItem({ navKey, icon, label, badge, tourId }: { navKey: NavKey; icon: string; label: string; badge?: number; tourId?: string }) {
    const active = activeNav === navKey
    return (
      <button
        data-tour={tourId}
        onClick={() => { setActiveNav(navKey); if (navKey === 'new') resetNewEpisode(); setMobileNavOpen(false) }}
        className={`w-full flex items-center gap-2.5 px-6 py-2.5 text-[13px] text-left transition-all border-l-2 ${
          active
            ? 'text-white border-[var(--accent)] bg-white/[0.07]'
            : 'text-white/55 border-transparent hover:text-white hover:bg-white/5'
        }`}
      >
        <span className="w-4 text-center text-sm shrink-0">{icon}</span>
        <span>{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="ml-auto bg-[var(--accent)] text-white text-[9px] font-[family-name:var(--font-dm-mono)] px-1.5 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </button>
    )
  }

  // ── Loading gate ──────────────────────────────────────────────────────────────

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">Loading…</p>
      </div>
    )
  }

  const orgInitials = me.org.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">

      {/* ── MOBILE BACKDROP ─────────────────────────────────────────── */}
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 sm:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
      <aside className={`w-[220px] shrink-0 bg-[var(--ink)] text-white flex flex-col py-7 fixed top-0 left-0 bottom-0 overflow-y-auto z-40 transition-transform duration-200 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'}`}>

        {/* Logo */}
        <div className="px-6 pb-7 border-b border-white/10 mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="LocalPod Studio" style={{ width: 130, filter: 'invert(1)', display: 'block', marginBottom: 6 }} />
          <div className="flex items-center gap-1">
            <span className="font-[family-name:var(--font-dm-mono)] text-white/35 text-[10px] uppercase tracking-[0.08em]">Dashboard</span>
          </div>
        </div>

        {/* Org */}
        <div className="px-6 pb-5 border-b border-white/10 mb-4">
          <div className="text-[9px] text-white/35 uppercase tracking-[0.1em] font-[family-name:var(--font-dm-mono)]">Newsroom</div>
          <div className="text-[13px] font-medium text-white mt-0.5">{me.org.name}</div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5">
          <NavItem navKey="dashboard" icon="▦" label="Dashboard" />
          <NavItem navKey="episodes"  icon="◎" label="Episodes" badge={episodes.filter(e => e.status === 'draft').length} tourId="nav-episodes" />
          <NavItem navKey="new"       icon="＋" label="New Episode" tourId="nav-new" />

          <div className="px-6 pt-4 pb-1.5 text-[9px] text-white/25 uppercase tracking-[0.1em] font-[family-name:var(--font-dm-mono)]">
            Publish
          </div>
          <NavItem navKey="shows"     icon="◈" label="Shows" />
          <NavItem navKey="analytics" icon="◌" label="Analytics" tourId="nav-analytics" />
          <NavItem navKey="ads" icon="◧" label="Ad Manager" />

          <div className="px-6 pt-4 pb-1.5 text-[9px] text-white/25 uppercase tracking-[0.1em] font-[family-name:var(--font-dm-mono)]">
            Settings
          </div>
          <NavItem navKey="dist"     icon="◫" label="Distribution" tourId="nav-dist" />
          <NavItem navKey="settings" icon="⊙" label="Settings" />
          <NavItem navKey="billing"  icon="◈" label="Billing" />
        </nav>

        {/* Bottom: usage + sign out */}
        <div className="mt-auto px-6 pt-5 border-t border-white/10">
          <div className="text-[10px] text-white/35 font-[family-name:var(--font-dm-mono)] mb-1.5">Monthly Characters</div>
          <div className="h-[3px] bg-white/10 rounded-full overflow-hidden mb-1">
            <div
              className="h-full bg-[var(--accent)] rounded-full"
              style={{ width: `${Math.min(100, (monthlyCharCount / CHARACTER_LIMIT) * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-white/40 font-[family-name:var(--font-dm-mono)] mb-3">
            {monthlyCharCount.toLocaleString()} / {CHARACTER_LIMIT.toLocaleString()} characters
          </div>
          <button
            onClick={async () => { await supabase.auth.signOut(); router.replace('/login') }}
            className="w-full text-left text-[11px] text-white/30 hover:text-white/60 transition-colors font-[family-name:var(--font-dm-mono)]"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      <main className="sm:ml-[220px] flex-1 flex flex-col min-h-screen">

        {/* Top bar */}
        <header className="bg-white border-b border-[var(--rule)] px-4 sm:px-8 h-14 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              className="sm:hidden flex flex-col gap-[5px] p-1"
              onClick={() => setMobileNavOpen(v => !v)}
              aria-label="Open menu"
            >
              <span className="w-5 h-[1.5px] bg-[var(--ink)] block" />
              <span className="w-5 h-[1.5px] bg-[var(--ink)] block" />
              <span className="w-5 h-[1.5px] bg-[var(--ink)] block" />
            </button>
            <h1 className="font-[family-name:var(--font-nunito)] font-bold text-[15px] text-[var(--ink)]">
              {NAV_TITLES[activeNav]}
            </h1>
            {me && me.shows.length > 1 && (
              <select
                className="text-[12px] font-[family-name:var(--font-dm-mono)] border border-[var(--rule)] rounded-[3px] px-2 py-1 bg-[var(--bg-warm)] text-[var(--ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
                value={activeShowId ?? ''}
                onChange={e => setActiveShowId(e.target.value)}
              >
                {me.shows.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-[var(--ink-light)] font-[family-name:var(--font-dm-mono)]">
              <span className="w-2 h-2 rounded-full bg-[var(--green)] inline-block" />
              All systems operational
            </span>
            <button
              data-tour="help"
              onClick={launchTour}
              aria-label="Take a tour"
              title="Take a tour"
              className="w-8 h-8 rounded-full bg-[var(--bg-warm)] border border-[var(--rule)] flex items-center justify-center text-[13px] font-semibold text-[var(--ink-light)] hover:text-[var(--ink)] hover:border-[var(--ink-faint)] transition-colors"
            >
              ?
            </button>
            <div className="w-8 h-8 rounded-full bg-[var(--bg-warm)] border border-[var(--rule)] flex items-center justify-center text-[12px] font-semibold text-[var(--ink-light)] cursor-default select-none">
              {orgInitials}
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="p-4 sm:p-8 flex-1">

          {/* ── DASHBOARD ─────────────────────────────────────────────── */}
          {activeNav === 'dashboard' && (
            <div>
              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                {[
                  { label: 'Episodes Published', value: publishedCount.toString(), delta: `${episodes.filter(e => e.status === 'published').length} total` },
                  { label: 'Drafts', value: episodes.filter(e => e.status === 'draft').length.toString(), delta: 'Not yet published' },
                  { label: 'Active Show', value: me.shows.length.toString(), delta: (me.shows.find(s => s.id === activeShowId) ?? me.shows[0])?.name ?? me.org.name },
                  { label: 'Next Scheduled', value: nextScheduled ? 'Yes' : '—', delta: nextScheduled?.title.slice(0, 28) ?? 'Nothing scheduled' },
                ].map(s => (
                  <div key={s.label} className="bg-white border border-[var(--rule)] rounded-[2px] p-5">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">{s.label}</div>
                    <div className="font-[family-name:var(--font-nunito)] text-[28px] font-bold leading-none my-1.5 text-[var(--ink)]">{s.value}</div>
                    <div className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)] truncate">{s.delta}</div>
                  </div>
                ))}
              </div>

              {/* Recent episodes */}
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-[family-name:var(--font-nunito)] font-bold text-base text-[var(--ink)]">Recent Episodes</h2>
                <button onClick={() => setActiveNav('episodes')} className="text-[12px] text-[var(--accent)] font-medium hover:opacity-70 transition-opacity">
                  View all →
                </button>
              </div>
              {loadingEpisodes
                ? <p className="text-[var(--ink-faint)] text-sm font-[family-name:var(--font-dm-mono)]">Loading…</p>
                : <EpisodeTable episodes={episodes.slice(0, 5)} onNew={() => { setActiveNav('new'); resetNewEpisode() }} />
              }
            </div>
          )}

          {/* ── EPISODES ──────────────────────────────────────────────── */}
          {activeNav === 'episodes' && (
            <div>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-[family-name:var(--font-nunito)] font-bold text-base text-[var(--ink)]">All Episodes</h2>
                <button onClick={() => { setActiveNav('new'); resetNewEpisode() }} className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--ink)] text-white text-[13px] font-semibold rounded-[2px] hover:bg-[#2a2825] transition-colors">
                  + New Episode
                </button>
              </div>
              {loadingEpisodes
                ? <p className="text-[var(--ink-faint)] text-sm font-[family-name:var(--font-dm-mono)]">Loading…</p>
                : <EpisodeTable episodes={episodes} onNew={() => { setActiveNav('new'); resetNewEpisode() }} onDelete={handleDeleteEpisodes} />
              }
            </div>
          )}

          {/* ── NEW EPISODE ───────────────────────────────────────────── */}
          {activeNav === 'new' && (
            <div>
              {/* FORM */}
              {newEpStage === 'form' && (
                <div className="bg-white border border-[var(--rule)] rounded-[2px] overflow-hidden max-w-3xl">
                  <div className="px-6 py-5 border-b border-[var(--rule)] bg-[var(--bg-warm)] flex items-center justify-between">
                    <div>
                      <div className="font-[family-name:var(--font-nunito)] font-bold text-[15px] text-[var(--ink)]">New Episode</div>
                      <div className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-0.5">
                        {epMode === 'ai' ? 'Paste your script → publish in minutes'
                          : epMode === 'url' ? 'Paste article links → we narrate them'
                          : 'Upload audio → publish to your podcast'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-[var(--bg)] border border-[var(--rule)] rounded-[2px] p-0.5">
                      {(['ai', 'url', 'upload'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setEpMode(mode)}
                          className={`px-3 py-1.5 text-[11px] font-[family-name:var(--font-dm-mono)] font-medium rounded-[2px] transition-colors ${
                            epMode === mode ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'
                          }`}
                        >
                          {mode === 'ai' ? 'AI Voice' : mode === 'url' ? 'From URL' : 'Upload Audio'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-6">
                    {/* Title */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">Episode Title</label>
                        <input
                          className="border border-[var(--rule)] rounded-[2px] px-3 py-2.5 text-[13px] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink)] focus:bg-white transition-colors"
                          placeholder="e.g. City Council Votes on New Housing Plan"
                          value={epTitle}
                          onChange={e => setEpTitle(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">Show</label>
                        <div className="border border-[var(--rule)] rounded-[2px] px-3 py-2.5 text-[13px] bg-[var(--bg-warm)] text-[var(--ink-light)]">
                          {(me.shows.find(s => s.id === activeShowId) ?? me.shows[0])?.name ?? me.org.name}
                        </div>
                      </div>
                    </div>

                    {epMode !== 'upload' && (
                      <>
                        {/* Voice */}
                        <div className="flex flex-col gap-1.5 mb-5">
                          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">AI Voice</label>
                          <div className="flex flex-wrap gap-2.5">
                            {voices.map(v => (
                              <div
                                key={v.id}
                                onClick={() => setSelectedVoiceId(v.id)}
                                className={`border-[1.5px] rounded-[2px] px-3.5 py-2.5 cursor-pointer transition-all flex flex-col gap-0.5 ${
                                  selectedVoiceId === v.id
                                    ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                                    : 'border-[var(--rule)] hover:border-[var(--ink-light)]'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[12px] font-semibold">{v.name}</span>
                                  {v.previewUrl && (
                                    <button
                                      onClick={e => { e.stopPropagation(); toggleVoicePreview(v) }}
                                      className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                                        selectedVoiceId === v.id ? 'bg-white/20 hover:bg-white/30' : 'bg-[var(--bg-warm)] hover:bg-[var(--rule)]'
                                      }`}
                                    >
                                      {playingVoiceId === v.id
                                        ? <span className="text-[8px]">■</span>
                                        : <span className="text-[8px] ml-px">▶</span>
                                      }
                                    </button>
                                  )}
                                </div>
                                {v.description && (
                                  <div className={`text-[10px] font-[family-name:var(--font-dm-mono)] ${selectedVoiceId === v.id ? 'text-white/50' : 'text-[var(--ink-faint)]'}`}>
                                    {v.description}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {epMode === 'ai' && (
                        <div className="flex flex-col gap-1.5 mb-5">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">Script</label>
                            <button
                              type="button"
                              onClick={() => pdfInputRef.current?.click()}
                              disabled={pdfLoading}
                              className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors disabled:opacity-50"
                            >
                              {pdfLoading ? 'Extracting…' : '↑ Upload PDF'}
                            </button>
                            <input
                              ref={pdfInputRef}
                              type="file"
                              accept=".pdf,application/pdf"
                              className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); e.target.value = '' }}
                            />
                          </div>
                          {pdfError && <p className="text-[11px] text-red-500 font-[family-name:var(--font-dm-mono)]">{pdfError}</p>}
                          <textarea
                            className="border border-[var(--rule)] rounded-[2px] px-3.5 py-3.5 text-[13px] font-[family-name:var(--font-dm-sans)] bg-[var(--bg)] text-[var(--ink)] resize-y min-h-[180px] w-full leading-relaxed focus:outline-none focus:border-[var(--ink)] focus:bg-white transition-colors"
                            placeholder="Paste your script here…"
                            value={script}
                            onChange={e => setScript(e.target.value)}
                          />
                          <div className="flex gap-4 text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
                            <span>{wordCount} words</span>
                            <span>·</span>
                            <span>~{Math.max(1, Math.round(wordCount / 150))} min estimated</span>
                          </div>
                        </div>
                        )}

                        {epMode === 'url' && (
                        <div className="flex flex-col gap-1.5 mb-5">
                          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">Article URL(s)</label>
                          <textarea
                            className="border border-[var(--rule)] rounded-[2px] px-3.5 py-3.5 text-[13px] font-[family-name:var(--font-dm-sans)] bg-[var(--bg)] text-[var(--ink)] resize-y min-h-[140px] w-full leading-relaxed focus:outline-none focus:border-[var(--ink)] focus:bg-white transition-colors"
                            placeholder="Paste one or more article URLs, one per line…"
                            value={urlInput}
                            onChange={e => setUrlInput(e.target.value)}
                          />
                          <div className="flex gap-4 text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
                            <span>{urlInput.split(/[\s,]+/).filter(Boolean).length} URL(s)</span>
                            <span>·</span>
                            <span>multiple links become one digest episode</span>
                          </div>
                        </div>
                        )}
                      </>
                    )}

                    {epMode === 'upload' && (
                      /* Upload Audio */
                      <div className="flex flex-col gap-1.5 mb-5">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">Audio File</label>
                        <div
                          onClick={() => audioFileRef.current?.click()}
                          className={`border-2 border-dashed rounded-[2px] p-8 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                            uploadFile ? 'border-[var(--ink)] bg-[var(--bg-warm)]' : 'border-[var(--rule)] hover:border-[var(--ink-light)]'
                          }`}
                        >
                          {uploadFile ? (
                            <>
                              <div className="text-[22px] mb-2">🎵</div>
                              <div className="text-[13px] font-medium text-[var(--ink)]">{uploadFile.name}</div>
                              <div className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-0.5">
                                {(uploadFile.size / 1024 / 1024).toFixed(1)} MB · click to change
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-[22px] mb-2">⬆</div>
                              <div className="text-[13px] text-[var(--ink-light)]">Click to upload audio</div>
                              <div className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-0.5">MP3, M4A, WAV, AAC · max 200 MB</div>
                            </>
                          )}
                        </div>
                        <input
                          ref={audioFileRef}
                          type="file"
                          accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,audio/ogg"
                          className="hidden"
                          onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                        />
                      </div>
                    )}

                    {/* Show notes */}
                    <div className="flex flex-col gap-1.5 mb-5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">Show Notes</label>
                        <button
                          type="button"
                          onClick={insertLink}
                          className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] border border-[var(--rule)] rounded-[2px] px-2 py-0.5 transition-colors"
                        >
                          + Link
                        </button>
                      </div>
                      <div
                        ref={showNotesRef}
                        contentEditable
                        suppressContentEditableWarning
                        onInput={() => setShowNotes(showNotesRef.current?.innerHTML ?? '')}
                        onClick={e => {
                          const link = (e.target as HTMLElement).closest('a')
                          if (link) { e.preventDefault(); window.open(link.getAttribute('href') ?? '', '_blank', 'noreferrer') }
                        }}
                        className="border border-[var(--rule)] rounded-[2px] px-3.5 py-3.5 text-[13px] font-[family-name:var(--font-dm-sans)] bg-[var(--bg)] text-[var(--ink)] min-h-[160px] w-full leading-relaxed focus:outline-none focus:border-[var(--ink)] focus:bg-white transition-colors cursor-text [&_a]:text-[var(--blue)] [&_a]:underline [&_a]:underline-offset-2 empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--ink-faint)] empty:before:pointer-events-none"
                        data-placeholder="Optional — appears in the episode description on Spotify, Apple Podcasts, etc."
                      />
                    </div>


                    {limitExceeded && (
                      <p className="text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)] mb-4">
                        You've reached your 150,000 character limit for this month.{' '}
                        <a href="mailto:paul@localpod.co" className="underline hover:opacity-70">Contact us to upgrade.</a>
                      </p>
                    )}
                    {generateError && (
                      <p className="text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)] mb-4">{generateError}</p>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-5 border-t border-[var(--rule)]">
                      <button
                        onClick={() => setActiveNav('episodes')}
                        className="px-5 py-2.5 text-[13px] font-semibold text-[var(--ink-light)] border border-[var(--rule)] rounded-[2px] hover:border-[var(--ink-light)] hover:text-[var(--ink)] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={epMode === 'ai' ? handleGenerate : epMode === 'url' ? handleGenerateFromUrls : handleUpload}
                        className="px-5 py-2.5 text-[13px] font-semibold text-white bg-[var(--accent)] hover:bg-[#a83315] rounded-[2px] transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* PROCESSING */}
              {newEpStage === 'processing' && (
                <div className="bg-white border border-[var(--rule)] rounded-[2px] p-10 text-center max-w-lg mx-auto">
                  <div className="relative w-16 h-16 rounded-full bg-[var(--gold-light)] flex items-center justify-center mx-auto mb-5 text-2xl">
                    🎙️
                    <div
                      className="lp-spin absolute -top-1 -left-1 -right-1 -bottom-1 rounded-full border-2 border-transparent"
                      style={{ borderTopColor: 'var(--gold)' }}
                    />
                  </div>
                  <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1.5">
                    {epMode === 'upload' ? 'Uploading your episode…' : 'Generating your episode…'}
                  </div>
                  <div className="text-[13px] text-[var(--ink-light)] mb-7">
                    {epMode === 'upload' ? 'Uploading and publishing…' : 'This usually takes under a minute.'}
                  </div>

                  <div className="max-w-xs mx-auto text-left">
                    {(epMode === 'ai'
                      ? ['Parsing script', `Synthesizing voice (${voices.find(v => v.id === selectedVoiceId)?.name ?? '…'})`, 'Saving audio', 'Done']
                      : epMode === 'url'
                      ? ['Fetching articles', `Synthesizing voice (${voices.find(v => v.id === selectedVoiceId)?.name ?? '…'})`, 'Saving audio', 'Done']
                      : ['Preparing upload', 'Uploading audio', 'Saving audio', 'Done']
                    ).map((label, i) => {
                      const done = processingStep > i
                      const active = processingStep === i
                      return (
                        <div key={i} className={`flex items-center gap-3 py-2 text-[13px] ${i < 3 ? 'border-b border-[var(--rule)]' : ''}`}>
                          <div className={`w-[22px] h-[22px] rounded-full shrink-0 flex items-center justify-center text-[10px] font-[family-name:var(--font-dm-mono)] font-medium border-[1.5px] ${
                            done   ? 'bg-[var(--green-light)] text-[var(--green)] border-[var(--green)]'
                            : active ? 'bg-[var(--gold-light)] text-[var(--gold)] border-[var(--gold)] lp-pulse'
                            : 'bg-[var(--bg-warm)] text-[var(--ink-faint)] border-[var(--rule)]'
                          }`}>
                            {done ? '✓' : i + 1}
                          </div>
                          <span className="flex-1 text-[var(--ink)]">{label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── ANALYTICS ─────────────────────────────────────────────── */}
          {activeNav === 'analytics' && (
            <AnalyticsView showId={activeShowId} />
          )}

          {/* ── ADS ───────────────────────────────────────────────────── */}
          {activeNav === 'ads' && (
            isSolo ? (
              <div className="max-w-lg">
                <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                  <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Ad Manager</div>
                  <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">A Publisher feature</div>
                  <p className="text-[13px] text-[var(--ink-light)] mb-5">
                    Create audio ads and manage campaigns to monetize your episodes. Ad Manager is included with LocalPod Publisher ($99/mo). Upgrade to start running ads.
                  </p>
                  <button
                    onClick={handlePortal}
                    disabled={portalLoading}
                    className="px-5 py-2.5 bg-[var(--ink)] text-white text-[13px] font-semibold rounded-[6px] hover:bg-[#2a2825] disabled:opacity-50 transition-colors"
                  >
                    {portalLoading ? 'Opening…' : 'Upgrade to Publisher →'}
                  </button>
                  {portalError && (
                    <p className="mt-3 text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{portalError}</p>
                  )}
                </div>
              </div>
            ) : (
              <AdsView getToken={getToken} />
            )
          )}

          {/* ── BILLING ───────────────────────────────────────────────── */}
          {activeNav === 'billing' && (
            <div className="max-w-lg">
              {cancelPending && (
                <div className="bg-[#fdf6e9] border border-[#e8d9b5] rounded-[8px] px-6 py-4 mb-4">
                  <div className="text-[13px] text-[#7a5b1e]">
                    <span className="font-semibold">Subscription set to cancel.</span>{' '}
                    {cancelDateStr
                      ? `You'll keep access until ${cancelDateStr}, and you won't be charged again.`
                      : `You'll keep access until the end of your current period, and you won't be charged again.`}{' '}
                    Changed your mind? Reopen billing to resubscribe.
                  </div>
                </div>
              )}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7 mb-4">
                <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Current Plan</div>
                {isTrial ? (
                  <>
                    <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">Free Trial</div>
                    <div className="text-[13px] text-[var(--ink-light)]">
                      {trialDaysLeft !== null && trialDaysLeft > 0
                        ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} remaining`
                        : 'Trial ending today'}
                      {me?.subscription?.stripeCustomerId && !cancelPending ? ' — your subscription starts automatically when the trial ends' : ''}
                    </div>
                  </>
                ) : isSolo ? (
                  <>
                    <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">LocalPod Solo — $49/mo</div>
                    <div className="text-[13px] text-[var(--ink-light)]">1 podcast feed · 50,000 AI characters/month · RSS distribution</div>
                  </>
                ) : (
                  <>
                    <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">LocalPod Publisher — $99/mo</div>
                    <div className="text-[13px] text-[var(--ink-light)]">Up to 5 podcast feeds · 150,000 AI characters/month · RSS distribution · Ad Manager · Priority support</div>
                  </>
                )}
              </div>

              {isTrial && !me?.subscription?.stripeCustomerId ? (
                <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7 mb-4">
                  <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Subscribe</div>
                  <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">LocalPod Publisher — $99/mo</div>
                  <div className="text-[13px] text-[var(--ink-light)] mb-4">Up to 5 podcast feeds · 150,000 AI characters/month · RSS distribution · Ad Manager · Priority support</div>
                  <button
                    onClick={handleCheckout}
                    disabled={portalLoading}
                    className="px-5 py-2.5 bg-[var(--ink)] text-white text-[13px] font-semibold rounded-[6px] hover:bg-[#2a2825] disabled:opacity-50 transition-colors"
                  >
                    {portalLoading ? 'Opening…' : 'Start subscription →'}
                  </button>
                  {portalError && (
                    <p className="mt-3 text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{portalError}</p>
                  )}
                </div>
              ) : (
                <>
                  {/* Other plan */}
                  {isSolo ? (
                    <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7 mb-4">
                      <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Upgrade</div>
                      <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">LocalPod Publisher — $99/mo</div>
                      <div className="text-[13px] text-[var(--ink-light)] mb-4">Up to 5 podcast feeds · 150,000 AI characters/month · Ad Manager · Priority support</div>
                      <button
                        onClick={handlePortal}
                        disabled={portalLoading}
                        className="px-5 py-2.5 bg-[var(--ink)] text-white text-[13px] font-semibold rounded-[6px] hover:bg-[#2a2825] disabled:opacity-50 transition-colors"
                      >
                        {portalLoading ? 'Opening…' : 'Upgrade →'}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7 mb-4">
                      <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Downgrade</div>
                      <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">LocalPod Solo — $49/mo</div>
                      <div className="text-[13px] text-[var(--ink-light)] mb-4">1 podcast feed · 50,000 AI characters/month · RSS distribution</div>
                      <button
                        onClick={handlePortal}
                        disabled={portalLoading}
                        className="px-5 py-2.5 border border-[var(--rule)] text-[var(--ink)] text-[13px] font-semibold rounded-[6px] hover:border-[var(--ink)] disabled:opacity-50 transition-colors"
                      >
                        {portalLoading ? 'Opening…' : 'Downgrade →'}
                      </button>
                    </div>
                  )}

                  <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                    <div className="text-[13px] text-[var(--ink-light)] mb-5">
                      Manage your payment method, download invoices, or cancel your subscription through the Stripe billing portal.
                    </div>
                    <button
                      onClick={handlePortal}
                      disabled={portalLoading}
                      className="px-5 py-2.5 bg-[var(--ink)] text-white text-[13px] font-semibold rounded-[6px] hover:bg-[#2a2825] disabled:opacity-50 transition-colors"
                    >
                      {portalLoading ? 'Opening…' : 'Manage Billing →'}
                    </button>
                    {portalError && (
                      <p className="mt-3 text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{portalError}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── SHOWS ─────────────────────────────────────────────────── */}
          {activeNav === 'shows' && (() => {
            const showLimit = showLimitForPlan(me.subscription?.plan)
            const atLimit = me.shows.length >= showLimit
            return (
            <div className="max-w-xl space-y-3">
              {me.shows.length === 0 ? (
                <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-[13px]">No show found.</p>
              ) : me.shows.map(show => (
                <div key={show.id} className={`bg-white border rounded-[2px] p-6 flex gap-6 items-start cursor-pointer transition-colors ${show.id === activeShowId ? 'border-[var(--ink)]' : 'border-[var(--rule)] hover:border-gray-300'}`} onClick={() => setActiveShowId(show.id)}>
                  {show.coverArtUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={show.coverArtUrl}
                      alt={show.name}
                      className="w-20 h-20 rounded-[2px] object-cover shrink-0 border border-[var(--rule)]"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-[2px] bg-[var(--bg-warm)] border border-[var(--rule)] shrink-0 flex items-center justify-center text-[var(--ink-faint)] text-xs font-[family-name:var(--font-dm-mono)]">
                      No art
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-[family-name:var(--font-nunito)] font-bold text-[15px] text-[var(--ink)] mb-1">
                      {show.name}
                    </div>
                    {show.description ? (
                      <p className="text-[13px] text-[var(--ink-light)] leading-relaxed" dangerouslySetInnerHTML={{ __html: show.description }} />
                    ) : (
                      <p className="text-[13px] text-[var(--ink-faint)] italic">No description yet.</p>
                    )}
                    {show.id === activeShowId && (
                      <p className="text-[11px] text-[var(--blue)] font-[family-name:var(--font-dm-mono)] mt-1.5">Active show</p>
                    )}
                  </div>
                </div>
              ))}

              {/* Add another feed, up to the plan's limit */}
              <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6">
                <div className="font-[family-name:var(--font-nunito)] font-bold text-[15px] text-[var(--ink)] mb-1">
                  Add a podcast feed
                </div>
                <p className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mb-4">
                  {me.shows.length} of {showLimit} feed{showLimit === 1 ? '' : 's'} used on your plan.
                </p>
                {atLimit ? (
                  <p className="text-[13px] text-[var(--ink-light)]">
                    You&apos;ve reached your plan&apos;s feed limit.{' '}
                    <button onClick={() => setActiveNav('billing')} className="text-[var(--blue)] underline">Upgrade</button>{' '}
                    to add more.
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newShowName}
                        onChange={e => setNewShowName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !creatingShow) createShow() }}
                        placeholder="New show name"
                        className="flex-1 border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--ink)]"
                      />
                      <button
                        onClick={createShow}
                        disabled={creatingShow}
                        className="bg-[var(--ink)] text-white text-[13px] font-[family-name:var(--font-dm-mono)] px-4 py-2 rounded-[2px] disabled:opacity-50 whitespace-nowrap"
                      >
                        {creatingShow ? 'Adding…' : 'Add show'}
                      </button>
                    </div>
                    <p className="text-[12px] text-[var(--ink-faint)] mt-2">
                      You&apos;ll set the cover art, description, and source on the next screen.
                    </p>
                  </>
                )}
                {addShowError && (
                  <p className="text-[12px] text-red-500 font-[family-name:var(--font-dm-mono)] mt-2">{addShowError}</p>
                )}
              </div>
            </div>
            )
          })()}

          {/* ── DISTRIBUTION ──────────────────────────────────────────── */}
          {activeNav === 'dist' && (() => {
            const activeShow = me.shows.find(s => s.id === activeShowId) ?? me.shows[0] ?? null

            const directories = [
              { name: 'Apple Podcasts', url: 'https://podcastsconnect.apple.com/my-podcasts/new-feed' },
              { name: 'Spotify', url: 'https://podcasters.spotify.com' },
              { name: 'Amazon Music', url: 'https://podcasters.amazon.com' },
              { name: 'iHeartRadio', url: 'https://podcasters.iheart.com' },
              { name: 'Pocket Casts', url: 'https://pocketcasts.com/submit' },
              { name: 'TuneIn', url: 'https://tunein.com/get-listed/' },
            ]

            return (
            <div className="max-w-xl space-y-6">

              {/* Your RSS feed URL */}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Your RSS Feed</div>
                <p className="text-[13px] text-[var(--ink-light)] mb-4">This is your podcast feed URL. Copy it and paste it into each directory below when submitting your show.</p>
                {activeShow?.megaphoneRssUrl ? (
                  <div className="relative">
                    <pre className="bg-[var(--bg-warm)] border border-[var(--rule)] rounded-[4px] px-4 py-3 pr-20 text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--ink)] whitespace-pre-wrap break-all leading-relaxed">
                      {activeShow.megaphoneRssUrl}
                    </pre>
                    <EmbedCopyButton code={activeShow.megaphoneRssUrl} />
                  </div>
                ) : (
                  <p className="text-[13px] text-[var(--ink-faint)]">Your RSS feed isn't ready yet. It's set up automatically when your show is created — if it hasn't appeared, reply to your welcome email or contact us and we'll sort it out.</p>
                )}
              </div>

              {/* Directory submission links */}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Submit to Directories</div>
                <p className="text-[13px] text-[var(--ink-light)] mb-5">Submit your RSS feed to each platform to get listed. Use your RSS feed URL from the section above.</p>
                <div className="divide-y divide-[var(--rule)]">
                  {directories.map(({ name, url }) => (
                    <div key={name} className="flex items-center justify-between py-3">
                      <span className="text-[13px] font-medium text-[var(--ink)]">{name}</span>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--blue)] hover:underline"
                      >
                        Submit →
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              {/* Have LocalPod do it */}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Prefer We Handle It?</div>
                <p className="text-[13px] text-[var(--ink-light)] mb-3">Happy to do the heavy lifting with you on a quick screen-share. Here&apos;s why it&apos;s a call and not a form:</p>
                <ul className="text-[13px] text-[var(--ink-light)] space-y-1.5 mb-4 list-disc pl-5 marker:text-[var(--ink-faint)]">
                  <li>Your show stays <span className="font-semibold text-[var(--ink)]">in your name</span> — we never take ownership of your podcast inside Apple, Spotify, or the other apps.</li>
                  <li>Most directories email a <span className="font-semibold text-[var(--ink)]">one-time verification code</span> to confirm ownership. You read those to us live and we paste them in as we go.</li>
                  <li>We submit to every major platform together in one sitting — usually about 15 minutes.</li>
                </ul>
                <a
                  href="https://calendly.com/mto-audio/podcast-app-submissions"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center px-5 py-2.5 bg-[var(--ink)] text-white text-[13px] font-semibold rounded-[6px] hover:bg-[#2a2825] transition-colors"
                >
                  Book a submission call →
                </a>
              </div>

              {/* Embed player */}
              {activeShow?.megaphoneRssUrl && (() => {
                const externalId = activeShow.megaphoneRssUrl!.split('/').pop()
                const embedCode = `<iframe src="https://playlist.megaphone.fm?p=${externalId}" width="100%" height="482" frameborder="0"></iframe>`
                return (
                  <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                    <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Embed Player</div>
                    <p className="text-[13px] text-[var(--ink-light)] mb-4">Paste this snippet anywhere on your site to embed your full podcast player.</p>
                    <div className="relative">
                      <pre className="bg-[var(--bg-warm)] border border-[var(--rule)] rounded-[4px] px-4 py-3 text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--ink)] whitespace-pre-wrap break-all leading-relaxed">
                        {embedCode}
                      </pre>
                      <EmbedCopyButton code={embedCode} />
                    </div>
                    <div className="mt-6 border border-[var(--rule)] rounded-[4px] overflow-hidden">
                      <iframe
                        src={`https://playlist.megaphone.fm?p=${activeShow.megaphoneRssUrl!.split('/').pop()}`}
                        width="100%"
                        height="482"
                        frameBorder={0}
                      />
                    </div>
                  </div>
                )
              })()}
            </div>
            )
          })()}

          {/* ── SETTINGS ──────────────────────────────────────────────── */}
          {activeNav === 'settings' && (
            <div className="max-w-xl space-y-6">
              {/* Cover art */}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-4">Cover Art</div>
                <div className="flex items-start gap-5">
                  <div
                    onClick={() => settingsCoverRef.current?.click()}
                    className="w-28 h-28 rounded-[4px] border border-[var(--rule)] bg-[var(--bg-warm)] shrink-0 flex items-center justify-center cursor-pointer hover:border-[var(--ink-faint)] transition-colors overflow-hidden"
                  >
                    {settingsCoverPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={settingsCoverPreview} alt="Cover art" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[var(--ink-faint)] text-[11px] font-[family-name:var(--font-dm-mono)] text-center px-2">No art</span>
                    )}
                  </div>
                  <div className="pt-1">
                    <button
                      onClick={() => settingsCoverRef.current?.click()}
                      className="text-[13px] font-semibold text-[var(--ink)] hover:underline"
                    >
                      {settingsCoverPreview ? 'Change image' : 'Upload image'}
                    </button>
                    <p className="text-[12px] text-[var(--ink-faint)] mt-1">3000 × 3000px recommended. JPG or PNG.</p>
                    {settingsCoverFile && (
                      <p className="text-[12px] text-[var(--ink-light)] mt-1">{settingsCoverFile.name}</p>
                    )}
                  </div>
                </div>
                <input
                  ref={settingsCoverRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setSettingsCoverFile(f)
                    setSettingsCoverPreview(URL.createObjectURL(f))
                  }}
                />
              </div>

              {/* Show name */}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                  Show Name
                </label>
                <input
                  type="text"
                  value={settingsName}
                  onChange={e => setSettingsName(e.target.value)}
                  className="w-full border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)]"
                />
              </div>

              {/* Description */}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em]">
                    Show Description
                  </label>
                  <button
                    type="button"
                    onClick={insertDescriptionLink}
                    className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] border border-[var(--rule)] rounded-[2px] px-2 py-0.5 transition-colors"
                  >
                    + Link
                  </button>
                </div>
                <div
                  ref={settingsDescriptionRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={() => setSettingsDescription(settingsDescriptionRef.current?.innerHTML ?? '')}
                  onClick={e => {
                    const link = (e.target as HTMLElement).closest('a')
                    if (link) { e.preventDefault(); window.open(link.getAttribute('href') ?? '', '_blank', 'noreferrer') }
                  }}
                  className="w-full border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)] min-h-[100px] leading-relaxed cursor-text [&_a]:text-[var(--blue)] [&_a]:underline [&_a]:underline-offset-2 empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--ink-faint)] empty:before:pointer-events-none"
                  data-placeholder="Describe your podcast…"
                />
              </div>

              {/* Automatic Episodes */}
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1">
                      Automatic Episodes
                    </label>
                    <p className="text-[13px] text-[var(--ink-light)] leading-relaxed max-w-[460px]">
                      Poll an RSS feed and turn new articles into draft episodes automatically. Drafts always wait for your review — nothing publishes on its own.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settingsAutomationEnabled}
                    onClick={() => setSettingsAutomationEnabled(v => !v)}
                    className={`shrink-0 mt-1 w-11 h-6 rounded-full transition-colors relative ${settingsAutomationEnabled ? 'bg-[var(--ink)]' : 'bg-[var(--rule)]'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settingsAutomationEnabled ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                <div className="mt-5">
                  <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                    Source URL
                  </label>
                  <div className="flex items-stretch gap-2">
                    <input
                      type="url"
                      value={settingsFeedUrl}
                      onChange={e => { setSettingsFeedUrl(e.target.value); setSourceTestResult(null) }}
                      placeholder="RSS feed or your site’s homepage"
                      className="flex-1 border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)]"
                    />
                    <button
                      type="button"
                      onClick={handleTestSource}
                      disabled={testingSource || !settingsFeedUrl.trim()}
                      className="shrink-0 px-4 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-[var(--ink)] border border-[var(--rule)] rounded-[4px] hover:border-[var(--ink-faint)] disabled:opacity-50 transition-colors"
                    >
                      {testingSource ? 'Testing…' : 'Test source'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px] text-[var(--ink-faint)] leading-relaxed">
                    Paste an RSS feed, or just your homepage — we’ll find the feed for you.
                  </p>

                  {sourceTestResult && (
                    sourceTestResult.ok ? (
                      <div className="mt-3 rounded-[4px] border border-[var(--green)]/40 bg-[var(--green)]/5 px-3 py-2.5">
                        <p className="text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--green)]">
                          ✓ {sourceTestResult.sourceType === 'sitemap' ? 'Found sitemap'
                            : sourceTestResult.sourceType === 'scrape' ? 'Reading article links from page'
                            : `Found ${sourceTestResult.sourceType?.toUpperCase()} feed`}{typeof sourceTestResult.itemCount === 'number' ? ` · ${sourceTestResult.itemCount} items` : ''}
                        </p>
                        {sourceTestResult.resolvedUrl && sourceTestResult.resolvedUrl !== settingsFeedUrl && (
                          <p className="mt-1 text-[11px] text-[var(--ink-faint)] break-all">Using: {sourceTestResult.resolvedUrl}</p>
                        )}
                        {sourceTestResult.sampleTitles && sourceTestResult.sampleTitles.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5">
                            {sourceTestResult.sampleTitles.slice(0, 3).map((t, i) => (
                              <li key={i} className="text-[12px] text-[var(--ink-light)] truncate">• {t}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[4px] border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-2.5">
                        <p className="text-[12px] text-[var(--accent)] leading-relaxed">{sourceTestResult.error}</p>
                      </div>
                    )
                  )}

                  {/* Advanced: link selector for scraped sources */}
                  {settingsSourceType === 'scrape' && (
                    <div className="mt-3">
                      <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">
                        Advanced · Article link selector
                      </label>
                      <input
                        type="text"
                        value={settingsLinkSelector}
                        onChange={e => { setSettingsLinkSelector(e.target.value); setSourceTestResult(null) }}
                        placeholder="e.g. h2.headline a"
                        className="w-full border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[13px] font-[family-name:var(--font-dm-mono)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-light)]"
                      />
                      <p className="mt-1.5 text-[12px] text-[var(--ink-faint)] leading-relaxed">
                        This site has no feed, so we read article links from the page. If we’re grabbing the wrong links, enter a CSS selector for the headline links and hit Test source.
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                    Voice for Auto Episodes
                  </label>
                  <select
                    value={settingsAutomationVoiceId}
                    onChange={e => setSettingsAutomationVoiceId(e.target.value)}
                    className="w-full border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)] bg-white"
                  >
                    <option value="">Use organization default voice</option>
                    {voices.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>

                {/* Schedule */}
                <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-4">
                  <div>
                    <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                      Generate an episode every
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={settingsIntervalDays}
                        onChange={e => {
                          const n = parseInt(e.target.value, 10)
                          setSettingsIntervalDays(Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 1)
                        }}
                        className="w-20 border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)]"
                      />
                      <span className="text-[14px] text-[var(--ink-light)]">{settingsIntervalDays === 1 ? 'day' : 'days'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                      Starting
                    </label>
                    <input
                      type="datetime-local"
                      value={settingsStartAt}
                      onChange={e => setSettingsStartAt(e.target.value)}
                      className="border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)]"
                    />
                  </div>
                </div>

                {/* Ads for auto episodes */}
                <div className="mt-6 pt-5 border-t border-[var(--rule)]">
                  <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1">
                    Ads for Auto Episodes
                  </label>
                  <p className="text-[13px] text-[var(--ink-light)] leading-relaxed max-w-[460px] mb-4">
                    Pick campaigns to place on every auto episode. Mid-roll spots are positioned automatically between articles — you can move them when you review each draft.
                  </p>

                  {adCampaigns.length === 0 ? (
                    <p className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
                      No active campaigns with audio yet.{' '}
                      <button type="button" onClick={() => setActiveNav('ads')} className="underline hover:text-[var(--ink)]">Create one in Ad Manager →</button>
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                          Pre-roll
                        </label>
                        <select
                          value={settingsPreRollId}
                          onChange={e => setSettingsPreRollId(e.target.value)}
                          className="w-full border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)] bg-white"
                        >
                          <option value="">None</option>
                          {adCampaigns.filter(c => c.type === 'pre-roll').map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                          Mid-roll{settingsMidRollIds.length > 1 ? ` (${settingsMidRollIds.length} spots)` : ''}
                        </label>
                        {adCampaigns.filter(c => c.type === 'mid-roll').length === 0 ? (
                          <p className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">No mid-roll campaigns.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {adCampaigns.filter(c => c.type === 'mid-roll').map(c => (
                              <label key={c.id} className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={settingsMidRollIds.includes(c.id)}
                                  onChange={() => setSettingsMidRollIds(prev =>
                                    prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                                  )}
                                  className="w-3.5 h-3.5 accent-[var(--ink)] shrink-0"
                                />
                                <span className="text-[14px] text-[var(--ink)]">{c.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                          Post-roll
                        </label>
                        <select
                          value={settingsPostRollId}
                          onChange={e => setSettingsPostRollId(e.target.value)}
                          className="w-full border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)] bg-white"
                        >
                          <option value="">None</option>
                          {adCampaigns.filter(c => c.type === 'post-roll').map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {settingsAutomationEnabled && !settingsFeedUrl.trim() && (
                  <p className="mt-4 text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">
                    Add a feed URL above for automation to run.
                  </p>
                )}
                {settingsAutomationEnabled && settingsFeedUrl.trim() && !settingsStartAt && (
                  <p className="mt-4 text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">
                    Set a start date/time for automation to run.
                  </p>
                )}
              </div>

              {/* Save */}
              <div className="flex items-center gap-4">
                <button
                  onClick={handleSettingsSave}
                  disabled={settingsSaving}
                  className="px-5 py-2.5 bg-[var(--ink)] text-white text-[13px] font-semibold rounded-[6px] hover:bg-[#2a2825] disabled:opacity-50 transition-colors"
                >
                  {settingsSaving ? 'Saving…' : 'Save Changes'}
                </button>
                {settingsSaved && (
                  <span className="text-[13px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Saved</span>
                )}
                {settingsError && (
                  <span className="text-[13px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{settingsError}</span>
                )}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

// ─── Suspense wrapper (required for useSearchParams in Next.js App Router) ───

export default function StudioPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f7]">
        <p className="text-[#a09c99] font-mono text-sm">Loading…</p>
      </div>
    }>
      <StudioInner />
    </Suspense>
  )
}
