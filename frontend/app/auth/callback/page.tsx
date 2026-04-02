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

    // OAuth (PKCE) may have already established the session before the listener fires
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { handleSession(session); return }

      // Not ready yet — wait for the state change
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) { router.replace('/login'); return }
        handleSession(session)
      })
      return () => subscription.unsubscribe()
    })
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Signing you in…</p>
    </main>
  )
}
