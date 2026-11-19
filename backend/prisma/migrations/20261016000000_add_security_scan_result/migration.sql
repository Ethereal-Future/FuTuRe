-- CreateTable
CREATE TABLE "SecurityScanResult" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "results" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "s3Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityScanResult_testId_key" ON "SecurityScanResult"("testId");

-- CreateIndex
CREATE INDEX "SecurityScanResult_timestamp_idx" ON "SecurityScanResult"("timestamp");