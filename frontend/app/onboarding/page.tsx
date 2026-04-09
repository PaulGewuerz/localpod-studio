'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

interface MeData {
  org: { id: string; name: string }
  show: { id: string; name: string; coverArtUrl: string | null } | null
  subscription: { stripeCustomerId: string | null } | null
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  return session.access_token
}

const STEPS = ['Show info', 'Cover art', 'Subscribe']

// ─── iTunes / Megaphone category data ─────────────────────────────────────────

const NEWS_SUBCATS = ['Business News', 'Daily News', 'Entertainment News', 'News Commentary', 'Politics', 'Sports News', 'Tech News']

const OTHER_CATS: { name: string; subcategories: string[] }[] = [
  { name: 'Arts',                  subcategories: ['Books', 'Design', 'Fashion & Beauty', 'Food', 'Performing Arts', 'Visual Arts'] },
  { name: 'Business',              subcategories: ['Careers', 'Entrepreneurship', 'Investing', 'Management', 'Marketing', 'Non-Profit'] },
  { name: 'Comedy',                subcategories: ['Comedy Interviews', 'Improv', 'Stand-Up'] },
  { name: 'Education',             subcategories: ['Courses', 'How To', 'Language Learning', 'Self-Improvement'] },
  { name: 'Fiction',               subcategories: ['Comedy Fiction', 'Drama', 'Science Fiction'] },
  { name: 'Government',            subcategories: [] },
  { name: 'Health & Fitness',      subcategories: ['Alternative Health', 'Fitness', 'Medicine', 'Mental Health', 'Nutrition', 'Sexuality'] },
  { name: 'History',               subcategories: [] },
  { name: 'Kids & Family',         subcategories: ['Education for Kids', 'Parenting', 'Pets & Animals', 'Stories for Kids'] },
  { name: 'Leisure',               subcategories: ['Animation & Manga', 'Automotive', 'Aviation', 'Crafts', 'Games', 'Hobbies', 'Home & Garden', 'Video Games'] },
  { name: 'Music',                 subcategories: ['Music Commentary', 'Music History', 'Music Interviews'] },
  { name: 'Religion & Spirituality', subcategories: ['Buddhism', 'Christianity', 'Hinduism', 'Islam', 'Judaism', 'Spirituality'] },
  { name: 'Science',               subcategories: ['Astronomy', 'Chemistry', 'Earth Sciences', 'Life Sciences', 'Mathematics', 'Natural Sciences', 'Nature', 'Physics', 'Social Sciences'] },
  { name: 'Society & Culture',     subcategories: ['Documentary', 'Personal Journals', 'Philosophy', 'Places & Travel', 'Relationships'] },
  { name: 'Sports',                subcategories: ['Baseball', 'Basketball', 'Cricket', 'Fantasy Sports', 'Football', 'Golf', 'Hockey', 'Rugby', 'Running', 'Soccer', 'Swimming', 'Tennis', 'Wilderness', 'Wrestling'] },
  { name: 'Technology',            subcategories: [] },
  { name: 'True Crime',            subcategories: [] },
  { name: 'TV & Film',             subcategories: ['After Shows', 'Film History', 'Film Interviews', 'Film Reviews', 'TV Reviews'] },
]

// ─── Category picker component ────────────────────────────────────────────────

const MAX_CATEGORIES = 3

function CategoryPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [showOthers, setShowOthers] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  function toggle(full: string) {
    if (value.includes(full)) {
      onChange(value.filter(v => v !== full))
    } else if (value.length < MAX_CATEGORIES) {
      onChange([...value, full])
    }
  }

  function Chip({ label, full }: { label: string; full: string }) {
    const selected = value.includes(full)
    const atMax = value.length >= MAX_CATEGORIES
    return (
      <button
        type="button"
        onClick={() => toggle(full)}
        disabled={!selected && atMax}
        className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
          selected
            ? 'bg-blue-600 text-white border-blue-600'
            : atMax
            ? 'bg-white text-gray-300 border-gray-100 cursor-not-allowed'
            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
        }`}
      >
        {selected && <span className="mr-1">✓</span>}{label}
      </button>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-sm">
      {/* News — highlighted at top, always visible */}
      <div className="bg-blue-50 border-b border-blue-100 px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => toggle('News')}
            disabled={!value.includes('News') && value.length >= MAX_CATEGORIES}
            className={`font-medium transition-colors ${value.includes('News') ? 'text-blue-700' : value.length >= MAX_CATEGORIES ? 'text-gray-300 cursor-not-allowed' : 'text-gray-800 hover:text-blue-600'}`}
          >
            {value.includes('News') && '✓ '}News
          </button>
          <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">Popular</span>
          <span className="text-xs text-gray-400 ml-auto">pick up to {MAX_CATEGORIES} categories</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {NEWS_SUBCATS.map(sub => <Chip key={sub} label={sub} full={`News > ${sub}`} />)}
        </div>
      </div>

      {/* Other categories */}
      <button
        type="button"
        onClick={() => setShowOthers(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span>Other categories</span>
        <span>{showOthers ? '▴' : '▾'}</span>
      </button>

      {showOthers && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {OTHER_CATS.map(cat => {
            const isActive = value.includes(cat.name) || value.some(v => v.startsWith(cat.name + ' > '))
            const isExpanded = expandedGroup === cat.name
            const atMax = value.length >= MAX_CATEGORIES
            return (
              <div key={cat.name}>
                <button
                  type="button"
                  onClick={() => {
                    if (cat.subcategories.length > 0) {
                      setExpandedGroup(isExpanded ? null : cat.name)
                    } else {
                      toggle(cat.name)
                    }
                  }}
                  disabled={!isActive && atMax && cat.subcategories.length === 0}
                  className={`w-full flex items-center justify-between px-3 py-2 transition-colors ${
                    isActive ? 'text-blue-600 bg-blue-50' : atMax && cat.subcategories.length === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span>{isActive && '✓ '}{cat.name}</span>
                  {cat.subcategories.length > 0 && <span className="text-gray-400 text-xs">{isExpanded ? '▴' : '▾'}</span>}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2.5 pt-1 flex flex-wrap gap-1.5 bg-gray-50">
                    {cat.subcategories.map(sub => <Chip key={sub} label={sub} full={`${cat.name} > ${sub}`} />)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {value.length > 0 && (
        <div className="border-t border-gray-100 px-3 py-1.5 bg-white space-y-1">
          {value.map((v, i) => (
            <div key={v} className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {i === 0 ? 'Primary' : `Category ${i + 1}`}: <span className="font-medium text-gray-700">{v}</span>
              </span>
              <button type="button" onClick={() => onChange(value.filter(x => x !== v))} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [me, setMe] = useState<MeData | null>(null)
  const [showName, setShowName] = useState('')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return }
      const token = session.access_token

      try {
        const [meRes] = await Promise.all([
          fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } }),
        ])

        if (meRes.status === 403) {
          // New self-signup user — create their backend account then re-fetch
          const regRes = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!regRes.ok) { setError('Failed to create account. Please try again.'); return }
          const meRes2 = await fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } })
          if (!meRes2.ok) { router.replace('/login'); return }
          const meData2: MeData = await meRes2.json()
          if (meData2.subscription?.stripeCustomerId) { router.replace('/studio'); return }
          setMe(meData2)
          setShowName(meData2.show?.name ?? meData2.org.name)
          return
        }
        if (!meRes.ok) { router.replace('/login'); return }

        const meData: MeData = await meRes.json()

        // Already onboarded
        if (meData.subscription?.stripeCustomerId) { router.replace('/studio'); return }

        setMe(meData)
        setShowName(meData.show?.name ?? meData.org.name)
      } catch {
        router.replace('/login')
      }
    })
  }, [router])

  async function savePreferences() {
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      let coverArtUrl: string | undefined

      // Upload cover art if provided
      if (coverFile) {
        const uploadRes = await fetch(`${API_URL}/me/cover-art`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': coverFile.type },
          body: coverFile,
        })
        if (!uploadRes.ok) {
          const data = await uploadRes.json()
          throw new Error('Cover art upload failed: ' + (data.error ?? uploadRes.statusText))
        }
        const { url } = await uploadRes.json()
        coverArtUrl = url
      }

      const patchRes = await fetch(`${API_URL}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          showName,
          author: author || undefined,
          description: description || undefined,
          categories: categories.length > 0 ? categories : undefined,
          ...(coverArtUrl ? { coverArtUrl } : {}),
        }),
      })
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}))
        throw new Error('Failed to save show details: ' + (data.error ?? patchRes.statusText))
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSubscribe() {
    setSaving(true)
    setError(null)
    try {
      await savePreferences()
      const token = await getToken()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/billing/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: session!.user.email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout session')
      window.location.href = data.url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  if (!me) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        {error
          ? <p className="text-red-500 text-sm">{error}</p>
          : <p className="text-gray-400">Loading…</p>
        }
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0
                ${i < step ? 'bg-blue-600 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${i === step ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-8">
          {/* Step 1: Show info */}
          {step === 0 && (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-1">Tell us about your show</h1>
              <p className="text-sm text-gray-500 mb-6">
                This is how your podcast appears on Spotify, Apple Podcasts, and more.{' '}
                <span className="text-gray-400">You can change everything here later.</span>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Show name <span className="text-red-400">*</span></label>
                  <input
                    autoFocus
                    className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={showName}
                    onChange={e => setShowName(e.target.value)}
                    placeholder="e.g. The Springfield Gazette Daily"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Publishing company</label>
                  <input
                    className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={author}
                    onChange={e => setAuthor(e.target.value)}
                    placeholder="e.g. Springfield Media Group"
                  />
                  <p className="text-xs text-gray-400 mt-1">Shown as the podcast author on Spotify, Apple Podcasts, etc.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Show description</label>
                  <textarea
                    rows={3}
                    className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="A short description of what your show covers…"
                  />
                  <p className="text-xs text-gray-400 mt-1">Shown on Apple Podcasts, Spotify, and your RSS feed when listeners browse for shows.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Category</label>
                  <CategoryPicker value={categories} onChange={setCategories} />
                  <p className="text-xs text-gray-400 mt-1">Used to place your show in the right section on Apple Podcasts and Spotify.</p>
                </div>
              </div>
              <button
                onClick={() => setStep(1)}
                disabled={!showName.trim()}
                className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors"
              >
                Continue →
              </button>
            </>
          )}

          {/* Step 2: Cover art (skippable) */}
          {step === 1 && (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-1">Add cover art</h1>
              <p className="text-sm text-gray-500 mb-6">3000 × 3000px recommended. You can add this later.</p>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-gray-300 transition-colors"
              >
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover preview" className="w-40 h-40 object-cover rounded-lg" />
                ) : (
                  <>
                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-500">Click to upload image</p>
                    <p className="text-xs text-gray-400 mt-1">PNG or JPG</p>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFileChange} />
              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(0)} className="flex-1 py-3 border border-gray-300 text-gray-600 font-medium rounded-lg hover:border-gray-400 transition-colors text-sm">
                  Back
                </button>
                <button onClick={() => setStep(2)} className="flex-1 py-3 border border-gray-300 text-gray-500 font-medium rounded-lg hover:border-gray-400 transition-colors text-sm">
                  Skip for now
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!coverFile}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors text-sm"
                >
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* Step 3: Subscribe */}
          {step === 2 && (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-1">Start your subscription</h1>
              <p className="text-sm text-gray-500 mb-6">You're all set. Activate your account to start publishing.</p>
              <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Show</span>
                  <span className="font-medium text-gray-900">{showName}</span>
                </div>
                {author && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Publisher</span>
                    <span className="font-medium text-gray-900">{author}</span>
                  </div>
                )}
                {categories.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Categories</span>
                    <span className="font-medium text-gray-900 text-right">{categories.join(', ')}</span>
                  </div>
                )}
                {coverFile && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cover art</span>
                    <span className="font-medium text-gray-900">Uploaded</span>
                  </div>
                )}
              </div>
              {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
              <button
                onClick={handleSubscribe}
                disabled={saving}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
              >
                {saving ? 'Redirecting to checkout…' : 'Activate account →'}
              </button>
              <button onClick={() => setStep(1)} className="w-full mt-3 text-sm text-gray-500 hover:text-gray-700">
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
