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
      // Give Supabase a moment to process the code/hash from the URL
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { await handleSession(session); return }

      // Listen for the session to be established (PKCE exchange in progress)
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe()
          await handleSession(session)
        }
      })

      // Timeout fallback — if no session after 5s, send to login
      setTimeout(() => {
        subscription.unsubscribe()
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) router.replace('/login')
        })
      }, 5000)
    }

    handleCallback()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Signing you in…</p>
    </main>
  )
}
