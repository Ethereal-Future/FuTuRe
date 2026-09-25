-- Normalize fee-bump metrics storage to avoid singleton-row contention.
CREATE TABLE IF NOT EXISTS "FeeBumpAccount" (
    "publicKey" TEXT NOT NULL,
    "firstUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeeBumpAccount_pkey" PRIMARY KEY ("publicKey")
);

CREATE TABLE IF NOT EXISTS "FeeBumpSummary" (
    "date" DATE NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "totalFeeStroops" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeeBumpSummary_pkey" PRIMARY KEY ("date")
);

-- Best-effort backfill from legacy singleton row if it exists.
DO $$
DECLARE
  legacy_total INTEGER;
  legacy_fee BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'FeeBumpStat'
  ) THEN
    SELECT "total", "totalFeeStroops"
      INTO legacy_total, legacy_fee
      FROM "FeeBumpStat"
      WHERE "id" = 'singleton'
      LIMIT 1;

    INSERT INTO "FeeBumpSummary" ("date", "total", "totalFeeStroops")
    VALUES (CURRENT_DATE, COALESCE(legacy_total, 0), COALESCE(legacy_fee, 0))
    ON CONFLICT ("date") DO NOTHING;

    INSERT INTO "FeeBumpAccount" ("publicKey")
    SELECT DISTINCT account
    FROM (
      SELECT jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof("accounts"::jsonb) = 'array' THEN "accounts"::jsonb
          ELSE '[]'::jsonb
        END
      ) AS account
      FROM "FeeBumpStat"
      WHERE "id" = 'singleton'
    ) expanded
    WHERE account IS NOT NULL AND account <> ''
    ON CONFLICT ("publicKey") DO NOTHING;
  END IF;
END $$;
