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
      const search = window.location.search
      const hash = window.location.hash
      console.log('[callback] search:', search)
      console.log('[callback] hash:', hash)

      // Explicitly exchange PKCE code if present in URL
      const code = new URLSearchParams(search).get('code')
      console.log('[callback] code:', code)
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        console.log('[callback] exchange result:', { session: !!data?.session, error })
        if (error || !data.session) { router.replace('/login'); return }
        await handleSession(data.session)
        return
      }

      // No code — check for existing session (e.g. magic link hash flow)
      const { data: { session } } = await supabase.auth.getSession()
      console.log('[callback] getSession:', !!session)
      if (session) { await handleSession(session); return }

      // Wait for auth state change
      console.log('[callback] waiting for auth state change...')
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        console.log('[callback] auth state change:', _event, !!session)
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
