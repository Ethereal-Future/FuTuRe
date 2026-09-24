-- CreateTable: ComplianceReport (issue #1144)
-- Durable storage for FinCEN SAR/CTR and general compliance reports.
-- Replaces ephemeral local-disk writes; enforces 5-year BSA retention
-- and explicit filing-status tracking.
CREATE TABLE "ComplianceReport" (
    "id"              TEXT NOT NULL,
    "reportType"      TEXT NOT NULL,
    "payload"         JSONB NOT NULL,
    "period"          JSONB NOT NULL,
    "filingStatus"    TEXT NOT NULL DEFAULT 'GENERATED',
    "filingReference" TEXT,
    "generatedBy"     TEXT,
    "generatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filedAt"         TIMESTAMP(3),
    "retainUntil"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceReport_reportType_idx" ON "ComplianceReport"("reportType");
CREATE INDEX "ComplianceReport_filingStatus_idx" ON "ComplianceReport"("filingStatus");
CREATE INDEX "ComplianceReport_generatedAt_idx" ON "ComplianceReport"("generatedAt");
