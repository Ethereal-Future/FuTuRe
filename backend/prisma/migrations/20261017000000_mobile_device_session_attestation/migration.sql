-- Unified device-bound sessions (issue #1381) and server-verified hardware
-- attestation state (issue #1382). Written defensively because these tables
-- may have been created via `prisma db push` in some environments.

-- Session: mobile device binding metadata (null for web sessions)
ALTER TABLE IF EXISTS "Session" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE IF EXISTS "Session" ADD COLUMN IF NOT EXISTS "deviceModel" TEXT;
ALTER TABLE IF EXISTS "Session" ADD COLUMN IF NOT EXISTS "osVersion" TEXT;
ALTER TABLE IF EXISTS "Session" ADD COLUMN IF NOT EXISTS "appVersion" TEXT;

DO $$
BEGIN
  IF to_regclass('"Session"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "Session_deviceId_idx" ON "Session"("deviceId");
  END IF;
END $$;

-- DeviceRegistry: hardware attestation results
ALTER TABLE IF EXISTS "DeviceRegistry" ADD COLUMN IF NOT EXISTS "attestationPlatform" TEXT;
ALTER TABLE IF EXISTS "DeviceRegistry" ADD COLUMN IF NOT EXISTS "attestationVerdict" TEXT;
ALTER TABLE IF EXISTS "DeviceRegistry" ADD COLUMN IF NOT EXISTS "attestedAt" TIMESTAMP(3);
ALTER TABLE IF EXISTS "DeviceRegistry" ADD COLUMN IF NOT EXISTS "appAttestKeyId" TEXT;
ALTER TABLE IF EXISTS "DeviceRegistry" ADD COLUMN IF NOT EXISTS "appAttestPublicKey" TEXT;
ALTER TABLE IF EXISTS "DeviceRegistry" ADD COLUMN IF NOT EXISTS "appAttestCounter" BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF to_regclass('"DeviceRegistry"') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "DeviceRegistry_appAttestKeyId_key" ON "DeviceRegistry"("appAttestKeyId");
  END IF;
END $$;
