-- Add penalty goal support and new event type
ALTER TABLE "player_season_stats" ADD COLUMN "penalty_goals" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "player_club_career_stats" ADD COLUMN "penalty_goals" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'PENALTY_GOAL';
