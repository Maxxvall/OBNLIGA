-- Match statistics table and archive flag for matches

-- Add archive flag to match table
ALTER TABLE "match" ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT FALSE;

-- Create per-club match statistics table
CREATE TABLE "match_statistic" (
    "match_id" BIGINT NOT NULL,
    "club_id" INT NOT NULL,
    "total_shots" INT NOT NULL DEFAULT 0,
    "shots_on_target" INT NOT NULL DEFAULT 0,
    "corners" INT NOT NULL DEFAULT 0,
    "yellow_cards" INT NOT NULL DEFAULT 0,
    "red_cards" INT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "match_statistic_pkey" PRIMARY KEY ("match_id", "club_id"),
    CONSTRAINT "match_statistic_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "match_statistic_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Ensure updated_at auto-updates on modification managed by Prisma client
CREATE OR REPLACE FUNCTION set_match_statistic_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_match_statistic_updated_at
BEFORE UPDATE ON "match_statistic"
FOR EACH ROW
EXECUTE FUNCTION set_match_statistic_updated_at();
