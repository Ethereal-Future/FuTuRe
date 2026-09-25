ALTER TABLE "NotificationPreference"
ADD COLUMN "lastBalanceCheckedAt" TIMESTAMP(3);

CREATE INDEX "NotificationPreference_lowBalanceAlertEnabled_lastBalanceCheckedAt_idx"
ON "NotificationPreference"("lowBalanceAlertEnabled", "lastBalanceCheckedAt");
