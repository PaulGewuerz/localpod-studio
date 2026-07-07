-- Enable Row-Level Security on all public tables (Supabase linter: rls_disabled_in_public).
-- No policies are created on purpose: all data access goes through the backend, which
-- connects as the table owner (owners bypass RLS unless FORCE is set). This locks out
-- the Supabase auto-generated REST API (anon/authenticated roles) entirely.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Show" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Voice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IngestedArticle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Episode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PronunciationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
