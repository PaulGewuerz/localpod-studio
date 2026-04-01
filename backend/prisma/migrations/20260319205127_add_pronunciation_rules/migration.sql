-- CreateTable
CREATE TABLE "PronunciationRule" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "pronunciation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "PronunciationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PronunciationRule_organizationId_word_key" ON "PronunciationRule"("organizationId", "word");

-- AddForeignKey
ALTER TABLE "PronunciationRule" ADD CONSTRAINT "PronunciationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
