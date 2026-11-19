-- Event-sourcing hardening (#1359, #1360, #1361, #1362).
--
-- The event-sourcing tables from #1125 were added to schema.prisma without a
-- migration, so some environments created them with `prisma db push` and
-- others do not have them at all. Every statement here is idempotent so the
-- migration applies cleanly in both cases.

-- ─── Tables from #1125 ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "EventStore" (
    "id" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventStore_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EventStore_aggregateId_idx" ON "EventStore"("aggregateId");
CREATE INDEX IF NOT EXISTS "EventStore_aggregateId_version_idx" ON "EventStore"("aggregateId", "version");
CREATE INDEX IF NOT EXISTS "EventStore_eventType_idx" ON "EventStore"("eventType");
CREATE INDEX IF NOT EXISTS "EventStore_createdAt_idx" ON "EventStore"("createdAt");

CREATE TABLE IF NOT EXISTS "EventSnapshot" (
    "id" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EventSnapshot_aggregateId_idx" ON "EventSnapshot"("aggregateId");

CREATE TABLE IF NOT EXISTS "EventArchive" (
    "id" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "originalCreatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EventArchive_aggregateId_idx" ON "EventArchive"("aggregateId");
CREATE INDEX IF NOT EXISTS "EventArchive_archivedAt_idx" ON "EventArchive"("archivedAt");

CREATE TABLE IF NOT EXISTS "EventProjection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventProjection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EventProjection_name_key" ON "EventProjection"("name");
CREATE INDEX IF NOT EXISTS "EventProjection_name_idx" ON "EventProjection"("name");

-- ─── #1362: versioned aggregate snapshots ───────────────────────────────────

ALTER TABLE "EventSnapshot" ADD COLUMN IF NOT EXISTS "reducerVersion" INTEGER NOT NULL DEFAULT 1;
DROP INDEX IF EXISTS "EventSnapshot_aggregateId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EventSnapshot_aggregateId_version_key" ON "EventSnapshot"("aggregateId", "version");

-- ─── #1361: S3 archive provenance ───────────────────────────────────────────

ALTER TABLE "EventArchive" ADD COLUMN IF NOT EXISTS "archiveKey" TEXT;
ALTER TABLE "EventArchive" ADD COLUMN IF NOT EXISTS "archiveSha256" TEXT;

-- ─── #1360: projection health and dead-letter queue ─────────────────────────

CREATE TABLE IF NOT EXISTS "ProjectionStatus" (
    "name" TEXT NOT NULL,
    "lastEventId" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectionStatus_pkey" PRIMARY KEY ("name")
);

CREATE TABLE IF NOT EXISTS "ProjectionDeadLetter" (
    "id" TEXT NOT NULL,
    "projection" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ProjectionDeadLetter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectionDeadLetter_projection_eventId_key" ON "ProjectionDeadLetter"("projection", "eventId");
CREATE INDEX IF NOT EXISTS "ProjectionDeadLetter_projection_resolvedAt_createdAt_idx" ON "ProjectionDeadLetter"("projection", "resolvedAt", "createdAt");
