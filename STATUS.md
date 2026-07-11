# LocalPod Studio — Status & TODO

> Living doc. Update this at the end of every working session.
> Last updated: 2026-07-08

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

**v2 shipped (`ac8945b`, 2026-06-19): scheduled digest + ad placement + junk-text cleanup.**
- Per-show schedule: "generate an episode every N days (1–8), starting <datetime>". Poller now fires per-show on its own interval (not per-article) via `automationNextRunAt`.
- Each run combines all new feed articles since the last run into one **digest** draft (`generateDigestEpisode`).
- Per-show ad selection (pre/mid/post) from active campaigns in Settings → auto-assigned on drafts; mid-rolls placed at article boundaries, movable in review.
- Junk-text cleanup (`utils/cleanArticleText.js`): strips bylines, captions/credits, share/newsletter/"read more" boilerplate before narration.
- Schema: `Show.automationIntervalDays/StartAt/NextRunAt/LastRunAt/AdSelections`; migration `20260619000000` applied to Supabase.

**Non-RSS source roadmap (staged):** RSS-only entry is an adoption risk — many target sites (e.g. decorahnews.com) have no feed *or* sitemap. Building a pluggable article-source layer behind a single "Source URL" field with auto-detection. Stages: (1) source abstraction + auto-discovery + Test button ✅, (2) manual paste-a-URL ✅, (3) sitemap ingestion ✅, (4) homepage scraping ✅. Email ingestion was considered and dropped. **All four stages shipped.**

**Stage 4 shipped: homepage scraping.** `detectSource` falls back to scraping article links from the page when no RSS/sitemap found (needs ≥3 article-like links). `discoverArticles` handles `sourceType: 'scrape'` — heuristic same-site link extraction (article-like path + headline-length text) or a per-show CSS selector. New `Show.sourceConfig` JSON (`{ linkSelector }`); migration applied. `POST /me/test-source` takes an optional `selector` to preview a scrape. Settings shows an "Advanced · Article link selector" field when the source is scrape. Verified: text.npr.org → 19 headline links.

**Known limit (important):** static-fetch scraping can't see JavaScript-rendered sites. **decorahnews.com** (the original test site) is JS-rendered (mynews360 platform) — its homepage has only 7 static anchors, articles load client-side — so NONE of rss/sitemap/scrape can reach it without a headless browser (Puppeteer-class infra, out of scope). detectSource fails gracefully with guidance. If JS sites become a real customer need, that's the next investment.

**Stage 3 shipped: sitemap ingestion.** `detectSource` now falls back to a sitemap (the pasted URL itself, robots.txt `Sitemap:` entries, or common paths) when no RSS is found; RSS still preferred when both exist. `discoverArticles` handles `sourceType: 'sitemap'` — parses urlset + sitemapindex (follows news/article/post children first), reads `<news:title>`/`<news:publication_date>`/`<lastmod>`, newest first. Poller now backfills missing titles from the extracted page title (helps sitemap/scrape items). Verified against AP (sitemap fallback), Guardian news.xml, TechCrunch index.

**Stage 2 shipped: manual paste-a-URL.** New Episode has a "From URL" mode: paste one or more article links → `POST /generate/from-urls` fetches each via shared `utils/extractArticle.js` (Readability) → `generateDigestEpisode` (multiple URLs = one digest). Poller's page-fetch refactored onto the same util. Junk-text cleanup extended with nav boilerplate (skip-to-content/menu/search).

