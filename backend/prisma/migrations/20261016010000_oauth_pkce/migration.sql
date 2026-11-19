-- OAuth authorization-code hardening (#1401).
-- Nullable fields preserve compatibility for confidential clients while
-- allowing public clients to bind a code to a verifier.
ALTER TABLE "OAuth2AuthorizationCode"
  ADD COLUMN IF NOT EXISTS "codeChallenge" TEXT,
  ADD COLUMN IF NOT EXISTS "codeChallengeMethod" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'OAuth2AuthorizationCode_codeChallengeMethod_check'
  ) THEN
    ALTER TABLE "OAuth2AuthorizationCode"
      ADD CONSTRAINT "OAuth2AuthorizationCode_codeChallengeMethod_check"
      CHECK ("codeChallengeMethod" IS NULL OR "codeChallengeMethod" IN ('plain', 'S256'));
  END IF;
END $$;
