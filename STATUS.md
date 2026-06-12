# LocalPod Studio — Status & TODO

> Living doc. Update this at the end of every working session.
> Last updated: 2026-06-12

---

## Where we're at

**Pre-launch.** Core pipeline (article text → ElevenLabs TTS → Supabase Storage → Megaphone publish) works end-to-end. Dashboard, login, and onboarding polish is **done**. Free trial now runs through Stripe (card up front, auto-charge at day 7, reminder email — `b8f1882`).

**Current focus: the automatic episode flow** — articles become published episodes without manual steps.

### Decisions made
- **Single-pass generation** for spoken-only episodes: one ElevenLabs `/with-timestamps` call for the full script. Per-paragraph regeneration (ffmpeg splice) is the surgical edit path only, never the generation path. (2026-06-12)
- Full regeneration recomputes `paragraphMeta` so paragraph editing survives a full regen (`22d116c`).

---

## TODO — Automatic episode flow

- [ ] **Decide the entry point** — how articles get in: RSS feed per show? Submitted URL? Email? (Blocks everything below.)
- [ ] Article ingestion (fetch + extract text from the chosen source)
- [ ] Auto-generate: run ingested articles through the existing `/generate` pipeline (pronunciation rules → normalize → single-pass TTS)
- [ ] Per-show automation settings (on/off, voice, auto-publish vs. land-as-draft for review)
- [ ] Trigger mechanism (cron/poller on Railway — nothing scheduled exists in the backend today)
- [ ] Auto-publish path to Megaphone for shows set to full-auto
- [ ] Failure handling + notification (bad article, TTS error, character limit hit)

## TODO — Other open items

- [ ] **Megaphone legacy campaign API sunsets July 14, 2026** — any DAI work must target v2 before then
- [ ] Decide fate of untracked working-tree files: `backend/test-output-*.mp3`, `backend/scripts/debug-show.js`, `frontend/netlify.toml`, `landing/generating-screenshot.html` (gitignore, commit, or delete)
- [ ] Voice roster update in `backend/prisma/seed.js` (9 voices) — uncommitted; needs commit + seed run against Supabase to take effect

---

## Done (recent, newest first)

- Free trial moved into Stripe: card up front, auto-charge at day 7, reminder email (`b8f1882`)
- Full-regenerate fix: `/with-timestamps` + `paragraphMeta` recompute (`22d116c`)
- 7-day free trial with expiry enforcement; landing/pricing copy (`4f57e70`, `0d0bcd5`, `78f70b1`)
- Character counting fixes: soft-deleted episodes included, billing-cycle-aligned periods
- Ad pipeline: campaign management, waveform position markers, stitch preview, M4A→MP3 conversion, publish-time stitching
- Episode rescheduling for already-scheduled episodes
- Auth overhaul: email/password + Google OAuth (magic link removed)
- Onboarding: 3-step flow, multi-category picker, cover art upload to Megaphone (S3 multipart)

---

## Quick reference

- **Deploys:** push to `master` = live. Frontend → Netlify (`app.localpod.co`), backend → Railway (`api.localpod.co`).
- **TTS:** `eleven_turbo_v2_5`, `language_code: 'en'` (prevents accent drift), stability 0.5 / similarity 0.75. 40k chars max per request; typical article ~5–6k. 150k chars/month limit per org.
- **Audio pipeline files:** `backend/src/routes/generate.js` (create), `backend/src/routes/episodes.js` (regen full + per-paragraph), `backend/src/utils/stitchAudio.js` + `preparePublishAudio.js` (ffmpeg splice/ads), `backend/src/utils/paragraphMeta.js` (timing helpers).
- **Episode lifecycle:** draft → approved → published (+ `scheduled` flipped lazily to `published` in GET /episodes).
