'use client'

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL

type AdSubNav = 'overview' | 'defaults' | 'campaigns'

interface AdMarkers {
  preRoll: boolean
  postRoll: boolean
  midRoll: number[]
}

interface EpisodeAd {
  id: string
  title: string
  status: string
  adMarkers: string | null
  adAssignments: string | null
}

interface Voice {
  id: string
  name: string
  elevenLabsId: string
}

interface AdCampaign {
  id: string
  name: string
  audioUrl: string | null
  type: string
  status: string
  startDate: string | null
  endDate: string | null
  notes: string | null
  createdAt: string
}

const EMPTY_MARKERS: AdMarkers = { preRoll: false, postRoll: false, midRoll: [] }

const TYPE_LABELS: Record<string, string> = {
  'pre-roll': 'Pre-roll',
  'mid-roll': 'Mid-roll',
  'post-roll': 'Post-roll',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function AdMarkerBadge({ markers }: { markers: AdMarkers | null }) {
  if (!markers) return <span className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">—</span>
  const parts: string[] = []
  if (markers.preRoll) parts.push('Pre')
  if (markers.midRoll?.length) parts.push(`${markers.midRoll.length} Mid`)
  if (markers.postRoll) parts.push('Post')
  if (!parts.length) return <span className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">None set</span>
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map(p => (
        <span key={p} className="px-1.5 py-0.5 rounded-[2px] bg-[var(--bg-warm)] text-[10px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-light)]">
          {p}
        </span>
      ))}
    </div>
  )
}

const EMPTY_FORM = { name: '', audioUrl: '', type: 'pre-roll', status: 'active', startDate: '', endDate: '', notes: '' }

