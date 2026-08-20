-- Add-on usage credits: a non-expiring balance of extra TTS characters that
-- customers can buy instead of upgrading tiers. Consumed only after the monthly
-- plan allowance is exhausted; rolls over across billing periods.
ALTER TABLE "Subscription" ADD COLUMN "creditBalance" INTEGER NOT NULL DEFAULT 0;

-- Audit trail + idempotency for one-time credit-pack purchases. The unique
-- stripeSessionId makes webhook retries no-ops (one top-up per completed session).
CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "characters" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditPurchase_stripeSessionId_key" ON "CreditPurchase"("stripeSessionId");

ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New tables must have RLS enabled (see 20260707000000_enable_rls). Backend
-- connects as table owner and bypasses RLS; this locks out the Supabase REST API.
ALTER TABLE "CreditPurchase" ENABLE ROW LEVEL SECURITY;
