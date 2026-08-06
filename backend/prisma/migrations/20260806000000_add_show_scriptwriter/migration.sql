-- Scriptwriter opt-in for the automatic episode flow: when enabled, the poller
-- rewrites the day's articles into a conversational script via an LLM instead of
-- narrating the raw article digest. `scriptConfig` holds per-show style options.
ALTER TABLE "Show" ADD COLUMN "scriptwriterEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Show" ADD COLUMN "scriptConfig" JSONB;
