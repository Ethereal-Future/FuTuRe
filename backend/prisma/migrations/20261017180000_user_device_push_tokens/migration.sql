-- Push notification device tokens (issue #1384). Expired / unregistered
-- FCM and APNS tokens are pruned from this table after each broadcast.

CREATE TABLE IF NOT EXISTS "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserDevice_token_key" ON "UserDevice"("token");
CREATE INDEX IF NOT EXISTS "UserDevice_userId_idx" ON "UserDevice"("userId");
CREATE INDEX IF NOT EXISTS "UserDevice_userId_deviceId_idx" ON "UserDevice"("userId", "deviceId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserDevice_userId_fkey') THEN
    ALTER TABLE "UserDevice"
      ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
