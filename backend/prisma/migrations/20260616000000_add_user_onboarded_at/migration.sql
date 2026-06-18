-- Tracks when a user completed (or skipped) the new-user product tour
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);
