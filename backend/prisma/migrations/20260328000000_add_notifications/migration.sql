-- CreateTable: Notification
CREATE TABLE "Notification" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "channel"   TEXT NOT NULL,
    "status"    TEXT NOT NULL DEFAULT 'sent',
    "title"     TEXT,
    "body"      TEXT NOT NULL,
    "read"      BOOLEAN NOT NULL DEFAULT false,
    "metadata"  JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable: NotificationPreference
CREATE TABLE "NotificationPreference" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "emailEnabled"    BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled"     BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled"      BOOLEAN NOT NULL DEFAULT false,
    "inAppEnabled"    BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 22,
    "quietHoursEnd"   INTEGER NOT NULL DEFAULT 7,
    "typeOverrides"   JSONB,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
