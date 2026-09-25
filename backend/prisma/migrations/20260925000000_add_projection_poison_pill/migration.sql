-- CreateTable: quarantine for events that repeatedly fail projection
-- processing, so they no longer stall the projection pipeline. See issue #1365.
CREATE TABLE "ProjectionPoisonPill" (
    "id"             TEXT         NOT NULL,
    "projectionName" TEXT         NOT NULL,
    "eventId"        TEXT         NOT NULL,
    "aggregateId"    TEXT         NOT NULL,
    "eventType"      TEXT         NOT NULL,
    "event"          JSONB        NOT NULL,
    "errorMessage"   TEXT         NOT NULL,
    "errorStack"     TEXT,
    "retryCount"     INTEGER      NOT NULL DEFAULT 0,
    "status"         TEXT         NOT NULL DEFAULT 'QUARANTINED',
    "resolvedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectionPoisonPill_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "ProjectionPoisonPill_projectionName_eventId_key" ON "ProjectionPoisonPill"("projectionName", "eventId");
CREATE INDEX "ProjectionPoisonPill_status_idx" ON "ProjectionPoisonPill"("status");
