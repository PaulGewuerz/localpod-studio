ALTER TABLE "Organization" ADD COLUMN "defaultVoiceId" TEXT;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_defaultVoiceId_fkey" FOREIGN KEY ("defaultVoiceId") REFERENCES "Voice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
