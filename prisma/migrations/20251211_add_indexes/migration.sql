-- Add indexes to speed up match, prediction_entry and user_rating queries
-- Generated: 2025-12-11

-- MATCH indexes
CREATE INDEX IF NOT EXISTS match_status_datetime_idx ON "match" (status, match_date_time);
CREATE INDEX IF NOT EXISTS match_home_status_friendly_datetime_idx ON "match" (home_team_id, status, is_friendly, match_date_time);
CREATE INDEX IF NOT EXISTS match_away_status_friendly_datetime_idx ON "match" (away_team_id, status, is_friendly, match_date_time);
CREATE INDEX IF NOT EXISTS match_season_status_friendly_idx ON "match" (season_id, status, is_friendly);

-- PREDICTION_ENTRY indexes
CREATE INDEX IF NOT EXISTS prediction_entry_user_submitted_at_idx ON "prediction_entry" (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS prediction_entry_status_resolved_idx ON "prediction_entry" (status, resolved_at);
CREATE INDEX IF NOT EXISTS prediction_entry_status_resolved_score_idx ON "prediction_entry" (status, resolved_at, score_awarded);

-- USER_RATING indexes
CREATE INDEX IF NOT EXISTS user_rating_seasonal_points_desc_idx ON "user_rating" (seasonal_points DESC);
CREATE INDEX IF NOT EXISTS user_rating_yearly_points_desc_idx ON "user_rating" (yearly_points DESC);
CREATE INDEX IF NOT EXISTS user_rating_total_points_desc_idx ON "user_rating" (total_points DESC);
CREATE INDEX IF NOT EXISTS user_rating_level_mythic_rank_idx ON "user_rating" (current_level, mythic_rank);
