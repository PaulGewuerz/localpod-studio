'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL
const MONTHLY_CHAR_LIMIT = 150_000

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CharBar({ used, limit = MONTHLY_CHAR_LIMIT }: { used: number; limit?: number }) {
  const pct = Math.min(100, (used / limit) * 100)
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-400' : 'bg-blue-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 shrink-0 font-mono">{used.toLocaleString()} / {limit.toLocaleString()}</span>
    </div>
  )
}

interface Voice { id: string; name: string; elevenLabsId: string }
interface Show {
  id: string
  name: string
  megaphoneShowId: string | null
  megaphoneRssUrl: string | null
  episodeCount: number
  totalChars: number
  monthlyChars: number
  lastEpisodeAt: string | null
  lastEpisodeStatus: string | null
}

interface Publisher {
  id: string
  name: string
  createdAt: string
  defaultVoice: { id: string; name: string } | null
  users: { id: string; email: string }[]
  subscription: { status: string; plan: string | null } | null
  shows: Show[]
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

  // Inline edit state — keyed by orgId for org-level fields, showId for show-level fields
  const [editingOrg, setEditingOrg] = useState<Record<string, { defaultVoiceId: string }>>({})
  const [editingShow, setEditingShow] = useState<Record<string, { megaphoneShowId: string; megaphoneRssUrl: string }>>({})
  const [addingShow, setAddingShow] = useState<Record<string, string>>({}) // orgId → new show name
  const [addingUser, setAddingUser] = useState<Record<string, string>>({}) // orgId → new user email
  const [saving, setSaving] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [activating, setActivating] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [provisioning, setProvisioning] = useState<string | null>(null)


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

  function startEditOrg(pub: Publisher) {
    setEditingOrg(prev => ({ ...prev, [pub.id]: { defaultVoiceId: pub.defaultVoice?.id ?? '' } }))
  }

  function startEditShow(show: Show) {
    setEditingShow(prev => ({
      ...prev,
      [show.id]: { megaphoneShowId: show.megaphoneShowId ?? '', megaphoneRssUrl: show.megaphoneRssUrl ?? '' },
    }))
  }

  async function handleSaveOrg(orgId: string) {
    setSaving(orgId)
    try {
      const token = await getToken()
      const { defaultVoiceId } = editingOrg[orgId]
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ defaultVoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setEditingOrg(prev => { const next = { ...prev }; delete next[orgId]; return next })
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  async function handleSaveShow(orgId: string, showId: string) {
    setSaving(showId)
    try {
      const token = await getToken()
      const { megaphoneShowId, megaphoneRssUrl } = editingShow[showId]
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}/shows/${showId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ megaphoneShowId, megaphoneRssUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setEditingShow(prev => { const next = { ...prev }; delete next[showId]; return next })
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  async function handleDeleteOrg(orgId: string, orgName: string) {
    if (!window.confirm(`Delete "${orgName}" and all its data?`)) return
    if (!window.confirm(`This will permanently delete all shows, episodes, and user logins for "${orgName}". Cannot be undone.`)) return
    setSaving(`del-org-${orgId}`)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(null)
    }
  }

  async function handleDeleteUser(orgId: string, userId: string, email: string) {
    if (!window.confirm(`Remove ${email} from this org?`)) return
    if (!window.confirm(`Are you sure? This will delete their login permanently.`)) return
    setSaving(`del-user-${userId}`)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(null)
    }
  }

  async function handleSyncMegaphone(orgId: string, showId: string) {
    setSyncing(showId)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}/shows/${showId}/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(null)
    }
  }

