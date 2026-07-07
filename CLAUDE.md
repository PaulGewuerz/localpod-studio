# LocalPod Studio — Claude Code Context

> **Session state lives in [STATUS.md](STATUS.md)** — read it at the start of every session for current focus, TODOs, and recent decisions. Update it at the end of every session.

## Project Overview
LocalPod Studio is a multi-tenant SaaS platform that automatically converts news articles into AI-narrated podcast episodes. It uses ElevenLabs TTS (Multilingual v2) for audio generation and Megaphone for RSS hosting and distribution. Customers are local news publishers, newsletter operators, and regional media groups.

**Current status: Pre-launch. Core pipeline is working end-to-end. Dashboard/login/onboarding polish is done. Current focus: the automatic episode flow.**

---

## Repo Structure
```
localpod-studio/
├── frontend/        # Next.js app — deployed to Netlify at app.localpod.co
├── backend/         # Express/Node API — deployed to Railway at api.localpod.co
│   └── src/
│       └── index.js  # Entry point (start command: node src/index.js)
├── prisma/          # Prisma schema and migrations
└── CLAUDE.md
```

---

## Stack

### Frontend
- **Framework:** Next.js
- **Hosting:** Netlify (`app.localpod.co`)

### Backend
- **Framework:** Express / Node.js
- **Hosting:** Railway (`api.localpod.co`)
- **Root:** `backend/`
- **Start command:** `node src/index.js`

### Database
- **ORM:** Prisma 7
- **Database:** Postgres via Supabase (`fkxhchvqozsgybjlibin.supabase.co`)
- **Connection:** Session pooler URL (required — IPv6 incompatibility with direct connection)

### Auth
- Supabase magic link auth
- Google OAuth via `madetoorderaudio.com` parent org

### Key Integrations
- **ElevenLabs** — TTS generation (`eleven_multilingual_v2`, switched from Turbo v2.5 on 2026-07-06 after audio-quality complaints; costs 1 credit/char — double Turbo — and caps requests at 10k chars, guarded at 9,500 in code)
- **Megaphone** — RSS hosting and episode publishing via API (Professional plan, $99/month); legacy campaign API sunsets July 14, 2026 — any DAI work must target v2
- **Stripe** — Billing; webhooks point to `https://api.localpod.co/webhooks/stripe`
- **Resend** — SMTP for Supabase auth emails, sent from `paul@localpod.co`

### Data Model (key entities)
`Organization` → `User` → `Show` → `Episode`, `Voice`, `Subscription`

### Episode State Machine
Episodes move through: **draft → approved → published**

---

## Environment
- Local development on Windows (`C:\Users\paulg\Documents\localpod-studio\`)
- GitHub repo: `PaulGewuerz/localpod-studio`

---

## Current Focus
**Automatic episode flow** — getting articles converted into published episodes without manual steps.

Design decision (2026-06-12): spoken-only episodes are generated **single-pass** — one ElevenLabs `/with-timestamps` call for the full script. Per-paragraph regeneration (splice via ffmpeg) is the surgical edit path only, not the generation path. Full regeneration recomputes `paragraphMeta` (fixed in `22d116c`).

Do not refactor working code or introduce new features unless explicitly asked. Prefer minimal, targeted fixes.

---

## Pricing (for context)
- **Publisher:** $99/month
- **Network:** $299/month
- Enterprise prospects handled separately (e.g. 6AM City at ~$3,500/month)

---

## Infrastructure Costs (for context)
~$243/month fixed: Megaphone $99, ElevenLabs Pro $99, Supabase $25, Railway $20, Netlify free.
