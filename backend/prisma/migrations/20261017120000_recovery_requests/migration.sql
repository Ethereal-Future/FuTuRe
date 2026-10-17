-- Durable account recovery state (issue #1387) with hashed guardian approval
-- tokens (issue #1388) and on-chain key rotation metadata (issue #1389).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecoveryStatus') THEN
    CREATE TYPE "RecoveryStatus" AS ENUM ('pending', 'approved', 'completing', 'completed', 'cancelled', 'expired', 'locked');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RecoveryRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" "RecoveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "newPublicKey" TEXT,
    "oldPublicKey" TEXT,
    "rotationTxHash" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executeAfter" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecoveryApproval" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecoveryRequest_userId_status_idx" ON "RecoveryRequest"("userId", "status");
CREATE INDEX IF NOT EXISTS "RecoveryRequest_expiresAt_idx" ON "RecoveryRequest"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryApproval_requestId_contactId_key" ON "RecoveryApproval"("requestId", "contactId");
CREATE INDEX IF NOT EXISTS "RecoveryApproval_requestId_idx" ON "RecoveryApproval"("requestId");

-- Not expressible in schema.prisma: at most one active recovery per user, so
-- concurrent initiations on different nodes cannot both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryRequest_one_active_per_user"
    ON "RecoveryRequest"("userId")
    WHERE "status" IN ('pending', 'approved', 'completing');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryRequest_userId_fkey') THEN
    ALTER TABLE "RecoveryRequest" ADD CONSTRAINT "RecoveryRequest_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryApproval_requestId_fkey') THEN
    ALTER TABLE "RecoveryApproval" ADD CONSTRAINT "RecoveryApproval_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "RecoveryRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
