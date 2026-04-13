'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

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
  scheduledAt: string | null
  createdAt: string
  voice: { name: string } | null
}


interface MeData {
  org: { id: string; name: string; megaphoneShowId: string | null; megaphoneRssUrl: string | null; defaultVoice: Voice | null }
  show: { name: string; description: string | null; coverArtUrl: string | null } | null
  subscription: { stripeCustomerId: string | null } | null
}

type NavKey = 'dashboard' | 'new' | 'episodes' | 'analytics' | 'billing' | 'shows' | 'dist' | 'settings'
type NewEpStage = 'form' | 'processing'

const NAV_TITLES: Record<NavKey, string> = {
  dashboard: 'Dashboard', new: 'New Episode', episodes: 'Episodes',
  analytics: 'Analytics', billing: 'Billing', shows: 'Shows',
 dist: 'Distribution', settings: 'Settings',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  return session.access_token
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
                  <input type="checkbox" checked={selected.has(ep.id)} onChange={() => toggle(ep.id)} className="cursor-pointer" />
                </td>
              )}
              <td className="px-4 py-3 border-b border-[var(--rule)]">
                <a href={`/episodes/${ep.id}/review`} className="font-medium text-[13px] text-[var(--ink)] hover:text-[var(--accent)] transition-colors">{ep.title}</a>
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

