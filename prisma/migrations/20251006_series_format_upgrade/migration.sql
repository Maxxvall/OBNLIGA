-- Upgrade competition type enum (remove HYBRID) and extend series formats

BEGIN;

-- 1. Normalize existing competition types
UPDATE "competition"
SET "type" = 'LEAGUE'
WHERE "type" = 'HYBRID';

-- 2. Recreate CompetitionType enum without HYBRID
CREATE TYPE "CompetitionType_new" AS ENUM ('LEAGUE', 'CUP');

ALTER TABLE "competition"
  ALTER COLUMN "type" TYPE "CompetitionType_new"
  USING "type"::text::"CompetitionType_new";

DROP TYPE "CompetitionType";
ALTER TYPE "CompetitionType_new" RENAME TO "CompetitionType";

-- 3. Extend SeriesFormat enum with double round playoff format
ALTER TYPE "SeriesFormat" ADD VALUE IF NOT EXISTS 'DOUBLE_ROUND_PLAYOFF';

COMMIT;
