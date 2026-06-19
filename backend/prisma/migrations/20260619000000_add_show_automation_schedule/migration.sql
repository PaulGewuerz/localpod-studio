-- Per-show scheduling + ad selection for the automatic (digest) episode flow
ALTER TABLE "Show" ADD COLUMN "automationIntervalDays" INTEGER;
ALTER TABLE "Show" ADD COLUMN "automationStartAt" TIMESTAMP(3);
ALTER TABLE "Show" ADD COLUMN "automationNextRunAt" TIMESTAMP(3);
ALTER TABLE "Show" ADD COLUMN "automationLastRunAt" TIMESTAMP(3);
ALTER TABLE "Show" ADD COLUMN "automationAdSelections" JSONB;
