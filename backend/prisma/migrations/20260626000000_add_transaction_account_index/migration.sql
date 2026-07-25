-- Create composite index for transaction history queries
-- This enables efficient account_id lookups with immediate sorted results by creation date
CREATE INDEX CONCURRENTLY idx_transactions_account_created ON "Transaction"("senderId", "createdAt" DESC);
