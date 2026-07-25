-- Add indexes for un-indexed foreign key columns to improve query performance

-- RetryAttempt.transactionId index
CREATE INDEX "RetryAttempt_transactionId_idx" ON "RetryAttempt"("transactionId");

-- AMLAlert foreign key indexes
CREATE INDEX "AMLAlert_transactionId_idx" ON "AMLAlert"("transactionId");
CREATE INDEX "AMLAlert_userId_idx" ON "AMLAlert"("userId");

-- PaymentStream foreign key indexes
CREATE INDEX "PaymentStream_senderId_idx" ON "PaymentStream"("senderId");
CREATE INDEX "PaymentStream_recipientId_idx" ON "PaymentStream"("recipientId");

-- KYCRecord status index for filtering queries
CREATE INDEX "KYCRecord_status_idx" ON "KYCRecord"("status");
