-- CreateTable: FeeBumpStat (singleton row for persisted fee-bump counters)
CREATE TABLE "FeeBumpStat" (
    "id"              TEXT NOT NULL DEFAULT 'singleton',
    "total"           INTEGER NOT NULL DEFAULT 0,
    "totalFeeStroops" BIGINT NOT NULL DEFAULT 0,
    "accounts"        JSONB NOT NULL DEFAULT '[]',
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeBumpStat_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add encrypted senderSecret to PaymentStream
ALTER TABLE "PaymentStream" ADD COLUMN "senderSecret" TEXT;
