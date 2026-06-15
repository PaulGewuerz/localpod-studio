# LocalPod Studio — Status & TODO

> Living doc. Update this at the end of every working session.
> Last updated: 2026-06-15

---

## Where we're at

**Pre-launch.** Core pipeline (article text → ElevenLabs TTS → Supabase Storage → Megaphone publish) works end-to-end. Dashboard, login, and onboarding polish is **done**. Free trial now runs through Stripe (card up front, auto-charge at day 7, reminder email — `b8f1882`).

**Current focus: the automatic episode flow** — articles become published episodes without manual steps.

### Decisions made
- **Single-pass generation** for spoken-only episodes: one ElevenLabs `/with-timestamps` call for the full script. Per-paragraph regeneration (ffmpeg splice) is the surgical edit path only, never the generation path. (2026-06-12)
- Full regeneration recomputes `paragraphMeta` so paragraph editing survives a full regen (`22d116c`).

---

## TODO — Automatic episode flow

**v1 shipped (`bb8a89b`, 2026-06-15): RSS feed → draft episodes.** Entry point is RSS per show; everything lands as a draft for review (no auto-publish).

Done:
- [x] Entry point decided: **RSS feed per show**
- [x] Article ingestion — `automation/feedPoller.js` (feed content first, page-fetch + Readability fallback)
- [x] Auto-generate via shared `services/generateEpisode.js` (same pipeline as manual `/generate`)
- [x] Per-show settings: `feedUrl` / `automationEnabled` / `automationVoiceId` (PATCH /me + studio Settings UI)
- [x] Trigger: in-process poller in the backend, every 15 min (prod only, or `ENABLE_FEED_POLLER=true` locally)
- [x] Migration applied to Supabase via `scripts/apply-automation-migration.js`
- [x] Validated: schema queryable + feed parse + extraction (no TTS spent in testing)

Still open:
- [ ] **End-to-end live test** — enable automation on a real show with a real feed, confirm a draft actually gets created (will spend ElevenLabs credits)
- [ ] **Failure visibility** — `IngestedArticle.status` is `failed`/`skipped` with an `error`, but there's no UI/notification surfacing it yet
- [ ] Auto-publish path to Megaphone for shows set to full-auto (v2)
- [ ] Per-article notification email on success/failure (v2)
- [ ] Consider tightening page-fetch timeout (NPR feed hung 20s on the Readability fallback; poller handles it gracefully but it's slow)
- [ ] `jsdom` + `@mozilla/readability` carry npm-audit vulns (3 high) — acceptable for server-side fetch, but noted

## TODO — Other open items

- [ ] **Megaphone legacy campaign API sunsets July 14, 2026** — any DAI work must target v2 before then
- [ ] Decide fate of untracked working-tree files: `backend/test-output-*.mp3`, `backend/scripts/debug-show.js`, `frontend/netlify.toml`, `landing/generating-screenshot.html` (gitignore, commit, or delete)
- [ ] Voice roster update in `backend/prisma/seed.js` (9 voices) — uncommitted; needs commit + seed run against Supabase to take effect

---

## Done (recent, newest first)

- Automatic episode flow v1: RSS feed → draft episodes (`bb8a89b`)
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
