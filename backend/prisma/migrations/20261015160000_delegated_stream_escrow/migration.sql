-- Delegated streaming: store Soroban escrow references; purge custodial secrets.
ALTER TABLE "PaymentStream" ADD COLUMN IF NOT EXISTS "escrowContractId" TEXT;
ALTER TABLE "PaymentStream" ADD COLUMN IF NOT EXISTS "contractStreamId" TEXT;

-- Safely purge any previously stored encrypted sender secrets (non-custodial migration).
UPDATE "PaymentStream" SET "senderSecret" = NULL WHERE "senderSecret" IS NOT NULL;
