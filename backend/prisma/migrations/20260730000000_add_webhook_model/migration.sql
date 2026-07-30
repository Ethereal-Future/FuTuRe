-- CreateTable: persisted webhook registrations (replaces the in-memory Map).
-- Soft-delete via deletedAt keeps rows joinable from WebhookDelivery.
CREATE TABLE "Webhook" (
    "id"              TEXT        NOT NULL,
    "accountId"       TEXT        NOT NULL,
    "url"             TEXT        NOT NULL,
    "events"          TEXT[]      NOT NULL,
    "signingSecret"   TEXT        NOT NULL,
    "previousSecrets" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRotatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"       TIMESTAMP(3),

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Webhook_accountId_idx"           ON "Webhook"("accountId");
CREATE INDEX "Webhook_accountId_deletedAt_idx" ON "Webhook"("accountId", "deletedAt");

-- AddForeignKey: WebhookDelivery.webhookId → Webhook.id
-- The FK does NOT cascade-delete so delivery history is preserved after a
-- webhook is soft-deleted.
ALTER TABLE "WebhookDelivery"
    ADD CONSTRAINT "WebhookDelivery_webhookId_fkey"
    FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
