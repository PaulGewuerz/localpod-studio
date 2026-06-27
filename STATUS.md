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

- [ ] **Stripe cancellation work landed under a mislabeled commit** — `sendCancellationEmail`/`sendCancellationAdminEmail` (email.js) + `cancel_at_period_end` webhook handler + GET /me cancellation read were accidentally swept into commit `146caaf` ("Update STATUS.md"). Code is complete, syntax-clean, and **live in production**. Only downside is the commit message; fixing it cleanly needs a force-push to `master`. **Decision pending:** leave as-is or rewrite history.
- [ ] **Reconcile `Subscription.plan` against live Stripe (data-layer fix)** — `plan` is unreliable (some active publishers stored as `null`, paul@localpod.co was mislabeled `solo`). Caps/gating fail open to Publisher so legacy accounts aren't downgraded, but a Publisher mislabeled `solo` is wrongly capped (e.g. 1 podcast feed via `showLimitForPlan`). Can't be fixed per-request (live Stripe price is prod-only). Needs a one-time reconciliation job mapping each org's live Stripe subscription price → plan. Must run against prod/Railway (local `STRIPE_SECRET_KEY` is test-mode).
- [ ] **Megaphone legacy campaign API sunsets July 14, 2026** — any DAI work must target v2 before then
- [ ] Decide fate of untracked working-tree files: `backend/test-output-*.mp3`, `backend/scripts/debug-show.js`, `frontend/netlify.toml`, `landing/generating-screenshot.html` (gitignore, commit, or delete)
- [ ] Voice roster update in `backend/prisma/seed.js` (9 voices) — uncommitted; needs commit + seed run against Supabase to take effect

---

## Done (recent, newest first)

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
- **TTS:** `eleven_turbo_v2_5`, `language_code: 'en'` (prevents accent drift), stability 0.5 / similarity 0.75. 40k chars max per request; typical article ~5–6k. 150k chars/month limit per org.
- **Audio pipeline files:** `backend/src/routes/generate.js` (create), `backend/src/routes/episodes.js` (regen full + per-paragraph), `backend/src/utils/stitchAudio.js` + `preparePublishAudio.js` (ffmpeg splice/ads), `backend/src/utils/paragraphMeta.js` (timing helpers).
- **Episode lifecycle:** draft → approved → published (+ `scheduled` flipped lazily to `published` in GET /episodes).
