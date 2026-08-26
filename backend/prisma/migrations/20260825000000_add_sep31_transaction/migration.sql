-- CreateTable: tracks SEP-0031 cross-border transactions created against a
-- receiving anchor's DIRECT_PAYMENT_SERVER. See issue #955.
CREATE TABLE "Sep31Transaction" (
    "id"                TEXT        NOT NULL,
    "anchorUrl"         TEXT        NOT NULL,
    "externalId"        TEXT        NOT NULL,
    "status"            TEXT        NOT NULL DEFAULT 'pending_sender',
    "amount"            TEXT        NOT NULL,
    "assetCode"         TEXT,
    "senderPublicKey"   TEXT,
    "receiverPublicKey" TEXT,
    "stellarAccountId"  TEXT,
    "stellarMemo"       TEXT,
    "stellarMemoType"   TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sep31Transaction_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "Sep31Transaction_anchorUrl_externalId_key" ON "Sep31Transaction"("anchorUrl", "externalId");
CREATE INDEX "Sep31Transaction_status_idx" ON "Sep31Transaction"("status");