  async function handleProvisionMegaphone(orgId: string, showId: string) {
    setProvisioning(showId)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}/shows/${showId}/provision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Provisioning failed')
    } finally {
      setProvisioning(null)
    }
  }

  async function handleActivate(orgId: string) {
    setActivating(orgId)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Activation failed')
    } finally {
      setActivating(null)
    }
  }

  async function handleAddUser(orgId: string) {
    const email = addingUser[orgId]?.trim()
    if (!email) return
    setSaving(`add-user-${orgId}`)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setAddingUser(prev => { const next = { ...prev }; delete next[orgId]; return next })
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to add user')
    } finally {
      setSaving(null)
    }
  }

  async function handleAddShow(orgId: string) {
    const showName = addingShow[orgId]?.trim()
    if (!showName) return
    setSaving(`add-${orgId}`)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/publishers/${orgId}/shows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ showName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
      setAddingShow(prev => { const next = { ...prev }; delete next[orgId]; return next })
      await loadData(token)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to add show')
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
      <div className="flex items-start justify-between gap-4 mb-10">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">Admin</h1>
          <p className="text-sm text-gray-500">Manage publisher accounts</p>
        </div>
        <button
          onClick={async () => { await supabase.auth.signOut(); router.replace('/login') }}
          className="shrink-0 py-2 px-4 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:border-gray-400 hover:text-gray-900 transition-colors"
        >
          Sign out
        </button>
      </div>

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
        <div className="space-y-4">
          {publishers.map(pub => {
            const edOrg = editingOrg[pub.id]
            const totalMonthlyChars = pub.shows.reduce((sum, s) => sum + s.monthlyChars, 0)
            return (
              <div key={pub.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Org header */}
                <div className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <p className="font-semibold text-gray-900">{pub.name}</p>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${pub.subscription?.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {pub.subscription?.status ?? 'none'}
                      </span>
                      {pub.subscription?.status !== 'active' && (
                        <button
                          onClick={() => handleActivate(pub.id)}
                          disabled={activating === pub.id}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 transition-colors"
                        >
                          {activating === pub.id ? '…' : 'Activate'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteOrg(pub.id, pub.name)}
                        disabled={saving === `del-org-${pub.id}`}
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-50 transition-colors ml-auto"
                      >
                        {saving === `del-org-${pub.id}` ? '…' : 'Delete org'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {pub.users.map(u => (
                        <span key={u.id} className="flex items-center gap-1 text-xs text-gray-500">
                          {u.email}
                          <button
                            onClick={() => handleDeleteUser(pub.id, u.id, u.email)}
                            disabled={saving === `del-user-${u.id}`}
                            className="text-gray-300 hover:text-red-500 disabled:opacity-50 transition-colors leading-none"
                            title="Remove user"
                          >
                            {saving === `del-user-${u.id}` ? '…' : '×'}
                          </button>
                        </span>
                      ))}
                    </div>
                    {addingUser[pub.id] !== undefined ? (
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          autoFocus
                          type="email"
                          className="p-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="user@example.com"
                          value={addingUser[pub.id]}
                          onChange={e => setAddingUser(prev => ({ ...prev, [pub.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddUser(pub.id) }}
                        />
                        <button onClick={() => handleAddUser(pub.id)} disabled={saving === `add-user-${pub.id}`} className="py-1 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-medium rounded-lg transition-colors">
                          {saving === `add-user-${pub.id}` ? '…' : 'Add'}
                        </button>
                        <button onClick={() => setAddingUser(prev => { const next = { ...prev }; delete next[pub.id]; return next })} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setAddingUser(prev => ({ ...prev, [pub.id]: '' }))} className="text-xs text-blue-600 hover:underline mt-1">+ Add user</button>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">Since {fmtDate(pub.createdAt)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400 mb-0.5">This month</p>
                    <p className="text-sm font-semibold text-gray-900">{totalMonthlyChars.toLocaleString()} chars</p>
                    <p className="text-[10px] text-gray-400">{Math.round((totalMonthlyChars / MONTHLY_CHAR_LIMIT) * 100)}% of limit</p>
                  </div>
                </div>

                {/* Shows */}
                <div className="border-t border-gray-100">
                  {pub.shows.map((show, i) => {
                    const edShow = editingShow[show.id]
                    return (
                      <div key={show.id} className={`px-5 py-3.5 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <p className="text-sm font-medium text-gray-800">{show.name}</p>
                              {show.lastEpisodeStatus && (
                                <span className="text-[10px] text-gray-400 font-mono">
                                  last: {show.lastEpisodeStatus} {show.lastEpisodeAt ? fmtDate(show.lastEpisodeAt) : ''}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-3 mb-2.5 text-xs">
                              <div>
                                <p className="text-gray-400 mb-0.5">Episodes</p>
                                <p className="font-semibold text-gray-800">{show.episodeCount}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-0.5">Total chars</p>
                                <p className="font-semibold text-gray-800">{show.totalChars.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-0.5">Megaphone ID</p>
                                <p className="font-mono text-gray-800 truncate">{show.megaphoneShowId || '—'}</p>
                              </div>
                            </div>
                            <CharBar used={show.monthlyChars} />
                          </div>
                          <div className="flex gap-2 shrink-0 mt-0.5">
                            {show.megaphoneRssUrl && (
                              <button onClick={() => copyRss(show.megaphoneRssUrl!, show.id)} className="text-xs text-gray-400 hover:text-blue-600">
                                {copied === show.id ? 'Copied!' : 'RSS'}
                              </button>
                            )}
                            {show.megaphoneShowId ? (
                              <button onClick={() => handleSyncMegaphone(pub.id, show.id)} disabled={syncing === show.id} className="text-xs text-green-600 hover:underline disabled:opacity-50">
                                {syncing === show.id ? '…' : 'Sync'}
                              </button>
                            ) : (
                              <button onClick={() => handleProvisionMegaphone(pub.id, show.id)} disabled={provisioning === show.id} className="text-xs text-amber-600 hover:underline disabled:opacity-50">
                                {provisioning === show.id ? '…' : 'Create Megaphone'}
                              </button>
                            )}
                          {!edShow && (
                              <button onClick={() => startEditShow(show)} className="text-xs text-blue-600 hover:underline">Edit</button>
                            )}
                          </div>
                        </div>

                        {edShow && (
                          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Megaphone show ID</label>
                              <input
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                value={edShow.megaphoneShowId}
                                onChange={e => setEditingShow(prev => ({ ...prev, [show.id]: { ...prev[show.id], megaphoneShowId: e.target.value } }))}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">RSS feed URL</label>
                              <input
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                value={edShow.megaphoneRssUrl}
                                onChange={e => setEditingShow(prev => ({ ...prev, [show.id]: { ...prev[show.id], megaphoneRssUrl: e.target.value } }))}
                              />
                            </div>
                            <div className="col-span-2 flex gap-2">
                              <button onClick={() => handleSaveShow(pub.id, show.id)} disabled={saving === show.id} className="py-1.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors">
                                {saving === show.id ? 'Saving…' : 'Save'}
                              </button>
                              <button onClick={() => setEditingShow(prev => { const next = { ...prev }; delete next[show.id]; return next })} className="py-1.5 px-4 border border-gray-300 text-gray-600 text-sm rounded-lg hover:border-gray-400 transition-colors">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Add show + voice edit */}
                  <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {addingShow[pub.id] !== undefined ? (
                        <>
                          <input
                            autoFocus
                            className="p-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Show name"
                            value={addingShow[pub.id]}
                            onChange={e => setAddingShow(prev => ({ ...prev, [pub.id]: e.target.value }))}
                          />
                          <button onClick={() => handleAddShow(pub.id)} disabled={saving === `add-${pub.id}`} className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-medium rounded-lg transition-colors">
                            {saving === `add-${pub.id}` ? '…' : 'Add'}
                          </button>
                          <button onClick={() => setAddingShow(prev => { const next = { ...prev }; delete next[pub.id]; return next })} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setAddingShow(prev => ({ ...prev, [pub.id]: '' }))} className="text-xs text-blue-600 hover:underline">+ Add show</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {edOrg ? (
                        <>
                          <select
                            className="p-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={edOrg.defaultVoiceId}
                            onChange={e => setEditingOrg(prev => ({ ...prev, [pub.id]: { defaultVoiceId: e.target.value } }))}
                          >
                            <option value="">No default voice</option>
                            {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                          <button onClick={() => handleSaveOrg(pub.id)} disabled={saving === pub.id} className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-medium rounded-lg transition-colors">
                            {saving === pub.id ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingOrg(prev => { const next = { ...prev }; delete next[pub.id]; return next })} className="hover:text-gray-600">Cancel</button>
                        </>
                      ) : (
                        <span>Voice: <button onClick={() => startEditOrg(pub)} className="text-blue-600 hover:underline">{pub.defaultVoice?.name || 'none'}</button></span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
