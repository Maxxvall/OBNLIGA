-- Create friendly matches table for non-statistical games
CREATE TABLE "friendly_match" (
  "friendly_match_id" BIGSERIAL PRIMARY KEY,
  "match_date_time" TIMESTAMP(3) NOT NULL,
  "home_team_name" TEXT NOT NULL,
  "away_team_name" TEXT NOT NULL,
  "event_name" TEXT,
  "stadium_id" INTEGER,
  "referee_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "friendly_match"
  ADD CONSTRAINT "friendly_match_stadium_id_fkey" FOREIGN KEY ("stadium_id") REFERENCES "stadium"("stadium_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "friendly_match"
  ADD CONSTRAINT "friendly_match_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "person"("person_id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "friendly_match_date_idx" ON "friendly_match" ("match_date_time");
