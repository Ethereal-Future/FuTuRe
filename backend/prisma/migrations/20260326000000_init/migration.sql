-- CreateTable
CREATE TABLE "User" (
    "id"        TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id"          TEXT NOT NULL,
    "hash"        TEXT NOT NULL,
    "assetCode"   TEXT NOT NULL DEFAULT 'XLM',
    "amount"      DECIMAL(65,30) NOT NULL,
    "ledger"      INTEGER,
    "successful"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senderId"    TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "defaultAsset"    TEXT NOT NULL DEFAULT 'XLM',
    "notificationsOn" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_publicKey_key" ON "User"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_hash_key" ON "Transaction"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_userId_key" ON "Setting"("userId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
