-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "voiceId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "megaphoneShowId" TEXT;

-- CreateTable
CREATE TABLE "Voice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "elevenLabsId" TEXT NOT NULL,
    "description" TEXT,
    "previewUrl" TEXT,

    CONSTRAINT "Voice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Voice_elevenLabsId_key" ON "Voice"("elevenLabsId");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_voiceId_fkey" FOREIGN KEY ("voiceId") REFERENCES "Voice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
