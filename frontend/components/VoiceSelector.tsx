'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Voice {
  id: string
  name: string
  elevenLabsId: string
  description: string | null
  previewUrl: string | null
}

interface Props {
  selectedId: string | null
  onSelect: (voice: Voice) => void
}

export default function VoiceSelector({ selectedId, onSelect }: Props) {
  const [voices, setVoices] = useState<Voice[]>([])
  const [loading, setLoading] = useState(true)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/voices`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const data = await res.json()
      setVoices(Array.isArray(data) ? data : [])
      setLoading(false)
    }
    load()
  }, [])

  function togglePreview(voice: Voice) {
    if (!voice.previewUrl) return

    if (playingId === voice.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }

    const audio = new Audio(voice.previewUrl)
    audioRef.current = audio
    audio.play()
    setPlayingId(voice.id)
    audio.onended = () => setPlayingId(null)
  }

  if (loading) return <p className="text-gray-400 text-sm">Loading voices…</p>

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {voices.map(voice => (
        <div
          key={voice.id}
          onClick={() => onSelect(voice)}
          className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors ${
            selectedId === voice.id
              ? 'border-black bg-black text-white'
              : 'border-gray-200 bg-white hover:border-gray-400'
          }`}
        >
          <div>
            <p className="font-medium">{voice.name}</p>
            {voice.description && (
              <p className={`text-sm ${selectedId === voice.id ? 'text-gray-300' : 'text-gray-500'}`}>
                {voice.description}
              </p>
            )}
          </div>
          {voice.previewUrl && (
            <button
              onClick={e => { e.stopPropagation(); togglePreview(voice) }}
              className={`ml-4 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                selectedId === voice.id
                  ? 'bg-white text-black hover:bg-gray-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              aria-label={playingId === voice.id ? 'Pause preview' : 'Play preview'}
            >
              {playingId === voice.id ? (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
