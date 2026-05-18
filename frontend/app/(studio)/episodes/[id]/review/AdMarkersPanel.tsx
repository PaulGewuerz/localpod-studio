'use client'

import { useEffect, useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface AdMarkers {
  preRoll: boolean
  postRoll: boolean
  midRoll: number[]
}

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
}

interface Props {
  audioUrl: string | null
  episodeId: string
  isPublished: boolean
  initialMarkers: AdMarkers | null
  initialAssignments: AdAssignment[]
  getToken: () => Promise<string>
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function AdMarkersPanel({ audioUrl, episodeId, isPublished, initialMarkers, initialAssignments, getToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsRef = useRef<any>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [waveReady, setWaveReady] = useState(false)
  const [markers, setMarkers] = useState<AdMarkers>(
    initialMarkers ?? { preRoll: false, postRoll: false, midRoll: [] }
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveWarning, setSaveWarning] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Campaign assignments
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([])
  const [assignments, setAssignments] = useState<AdAssignment[]>(initialAssignments)
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignSaved, setAssignSaved] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  // Mid-roll insertAt inputs keyed by campaignId
  const [insertAtInputs, setInsertAtInputs] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const a of initialAssignments) {
      if (a.type === 'mid-roll') m[a.campaignId] = String(a.insertAt ?? '')
    }
    return m
  })

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ws: any = null
    import('wavesurfer.js').then(({ default: WaveSurfer }) => {
      if (!containerRef.current) return
      ws = WaveSurfer.create({
        container: containerRef.current,
        url: audioUrl,
        waveColor: '#d1d5db',
        progressColor: '#374151',
        height: 72,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
      })
      ws.on('ready', () => { setDuration(ws.getDuration()); setWaveReady(true) })
      ws.on('timeupdate', (t: number) => setCurrentTime(t))
      ws.on('play', () => setIsPlaying(true))
      ws.on('pause', () => setIsPlaying(false))
      ws.on('finish', () => setIsPlaying(false))
      wsRef.current = ws
    })
    return () => { ws?.destroy() }
  }, [audioUrl])

  useEffect(() => {
    getToken().then(token =>
      fetch(`${API_URL}/ad-campaigns`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then((all: AdCampaign[]) => setCampaigns(all.filter(c => c.status === 'active' && c.audioUrl)))
        .catch(() => {})
    )
  }, [getToken])

  function handlePlayPause() { wsRef.current?.playPause() }

  function handleMarkHere() {
    const t = Math.round(currentTime * 10) / 10
    setMarkers(prev => {
      if (prev.midRoll.includes(t)) return prev
      return { ...prev, midRoll: [...prev.midRoll, t].sort((a, b) => a - b) }
    })
    setSaved(false)
  }

  function removeMidRoll(time: number) {
    setMarkers(prev => ({ ...prev, midRoll: prev.midRoll.filter(t => t !== time) }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true); setSaveError(null); setSaveWarning(null); setSaved(false)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/episodes/${episodeId}/ad-markers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(markers),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`)
      if (data.warning) setSaveWarning(data.warning)
      setSaved(true)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  // ── Campaign assignment ────────────────────────────────────────────

  function isAssigned(campaignId: string) {
    return assignments.some(a => a.campaignId === campaignId)
  }

  function toggleAssignment(campaign: AdCampaign) {
    setAssignSaved(false)
    if (isAssigned(campaign.id)) {
      setAssignments(prev => prev.filter(a => a.campaignId !== campaign.id))
    } else {
      const newA: AdAssignment = { campaignId: campaign.id, type: campaign.type }
      if (campaign.type === 'mid-roll') newA.insertAt = Number(insertAtInputs[campaign.id]) || 0
      setAssignments(prev => [...prev, newA])
    }
  }

  function updateInsertAt(campaignId: string, val: string) {
    setInsertAtInputs(prev => ({ ...prev, [campaignId]: val }))
    setAssignments(prev => prev.map(a =>
      a.campaignId === campaignId ? { ...a, insertAt: Number(val) || 0 } : a
    ))
    setAssignSaved(false)
  }

  async function handleSaveAssignments() {
    setAssignSaving(true); setAssignError(null); setAssignSaved(false)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/episodes/${episodeId}/ad-assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignments }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`)
      setAssignSaved(true)
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setAssignSaving(false)
    }
  }

  const activeCampaigns = campaigns.filter(c => c.audioUrl)
  const hasCampaigns = activeCampaigns.length > 0

  return (
    <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6 flex flex-col gap-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">
        Ad Placements
      </div>

      {/* Pre / post roll toggles */}
      <div className="flex items-center gap-6">
        {(['preRoll', 'postRoll'] as const).map(key => (
          <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={markers[key]}
              onChange={e => { setMarkers(prev => ({ ...prev, [key]: e.target.checked })); setSaved(false) }}
              className="w-3.5 h-3.5 accent-[var(--ink)]"
            />
            <span className="text-[13px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-light)]">
              {key === 'preRoll' ? 'Pre-roll' : 'Post-roll'}
            </span>
          </label>
        ))}
      </div>

      {/* Mid-roll waveform + player */}
      <div>
        <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-2">
          Mid-roll — {audioUrl ? (waveReady ? 'play to find your spot, then mark it' : 'loading waveform…') : 'generate audio first'}
        </div>
        {audioUrl && (
          <>
            <div className="relative rounded-[2px] overflow-hidden">
              <div ref={containerRef} />
              {waveReady && markers.midRoll.map(t => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 w-px bg-[var(--accent)] pointer-events-none"
                  style={{ left: `${(t / duration) * 100}%` }}
                />
              ))}
            </div>
            {waveReady && (
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handlePlayPause}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-[var(--ink)] text-white hover:bg-[#2a2825] transition-colors shrink-0"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
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
                <button
                  onClick={handleMarkHere}
                  className="px-3 py-1 text-[11px] font-semibold font-[family-name:var(--font-dm-mono)] text-[var(--accent)] border border-[var(--accent)] rounded-[2px] hover:bg-red-50 transition-colors"
                >
                  Mark here
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Mid-roll marker chips */}
      {markers.midRoll.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {markers.midRoll.map(t => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[2px] bg-[var(--bg-warm)] text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--ink)]"
            >
              {formatTime(t)}
              <button
                onClick={() => removeMidRoll(t)}
                className="text-[var(--ink-faint)] hover:text-[var(--accent)] leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Megaphone DAI marker save row */}
      <div className="flex items-center gap-3 pt-1 border-t border-[var(--rule)]">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
        >
          {saving ? 'Saving…' : isPublished ? 'Save & sync to Megaphone →' : 'Save ad markers'}
        </button>
        {saved && !saving && (
          <span className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Saved</span>
        )}
        {saveWarning && !saving && (
          <span className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">{saveWarning}</span>
        )}
        {saveError && (
          <span className="text-[11px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{saveError}</span>
        )}
      </div>

      {/* ── Sponsor Campaigns ──────────────────────────────────────────── */}
      <div className="pt-2 border-t border-[var(--rule)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-3">
          Sponsor Campaigns
        </div>

        {!hasCampaigns ? (
          <p className="text-[12px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
            No active campaigns with audio yet.{' '}
            <a href="/studio?nav=ads" className="underline hover:text-[var(--ink)]">Create one in Dynamic Ads →</a>
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
              Selected campaigns will be stitched into the audio when this episode publishes.
            </p>
            {activeCampaigns.map(c => {
              const assigned = isAssigned(c.id)
              return (
                <div key={c.id} className="flex items-center gap-3 py-1.5">
                  <input
                    type="checkbox"
                    id={`camp-${c.id}`}
                    checked={assigned}
                    onChange={() => toggleAssignment(c)}
                    className="w-3.5 h-3.5 accent-[var(--ink)] shrink-0"
                  />
                  <label htmlFor={`camp-${c.id}`} className="flex-1 cursor-pointer select-none">
                    <span className="text-[13px] text-[var(--ink)]">{c.name}</span>
                    <span className="ml-2 text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">{c.type}</span>
                  </label>
                  {c.type === 'mid-roll' && assigned && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">at</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={insertAtInputs[c.id] ?? ''}
                        onChange={e => updateInsertAt(c.id, e.target.value)}
                        placeholder="sec"
                        className="w-20 border border-[var(--rule)] rounded-[2px] px-2 py-1 text-[12px] text-[var(--ink)] bg-[var(--bg)] focus:outline-none focus:border-[var(--ink)] transition-colors"
                      />
                      <span className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">s</span>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveAssignments}
                disabled={assignSaving}
                className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
              >
                {assignSaving ? 'Saving…' : 'Save campaign assignments'}
              </button>
              {assignSaved && !assignSaving && (
                <span className="text-[11px] text-[var(--green)] font-[family-name:var(--font-dm-mono)]">Saved — will apply at next publish</span>
              )}
              {assignError && (
                <span className="text-[11px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{assignError}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
