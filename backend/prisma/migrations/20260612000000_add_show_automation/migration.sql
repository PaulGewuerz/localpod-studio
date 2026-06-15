-- Show automation fields for the automatic episode flow
ALTER TABLE "Show" ADD COLUMN "feedUrl" TEXT;
ALTER TABLE "Show" ADD COLUMN "automationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Show" ADD COLUMN "automationVoiceId" TEXT;

ALTER TABLE "Show" ADD CONSTRAINT "Show_automationVoiceId_fkey"
  FOREIGN KEY ("automationVoiceId") REFERENCES "Voice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tracks feed items seen by the automatic episode flow so each article is only generated once
CREATE TABLE "IngestedArticle" (
  "id" TEXT NOT NULL,
  "guid" TEXT NOT NULL,
  "url" TEXT,
  "title" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "episodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "showId" TEXT NOT NULL,

  CONSTRAINT "IngestedArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IngestedArticle_showId_guid_key" ON "IngestedArticle"("showId", "guid");

ALTER TABLE "IngestedArticle" ADD CONSTRAINT "IngestedArticle_showId_fkey"
  FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
