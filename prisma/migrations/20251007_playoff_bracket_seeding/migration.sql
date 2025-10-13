-- Add seed metadata to match series for deterministic playoff brackets
ALTER TABLE "match_series"
  ADD COLUMN "home_seed" INTEGER NULL,
  ADD COLUMN "away_seed" INTEGER NULL,
  ADD COLUMN "bracket_slot" INTEGER NULL;
