'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL

interface Voice { id: string; name: string; elevenLabsId: string }
interface Publisher {
  id: string
  name: string
  megaphoneShowId: string | null
  megaphoneRssUrl: string | null
  defaultVoice: { id: string; name: string } | null
  users: { id: string; email: string }[]
  subscription: { status: string; plan: string | null } | null
  shows: { id: string }[]
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  return session.access_token
}

export default function AdminPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [publishers, setPublishers] = useState<Publisher[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // New publisher form
  const [form, setForm] = useState({ orgName: '', email: '', defaultVoiceId: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createResult, setCreateResult] = useState<{ message: string; warnings?: string[] } | null>(null)

  // Inline edit state
  const [editing, setEditing] = useState<Record<string, { megaphoneShowId: string; megaphoneRssUrl: string; defaultVoiceId: string }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)


  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      if (ADMIN_EMAIL && session.user.email !== ADMIN_EMAIL) { router.replace('/studio'); return }
      setReady(true)
      loadData(session.access_token)
    })
  }, [router])

  async function loadData(token: string) {
    setLoadError(null)
    try {
      const [pubRes, voiceRes] = await Promise.all([
        fetch(`${API_URL}/admin/publishers`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/voices`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!pubRes.ok) throw new Error(`Publishers: ${pubRes.status}`)
      setPublishers(await pubRes.json())
      if (voiceRes.ok) setVoices(await voiceRes.json())
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load data')
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreateResult(null)
    setCreating(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orgName: form.orgName,
          email: form.email,
          defaultVoiceId: form.defaultVoiceId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setCreateResult({
        message: `Created "${form.orgName}" — magic link sent to ${form.email}`,
        warnings: data.warnings,
      })
      setForm({ orgName: '', email: '', defaultVoiceId: '' })
      await loadData(await getToken())
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create publisher')
    } finally {
      setCreating(false)
    }
  }

  function startEdit(pub: Publisher) {
    setEditing(prev => ({
      ...prev,
      [pub.id]: {
        megaphoneShowId: pub.megaphoneShowId ?? '',
        megaphoneRssUrl: pub.megaphoneRssUrl ?? '',
        defaultVoiceId: pub.defaultVoice?.id ?? '',
      },
    }))
  }

  async function handleSave(orgId: string) {
    setSaving(orgId)
    try {
      const token = await getToken()
      const { megaphoneShowId, megaphoneRssUrl, defaultVoiceId } = editing[orgId]
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ megaphoneShowId, megaphoneRssUrl, defaultVoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setEditing(prev => { const next = { ...prev }; delete next[orgId]; return next })
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  function copyRss(url: string, id: string) {
    navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }


  if (!ready) return null

  return (
    <main className="min-h-screen bg-gray-50 p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Admin</h1>
      <p className="text-sm text-gray-500 mb-10">Manage publisher accounts</p>

      {/* Create publisher */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 mb-10">
        <h2 className="text-base font-semibold text-gray-900 mb-4">New publisher</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Organization name</label>
              <input
                required
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Springfield Gazette"
                value={form.orgName}
                onChange={e => setForm(f => ({ ...f, orgName: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Publisher email</label>
              <input
                required
                type="email"
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="editor@gazette.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Default voice</label>
              <select
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.defaultVoiceId}
                onChange={e => setForm(f => ({ ...f, defaultVoiceId: e.target.value }))}
              >
                <option value="">None</option>
                {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400">Megaphone show will be created automatically.</p>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          {createResult && (
            <div className="text-sm">
              <p className="text-green-700">{createResult.message}</p>
              {createResult.warnings?.map((w, i) => (
                <p key={i} className="text-yellow-700 mt-1">⚠ {w}</p>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={creating}
            className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {creating ? 'Creating…' : 'Create publisher →'}
          </button>
        </form>
      </section>

      {/* Publishers list */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Publishers ({publishers.length})
        </h2>
        {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}
        {publishers.length === 0 && !loadError && (
          <p className="text-sm text-gray-400">No publishers yet.</p>
        )}
        <div className="space-y-3">
          {publishers.map(pub => {
            const ed = editing[pub.id]
            return (
              <div key={pub.id} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{pub.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {pub.users.map(u => u.email).join(', ')}
                    </p>
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                      <span>
                        Megaphone ID: <span className="text-gray-900 font-mono">{pub.megaphoneShowId || '—'}</span>
                      </span>
                      <span>
                        Voice: <span className="text-gray-900">{pub.defaultVoice?.name || '—'}</span>
                      </span>
                      <span>
                        Status: <span className={`font-medium ${pub.subscription?.status === 'active' ? 'text-green-700' : 'text-yellow-600'}`}>
                          {pub.subscription?.status ?? 'none'}
                        </span>
                      </span>
                    </div>
                    {pub.megaphoneRssUrl && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-400 truncate max-w-xs">{pub.megaphoneRssUrl}</span>
                        <button
                          onClick={() => copyRss(pub.megaphoneRssUrl!, pub.id)}
                          className="text-xs text-blue-600 hover:underline shrink-0"
                        >
                          {copied === pub.id ? 'Copied!' : 'Copy RSS'}
                        </button>
                      </div>
                    )}
                  </div>
                    <div className="flex gap-3 shrink-0">
                    {!ed && (
                      <button onClick={() => startEdit(pub)} className="text-xs text-blue-600 hover:underline">Edit</button>
                    )}
                  </div>
                </div>

                {ed && (
                  <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Megaphone show ID</label>
                      <input
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={ed.megaphoneShowId}
                        onChange={e => setEditing(prev => ({ ...prev, [pub.id]: { ...prev[pub.id], megaphoneShowId: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Default voice</label>
                      <select
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={ed.defaultVoiceId}
                        onChange={e => setEditing(prev => ({ ...prev, [pub.id]: { ...prev[pub.id], defaultVoiceId: e.target.value } }))}
                      >
                        <option value="">None</option>
                        {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">RSS feed URL</label>
                      <input
                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                        value={ed.megaphoneRssUrl}
                        onChange={e => setEditing(prev => ({ ...prev, [pub.id]: { ...prev[pub.id], megaphoneRssUrl: e.target.value } }))}
                      />
                    </div>
                    <div className="col-span-2 flex gap-2">
                      <button
                        onClick={() => handleSave(pub.id)}
                        disabled={saving === pub.id}
                        className="py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {saving === pub.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditing(prev => { const next = { ...prev }; delete next[pub.id]; return next })}
                        className="py-2 px-4 border border-gray-300 text-gray-600 text-sm rounded-lg hover:border-gray-400 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
