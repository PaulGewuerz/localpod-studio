-- Article-source type for the automatic episode flow (null = rss, for back-compat)
ALTER TABLE "Show" ADD COLUMN "sourceType" TEXT;