**Stage 1 shipped: source abstraction + auto-discovery + Test source.**
- `automation/articleSource.js`: `detectSource(url)` resolves RSS directly / via declared `<link>` / via common paths; `discoverArticles(show)` dispatches on `Show.sourceType` (rss only so far) returning normalized `{guid,url,title,publishedAt,raw}`.
- Poller refactored to call `discoverArticles` (source-agnostic). `POST /me/test-source` powers the Settings "Test source" button. New `Show.sourceType` column (null = rss); migration applied to Supabase.
- Helper: `scripts/poll-feeds-once.js` fires one cycle on demand (surfaces feed errors the dashboard doesn't yet).

Still open:
- [ ] **End-to-end live test** — point a show at a real feed (NPR/BBC/Verge validated), confirm a digest draft gets created (will spend ElevenLabs credits)
- [ ] **Failure visibility** — `IngestedArticle.status` is `failed`/`skipped` with an `error`, but there's no UI/notification surfacing it yet
- [ ] Auto-publish path to Megaphone for shows set to full-auto (v2)
- [ ] Per-article notification email on success/failure (v2)
- [ ] Consider tightening page-fetch timeout (NPR feed hung 20s on the Readability fallback; poller handles it gracefully but it's slow)
- [ ] `jsdom` + `@mozilla/readability` carry npm-audit vulns (3 high) — acceptable for server-side fetch, but noted

## TODO — Other open items

- [ ] **OP3 analytics — two manual steps to go live:** (1) add the OP3 prefix `https://op3.dev/e/` to each podcast in the Megaphone UI (podcast Settings → Megaphone Settings → Feed Prefixes → Custom) — start with A-Towner; NOT settable via the API (verified: unknown PUT fields are silently ignored, 2026-07). Counting starts at install with no backfill — do it ASAP. (2) Mint a real OP3 API key at https://op3.dev/api/keys and set `OP3_API_TOKEN` on Railway (code falls back to OP3's public sample token `preview07ce`). Also: add the prefix step to the new-show provisioning checklist.
- [ ] **Stripe cancellation work landed under a mislabeled commit** — `sendCancellationEmail`/`sendCancellationAdminEmail` (email.js) + `cancel_at_period_end` webhook handler + GET /me cancellation read were accidentally swept into commit `146caaf` ("Update STATUS.md"). Code is complete, syntax-clean, and **live in production**. Only downside is the commit message; fixing it cleanly needs a force-push to `master`. **Decision pending:** leave as-is or rewrite history.
- [ ] **Reconcile `Subscription.plan` against live Stripe (data-layer fix)** — `plan` is unreliable (some active publishers stored as `null`, paul@localpod.co was mislabeled `solo`). Caps/gating fail open to Publisher so legacy accounts aren't downgraded, but a Publisher mislabeled `solo` is wrongly capped (e.g. 1 podcast feed via `showLimitForPlan`). Can't be fixed per-request (live Stripe price is prod-only). Needs a one-time reconciliation job mapping each org's live Stripe subscription price → plan. Must run against prod/Railway (local `STRIPE_SECRET_KEY` is test-mode).
- [ ] **Megaphone legacy campaign API sunsets July 14, 2026** — any DAI work must target v2 before then
- [ ] Decide fate of untracked working-tree files: `backend/test-output-*.mp3`, `backend/scripts/debug-show.js`, `frontend/netlify.toml`, `landing/generating-screenshot.html` (gitignore, commit, or delete)
- [ ] Voice roster update in `backend/prisma/seed.js` (9 voices) — uncommitted; needs commit + seed run against Supabase to take effect

---

## Done (recent, newest first)

- **Unschedule: scheduled episodes can be reverted to draft** (2026-07-11) — previously the only ways out of `scheduled` were reschedule, publish-now, or delete; the review page's "Save as Draft" button was just a back-link (customer confusion). New `POST /episodes/:id/unschedule`: deletes the Megaphone episode (strict — only 404 tolerated; flipping local status alone would leave stale audio to publish at pubdate), clears `megaphoneEpisodeId`/`publishedUrl`/`scheduledAt`, sets draft; rejects if the pubdate already passed. UI: "Unschedule" button on the review page (scheduled episodes only) + per-row "Unschedule" action on the Episodes table (both dashboard and All Episodes); "Save as Draft" renamed "← Back to Episodes".

- **Fixed: script edits after scheduling published the ORIGINAL audio** (2026-07-09, `ec74672`) — once an episode was scheduled, Megaphone held the audio ingested at schedule time and `megaphoneEpisodeId` survived every later audio edit. Re-scheduling hit the retry-safety branch (pubdate-only update — Megaphone updates can't replace ingested audio) and Approve & Publish orphaned the old scheduled Megaphone episode, which still went live with the pre-edit audio. Fix: all five audio-mutating routes (full regen, paragraph regen, take restore, add/delete paragraph) now delete the stale scheduled Megaphone episode and clear `megaphoneEpisodeId`/`publishedUrl`/`scheduledAt`; approve deletes any leftover scheduled Megaphone episode before publishing; schedule's retry branch deletes + recreates instead of updating in place. **Cleanup pending:** the two episodes that already published with wrong audio need manual repair (delete wrong-audio episode on Megaphone, reset episode to draft, republish).

- **Add/delete paragraphs on the review page** (2026-07-08) — paragraphs can now be inserted or removed, not just regenerated. New `POST /episodes/:id/paragraphs` (body `{ text, afterOrder }`, `-1` = start) generates TTS for the new text and splices it in at the boundary (zero-length `spliceSegment` window); new `DELETE /episodes/:id/paragraphs/:order` cuts the paragraph's time window out of the audio via `removeSegment` (new in stitchAudio.js). Both renumber `paragraphMeta` orders, shift subsequent timings, rebuild `scriptText` from paragraph texts (also syncing any drift from past per-paragraph regens), and reset status to draft. UI: faint "+ Add paragraph" insert points before/between/after paragraphs (expand to a textarea), "Delete paragraph" (with confirm) in the paragraph editor; deleting the only paragraph is rejected. Notes: neither path updates `characterCount` (same as per-paragraph regen — TTS spend on edits isn't metered); a deleted paragraph's take files stay in storage (no cleanup, consistent with take history).

- **RLS enabled on all public tables** (2026-07-07) — Supabase flagged `rls_disabled_in_public` (critical): every table was readable/writable by anyone with the anon key (verified live — anonymous REST read of `User` returned data). Fix: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on all 12 public tables (9 Prisma models + `_prisma_migrations` + stray lowercase `shows`/`episodes` leftovers) with **no policies** — backend connects as the table owner, which bypasses RLS, so Prisma is unaffected; the auto-generated REST API is fully locked out (anon reads return `[]`, writes get 42501). Migration `20260707000000_enable_rls` + `scripts/enable-rls.js` (re-runnable; sweeps any public table the migration misses and aborts if a table isn't owned by the connecting role). **Note:** new tables don't inherit RLS — future migrations must include `ENABLE ROW LEVEL SECURITY`, or re-run the script. The stray `shows`/`episodes` tables are candidates for dropping.

- **Long scripts no longer rejected — chunked TTS** (2026-07-07) — the `MAX_TTS_CHARS = 9500` guard (from the multilingual-v2 switch, 10k/request cap) blocked manual uploads and full regens over 9,500 chars ("Script is too long"). New `synthesizeSpeech()` in `services/generateEpisode.js` splits long scripts at paragraph (then sentence) boundaries, calls `/with-timestamps` per chunk with `previous_text`/`next_text` conditioning for prosody continuity, merges alignments (time-offset), and concats audio via ffmpeg (`concatAudioBuffers` in stitchAudio.js) — so paragraphMeta works exactly as before. Used by `generateDraftEpisode` + full regen. **Digests unchanged on purpose:** drop-oldest-to-fit also caps ElevenLabs spend per automated run; lifting it is a cost decision. Smoke-tested live (`scripts/smoke-chunked-tts.js`, forced 100-char chunks): alignment chars match input, monotonic times, clean paragraph meta.

- **Schedule-from-review hang fixed** (2026-07-07, `75c55db`) — Megaphone's episode-create can be slow (it ingests the audio) and a silently dropped connection left the button on "Scheduling…" forever even though Megaphone + DB had finished. The client now aborts after 45s and falls back to polling GET /episodes/:id until `scheduledAt` matches, then redirects to Episodes (success now always redirects, matching Approve & Publish). Backend `POST /schedule` is retry-safe: if the episode already has a `megaphoneEpisodeId` it updates that episode's pubdate instead of creating a duplicate, and scheduling an already-published episode is rejected.

- **Analytics tab now backed by OP3** (2026-07-07) — Megaphone's public API has no analytics (episode objects carry no download fields; `/downloads`, `/analytics`, `/metrics`, `/stats`, `/reports` all 404 — verified live; the S3 Metrics Export is Enterprise-only). Downloads now come from OP3 (op3.dev prefix analytics, free): new `backend/src/adapters/analytics/op3.js` (show lookup by base64url feed URL, per-episode `downloadsAll`/`downloads30` joined to Megaphone episodes by RSS item guid, monthly/weekly rollups). `GET /analytics` response keeps its shape + adds `trackingEnabled`/`note`/`monthlyDownloads`/`weeklyDownloads`/`asof`; shows without the prefix installed degrade to the existing "Request analytics report" flow. **Blocked on two manual steps — see Other open items.**

- **Paragraph take history** (2026-07-07, `72e0c01`) — regenerating a paragraph on the review page no longer discards the previous audio. Each take (including the pre-regen original, extracted from the full audio on first regen) is stored as a standalone MP3 in Supabase Storage and tracked in `paragraphMeta` (`takes[]` + `activeTake` — JSON only, no migration). New `POST /episodes/:id/paragraphs/:order/takes/:takeIndex/restore` splices a saved take back in; review page shows a per-paragraph "Versions" strip (play + "Use this"). Full regeneration recomputes `paragraphMeta`, so takes reset then (intended — timings/text no longer apply). Note: take files accumulate in storage; no cleanup yet.

- **Admin impersonation** (2026-07-06, `f60ee5c`) — "View as" link next to each user email on /admin opens /studio in a new tab acting as that customer (see what they see, edit episodes for them). Backend honors `X-Impersonate-Email` only when the bearer token belongs to `ADMIN_EMAIL` (shared resolver `utils/resolveAuthUser.js`, used by both requireAuth and requireActiveSubscription); every impersonated request is console-logged on Railway. Frontend: `lib/impersonation.ts` patches window.fetch (per-tab via sessionStorage), amber bottom banner with Exit. Writes made while impersonating are real.

- **TTS model switched to `eleven_multilingual_v2`** (2026-07-06) — Turbo v2.5 was producing weird audio for users. All 9 roster voices verified compatible via ElevenLabs API (`scripts/check-voice-models.js`); smoke-tested `/with-timestamps` with the new model (`scripts/smoke-multilingual-v2.js`). Removed `language_code` (multilingual v2 rejects it). Added `MAX_TTS_CHARS = 9500` guard (multilingual v2 caps at 10k/request vs Turbo's 40k): digests drop oldest articles to fit; single-article + full-regen paths return `script_too_long`. Note: 1 credit/char = double Turbo's cost.

- Distribution "Prefer We Handle It?" now books a call instead of POSTing a submit-request. Button links to `calendly.com/mto-audio/podcast-app-submissions` and explains why it's a live call: the customer's show stays in their name (we don't take ownership in Apple/Spotify/etc.), and most directories email one-time verification codes the customer reads to us during the screen-share. Removed the unused `handleDistSubmit` handler + `distSubmit*` state (frontend only; backend `/distribution/submit-request` route left in place, now unused). Shipped in the "Distribution: book a call…" commit.
- Multi-feed creation in the dashboard: `POST /me/shows` (per-plan cap — solo 1 / publisher 3) + "Add a podcast feed" form on the Shows tab. Megaphone provisioning stays lazy (at first publish). Frontend multi-show UI (switcher, Shows tab, per-show settings) already existed; this fills the missing "create another show" path. New shows land on Settings to fill in details.
- Automatic episode flow v2: scheduled digest, per-show ad placement, junk-text cleanup (`ac8945b`)
- Automatic episode flow v1: RSS feed → draft episodes (`bb8a89b`)
- Stripe cancellation emails (customer + admin) on cancel-at-period-end (`146caaf` — see Other open items re: commit message)
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
- **TTS:** `eleven_multilingual_v2` (no `language_code` — multilingual v2 rejects it), stability 0.5 / similarity 0.75. 10k chars max per request; manual/full-regen scripts of any length are auto-chunked at 9,500 (`synthesizeSpeech`), digests still drop oldest articles to fit one request (cost cap); typical article ~5–6k. Costs 1 credit/char (double Turbo v2.5). 150k chars/month limit per org.
- **Audio pipeline files:** `backend/src/routes/generate.js` (create), `backend/src/routes/episodes.js` (regen full + per-paragraph), `backend/src/utils/stitchAudio.js` + `preparePublishAudio.js` (ffmpeg splice/ads), `backend/src/utils/paragraphMeta.js` (timing helpers).
- **Episode lifecycle:** draft → approved → published (+ `scheduled` flipped lazily to `published` in GET /episodes).
