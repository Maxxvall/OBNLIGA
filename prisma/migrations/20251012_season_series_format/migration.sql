-- Add per-season series format to support bracket progression logic
ALTER TABLE "season" ADD COLUMN "series_format" "SeriesFormat";

-- Backfill existing seasons with their competition's format
UPDATE "season" AS s
SET "series_format" = c."series_format"
FROM "competition" AS c
WHERE s."competition_id" = c."competition_id";
