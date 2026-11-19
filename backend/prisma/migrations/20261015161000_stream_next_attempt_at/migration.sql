-- Exponential backoff for failed stream payment retries
ALTER TABLE "PaymentStream" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "PaymentStream_status_nextAttemptAt_idx"
  ON "PaymentStream"("status", "nextAttemptAt");
