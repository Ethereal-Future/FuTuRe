-- Durable storage for mobile offline transaction queues (issue #1376)
CREATE TABLE IF NOT EXISTS "MobileOfflineQueueItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileOfflineQueueItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MobileOfflineQueueItem_userId_status_enqueuedAt_idx"
    ON "MobileOfflineQueueItem"("userId", "status", "enqueuedAt");

CREATE INDEX IF NOT EXISTS "MobileOfflineQueueItem_status_idx"
    ON "MobileOfflineQueueItem"("status");
