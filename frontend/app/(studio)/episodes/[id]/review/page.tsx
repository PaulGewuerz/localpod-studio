'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface ParagraphMeta {
  order: number
  text: string
  timeStart: number
  timeEnd: number
}

interface Episode {
  id: string
  title: string
  status: string
  audioUrl: string | null
  scriptText: string | null
  paragraphMeta: string | null
  description: string | null
  megaphoneEpisodeId: string | null
  createdAt: string
  voice: { name: string } | null
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  return session.access_token
}

export default function EpisodeReviewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [episode, setEpisode] = useState<Episode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Paragraph state
  const [paragraphs, setParagraphs] = useState<ParagraphMeta[]>([])
  const [editingOrder, setEditingOrder] = useState<number | null>(null)
  const [editedText, setEditedText] = useState('')
  const [regeneratingOrder, setRegeneratingOrder] = useState<number | null>(null)

  // Full-script fallback state (when no paragraphMeta)
  const [fullEditing, setFullEditing] = useState(false)
  const [editedScript, setEditedScript] = useState('')
  const [fullRegenerating, setFullRegenerating] = useState(false)

  const [downloads, setDownloads] = useState<number | null>(null)

  // Title / description editing
  const [editingMeta, setEditingMeta] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)

  const [approving, setApproving] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const minDateTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
    })
  }, [router])

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const res = await fetch(`${API_URL}/episodes/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`Failed to load episode (${res.status})`)
        const data: Episode = await res.json()
        setEpisode(data)
        setEditedScript(data.scriptText ?? '')
        if (data.paragraphMeta) {
          setParagraphs(JSON.parse(data.paragraphMeta))
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load episode.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // Fetch download count for published episodes
  useEffect(() => {
    if (!episode?.megaphoneEpisodeId || episode.status !== 'published') return
    const megId = episode.megaphoneEpisodeId
    getToken().then(token =>
      fetch(`${API_URL}/analytics`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          const match = data.episodes?.find((e: { megaphoneId: string; downloads: number }) => e.megaphoneId === megId)
          if (match) setDownloads(match.downloads)
        })
        .catch(() => {})
    )
  }, [episode?.megaphoneEpisodeId, episode?.status])

  function startEditParagraph(para: ParagraphMeta) {
    setEditingOrder(para.order)
    setEditedText(para.text)
    setActionError(null)
  }

  function cancelEditParagraph() {
    setEditingOrder(null)
    setEditedText('')
  }

  async function handleParagraphRegenerate(order: number) {
    if (!editedText.trim()) return
    setRegeneratingOrder(order)
    setActionError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/episodes/${id}/paragraphs/${order}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: editedText }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Regenerate failed (${res.status})`)
      }
      const updated = await res.json()
      setEpisode(prev => prev ? { ...prev, audioUrl: updated.audioUrl, status: 'draft' } : prev)
      setParagraphs(updated.paragraphMeta)
      setEditingOrder(null)
      setEditedText('')
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setRegeneratingOrder(null)
    }
  }

  async function handleFullRegenerate() {
    if (!editedScript.trim()) return
    setFullRegenerating(true)
    setActionError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/episodes/${id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptText: editedScript }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Regenerate failed (${res.status})`)
      }
      const updated = await res.json()
      setEpisode(prev => prev ? { ...prev, audioUrl: updated.audioUrl, scriptText: editedScript, status: 'draft' } : prev)
      setFullEditing(false)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setFullRegenerating(false)
    }
  }

  function startEditMeta() {
    setEditedTitle(episode!.title)
    setEditedDescription(episode!.description ?? '')
    setEditingMeta(true)
    setActionError(null)
  }

  async function handleSaveMeta() {
    if (!editedTitle.trim()) { setActionError('Title cannot be empty.'); return }
    setSavingMeta(true)
    setActionError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/episodes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: editedTitle.trim(), description: editedDescription.trim() || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Save failed (${res.status})`)
      }
      const updated = await res.json()
      setEpisode(prev => prev ? { ...prev, title: updated.title, description: updated.description } : prev)
      setEditingMeta(false)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSavingMeta(false)
    }
  }

  async function handleApprove() {
    setApproving(true)
    setActionError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/episodes/${id}/approve`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Approve failed (${res.status})`)
      }
      router.push('/studio?nav=episodes')
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
      setApproving(false)
    }
  }

  async function handleSchedule() {
    if (!scheduleDate) { setActionError('Please pick a date and time.'); return }
    setScheduling(true)
    setActionError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          episodeId: id,
          title: episode!.title,
          pubdate: new Date(scheduleDate).toISOString(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Schedule failed (${res.status})`)
      }
      router.push('/studio?nav=episodes')
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
      setScheduling(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] text-sm">Loading…</p>
      </div>
    )
  }

  if (error || !episode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--accent)] font-[family-name:var(--font-dm-mono)] text-sm">{error ?? 'Episode not found.'}</p>
      </div>
    )
  }

  const hasParagraphs = paragraphs.length > 0

  return (
    <div className="min-h-screen bg-[var(--bg)]">

      {/* Top bar */}
      <header className="bg-white border-b border-[var(--rule)] px-8 h-14 flex items-center gap-4 sticky top-0 z-30">
        <button
          onClick={() => router.push('/studio?nav=episodes')}
          className="text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors"
        >
          ← Episodes
        </button>
        <span className="text-[var(--rule)]">|</span>
        <h1 className="font-[family-name:var(--font-nunito)] font-bold text-[15px] text-[var(--ink)] truncate flex-1">
          {editingMeta ? (
            <input
              autoFocus
              value={editedTitle}
              onChange={e => setEditedTitle(e.target.value)}
              className="w-full border-b border-[var(--ink)] bg-transparent focus:outline-none font-[family-name:var(--font-nunito)] font-bold text-[15px] text-[var(--ink)]"
            />
          ) : episode.title}
        </h1>
        {!editingMeta && (
          <button
            onClick={startEditMeta}
            className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors shrink-0"
          >
            Edit title & description
          </button>
        )}
        {editingMeta && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { setEditingMeta(false); setActionError(null) }}
              className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveMeta}
              disabled={savingMeta}
              className="px-3 py-1 text-[11px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
            >
              {savingMeta ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[10px] font-medium font-[family-name:var(--font-dm-mono)] uppercase tracking-[0.04em] ${
          episode.status === 'approved'  ? 'bg-[var(--blue-light)] text-[var(--blue)]' :
          episode.status === 'published' ? 'bg-[var(--green-light)] text-[var(--green)]' :
          'bg-[var(--bg-warm)] text-[var(--ink-faint)]'
        }`}>
          <span className="w-[5px] h-[5px] rounded-full bg-current inline-block" />
          {episode.status}
        </span>
      </header>

      <div className="max-w-3xl mx-auto px-8 py-8 flex flex-col gap-6">

        {/* Meta: description + downloads */}
        <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6 flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-1.5">Description</div>
            {editingMeta ? (
              <textarea
                value={editedDescription}
                onChange={e => setEditedDescription(e.target.value)}
                placeholder="Optional episode description"
                className="w-full border border-[var(--rule)] rounded-[2px] px-3 py-2.5 text-[13px] font-[family-name:var(--font-dm-sans)] leading-relaxed bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink)] resize-y min-h-[80px] transition-colors"
              />
            ) : episode.description ? (
              <p
                className="text-[13px] text-[var(--ink-light)] leading-relaxed [&_a]:text-[var(--blue)] [&_a]:underline [&_a]:underline-offset-2"
                dangerouslySetInnerHTML={{ __html: episode.description }}
              />
            ) : (
              <p className="text-[13px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">No description set.</p>
            )}
          </div>
          {downloads !== null && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-1.5">Downloads</div>
              <p className="text-[22px] font-bold font-[family-name:var(--font-nunito)] text-[var(--ink)] leading-none">{downloads.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Audio player */}
        <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] mb-3">
            Audio Preview
          </div>
          {episode.audioUrl ? (
            <audio key={episode.audioUrl} controls src={episode.audioUrl} className="w-full" />
          ) : (
            <p className="text-[13px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">No audio available.</p>
          )}
          {episode.voice && (
            <div className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-2">
              Voice: {episode.voice.name}
            </div>
          )}
        </div>

        {/* Script — paragraph mode */}
        {hasParagraphs && (
          <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">
                Script
              </div>
              <span className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
                Click any paragraph to edit
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {paragraphs.map(para => {
                const isEditing = editingOrder === para.order
                const isRegenerating = regeneratingOrder === para.order

                return (
                  <div
                    key={para.order}
                    className={`rounded-[2px] border transition-colors ${
                      isEditing
                        ? 'border-[var(--ink)] bg-white'
                        : 'border-[var(--rule)] bg-[var(--bg)] hover:border-[var(--ink-faint)] cursor-pointer'
                    }`}
                  >
                    {isEditing ? (
                      <div className="p-3">
                        <textarea
                          autoFocus
                          value={editedText}
                          onChange={e => setEditedText(e.target.value)}
                          className="w-full text-[13px] font-[family-name:var(--font-dm-sans)] leading-relaxed resize-y bg-white text-[var(--ink)] focus:outline-none min-h-[80px]"
                        />
                        <div className="flex items-center justify-between mt-2">
                          <button
                            onClick={cancelEditParagraph}
                            className="text-[11px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleParagraphRegenerate(para.order)}
                            disabled={isRegenerating || !editedText.trim()}
                            className="px-4 py-1.5 text-[12px] font-semibold font-[family-name:var(--font-dm-mono)] text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
                          >
                            {isRegenerating ? (
                              <span className="flex items-center gap-2">
                                <span className="lp-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                                Regenerating…
                              </span>
                            ) : 'Regenerate paragraph →'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="px-3.5 py-3"
                        onClick={() => editingOrder === null && startEditParagraph(para)}
                      >
                        <p className="text-[13px] font-[family-name:var(--font-dm-sans)] leading-relaxed text-[var(--ink-light)]">
                          {para.text}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Script — full fallback (no paragraphMeta) */}
        {!hasParagraphs && (
          <div className="bg-white border border-[var(--rule)] rounded-[2px] p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)]">
                Script
              </div>
              {!fullEditing && (
                <span className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)]">
                  {(episode.scriptText ?? '').trim().split(/\s+/).filter(Boolean).length} words
                </span>
              )}
            </div>
            <textarea
              readOnly={!fullEditing}
              value={fullEditing ? editedScript : (episode.scriptText ?? '')}
              onChange={e => setEditedScript(e.target.value)}
              className={`w-full min-h-[280px] resize-y text-[13px] font-[family-name:var(--font-dm-sans)] leading-relaxed rounded-[2px] px-3.5 py-3.5 transition-colors ${
                fullEditing
                  ? 'border border-[var(--ink)] bg-white text-[var(--ink)] focus:outline-none'
                  : 'border border-[var(--rule)] bg-[var(--bg)] text-[var(--ink-light)] cursor-default'
              }`}
            />
            {fullEditing && (
              <div className="text-[11px] text-[var(--ink-faint)] font-[family-name:var(--font-dm-mono)] mt-1.5">
                {editedScript.trim().split(/\s+/).filter(Boolean).length} words
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="bg-white border border-[var(--rule)] rounded-[2px] p-5 flex flex-col gap-4">

          {/* Full-script edit toggle (fallback mode only) */}
          {!hasParagraphs && (
            <div className="flex items-center justify-between border-b border-[var(--rule)] pb-4">
              <button
                onClick={() => { setFullEditing(e => !e); setActionError(null) }}
                className="text-[13px] font-semibold text-[var(--ink-light)] border border-[var(--rule)] rounded-[2px] px-4 py-2 hover:border-[var(--ink-light)] hover:text-[var(--ink)] transition-colors"
              >
                {fullEditing ? 'Cancel Edit' : 'Edit & Regenerate'}
              </button>
              {fullEditing && (
                <button
                  onClick={handleFullRegenerate}
                  disabled={fullRegenerating || !editedScript.trim()}
                  className="px-4 py-2 text-[13px] font-semibold text-white bg-[var(--ink)] hover:bg-[#2a2825] disabled:opacity-50 rounded-[2px] transition-colors"
                >
                  {fullRegenerating ? (
                    <span className="flex items-center gap-2">
                      <span className="lp-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                      Regenerating…
                    </span>
                  ) : 'Regenerate Audio →'}
                </button>
              )}
            </div>
          )}

          {/* Schedule expander */}
          {showSchedule && (
            <div className="flex items-center gap-3">
              <input
                type="datetime-local"
                min={minDateTime}
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
                className="border border-[var(--rule)] rounded-[2px] px-3 py-2 text-[13px] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink)] transition-colors"
              />
              <button
                onClick={handleSchedule}
                disabled={scheduling || !scheduleDate}
                className="px-4 py-2 text-[13px] font-semibold text-white bg-[var(--blue)] hover:opacity-90 disabled:opacity-50 rounded-[2px] transition-colors"
              >
                {scheduling ? 'Scheduling…' : 'Confirm Schedule →'}
              </button>
              <button
                onClick={() => { setShowSchedule(false); setScheduleDate(''); setActionError(null) }}
                className="text-[12px] font-[family-name:var(--font-dm-mono)] text-[var(--ink-faint)] hover:text-[var(--ink)]"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Publish actions row */}
          {!showSchedule && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => router.push('/studio?nav=episodes')}
                className="px-4 py-2 text-[13px] font-semibold text-[var(--ink-faint)] border border-[var(--rule)] rounded-[2px] hover:text-[var(--ink)] hover:border-[var(--ink-light)] transition-colors"
              >
                Save as Draft
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setShowSchedule(true); setActionError(null) }}
                  disabled={episode.status === 'published' || episode.status === 'scheduled'}
                  className="px-4 py-2 text-[13px] font-semibold text-[var(--blue)] border border-[var(--blue)] rounded-[2px] hover:bg-[var(--blue-light)] disabled:opacity-40 transition-colors"
                >
                  Schedule →
                </button>
                <button
                  onClick={handleApprove}
                  disabled={approving || episode.status === 'published'}
                  className="px-5 py-2 text-[13px] font-semibold text-white bg-[var(--green)] hover:bg-[#155c38] disabled:opacity-50 rounded-[2px] transition-colors"
                >
                  {approving ? 'Publishing…' : episode.status === 'published' ? 'Published ✓' : 'Approve & Publish →'}
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <p className="text-[12px] text-[var(--accent)] font-[family-name:var(--font-dm-mono)]">{actionError}</p>
          )}
        </div>

      </div>
    </div>
  )
}
