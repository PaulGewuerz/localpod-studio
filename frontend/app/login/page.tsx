'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL
const IS_DEV = process.env.NODE_ENV === 'development'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [devLoading, setDevLoading] = useState(false)

  async function handleDevLogin() {
    setDevLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/dev-login`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Dev login failed')
      window.location.href = data.url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Dev login failed')
      setDevLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Check your email</h1>
          <p className="text-gray-500">We sent a magic link to <strong>{email}</strong>. Click it to sign in.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6 text-center">Sign in to LocalPod Studio</h1>

        {IS_DEV && (
          <div className="mb-6 p-3 border border-dashed border-gray-300 rounded-lg">
            <p className="text-xs text-gray-400 mb-2 font-mono">DEV MODE</p>
            <button
              onClick={handleDevLogin}
              disabled={devLoading}
              className="w-full bg-gray-800 text-white py-2 rounded-lg font-medium hover:bg-black disabled:opacity-50 text-sm"
            >
              {devLoading ? 'Signing in…' : 'One-click dev login'}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      </div>
    </main>
  )
}
