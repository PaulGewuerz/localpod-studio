'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const API_URL = process.env.NEXT_PUBLIC_API_URL

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session) { router.replace('/login'); return }

      // Check if publisher has completed onboarding (has a Stripe customer ID)
      try {
        const res = await fetch(`${API_URL}/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) {
          // Authenticated in Supabase but not found in backend DB — send to onboarding
          router.replace('/onboarding')
          return
        }
        const { subscription } = await res.json()
        if (!subscription?.stripeCustomerId) {
          router.replace('/onboarding')
          return
        }
      } catch {
        router.replace('/onboarding')
        return
      }

      router.replace('/studio')
    })
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Signing you in…</p>
    </main>
  )
}
