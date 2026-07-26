-- Extend Notification table for retry links and action URLs
ALTER TABLE "Notification" ADD COLUMN "actionUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN "actionRetryParams" JSONB;
ALTER TABLE "Notification" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Create index for soft deletes
CREATE INDEX "Notification_userId_deletedAt_idx" ON "Notification"("userId", "deletedAt");

-- Extend NotificationPreference table for new features
ALTER TABLE "NotificationPreference" ADD COLUMN "weeklyDigestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPreference" ADD COLUMN "weeklyDigestDay" INTEGER DEFAULT 1;
ALTER TABLE "NotificationPreference" ADD COLUMN "weeklyDigestTime" INTEGER DEFAULT 9;
ALTER TABLE "NotificationPreference" ADD COLUMN "lowBalanceAlertEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPreference" ADD COLUMN "lowBalanceThreshold" DECIMAL(19,7) DEFAULT 10.0;
ALTER TABLE "NotificationPreference" ADD COLUMN "lowBalanceAsset" TEXT DEFAULT 'XLM';
ALTER TABLE "NotificationPreference" ADD COLUMN "lastLowBalanceAlertAt" TIMESTAMP(3);
ALTER TABLE "NotificationPreference" ADD COLUMN "lastLowBalanceAlertLevel" DECIMAL(19,7);
