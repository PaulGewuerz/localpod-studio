'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function AcceptInviteInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Parse hash fragment — Supabase sends access_token + refresh_token for invites
  const hashParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.hash.slice(1))
    : new URLSearchParams()

  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  const type = hashParams.get('type') || searchParams.get('type')
  const tokenHash = searchParams.get('token_hash')

  const isValid = type === 'invite' && (accessToken || tokenHash)

  if (!isValid) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm text-center">
          <p className="text-red-600 mb-4">Invalid invite link.</p>
          <a href="/login" className="text-sm text-black font-medium hover:underline mt-4 block">Back to login</a>
        </div>
      </main>
    )
  }

  async function handleAccept() {
    setLoading(true)
    setError('')

    let err: { message: string } | null = null

    if (accessToken && refreshToken) {
      // Old Supabase format: access_token + refresh_token in hash
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      err = error
    } else if (tokenHash) {
      // New Supabase PKCE format: token_hash in query params
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' })
      err = error
    }

    if (err) {
      setError('This invite link has expired or already been used. Ask your account manager to resend it.')
      setLoading(false)
      return
    }
    router.replace('/auth/reset-password')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm text-center">
        <img src="/logo.png" alt="LocalPod Studio" style={{ width: 140, margin: '0 auto 32px' }} />
        <h1 className="text-xl font-semibold text-gray-900 mb-2">You've been invited</h1>
        <p className="text-sm text-gray-500 mb-8">Click below to accept your invitation and set up your password.</p>
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        <button
          onClick={handleAccept}
          disabled={loading}
          className="w-full bg-black text-white py-2.5 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Accepting…' : 'Accept invitation →'}
        </button>
      </div>
    </main>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400">Loading…</p>
      </main>
    }>
      <AcceptInviteInner />
    </Suspense>
  )
}