export default function AdsView({ getToken }: { getToken: () => Promise<string> }) {
  const [subNav, setSubNav] = useState<AdSubNav>('overview')

  // Overview
  const [episodes, setEpisodes] = useState<EpisodeAd[]>([])
  const [epLoading, setEpLoading] = useState(true)

  // Defaults
  const [defaults, setDefaults] = useState<AdMarkers>(EMPTY_MARKERS)
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)
  const [newMidSec, setNewMidSec] = useState('')

  // Campaigns
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([])
  const [campLoading, setCampLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [campSaving, setCampSaving] = useState(false)
  const [campError, setCampError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // AI audio generation
  const [voices, setVoices] = useState<Voice[]>([])
  const [showGenerate, setShowGenerate] = useState(false)
  const [adCopy, setAdCopy] = useState('')
  const [genVoiceId, setGenVoiceId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  useEffect(() => {
    async function loadAll() {
      try {
        const token = await getToken()
        const [epRes, meRes, campRes, voiceRes] = await Promise.all([
          fetch(`${API_URL}/episodes`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/ad-campaigns`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/voices`, { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (epRes.ok) setEpisodes(await epRes.json())
        if (meRes.ok) {
          const me = await meRes.json()
          if (me.show?.adMarkerDefaults) setDefaults(JSON.parse(me.show.adMarkerDefaults))
        }
        if (campRes.ok) setCampaigns(await campRes.json())
        if (voiceRes.ok) {
          const vs: Voice[] = await voiceRes.json()
          setVoices(vs)
          if (vs.length) setGenVoiceId(vs[0].elevenLabsId)
        }
      } catch { /* silent */ }
      setEpLoading(false)
      setCampLoading(false)
    }
    loadAll()
  }, [getToken])

  // ── Defaults handlers ──────────────────────────────────────────────────────

  function addMidDefault() {
    const sec = parseFloat(newMidSec)
    if (isNaN(sec) || sec < 0) return
    setDefaults(prev => ({ ...prev, midRoll: [...prev.midRoll, Math.round(sec * 10) / 10].sort((a, b) => a - b) }))
    setNewMidSec('')
    setDefaultsSaved(false)
  }

  async function saveDefaults() {
    setDefaultsSaving(true)
    setDefaultsError(null)
    setDefaultsSaved(false)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adMarkerDefaults: defaults }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Save failed (${res.status})`)
      }
      setDefaultsSaved(true)
    } catch (err: unknown) {
      setDefaultsError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setDefaultsSaving(false)
    }
  }

  // ── Campaign handlers ──────────────────────────────────────────────────────

  function resetGenerate() {
    setShowGenerate(false)
    setAdCopy('')
    setGeneratedUrl(null)
    setGenError(null)
  }

  function openNew() {
    setForm({ ...EMPTY_FORM })
    setEditId(null)
    setCampError(null)
    resetGenerate()
    setShowForm(true)
  }

  function openEdit(c: AdCampaign) {
    setForm({
      name: c.name,
      audioUrl: c.audioUrl ?? '',
      type: c.type,
      status: c.status,
      startDate: c.startDate ? c.startDate.slice(0, 10) : '',
      endDate: c.endDate ? c.endDate.slice(0, 10) : '',
      notes: c.notes ?? '',
    })
    setEditId(c.id)
    setCampError(null)
    resetGenerate()
    setShowForm(true)
  }

  async function handleGenerate() {
    if (!adCopy.trim()) { setGenError('Enter some ad copy first.'); return }
    if (!genVoiceId) { setGenError('Select a voice.'); return }
    setGenerating(true)
    setGenError(null)
    setGeneratedUrl(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/ad-campaigns/generate-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: adCopy, voiceId: genVoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Generate failed (${res.status})`)
      setGeneratedUrl(data.audioUrl)
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : 'Generation failed.')
    } finally {
      setGenerating(false)
    }
  }

  function useGeneratedAudio() {
    if (!generatedUrl) return
    setForm(f => ({ ...f, audioUrl: generatedUrl }))
    resetGenerate()
  }

  async function saveCampaign() {
    if (!form.name.trim()) { setCampError('Name is required.'); return }
    setCampSaving(true)
    setCampError(null)
    try {
      const token = await getToken()
      const url = editId ? `${API_URL}/ad-campaigns/${editId}` : `${API_URL}/ad-campaigns`
      const res = await fetch(url, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name.trim(),
          audioUrl: form.audioUrl || null,
          type: form.type,
          status: form.status,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          notes: form.notes || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`)
      setCampaigns(prev => editId
        ? prev.map(c => c.id === editId ? data : c)
        : [data, ...prev]
      )
      setShowForm(false)
    } catch (err: unknown) {
      setCampError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setCampSaving(false)
    }
  }

  async function deleteCampaign(id: string) {
    if (!window.confirm('Delete this campaign?')) return
    setDeletingId(id)
    try {
      const token = await getToken()
      await fetch(`${API_URL}/ad-campaigns/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      setCampaigns(prev => prev.filter(c => c.id !== id))
    } catch { /* silent */ }
    setDeletingId(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Sub-nav */}
      <div className="flex gap-0 mb-6 border-b border-[var(--rule)]">
        {(['overview', 'defaults', 'campaigns'] as AdSubNav[]).map(tab => (
          <button
            key={tab}
            onClick={() => setSubNav(tab)}
            className={`px-5 py-2.5 text-[12px] font-[family-name:var(--font-dm-mono)] capitalize border-b-2 -mb-px transition-colors ${
              subNav === tab
                ? 'border-[var(--ink)] text-[var(--ink)]'
                : 'border-transparent text-[var(--ink-faint)] hover:text-[var(--ink-light)]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
      {subNav === 'overview' && (
        <div>
          {epLoading ? (
            <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">Loading…</p>
          ) : episodes.length === 0 ? (
            <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">No episodes yet.</p>
          ) : (
            <table className="w-full border-collapse bg-white border border-[var(--rule)] rounded-[2px]">
              <thead>
                <tr>
                  {['Episode', 'Status', 'Ad Markers', 'Sponsor Ads', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] font-normal border-b border-[var(--rule)] bg-[var(--bg-warm)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {episodes.map(ep => {
                  const markers = ep.adMarkers ? JSON.parse(ep.adMarkers) as AdMarkers : null
                  const assignCount = ep.adAssignments ? (JSON.parse(ep.adAssignments) as unknown[]).length : 0
                  return (
                    <tr key={ep.id} className="hover:bg-[var(--bg)]">
                      <td className="px-4 py-3 border-b border-[var(--rule)] text-[13px] font-medium text-[var(--ink)]">{ep.title}</td>
                      <td className="px-4 py-3 border-b border-[var(--rule)]">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[10px] font-medium font-[family-name:var(--font-dm-mono)] uppercase tracking-[0.04em] ${
                          ep.status === 'published' ? 'bg-[var(--green-light)] text-[var(--green)]' :
                          ep.status === 'scheduled' ? 'bg-[var(--blue-light)] text-[var(--blue)]' :
                          'bg-[var(--bg-warm)] text-[var(--ink-faint)]'
                        }`}>
                          <span className="w-[5px] h-[5px] rounded-full bg-current inline-block" />{ep.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--rule)]">
                        <AdMarkerBadge markers={markers} />
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--rule)] text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">
                        {assignCount > 0
                          ? <span className="text-[var(--ink)]">{assignCount} assigned</span>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--rule)]">
                        <a
                          href={`/episodes/${ep.id}/review`}
                          className="text-[12px] text-[var(--ink-faint)] hover:text-[var(--accent)] font-[family-name:var(--font-dm-mono)] transition-colors"
                        >
                          Edit →
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── DEFAULTS ──────────────────────────────────────────────────── */}
      {subNav === 'defaults' && (
        <div className="max-w-lg space-y-5">
          <p className="text-[13px] text-[var(--ink-light)]">
            These defaults are applied to every new episode automatically. You can override them per-episode on the review page.
          </p>

          {/* Pre / post roll */}
          <div className="bg-white border border-[var(--rule)] rounded-[2px] p-5 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">Pre / Post Roll</div>
            {(['preRoll', 'postRoll'] as const).map(key => (
              <label key={key} className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={defaults[key]}
                  onChange={e => { setDefaults(prev => ({ ...prev, [key]: e.target.checked })); setDefaultsSaved(false) }}
                  className="w-4 h-4 accent-[var(--ink)]"
                />
                <span className="text-[13px] text-[var(--ink-light)]">
                  {key === 'preRoll' ? 'Enable pre-roll by default' : 'Enable post-roll by default'}
                </span>
              </label>
            ))}
          </div>

          {/* Mid-roll defaults */}
          <div className="bg-white border border-[var(--rule)] rounded-[2px] p-5 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">Mid-roll Defaults</div>
            <p className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
              Add timestamps in seconds. These will be applied as starting points — adjust per-episode on the review page.
            </p>
            {defaults.midRoll.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {defaults.midRoll.map(t => (
                  <span key={t} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] bg-[var(--bg-warm)] text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]">
                    {formatTime(t)}
                    <button
                      onClick={() => { setDefaults(prev => ({ ...prev, midRoll: prev.midRoll.filter(x => x !== t) })); setDefaultsSaved(false) }}
                      className="text-[var(--ink-faint)] hover:text-[var(--accent)]"
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Seconds (e.g. 90)"
                value={newMidSec}
                onChange={e => setNewMidSec(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addMidDefault()}
                className="border border-[var(--rule)] rounded-[2px] px-3 py-1.5 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] w-40 transition-colors"
              />
              <button
                onClick={addMidDefault}
                className="px-3 py-1.5 text-[12px] font-[family-name:var(--font-dm-mono)] font-semibold border border-[var(--rule)] rounded-[2px] text-[var(--ink-light)] hover:text-[var(--ink)] transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              onClick={saveDefaults}
              disabled={defaultsSaving}
              className="px-4 py-2 text-[13px] font-semibold text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
            >
              {defaultsSaving ? 'Saving…' : 'Save Defaults'}
            </button>
            {defaultsSaved && !defaultsSaving && (
              <span className="text-[12px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Saved</span>
            )}
            {defaultsError && (
              <span className="text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{defaultsError}</span>
            )}
          </div>
        </div>
      )}

      {/* ── CAMPAIGNS ─────────────────────────────────────────────────── */}
      {subNav === 'campaigns' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-nunito)] font-bold text-base text-[var(--ink)]">
              {campaigns.length} Campaign{campaigns.length !== 1 ? 's' : ''}
            </h2>
            <button
              onClick={openNew}
              className="px-4 py-2 text-[13px] font-semibold text-white bg-[var(--ink)] hover:bg-[#2a2825] rounded-[2px] transition-colors"
            >
              + New Campaign
            </button>
          </div>

          {/* Form */}
          {showForm && (
            <div className="bg-white border border-[var(--rule)] rounded-[2px] p-5 mb-5 space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">
                {editId ? 'Edit Campaign' : 'New Campaign'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.05em]">Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Sponsor House Ad Q2"
                    className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.05em]">Type</label>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                  >
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {/* Audio URL + AI generation */}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.05em]">Ad Audio</label>
                    {voices.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setShowGenerate(v => !v); setGeneratedUrl(null); setGenError(null) }}
                        className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--accent)] hover:opacity-75 transition-opacity"
                      >
                        {showGenerate ? 'Cancel' : '✦ Generate with AI'}
                      </button>
                    )}
                  </div>

                  {/* Manual URL input */}
                  {!showGenerate && (
                    <input
                      value={form.audioUrl}
                      onChange={e => setForm(f => ({ ...f, audioUrl: e.target.value }))}
                      placeholder="https://… (paste audio URL, or generate with AI above)"
                      className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                    />
                  )}

                  {/* AI generation panel */}
                  {showGenerate && (
                    <div className="border border-[var(--rule)] rounded-[2px] p-4 bg-[var(--bg)] space-y-3">
                      <textarea
                        value={adCopy}
                        onChange={e => setAdCopy(e.target.value)}
                        rows={4}
                        placeholder="Write your ad copy here… e.g. 'This episode is brought to you by Acme Co. Visit acme.com to learn more.'"
                        className="w-full border border-[var(--rule)] rounded-[2px] px-3 py-2.5 text-[13px] text-[var(--ink)] bg-white focus:outline-none focus:border-[var(--ink)] resize-y transition-colors"
                      />
                      <div className="flex items-center gap-3">
                        <select
                          value={genVoiceId}
                          onChange={e => setGenVoiceId(e.target.value)}
                          className="border border-[var(--rule)] rounded-[2px] px-3 py-1.5 text-[13px] text-[var(--ink)] bg-white focus:outline-none focus:border-[var(--ink)] transition-colors"
                        >
                          {voices.map(v => <option key={v.elevenLabsId} value={v.elevenLabsId}>{v.name}</option>)}
                        </select>
                        <button
                          onClick={handleGenerate}
                          disabled={generating || !adCopy.trim()}
                          className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 rounded-[2px] transition-opacity"
                        >
                          {generating ? (
                            <span className="flex items-center gap-2">
                              <span className="lp-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                              Generating…
                            </span>
                          ) : 'Generate →'}
                        </button>
                      </div>
                      {genError && (
                        <p className="text-[11px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{genError}</p>
                      )}
                      {generatedUrl && (
                        <div className="space-y-2 pt-1 border-t border-[var(--rule)]">
                          <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">Preview</div>
                          <audio controls src={generatedUrl} className="w-full" />
                          <div className="flex items-center gap-3">
                            <button
                              onClick={useGeneratedAudio}
                              className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--green)] hover:opacity-90 rounded-[2px] transition-opacity"
                            >
                              Use this audio →
                            </button>
                            <button
                              onClick={() => { setGeneratedUrl(null); setAdCopy('') }}
                              className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] hover:text-[var(--ink)]"
                            >
                              Regenerate
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show current URL if set */}
                  {form.audioUrl && !showGenerate && (
                    <audio controls src={form.audioUrl} className="w-full mt-1" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.05em]">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.05em]">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.05em]">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] uppercase tracking-[0.05em]">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    placeholder="Sponsor details, copy notes, etc."
                    className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] resize-none transition-colors"
                  />
                </div>
              </div>
              {campError && <p className="text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{campError}</p>}
              <div className="flex items-center gap-3 pt-1 border-t border-[var(--rule)]">
                <button
                  onClick={saveCampaign}
                  disabled={campSaving}
                  className="px-4 py-2 text-[13px] font-semibold text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
                >
                  {campSaving ? 'Saving…' : editId ? 'Save Changes' : 'Create Campaign'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-[13px] text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Campaign table */}
          {campLoading ? (
            <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">Loading…</p>
          ) : campaigns.length === 0 ? (
            <div className="bg-white border border-[var(--rule)] rounded-[2px] p-10 text-center">
              <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">No campaigns yet.</p>
            </div>
          ) : (
            <table className="w-full border-collapse bg-white border border-[var(--rule)] rounded-[2px]">
              <thead>
                <tr>
                  {['Campaign', 'Type', 'Status', 'Dates', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] font-normal border-b border-[var(--rule)] bg-[var(--bg-warm)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-[var(--bg)]">
                    <td className="px-4 py-3 border-b border-[var(--rule)]">
                      <div className="text-[13px] font-medium text-[var(--ink)]">{c.name}</div>
                      {c.notes && (
                        <div className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-0.5 truncate max-w-[200px]">{c.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--rule)] text-[12px] text-[var(--ink-light)] font-[family-name:var(--font-dm-mono)]">
                      {TYPE_LABELS[c.type] ?? c.type}
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--rule)]">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[10px] font-medium font-[family-name:var(--font-dm-mono)] uppercase tracking-[0.04em] ${
                        c.status === 'active' ? 'bg-[var(--green-light)] text-[var(--green)]' : 'bg-[var(--bg-warm)] text-[var(--ink-faint)]'
                      }`}>
                        <span className="w-[5px] h-[5px] rounded-full bg-current inline-block" />{c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--rule)] text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
                      {c.startDate ? fmtDate(c.startDate) : '—'}
                      {c.endDate ? ` → ${fmtDate(c.endDate)}` : ''}
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--rule)]">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEdit(c)} className="text-[12px] text-[var(--ink-faint)] hover:text-[var(--ink)] font-[family-name:var(--font-dm-mono)] transition-colors">
                          Edit
                        </button>
                        <button
                          onClick={() => deleteCampaign(c.id)}
                          disabled={deletingId === c.id}
                          className="text-[12px] text-[var(--ink-faint)] hover:text-[var(--accent)] font-[family-name:var(--font-dm-mono)] disabled:opacity-50 transition-colors"
                        >
                          {deletingId === c.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
