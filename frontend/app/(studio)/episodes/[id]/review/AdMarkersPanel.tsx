'use client'

import { useEffect, useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface AdAssignment {
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
  initialAssignments: AdAssignment[]
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
  const [assignments, setAssignments] = useState<Map<string, AdAssignment>>(() => {
    const m = new Map<string, AdAssignment>()
    for (const a of initialAssignments) m.set(a.campaignId, a)
    return m
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
        // Cache peaks so next load is instant
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
            const auto = new Map<string, AdAssignment>()
            const now = Date.now()
            for (const c of active) {
              const inWindow =
                (!c.startDate || new Date(c.startDate).getTime() <= now) &&
                (!c.endDate || new Date(c.endDate).getTime() >= now)
              if (!inWindow) continue
              if (c.type === 'pre-roll' && defaults.preRoll) auto.set(c.id, { campaignId: c.id, type: 'pre-roll' })
              else if (c.type === 'post-roll' && defaults.postRoll) auto.set(c.id, { campaignId: c.id, type: 'post-roll' })
            }
            if (auto.size > 0) setAssignments(auto)
          }
        }
      } catch { /* silent */ }
    }
    load()
  }, [getToken, initialAssignments.length])

  function toggleCampaign(campaign: AdCampaign) {
    setSaved(false)
    setAssignments(prev => {
      const next = new Map(prev)
      if (next.has(campaign.id)) next.delete(campaign.id)
      else next.set(campaign.id, { campaignId: campaign.id, type: campaign.type })
      return next
    })
  }

  function setAssignmentType(campaignId: string, type: string) {
    setSaved(false)
    if (type === 'mid-roll') setWaveEnabled(true)
    setAssignments(prev => {
      const next = new Map(prev)
      const existing = next.get(campaignId)
      if (!existing) return prev
      const updated: AdAssignment = { ...existing, type }
      if (type !== 'mid-roll') delete updated.insertAt
      next.set(campaignId, updated)
      return next
    })
  }

  function markCampaignHere(campaignId: string) {
    const t = Math.round(currentTime * 10) / 10
    setSaved(false)
    setAssignments(prev => {
      const next = new Map(prev)
      const existing = next.get(campaignId)
      if (!existing) return prev
      next.set(campaignId, { ...existing, insertAt: t })
      return next
    })
  }

  async function handleSave() {
    setSaving(true); setSaveError(null); setSaved(false)
    try {
      const token = await getToken()
      const assignmentList = [...assignments.values()]

      // Derive adMarkers from assignments so Megaphone DAI slots stay in sync
      const derivedMarkers = {
        preRoll:  assignmentList.some(a => a.type === 'pre-roll'),
        postRoll: assignmentList.some(a => a.type === 'post-roll'),
        midRoll:  assignmentList.filter(a => a.type === 'mid-roll' && a.insertAt != null).map(a => a.insertAt as number),
      }

      await Promise.all([
        fetch(`${API_URL}/episodes/${episodeId}/ad-assignments`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ assignments: assignmentList }),
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
  const hasMidRollAssigned = [...assignments.values()].some(a => a.type === 'mid-roll')

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
          {/* Waveform — only shown when a mid-roll is assigned */}
          {audioUrl && (
            <div className={hasMidRollAssigned ? '' : 'hidden'}>
              <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-2">
                {waveReady ? 'Scrub to the mid-roll position, then click Mark here' : 'Loading waveform…'}
              </div>
              <div className="relative rounded-[2px] overflow-hidden">
                <div ref={containerRef} />
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
              const assignment = assignments.get(c.id)
              const checked = !!assignment
              const assignedType = assignment?.type ?? c.type

              return (
                <div key={c.id} className="rounded-[2px] border border-[var(--rule)] p-3 space-y-2">
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
                    <div className="ml-6 flex items-center gap-2 flex-wrap">
                      {AD_TYPES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => setAssignmentType(c.id, t.value)}
                          className={`px-3 py-1 text-[11px] font-semibold font-[family-name:var(--font-dm-mono)] rounded-[2px] border transition-colors ${
                            assignedType === t.value
                              ? 'bg-[var(--ink)] text-white border-[var(--ink)]'
                              : 'bg-white text-[var(--ink-faint)] border-[var(--rule)] hover:text-[var(--ink)] hover:border-[var(--ink-faint)]'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}

                      {assignedType === 'mid-roll' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => markCampaignHere(c.id)}
                            disabled={!waveReady}
                            className="px-3 py-1 text-[11px] font-semibold font-[family-name:var(--font-dm-mono)] text-[var(--accent)] border border-[var(--accent)] rounded-[2px] hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            Mark here
                          </button>
                          <span className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] tabular-nums">
                            {assignment?.insertAt != null
                              ? `→ ${formatTime(assignment.insertAt)}`
                              : waveReady ? `cursor at ${formatTime(currentTime)}` : audioUrl ? 'loading…' : 'no audio'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Single save */}
          <div className="flex items-center gap-3 pt-1 border-t border-[var(--rule)]">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
            >
              {saving ? 'Saving…' : isPublished ? 'Save & sync →' : 'Save'}
            </button>
            {saved && !saving && (
              <span className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Saved — will stitch on next publish</span>
            )}
            {saveError && (
              <span className="text-[11px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{saveError}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
