'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

export default function AuthCallbackPage() {
  const router = useRouter()
  const [debugInfo, setDebugInfo] = useState<string>('Starting…')

  useEffect(() => {
    async function handleSession(session: import('@supabase/supabase-js').Session) {
      setDebugInfo('Session found, checking /me…')
      try {
        const res = await fetch(`${API_URL}/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) { setDebugInfo('/me returned ' + res.status + ', going to onboarding'); router.replace('/onboarding'); return }
        const { subscription } = await res.json()
        if (!subscription?.stripeCustomerId) { setDebugInfo('No subscription, going to onboarding'); router.replace('/onboarding'); return }
      } catch (e) {
        setDebugInfo('/me fetch error: ' + String(e)); router.replace('/onboarding'); return
      }
      router.replace('/studio')
    }

    async function handleCallback() {
      const code = new URLSearchParams(window.location.search).get('code')
      const hash = window.location.hash
      setDebugInfo(`code=${!!code} hash=${!!hash}`)

      if (code) {
        setDebugInfo('Exchanging code for session…')
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        setDebugInfo(`exchangeCodeForSession: session=${!!data?.session} error=${error?.message ?? 'none'}`)
        if (error || !data.session) return
        await handleSession(data.session)
        return
      }

      setDebugInfo('No code in URL, checking getSession…')
      const { data: { session } } = await supabase.auth.getSession()
      setDebugInfo(`getSession: session=${!!session}`)
      if (session) { await handleSession(session); return }

      setDebugInfo('No session found — check Supabase redirect URL config')
    }

    handleCallback()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-gray-500 mb-2">Signing you in…</p>
        <p className="text-xs text-gray-400 font-mono">{debugInfo}</p>
      </div>
    </main>
  )
}
