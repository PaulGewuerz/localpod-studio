'use client'

import { useEffect, useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface AdAssignment {
  id: string        // unique per placement
  campaignId: string
  type: string
  insertAt?: number
}

interface AdCampaign {
  id: string
  name: string
  type: string
  status: string
  audioUrl: string | null
  startDate: string | null
  endDate: string | null
}

interface Props {
  audioUrl: string | null
  episodeId: string
  isPublished: boolean
  initialMarkers: { preRoll: boolean; postRoll: boolean; midRoll: number[] } | null
  initialAssignments: Omit<AdAssignment, 'id'>[]
  getToken: () => Promise<string>
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const AD_TYPES = [
  { value: 'pre-roll', label: 'Pre' },
  { value: 'mid-roll', label: 'Mid' },
  { value: 'post-roll', label: 'Post' },
]

const PEAKS_CACHE_PREFIX = 'lp_peaks_'

function loadCachedPeaks(episodeId: string): number[][] | null {
  try {
    const raw = localStorage.getItem(PEAKS_CACHE_PREFIX + episodeId)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveCachedPeaks(episodeId: string, peaks: number[][]) {
  try { localStorage.setItem(PEAKS_CACHE_PREFIX + episodeId, JSON.stringify(peaks)) } catch { /* quota */ }
}

function makeId() {
  return Math.random().toString(36).slice(2)
}

export default function AdMarkersPanel({ audioUrl, episodeId, isPublished, initialAssignments, getToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsRef = useRef<any>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [waveReady, setWaveReady] = useState(false)
  const [waveEnabled, setWaveEnabled] = useState(() =>
    initialAssignments.some(a => a.type === 'mid-roll')
  )

  const [campaigns, setCampaigns] = useState<AdCampaign[]>([])
  const [assignments, setAssignments] = useState<AdAssignment[]>(() =>
    initialAssignments.map((a, i) => ({ ...a, id: `${a.campaignId}_${i}` }))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const hasMidRollAssigned = assignments.some(a => a.type === 'mid-roll')
  const hasAnyAssigned = assignments.length > 0

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ws: any = null
    import('wavesurfer.js').then(({ default: WaveSurfer }) => {
      if (!containerRef.current) return
      const cachedPeaks = loadCachedPeaks(episodeId)
      ws = WaveSurfer.create({
        container: containerRef.current,
        url: audioUrl,
        waveColor: '#d1d5db',
        progressColor: '#374151',
        height: 72,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        ...(cachedPeaks ? { peaks: cachedPeaks } : {}),
      })
      ws.on('ready', () => {
        setDuration(ws.getDuration())
        setWaveReady(true)
        if (!cachedPeaks) {
          try { saveCachedPeaks(episodeId, ws.exportPeaks()) } catch { /* non-fatal */ }
        }
      })
      ws.on('timeupdate', (t: number) => setCurrentTime(t))
      ws.on('play', () => setIsPlaying(true))
      ws.on('pause', () => setIsPlaying(false))
      ws.on('finish', () => setIsPlaying(false))
      wsRef.current = ws
    })
    return () => { ws?.destroy() }
  }, [audioUrl, episodeId, campaigns.length])

  // When the waveform div becomes visible, WaveSurfer needs to recalculate
  // its canvas dimensions (they were 0 while the container was display:none)
  useEffect(() => {
    if (hasAnyAssigned && wsRef.current) {
      window.dispatchEvent(new Event('resize'))
    }
  }, [hasAnyAssigned])

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const [campRes, meRes] = await Promise.all([
          fetch(`${API_URL}/ad-campaigns`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } }),
        ])
        const all: AdCampaign[] = campRes.ok ? await campRes.json() : []
        const active = all.filter(c => c.status === 'active' && c.audioUrl)
        setCampaigns(active)

        if (initialAssignments.length === 0 && meRes.ok) {
          const me = await meRes.json()
          const defaults = me.show?.adMarkerDefaults ? JSON.parse(me.show.adMarkerDefaults) : null
          if (defaults) {
            const auto: AdAssignment[] = []
            const now = Date.now()
            for (const c of active) {
              const inWindow =
                (!c.startDate || new Date(c.startDate).getTime() <= now) &&
                (!c.endDate || new Date(c.endDate).getTime() >= now)
              if (!inWindow) continue
              if (c.type === 'pre-roll' && defaults.preRoll)
                auto.push({ id: makeId(), campaignId: c.id, type: 'pre-roll' })
              else if (c.type === 'post-roll' && defaults.postRoll)
                auto.push({ id: makeId(), campaignId: c.id, type: 'post-roll' })
            }
            if (auto.length > 0) setAssignments(auto)
          }
        }
      } catch { /* silent */ }
    }
    load()
  }, [getToken, initialAssignments.length])

  function toggleCampaign(campaign: AdCampaign) {
    setSaved(false)
    setAssignments(prev => {
      const hasCampaign = prev.some(a => a.campaignId === campaign.id)
      if (hasCampaign) return prev.filter(a => a.campaignId !== campaign.id)
      return [...prev, { id: makeId(), campaignId: campaign.id, type: campaign.type }]
    })
  }

  function addPlacement(campaign: AdCampaign) {
    setSaved(false)
    setAssignments(prev => [...prev, { id: makeId(), campaignId: campaign.id, type: campaign.type }])
  }

  function removePlacement(placementId: string) {
    setSaved(false)
    setAssignments(prev => prev.filter(a => a.id !== placementId))
  }

  function setAssignmentType(placementId: string, type: string) {
    setSaved(false)
    if (type === 'mid-roll') setWaveEnabled(true)
    setAssignments(prev => prev.map(a => {
      if (a.id !== placementId) return a
      const updated = { ...a, type }
      if (type !== 'mid-roll') delete updated.insertAt
      return updated
    }))
  }

  function markCampaignHere(placementId: string) {
    const t = Math.round(currentTime * 10) / 10
    setSaved(false)
    setAssignments(prev => prev.map(a =>
      a.id === placementId ? { ...a, insertAt: t } : a
    ))
  }

  async function handlePreview() {
    const unmarkedMidRoll = assignments.find(a => a.type === 'mid-roll' && a.insertAt == null)
    if (unmarkedMidRoll) {
      setPreviewError('Set a position for each mid-roll by scrubbing to the right spot and clicking "Mark here".')
      return
    }
    setPreviewing(true)
    setPreviewUrl(null)
    setPreviewError(null)
    try {
      const token = await getToken()
      const derivedMarkers = {
        preRoll:  assignments.some(a => a.type === 'pre-roll'),
        postRoll: assignments.some(a => a.type === 'post-roll'),
        midRoll:  assignments.filter(a => a.type === 'mid-roll' && a.insertAt != null).map(a => a.insertAt as number),
      }

      // Save current assignments first so the preview reflects what's on screen
      await Promise.all([
        fetch(`${API_URL}/episodes/${episodeId}/ad-assignments`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ assignments }),
        }),
        fetch(`${API_URL}/episodes/${episodeId}/ad-markers`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(derivedMarkers),
        }),
      ])
      setSaved(true)

      const res = await fetch(`${API_URL}/episodes/${episodeId}/preview-audio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Preview failed')
      }
      const { audioUrl: url } = await res.json()
      setPreviewUrl(url)
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed.')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSave() {
    setSaving(true); setSaveError(null); setSaved(false)
    const unmarkedMidRoll = assignments.find(a => a.type === 'mid-roll' && a.insertAt == null)
    if (unmarkedMidRoll) {
      setSaveError('Set a position for each mid-roll by scrubbing to the right spot and clicking "Mark here".')
      setSaving(false)
      return
    }
    try {
      const token = await getToken()
      const derivedMarkers = {
        preRoll:  assignments.some(a => a.type === 'pre-roll'),
        postRoll: assignments.some(a => a.type === 'post-roll'),
        midRoll:  assignments.filter(a => a.type === 'mid-roll' && a.insertAt != null).map(a => a.insertAt as number),
      }

      await Promise.all([
        fetch(`${API_URL}/episodes/${episodeId}/ad-assignments`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ assignments }),
        }),
        fetch(`${API_URL}/episodes/${episodeId}/ad-markers`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(derivedMarkers),
        }),
      ])

      setSaved(true)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const activeCampaigns = campaigns.filter(c => c.audioUrl)

  return (
    <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6 flex flex-col gap-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">
        Sponsor Ads
      </div>

      {activeCampaigns.length === 0 ? (
        <p className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
          No active campaigns with audio yet.{' '}
          <a href="/studio?nav=ads" className="underline hover:text-[var(--ink)]">Create one in Ad Manager →</a>
        </p>
      ) : (
        <>
          {/* Waveform — shown when any ad is assigned; markers show each ad's position */}
          {audioUrl && (
            <div className={hasAnyAssigned ? '' : 'hidden'}>
              <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-2">
                {!waveReady ? 'Loading waveform…' : hasMidRollAssigned ? 'Scrub to the mid-roll position, then click Mark here' : 'Ad positions shown on waveform'}
              </div>
              <div className="relative rounded-[2px] overflow-hidden">
                <div ref={containerRef} />
                {waveReady && duration > 0 && assignments.map(a => {
                  const pos = a.type === 'pre-roll' ? 0
                            : a.type === 'post-roll' ? 100
                            : a.insertAt != null ? (a.insertAt / duration) * 100 : null
                  if (pos === null) return null
                  const color = a.type === 'pre-roll' ? 'var(--green)'
                              : a.type === 'mid-roll' ? 'var(--blue)'
                              : 'var(--accent)'
                  const label = a.type === 'pre-roll' ? 'Pre' : a.type === 'mid-roll' ? 'Mid' : 'Post'
                  const transform = pos === 0 ? 'none' : pos === 100 ? 'translateX(-100%)' : 'translateX(-50%)'
                  return (
                    <div
                      key={a.id}
                      className="absolute top-0 h-full pointer-events-none flex flex-col"
                      style={{ left: `${pos}%`, transform }}
                    >
                      <span
                        className="px-1 text-[9px] font-semibold font-[family-name:var(--font-dm-mono)] leading-none py-0.5"
                        style={{ color, backgroundColor: 'rgba(255,255,255,0.85)' }}
                      >
                        {label}
                      </span>
                      <div className="flex-1 w-px opacity-75" style={{ backgroundColor: color }} />
                    </div>
                  )
                })}
              </div>
              {waveReady && (
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => wsRef.current?.playPause()}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-[var(--ink)] text-white hover:bg-[#2a2825] transition-colors shrink-0"
                  >
                    {isPlaying ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <rect x="1" y="1" width="3" height="8" rx="1"/><rect x="6" y="1" width="3" height="8" rx="1"/>
                      </svg>
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
                      </svg>
                    )}
                  </button>
                  <span className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] w-20 tabular-nums">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Campaign list */}
          <div className="space-y-2">
            {activeCampaigns.map(c => {
              const campaignPlacements = assignments.filter(a => a.campaignId === c.id)
              const checked = campaignPlacements.length > 0

              return (
                <div key={c.id} className="rounded-[2px] border border-[var(--rule)] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCampaign(c)}
                        className="w-3.5 h-3.5 accent-[var(--ink)] shrink-0"
                      />
                      <span className="text-[13px] text-[var(--ink)] font-medium">{c.name}</span>
                    </label>
                    {checked && (
                      <button
                        onClick={() => addPlacement(c)}
                        className="text-[11px] font-semibold font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors"
                      >
                        + Add
                      </button>
                    )}
                  </div>

                  {campaignPlacements.map(placement => (
                    <div key={placement.id} className="ml-6 flex items-center gap-2 flex-wrap">
                      {AD_TYPES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => setAssignmentType(placement.id, t.value)}
                          className={`px-3 py-1 text-[11px] font-semibold font-[family-name:var(--font-dm-mono)] rounded-[2px] border transition-colors ${
                            placement.type === t.value
                              ? 'bg-[var(--ink)] text-white border-[var(--ink)]'
                              : 'bg-white text-[var(--ink-faint)] border-[var(--rule)] hover:text-[var(--ink)] hover:border-[var(--ink-faint)]'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}

                      {placement.type === 'mid-roll' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => markCampaignHere(placement.id)}
                            disabled={!waveReady}
                            className="px-3 py-1 text-[11px] font-semibold font-[family-name:var(--font-dm-mono)] text-[var(--accent)] border border-[var(--accent)] rounded-[2px] hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            Mark here
                          </button>
                          <span className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] tabular-nums">
                            {placement.insertAt != null
                              ? `→ ${formatTime(placement.insertAt)}`
                              : waveReady ? `cursor at ${formatTime(currentTime)}` : audioUrl ? 'loading…' : 'no audio'}
                          </span>
                        </div>
                      )}

                      <button
                        onClick={() => removePlacement(placement.id)}
                        className="ml-auto text-[13px] leading-none text-[var(--ink-faint)] hover:text-[var(--accent)] transition-colors"
                        title="Remove placement"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Save + preview */}
          <div className="flex flex-col gap-3 pt-1 border-t border-[var(--rule)]">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
              >
                {saving ? 'Saving…' : isPublished ? 'Save & sync →' : 'Save'}
              </button>
              {hasAnyAssigned && (
                <button
                  onClick={handlePreview}
                  disabled={previewing}
                  className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-[var(--ink)] border border-[var(--rule)] hover:border-[var(--ink-faint)] disabled:opacity-50 rounded-[2px] transition-colors"
                >
                  {previewing ? (
                    <span className="flex items-center gap-2">
                      <span className="lp-spin inline-block w-3 h-3 border-2 border-[var(--ink-faint)]/30 border-t-[var(--ink-faint)] rounded-full" />
                      Stitching…
                    </span>
                  ) : 'Preview with ads →'}
                </button>
              )}
              {saved && !saving && (
                <span className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Saved</span>
              )}
              {saveError && (
                <span className="text-[11px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{saveError}</span>
              )}
            </div>
            {previewUrl && (
              <audio key={previewUrl} controls src={previewUrl} className="w-full" />
            )}
            {previewError && (
              <span className="text-[11px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{previewError}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