function AnalyticsView() {
  const [data, setData] = useState<{
    available: boolean
    reason?: string
    totalDownloads?: number
    episodes?: { id: string | null; megaphoneId: string; title: string; pubdate: string; duration: number; downloads: number }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const res = await fetch(`${API_URL}/analytics`, {
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
  }, [])

  if (loading) return <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">Loading analytics…</p>

  if (!data?.available) {
    return (
      <div className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-[13px] py-10">
        {data?.reason ?? 'Analytics unavailable.'}
      </div>
    )
  }

  const episodes = data.episodes ?? []
  const maxDownloads = Math.max(...episodes.map(e => e.downloads), 1)

  return (
    <div>
      {/* Stat cards */}
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

      {/* Episode breakdown */}
      <div className="bg-white border border-[var(--rule)] rounded-[2px]">
        <div className="px-5 py-4 border-b border-[var(--rule)] font-[family-name:var(--font-nunito)] font-bold text-[14px] text-[var(--ink)]">
          Downloads by Episode
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
                    <div className="mt-1.5 h-1.5 bg-[var(--bg-warm)] rounded-full overflow-hidden w-full max-w-xs">
                      <div
                        className="h-full bg-[var(--accent)] rounded-full"
                        style={{ width: `${(ep.downloads / maxDownloads) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-[13px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-light)] shrink-0">
                    {ep.downloads.toLocaleString()}
                  </div>
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
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard')
  const [voices, setVoices] = useState<Voice[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(true)
  const [episodeRefreshKey, setEpisodeRefreshKey] = useState(0)

  // New Episode form state
  const [epMode, setEpMode] = useState<'ai' | 'upload'>('ai')
  const [epTitle, setEpTitle] = useState('')
  const [selectedVoiceId, setSelectedVoiceId] = useState('')
  const [script, setScript] = useState('')
  const [showNotes, setShowNotes] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [newEpStage, setNewEpStage] = useState<NewEpStage>('form')
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [processingStep, setProcessingStep] = useState(0) // 0-3
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  // Mobile nav
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Billing
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)

  // Settings
  const [settingsName, setSettingsName] = useState('')
  const [settingsDescription, setSettingsDescription] = useState('')
  const [settingsCoverFile, setSettingsCoverFile] = useState<File | null>(null)
  const [settingsCoverPreview, setSettingsCoverPreview] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const settingsCoverRef = useRef<HTMLInputElement>(null)

  // Voice preview
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)

const showNotesRef = useRef<HTMLTextAreaElement>(null)
  const audioFileRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0

  async function handlePdfUpload(file: File) {
    setPdfLoading(true)
    setPdfError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/extract-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', Authorization: `Bearer ${token}` },
        body: file,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to extract PDF')
      setScript(data.text)
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
        if (!subscription?.stripeCustomerId) { router.replace('/onboarding'); return }

        setMe(meData)
        if (meData!.org.defaultVoice) setSelectedVoiceId(meData!.org.defaultVoice.id)

        // Honor ?nav= query param (e.g. return from Stripe billing portal)
        const navParam = searchParams.get('nav') as NavKey | null
        const validNavKeys: NavKey[] = ['dashboard', 'new', 'episodes', 'analytics', 'billing', 'shows', 'dist', 'settings']
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
        const res = await fetch(`${API_URL}/episodes`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) setEpisodes(await res.json())
      } catch { /* silent */ }
      finally { setLoadingEpisodes(false) }
    }
    load()
  }, [episodeRefreshKey])

  // ── Sync settings form from me when tab opens ────────────────────────────────

  useEffect(() => {
    if (activeNav === 'settings' && me?.show) {
      setSettingsName(me.show.name ?? '')
      setSettingsDescription(me.show.description ?? '')
      setSettingsCoverPreview(me.show.coverArtUrl ?? null)
      setSettingsCoverFile(null)
      setSettingsError(null)
      setSettingsSaved(false)
    }
  }, [activeNav, me])

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
        }),
      })

      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)

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
          showName: settingsName || undefined,
          description: settingsDescription || undefined,
          ...(coverArtUrl ? { coverArtUrl } : {}),
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
        show: prev.show ? {
          ...prev.show,
          name: settingsName || prev.show.name,
          description: settingsDescription || prev.show.description,
          ...(cacheBustedUrl ? { coverArtUrl: cacheBustedUrl } : {}),
        } : prev.show,
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
    const ta = showNotesRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = showNotes.slice(start, end)
    const url = window.prompt('URL:', 'https://')
    if (!url) return
    const linkText = selected || url
    const tag = `<a href="${url}">${linkText}</a>`
    const next = showNotes.slice(0, start) + tag + showNotes.slice(end)
    setShowNotes(next)
    // Restore focus and position cursor after the inserted tag
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + tag.length, start + tag.length)
    })
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

  // ── Sidebar nav item ──────────────────────────────────────────────────────────

  function NavItem({ navKey, icon, label, badge }: { navKey: NavKey; icon: string; label: string; badge?: number }) {
    const active = activeNav === navKey
    return (
      <button
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
          <NavItem navKey="episodes"  icon="◎" label="Episodes" badge={episodes.filter(e => e.status === 'draft').length} />
          <NavItem navKey="new"       icon="＋" label="New Episode" />

          <div className="px-6 pt-4 pb-1.5 text-[9px] text-white/25 uppercase tracking-[0.1em] font-[family-name:var(--font-dm-mono)]">
            Publish
          </div>
          <NavItem navKey="shows"     icon="◈" label="Shows" />
          <NavItem navKey="analytics" icon="◌" label="Analytics" />

          <div className="px-6 pt-4 pb-1.5 text-[9px] text-white/25 uppercase tracking-[0.1em] font-[family-name:var(--font-dm-mono)]">
            Settings
          </div>
          <NavItem navKey="dist"     icon="◫" label="Distribution" />
          <NavItem navKey="settings" icon="⊙" label="Settings" />
          <NavItem navKey="billing"  icon="◈" label="Billing" />
        </nav>

        {/* Bottom: usage + sign out */}
        <div className="mt-auto px-6 pt-5 border-t border-white/10">
          <div className="text-[10px] text-white/35 font-[family-name:var(--font-dm-mono)] mb-1.5">Monthly Episodes</div>
          <div className="h-[3px] bg-white/10 rounded-full overflow-hidden mb-1">
            <div
              className="h-full bg-[var(--accent)] rounded-full"
              style={{ width: `${Math.min(100, (monthlyPublishedCount / 50) * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-white/40 font-[family-name:var(--font-dm-mono)] mb-3">
            {monthlyPublishedCount} / 50 used
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
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-[var(--ink-light)] font-[family-name:var(--font-dm-mono)]">
              <span className="w-2 h-2 rounded-full bg-[var(--green)] inline-block" />
              All systems operational
            </span>
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
                  { label: 'Active Show', value: '1', delta: me.show?.name ?? me.org.name },
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
                        {epMode === 'ai' ? 'Paste your script → publish in minutes' : 'Upload audio → publish to your podcast'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-[var(--bg)] border border-[var(--rule)] rounded-[2px] p-0.5">
                      {(['ai', 'upload'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setEpMode(mode)}
                          className={`px-3 py-1.5 text-[11px] font-[family-name:var(--font-dm-mono)] font-medium rounded-[2px] transition-colors ${
                            epMode === mode ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'
                          }`}
                        >
                          {mode === 'ai' ? 'AI Voice' : 'Upload Audio'}
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
                          {me.show?.name ?? me.org.name}
                        </div>
                      </div>
                    </div>

                    {epMode === 'ai' ? (
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

                        {/* Script */}
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
                      </>
                    ) : (
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
                      <textarea
                        ref={showNotesRef}
                        className="border border-[var(--rule)] rounded-[2px] px-3.5 py-3.5 text-[13px] font-[family-name:var(--font-dm-sans)] bg-[var(--bg)] text-[var(--ink)] resize-y min-h-[80px] w-full leading-relaxed focus:outline-none focus:border-[var(--ink)] focus:bg-white transition-colors"
                        placeholder="Optional — appears in the episode description on Spotify, Apple Podcasts, etc."
                        value={showNotes}
                        onChange={e => setShowNotes(e.target.value)}
                      />
                      {showNotes.includes('<') && (
                        <div
                          className="px-3.5 py-2.5 border border-[var(--rule)] rounded-[2px] bg-white text-[13px] font-[family-name:var(--font-dm-sans)] text-[var(--ink-light)] leading-relaxed [&_a]:text-[var(--blue)] [&_a]:underline [&_a]:underline-offset-2"
                          dangerouslySetInnerHTML={{ __html: showNotes }}
                        />
                      )}
                    </div>


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
                        onClick={epMode === 'ai' ? handleGenerate : handleUpload}
                        className="px-5 py-2.5 text-[13px] font-semibold text-white bg-[var(--accent)] hover:bg-[#a83315] rounded-[2px] transition-colors"
                      >
                        {epMode === 'ai' ? 'Next →' : 'Next →'}
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
                    {epMode === 'ai' ? 'Generating your episode…' : 'Uploading your episode…'}
                  </div>
                  <div className="text-[13px] text-[var(--ink-light)] mb-7">
                    {epMode === 'ai' ? 'This usually takes under a minute.' : 'Uploading and publishing…'}
                  </div>

                  <div className="max-w-xs mx-auto text-left">
                    {(epMode === 'ai'
                      ? ['Parsing script', `Synthesizing voice (${voices.find(v => v.id === selectedVoiceId)?.name ?? '…'})`, 'Saving audio', 'Done']
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
            <AnalyticsView />
          )}

          {/* ── BILLING ───────────────────────────────────────────────── */}
          {activeNav === 'billing' && (
            <div className="max-w-lg">
              <div className="bg-white border border-[var(--rule)] rounded-[8px] px-8 py-7 mb-4">
                <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-1.5">Current Plan</div>
                <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">LocalPod Studio — $99/mo</div>
                <div className="text-[13px] text-[var(--ink-light)]">Unlimited episodes · RSS distribution · Priority support</div>
              </div>
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
            </div>
          )}

          {/* ── SHOWS ─────────────────────────────────────────────────── */}
          {activeNav === 'shows' && (
            <div className="max-w-xl">
              {me.show ? (
                <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6 flex gap-6 items-start">
                  {me.show.coverArtUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={me.show.coverArtUrl}
                      alt={me.show.name}
                      className="w-32 h-32 rounded-[2px] object-cover shrink-0 border border-[var(--rule)]"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-[2px] bg-[var(--bg-warm)] border border-[var(--rule)] shrink-0 flex items-center justify-center text-[var(--ink-faint)] text-xs font-[family-name:var(--font-dm-mono)]">
                      No art
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-[family-name:var(--font-nunito)] font-bold text-lg text-[var(--ink)] mb-1">
                      {me.show.name}
                    </div>
                    {me.show.description ? (
                      <p className="text-[13px] text-[var(--ink-light)] leading-relaxed">
                        {me.show.description}
                      </p>
                    ) : (
                      <p className="text-[13px] text-[var(--ink-faint)] italic">No description yet.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-[13px]">No show found.</p>
              )}
            </div>
          )}

          {/* ── DISTRIBUTION ──────────────────────────────────────────── */}
          {activeNav === 'dist' && (
            <div className="max-w-xl space-y-6">
              {/* Embed player */}
              {me.org.megaphoneRssUrl && (() => {
                const externalId = me.org.megaphoneRssUrl.split('/').pop()
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
                        src={`https://playlist.megaphone.fm?p=${me.org.megaphoneRssUrl!.split('/').pop()}`}
                        width="100%"
                        height="482"
                        frameBorder={0}
                      />
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

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
                <label className="block text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.08em] mb-2">
                  Show Description
                </label>
                <textarea
                  value={settingsDescription}
                  onChange={e => setSettingsDescription(e.target.value)}
                  rows={4}
                  className="w-full border border-[var(--rule)] rounded-[4px] px-3 py-2 text-[14px] text-[var(--ink)] font-[family-name:var(--font-nunito)] focus:outline-none focus:border-[var(--ink-light)] resize-none"
                />
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
