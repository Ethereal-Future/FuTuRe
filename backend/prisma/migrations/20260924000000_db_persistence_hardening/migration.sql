-- ISSUE-065: uniqueness only among non-deleted users
DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_username_key";
CREATE UNIQUE INDEX IF NOT EXISTS user_email_active_unique ON "User" (email) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_username_active_unique ON "User" (username) WHERE "deletedAt" IS NULL;

-- ISSUE-066: blind index columns for encrypted-field search
ALTER TABLE "KycVerification" ADD COLUMN IF NOT EXISTS "documentNumberHash" TEXT;
CREATE INDEX IF NOT EXISTS kyc_document_number_hash_idx ON "KycVerification" ("documentNumberHash");
ALTER TABLE "RecoveryContact" ADD COLUMN IF NOT EXISTS "phoneHash" TEXT;
CREATE INDEX IF NOT EXISTS recovery_contact_phone_hash_idx ON "RecoveryContact" ("phoneHash");

-- ISSUE-067: data migration checkpoints
CREATE TABLE IF NOT EXISTS "DataMigrationCheckpoint" (
  "migration"       TEXT NOT NULL,
  "table"           TEXT NOT NULL,
  "lastProcessedId" TEXT,
  "processed"       INTEGER NOT NULL DEFAULT 0,
  "completed"       BOOLEAN NOT NULL DEFAULT false,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("migration", "table")
);
