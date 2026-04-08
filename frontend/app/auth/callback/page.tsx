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
      // PKCE flow: code in query params
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error || !data.session) { router.replace('/login'); return }
        await handleSession(data.session)
        return
      }

      // Implicit flow: tokens in URL hash
      const hash = window.location.hash
      console.log('[callback] hash present:', !!hash)
      if (hash) {
        const params = new URLSearchParams(hash.slice(1))
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        console.log('[callback] access_token present:', !!access_token, 'refresh_token present:', !!refresh_token)
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
          console.log('[callback] setSession result:', { session: !!data?.session, error: error?.message })
          if (error || !data.session) { router.replace('/login'); return }
          await handleSession(data.session)
          return
        }
      }

      // No tokens in URL — check for existing session
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { await handleSession(session); return }

      router.replace('/login')
    }

    handleCallback()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Signing you in…</p>
    </main>
  )
}
