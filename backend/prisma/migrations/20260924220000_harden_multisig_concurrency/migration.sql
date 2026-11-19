-- Harden multi-signature collection and submission races (#1279, #1280, #1282).
ALTER TABLE "PendingMultiSigTx"
  ADD COLUMN IF NOT EXISTS "baseTxXdr" TEXT,
  ADD COLUMN IF NOT EXISTS "submissionSourcePublicKey" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSequence" BIGINT;

CREATE TABLE IF NOT EXISTS "MultiSigSignature" (
  "id" TEXT NOT NULL,
  "txId" TEXT NOT NULL,
  "signerPublicKey" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MultiSigSignature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MultiSigSignature_txId_fkey" FOREIGN KEY ("txId") REFERENCES "PendingMultiSigTx"("txId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MultiSigSignature_txId_signerPublicKey_key" ON "MultiSigSignature"("txId", "signerPublicKey");
CREATE INDEX IF NOT EXISTS "MultiSigSignature_txId_idx" ON "MultiSigSignature"("txId");
