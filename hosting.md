# Self-Hosted Podcast Hosting — Plan

> **Status: backlog.** Not scheduled, not started. Written 2026-07-11 as a future project.
> Goal: serve RSS feeds and audio ourselves, drop the Megaphone dependency ($99/mo), and own the full pipeline.

---

## Why

- Megaphone does very little for us relative to cost: ads are baked in by our own ffmpeg pipeline (no DAI), analytics come from OP3 (Megaphone's API has none), and distribution is just "hand directories an RSS URL."
- Every Megaphone dependency we've hit has cost us: the scheduled-episode stale-audio bug (`ec74672`) existed only because Megaphone holds an audio copy we can't update; feed prefixes for OP3 can't be set via API; the legacy campaign API sunset forced a deadline.
- Pre-launch is the cheapest time to do this. Right now there's ~one real show to migrate; in a year it could be dozens of customer feeds, each needing a redirect dance.

## What Megaphone actually provides today (to be replaced)

1. **RSS feed hosting** — the canonical URL Apple/Spotify poll.
2. **Audio delivery** — enclosure URLs with byte-range support at CDN scale.
3. **Scheduled publishing** — holds episodes and flips them live at pubdate.
4. Cover art hosting / feed metadata.

Nothing else we use. The ad marketplace, DAI, and analytics are irrelevant to us.

## Architecture

### Audio delivery — Cloudflare R2 + custom domain (`media.localpod.co`)
- **Zero egress fees** — the reason R2 is the standard choice for podcast audio. Supabase Storage works technically but charges ~$0.09/GB egress past the included tier; podcast bandwidth is spiky.
- At publish, `preparePublishAudio` already produces the final stitched MP3. Instead of handing Megaphone a URL to ingest, upload that file to R2 at a stable path. Done.
- Storage cost is pennies (30 MB/episode × hundreds of episodes ≈ single-digit GB at $0.015/GB-mo).
- Test checklist: byte-range requests, ETags, `Content-Type: audio/mpeg` — Apple's player is picky. R2 + Cloudflare CDN handle this but verify.

### Feed generation — static XML on R2/CDN (`feeds.localpod.co/{show-slug}.xml`)
- **Do not render feeds per-request from Express** — that makes feed uptime depend on Railway + Postgres. A broken feed = show disappears from apps.
- Any episode publish/update/delete regenerates the show's feed XML and writes it to R2, fronted by Cloudflare CDN. Feeds stay up even if the backend is down.
- Format: RSS 2.0 + iTunes namespace + `podcast:` namespace. Validate with standard feed validators before pointing Apple at anything.
- Wrap every enclosure URL in the OP3 prefix (`https://op3.dev/e/`) programmatically — this kills the manual Megaphone-UI prefix step forever; analytics work day one on every new show.

### Scheduling — gets simpler
- A scheduled episode is just a row with future `scheduledAt`; the feed generator excludes it until the time passes.
- The existing in-process poller (15-min cycle) regenerates feeds whose scheduled episodes have come due.
- No external audio copy exists → the entire `ec74672` bug class (edit-after-schedule publishing stale audio, delete-and-recreate dance) disappears on the self-hosted path.

### Adapter — `adapters/hosting/selfhosted.js`
- Implements the existing interface: `publishEpisode`, `getEpisodes`, `deleteEpisode`, `updateEpisode`, `createPodcast`, `uploadPodcastCoverArt`, `getPodcast`. All 14 call sites already go through `getHostingAdapter()`; routes shouldn't need changes.
  - `publishEpisode` → upload MP3 to R2 + regenerate feed
  - `deleteEpisode` → remove item + regenerate feed
  - `createPodcast` → allocate slug + write initial feed
  - `getEpisodes` → read from our own DB
- **Schema change:** the factory currently picks the provider from a global env var (`PODCAST_HOSTING_PROVIDER`). Needs a per-show `Show.hostingProvider` column so existing shows stay on Megaphone while new shows go self-hosted. (Reminder: new-table/column migrations don't need RLS here, but any *new table* must include `ENABLE ROW LEVEL SECURITY`.)

## Free wins along the way

- **Transcripts as a feature** — we already have word-level timing from `/with-timestamps` in `paragraphMeta`. Emitting `<podcast:transcript>` (SRT/VTT) is nearly free; Apple and Spotify both surface transcripts now. Real differentiator most hosts charge for.
- **~$95/mo off fixed costs** — $99 Megaphone → ~$1–5 R2. Infra ~$243 → ~$150/mo.
- OP3 prefix automation (above).

## What we take on

- **Feed uptime is ours.** Static-on-CDN makes it a small risk; add a simple external check that each feed URL returns valid XML.
- **IAB-certified analytics** — Megaphone is IAB-certified, OP3 is respected but not certified. Irrelevant to $99–299 customers; may matter to enterprise prospects (6AM City) selling ads against downloads. Know this before that conversation; not a blocker.
- **Migration of existing shows** — see playbook below. Fiddly but doable; gets worse the longer we wait.

## Staged rollout

1. **Build** the `selfhosted` adapter + feed generator + R2 upload, per-show `hostingProvider` column, feature-flagged. Est. 1–2 weeks given how much already exists.
2. **Test show end-to-end** — publish self-hosted, validate feed, submit to Apple/Spotify, confirm playback + OP3 counting.
3. **New shows default to self-hosted.** Megaphone stays only for existing shows.
4. **Migrate existing shows** (A-Towner), then cancel Megaphone before the next billing cycle.

## Migration playbook (per existing show)

1. Stand up the new self-hosted feed with the full episode history.
2. Add `<itunes:new-feed-url>` pointing at the new feed.
3. Have Megaphone 301-redirect the old feed URL (they support redirects on churn).
4. Update the feed URL in Apple Podcasts Connect and Spotify for Podcasters.
5. Confirm directories are polling the new URL, then remove the show from Megaphone.

## Prerequisites / sequencing notes

- **Before migrating anything:** repair the two episodes that published with wrong audio (`ec74672` cleanup, still pending in STATUS.md) — don't redirect a feed containing known-bad episodes.
- Megaphone must stay alive and paid through the transition; cancel only after the last show's redirect is confirmed.
