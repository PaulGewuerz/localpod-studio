'use client'

import { useEffect, useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface AdMarkers {
  preRoll: boolean
  postRoll: boolean
  midRoll: number[]
}

interface Props {
  audioUrl: string | null
  episodeId: string
  isPublished: boolean
  initialMarkers: AdMarkers | null
  getToken: () => Promise<string>
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function AdMarkersPanel({ audioUrl, episodeId, isPublished, initialMarkers, getToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsRef = useRef<any>(null)
  const [duration, setDuration] = useState(0)
  const [waveReady, setWaveReady] = useState(false)
  const [markers, setMarkers] = useState<AdMarkers>(
    initialMarkers ?? { preRoll: false, postRoll: false, midRoll: [] }
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveWarning, setSaveWarning] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ws: any = null

    import('wavesurfer.js').then(({ default: WaveSurfer }) => {
      if (!containerRef.current) return
      ws = WaveSurfer.create({
        container: containerRef.current,
        url: audioUrl,
        waveColor: 'var(--rule)',
        progressColor: 'var(--ink-faint)',
        height: 72,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        interact: false,
      })
      ws.on('ready', () => {
        setDuration(ws!.getDuration())
        setWaveReady(true)
      })
      wsRef.current = ws
    })

    return () => { ws?.destroy() }
  }, [audioUrl])

  function handleWaveformClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    const time = Math.round(pct * duration * 10) / 10
    setMarkers(prev => {
      if (prev.midRoll.includes(time)) return prev
      return { ...prev, midRoll: [...prev.midRoll, time].sort((a, b) => a - b) }
    })
    setSaved(false)
  }

  function removeMidRoll(time: number) {
    setMarkers(prev => ({ ...prev, midRoll: prev.midRoll.filter(t => t !== time) }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveWarning(null)
    setSaved(false)
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

      {/* Mid-roll waveform */}
      <div>
        <div className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-2">
          Mid-roll — {audioUrl ? (waveReady ? 'click waveform to place markers' : 'loading waveform…') : 'generate audio first'}
        </div>
        {audioUrl && (
          <div
            className="relative rounded-[2px] overflow-hidden"
            style={{ cursor: waveReady ? 'crosshair' : 'default' }}
            onClick={waveReady ? handleWaveformClick : undefined}
          >
            <div ref={containerRef} />
            {/* Marker lines */}
            {waveReady && markers.midRoll.map(t => (
              <div
                key={t}
                className="absolute top-0 bottom-0 w-px bg-[var(--accent)] pointer-events-none"
                style={{ left: `${(t / duration) * 100}%` }}
              />
            ))}
          </div>
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

      {/* Save row */}
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
    </div>
  )
}
