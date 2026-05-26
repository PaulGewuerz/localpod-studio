'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function AcceptInviteInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as 'invite' | null

  if (!tokenHash || type !== 'invite') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm text-center">
          <p className="text-red-600 mb-4">Invalid invite link.</p>
          <a href="/login" className="text-sm text-black font-medium hover:underline">Back to login</a>
        </div>
      </main>
    )
  }

  async function handleAccept() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: 'invite' })
    if (error) {
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
