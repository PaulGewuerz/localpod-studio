-- Move megaphoneShowId and megaphoneRssUrl from Organization to Show

-- Step 1: Add columns to Show
ALTER TABLE "Show" ADD COLUMN IF NOT EXISTS "megaphoneShowId" TEXT;
ALTER TABLE "Show" ADD COLUMN IF NOT EXISTS "megaphoneRssUrl" TEXT;

-- Step 2: Copy existing values from Organization to its first (oldest) Show
UPDATE "Show" s
SET
  "megaphoneShowId" = o."megaphoneShowId",
  "megaphoneRssUrl" = o."megaphoneRssUrl"
FROM "Organization" o
WHERE s."organizationId" = o.id
  AND (o."megaphoneShowId" IS NOT NULL OR o."megaphoneRssUrl" IS NOT NULL)
  AND s.id = (
    SELECT id FROM "Show"
    WHERE "organizationId" = o.id
    ORDER BY "createdAt" ASC
    LIMIT 1
  );

-- Step 3: Drop columns from Organization
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "megaphoneShowId";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "megaphoneRssUrl";
