'use client'

import { useEffect, useState } from 'react'
import { getImpersonatedEmail, stopImpersonating } from '@/lib/impersonation'

export default function ImpersonationBanner() {
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => { setEmail(getImpersonatedEmail()) }, [])

  if (!email) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-400 text-amber-950 text-sm font-medium px-4 py-2 flex items-center justify-center gap-3">
      <span>Viewing as <strong>{email}</strong> — changes you make here are real</span>
      <button onClick={stopImpersonating} className="underline hover:no-underline">
        Exit
      </button>
    </div>
  )
}
