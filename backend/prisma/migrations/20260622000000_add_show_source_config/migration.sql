-- Per-source options for the automatic episode flow (e.g. scrape link selector)
ALTER TABLE "Show" ADD COLUMN "sourceConfig" JSONB;
