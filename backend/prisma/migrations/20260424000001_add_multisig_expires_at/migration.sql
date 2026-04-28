-- Add expiresAt to PendingMultiSigTx
-- Default existing rows to createdAt + 5 minutes so the NOT NULL constraint is satisfied
ALTER TABLE "PendingMultiSigTx" ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
UPDATE "PendingMultiSigTx" SET "expiresAt" = "createdAt" + INTERVAL '5 minutes';
ALTER TABLE "PendingMultiSigTx" ALTER COLUMN "expiresAt" DROP DEFAULT;

CREATE INDEX "PendingMultiSigTx_status_expiresAt_idx" ON "PendingMultiSigTx"("status", "expiresAt");
