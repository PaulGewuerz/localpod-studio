'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    async function handleSession(session: import('@supabase/supabase-js').Session) {
      try {
        const res = await fetch(`${API_URL}/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) { router.replace('/onboarding'); return }
        const { subscription } = await res.json()
        if (!subscription?.stripeCustomerId) { router.replace('/onboarding'); return }
      } catch {
        router.replace('/onboarding'); return
      }
      router.replace('/studio')
    }

    async function handleCallback() {
      // Explicitly exchange PKCE code if present in URL
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error || !data.session) { router.replace('/login'); return }
        await handleSession(data.session)
        return
      }

      // No code — check for existing session (e.g. magic link hash flow)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { await handleSession(session); return }

      // Wait for auth state change
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        subscription.unsubscribe()
        if (!session) { router.replace('/login'); return }
        handleSession(session)
      })
    }

    handleCallback()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Signing you in…</p>
    </main>
  )
}
