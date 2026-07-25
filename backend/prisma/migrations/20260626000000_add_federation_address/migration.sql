ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "federationAddress" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Setting_federationAddress_key"
  ON "Setting"("federationAddress")
  WHERE "federationAddress" IS NOT NULL;
