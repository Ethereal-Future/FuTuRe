-- PendingMultiSigTx (#1287): the model was referenced by services/multiSig.js
-- and altered by 20260424000001 but never declared in schema.prisma. Create it
-- idempotently and ensure the (status, expiresAt) index used by the expiry job.
CREATE TABLE IF NOT EXISTS "PendingMultiSigTx" (
    "txId" TEXT NOT NULL,
    "txXdr" TEXT NOT NULL,
    "sourcePublicKey" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL DEFAULT 'XLM',
    "signatures" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingMultiSigTx_pkey" PRIMARY KEY ("txId")
);

ALTER TABLE "PendingMultiSigTx" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "PendingMultiSigTx_status_expiresAt_idx" ON "PendingMultiSigTx"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "PendingMultiSigTx_sourcePublicKey_status_idx" ON "PendingMultiSigTx"("sourcePublicKey", "status");

-- AMM state (#1290): durable, shared pool / position / trade storage.
CREATE TABLE "AmmPool" (
    "poolId" TEXT NOT NULL,
    "assetA" TEXT NOT NULL,
    "assetB" TEXT NOT NULL,
    "reserveA" DECIMAL(38,18) NOT NULL,
    "reserveB" DECIMAL(38,18) NOT NULL,
    "feeBps" INTEGER NOT NULL DEFAULT 30,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmmPool_pkey" PRIMARY KEY ("poolId"),
    CONSTRAINT "AmmPool_reserves_positive" CHECK ("reserveA" > 0 AND "reserveB" > 0)
);

CREATE INDEX "AmmPool_assetA_assetB_idx" ON "AmmPool"("assetA", "assetB");

CREATE TABLE "AmmPosition" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "shares" DECIMAL(38,18) NOT NULL,
    "depositedA" DECIMAL(38,18) NOT NULL,
    "depositedB" DECIMAL(38,18) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmmPosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmmPosition_providerId_poolId_key" ON "AmmPosition"("providerId", "poolId");
CREATE INDEX "AmmPosition_poolId_idx" ON "AmmPosition"("poolId");

CREATE TABLE "AmmTrade" (
    "tradeId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "inputAsset" TEXT NOT NULL,
    "outputAsset" TEXT NOT NULL,
    "amountIn" DECIMAL(38,18) NOT NULL,
    "amountOut" DECIMAL(38,18) NOT NULL,
    "feePaid" DECIMAL(38,18) NOT NULL,
    "priceImpact" DECIMAL(38,18) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AmmTrade_pkey" PRIMARY KEY ("tradeId")
);

CREATE INDEX "AmmTrade_poolId_createdAt_idx" ON "AmmTrade"("poolId", "createdAt");
CREATE INDEX "AmmTrade_traderId_idx" ON "AmmTrade"("traderId");

ALTER TABLE "AmmPosition" ADD CONSTRAINT "AmmPosition_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "AmmPool"("poolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AmmTrade" ADD CONSTRAINT "AmmTrade_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "AmmPool"("poolId") ON DELETE CASCADE ON UPDATE CASCADE;
