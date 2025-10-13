-- Add is_active flag for seasons and ensure a single active season.
ALTER TABLE "season" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT false;

-- Promote the most recent season to active to avoid empty active state post-migration.
WITH latest AS (
  SELECT "season_id"
  FROM "season"
  ORDER BY "start_date" DESC
  LIMIT 1
)
UPDATE "season"
SET "is_active" = true
WHERE "season_id" IN (SELECT "season_id" FROM latest);

-- Enforce only one active season at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "season_single_active" ON "season" ("is_active") WHERE "is_active" = true;
