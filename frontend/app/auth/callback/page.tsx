'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

export default function AuthCallbackPage() {
  const router = useRouter()
  const [logs, setLogs] = useState<string[]>([])
  const log = (msg: string) => console.log('[auth/callback]', msg)

  useEffect(() => {
    async function handleSession(session: import('@supabase/supabase-js').Session) {
      log('Session found, checking /me…')
      try {
        const res = await fetch(`${API_URL}/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) { log('/me returned ' + res.status + ', going to onboarding'); router.replace('/onboarding'); return }
        const { subscription } = await res.json()
        const activeStatuses = ['active', 'trial']
        if (!subscription?.status || !activeStatuses.includes(subscription.status)) { log('No active subscription, going to onboarding'); router.replace('/onboarding'); return }
      } catch (e) {
        log('/me fetch error: ' + String(e)); router.replace('/onboarding'); return
      }
      router.replace('/studio')
    }

    async function handleCallback() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const tokenHash = params.get('token_hash')
      const type = params.get('type')
      const hash = window.location.hash
      log(`code=${code?.slice(0,8) ?? 'null'} token_hash=${!!tokenHash} type=${type} hash="${hash.slice(0,40)}" search="${window.location.search.slice(0,80)}"`)

      // Invite link — exchange token then send to set-password page
      if (tokenHash && type === 'invite') {
        log('Exchanging invite token…')
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' })
        log(`verifyOtp: session=${!!data?.session} error=${error?.message ?? 'none'}`)
        if (error || !data.session) { router.replace('/login'); return }
        router.replace('/auth/reset-password')
        return
      }

      if (code) {
        log('Exchanging code for session…')
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        log(`exchangeCodeForSession: session=${!!data?.session} error=${error?.message ?? 'none'}`)
        if (error || !data.session) return
        await handleSession(data.session)
        return
      }

      // Implicit flow — tokens in hash fragment
      if (hash.includes('access_token')) {
        log('Implicit flow detected, parsing hash…')
        const hashParams = new URLSearchParams(hash.slice(1))
        const access_token = hashParams.get('access_token')
        const refresh_token = hashParams.get('refresh_token')
        log(`access_token=${access_token?.slice(0,8) ?? 'null'} refresh_token=${!!refresh_token}`)
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
          log(`setSession: session=${!!data?.session} error=${error?.message ?? 'none'}`)
          if (data.session) { await handleSession(data.session); return }
        }
      }

      log('No code in URL, checking getSession…')
      const { data: { session } } = await supabase.auth.getSession()
      log(`getSession: session=${!!session}`)
      if (session) { await handleSession(session); return }

      log('No session found — search=' + window.location.search + ' hash=' + window.location.hash)
    }

    handleCallback()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-gray-500">Signing you in…</p>
      </div>
    </main>
  )
}
