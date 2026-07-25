-- CreateTable
CREATE TABLE "StreamFailure" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreamFailure_streamId_createdAt_idx" ON "StreamFailure"("streamId", "createdAt");

-- AddForeignKey
ALTER TABLE "StreamFailure" ADD CONSTRAINT "StreamFailure_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "PaymentStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
