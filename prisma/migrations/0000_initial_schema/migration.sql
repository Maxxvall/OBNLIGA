-- Baseline schema generated from prisma/schema.prisma

-- CreateEnum
CREATE TYPE "CompetitionType" AS ENUM ('LEAGUE', 'CUP');

-- CreateEnum
CREATE TYPE "SeriesFormat" AS ENUM ('SINGLE_MATCH', 'TWO_LEGGED', 'BEST_OF_N', 'DOUBLE_ROUND_PLAYOFF', 'PLAYOFF_BRACKET', 'GROUP_SINGLE_ROUND_PLAYOFF');

-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('REGULAR', 'PLAYOFF');

-- CreateEnum
CREATE TYPE "SeriesStatus" AS ENUM ('IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED');

-- CreateEnum
CREATE TYPE "LineupRole" AS ENUM ('STARTER', 'SUBSTITUTE');

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('GOAL', 'PENALTY_GOAL', 'OWN_GOAL', 'PENALTY_MISSED', 'YELLOW_CARD', 'SECOND_YELLOW_CARD', 'RED_CARD', 'SUB_IN', 'SUB_OUT');

-- CreateEnum
CREATE TYPE "LeaguePlayerStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED');

-- CreateEnum
CREATE TYPE "PredictionResult" AS ENUM ('ONE', 'DRAW', 'TWO');

-- CreateEnum
CREATE TYPE "PredictionMarketType" AS ENUM ('MATCH_OUTCOME', 'TOTAL_GOALS', 'CUSTOM_BOOLEAN');

-- CreateEnum
CREATE TYPE "PredictionEntryStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'VOID', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RatingScope" AS ENUM ('CURRENT', 'YEARLY');

-- CreateEnum
CREATE TYPE "RatingLevel" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MYTHIC');

-- CreateEnum
CREATE TYPE "AchievementMetric" AS ENUM ('DAILY_LOGIN', 'TOTAL_PREDICTIONS', 'CORRECT_PREDICTIONS');

-- CreateEnum
CREATE TYPE "DisqualificationReason" AS ENUM ('RED_CARD', 'SECOND_YELLOW', 'ACCUMULATED_CARDS', 'OTHER');

-- CreateTable
CREATE TABLE "club" (
    "club_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_pkey" PRIMARY KEY ("club_id")
);

-- CreateTable
CREATE TABLE "person" (
    "person_id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "is_player" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "competition" (
    "competition_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CompetitionType" NOT NULL,
    "series_format" "SeriesFormat" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competition_pkey" PRIMARY KEY ("competition_id")
);

-- CreateTable
CREATE TABLE "season" (
    "season_id" SERIAL NOT NULL,
    "competition_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "city" TEXT,
    "series_format" "SeriesFormat",
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("season_id")
);

-- CreateTable
CREATE TABLE "season_participant" (
    "season_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,

    CONSTRAINT "season_participant_pkey" PRIMARY KEY ("season_id","club_id")
);

-- CreateTable
CREATE TABLE "season_roster" (
    "season_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "person_id" INTEGER NOT NULL,
    "shirt_number" INTEGER NOT NULL,
    "registration_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_roster_pkey" PRIMARY KEY ("season_id","club_id","person_id")
);

-- CreateTable
CREATE TABLE "club_player" (
    "club_id" INTEGER NOT NULL,
    "person_id" INTEGER NOT NULL,
    "default_shirt_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_player_pkey" PRIMARY KEY ("club_id","person_id")
);

-- CreateTable
CREATE TABLE "stadium" (
    "stadium_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stadium_pkey" PRIMARY KEY ("stadium_id")
);

-- CreateTable
CREATE TABLE "season_round" (
    "round_id" SERIAL NOT NULL,
    "season_id" INTEGER NOT NULL,
    "round_type" "RoundType" NOT NULL,
    "round_number" INTEGER,
    "label" TEXT NOT NULL,
    "group_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_round_pkey" PRIMARY KEY ("round_id")
);

-- CreateTable
CREATE TABLE "match_series" (
    "series_id" BIGSERIAL NOT NULL,
    "season_id" INTEGER NOT NULL,
    "stage_name" TEXT NOT NULL,
    "home_club_id" INTEGER NOT NULL,
    "away_club_id" INTEGER NOT NULL,
    "series_status" "SeriesStatus" NOT NULL,
    "winner_club_id" INTEGER,
    "home_seed" INTEGER,
    "away_seed" INTEGER,
    "bracket_slot" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_series_pkey" PRIMARY KEY ("series_id")
);

-- CreateTable
CREATE TABLE "match" (
    "match_id" BIGSERIAL NOT NULL,
    "season_id" INTEGER,
    "series_id" BIGINT,
    "series_match_number" INTEGER,
    "match_date_time" TIMESTAMP(3) NOT NULL,
    "home_team_id" INTEGER NOT NULL,
    "away_team_id" INTEGER NOT NULL,
    "home_score" INTEGER NOT NULL DEFAULT 0,
    "away_score" INTEGER NOT NULL DEFAULT 0,
    "status" "MatchStatus" NOT NULL,
    "stadium_id" INTEGER,
    "referee_id" INTEGER,
    "round_id" INTEGER,
    "group_id" INTEGER,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "has_penalty_shootout" BOOLEAN NOT NULL DEFAULT false,
    "penalty_home_score" INTEGER NOT NULL DEFAULT 0,
    "penalty_away_score" INTEGER NOT NULL DEFAULT 0,
    "broadcast_url" TEXT,
    "event_name" TEXT,
    "is_friendly" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_pkey" PRIMARY KEY ("match_id")
);

-- CreateTable
CREATE TABLE "season_group" (
    "season_group_id" SERIAL NOT NULL,
    "season_id" INTEGER NOT NULL,
    "group_index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "qualify_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_group_pkey" PRIMARY KEY ("season_group_id")
);

-- CreateTable
CREATE TABLE "season_group_slot" (
    "season_group_slot_id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "club_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_group_slot_pkey" PRIMARY KEY ("season_group_slot_id")
);

-- CreateTable
CREATE TABLE "match_lineup" (
    "match_id" BIGINT NOT NULL,
    "person_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "role" "LineupRole" NOT NULL,
    "position" TEXT,

    CONSTRAINT "match_lineup_pkey" PRIMARY KEY ("match_id","person_id")
);

-- CreateTable
CREATE TABLE "match_event" (
    "event_id" BIGSERIAL NOT NULL,
    "match_id" BIGINT NOT NULL,
    "team_id" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "event_type" "MatchEventType" NOT NULL,
    "player_id" INTEGER NOT NULL,
    "related_player_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "match_statistic" (
    "match_id" BIGINT NOT NULL,
    "club_id" INTEGER NOT NULL,
    "total_shots" INTEGER NOT NULL DEFAULT 0,
    "shots_on_target" INTEGER NOT NULL DEFAULT 0,
    "corners" INTEGER NOT NULL DEFAULT 0,
    "yellow_cards" INTEGER NOT NULL DEFAULT 0,
    "red_cards" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_statistic_pkey" PRIMARY KEY ("match_id","club_id")
);

-- CreateTable
CREATE TABLE "player_season_stats" (
    "season_id" INTEGER NOT NULL,
    "person_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "penalty_goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "yellow_cards" INTEGER NOT NULL DEFAULT 0,
    "red_cards" INTEGER NOT NULL DEFAULT 0,
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_season_stats_pkey" PRIMARY KEY ("season_id","person_id")
);

-- CreateTable
CREATE TABLE "player_club_career_stats" (
    "person_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "total_goals" INTEGER NOT NULL DEFAULT 0,
    "penalty_goals" INTEGER NOT NULL DEFAULT 0,
    "total_matches" INTEGER NOT NULL DEFAULT 0,
    "total_assists" INTEGER NOT NULL DEFAULT 0,
    "yellow_cards" INTEGER NOT NULL DEFAULT 0,
    "red_cards" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_club_career_stats_pkey" PRIMARY KEY ("person_id","club_id")
);

-- CreateTable
CREATE TABLE "club_season_stats" (
    "season_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "goals_for" INTEGER NOT NULL DEFAULT 0,
    "goals_against" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_season_stats_pkey" PRIMARY KEY ("season_id","club_id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "user_id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "photo_url" TEXT,
    "registration_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_date" TIMESTAMP(3),
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "total_predictions" INTEGER NOT NULL DEFAULT 0,
    "league_player_status" "LeaguePlayerStatus" NOT NULL DEFAULT 'NONE',
    "league_player_requested_at" TIMESTAMP(3),
    "league_player_verified_at" TIMESTAMP(3),
    "league_player_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "prediction" (
    "prediction_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "match_id" BIGINT NOT NULL,
    "prediction_date" TIMESTAMP(3) NOT NULL,
    "result_1x2" "PredictionResult",
    "total_goals_over" DOUBLE PRECISION,
    "penalty_yes" BOOLEAN,
    "red_card_yes" BOOLEAN,
    "is_correct" BOOLEAN,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prediction_pkey" PRIMARY KEY ("prediction_id")
);

-- CreateTable
CREATE TABLE "prediction_template" (
    "prediction_template_id" BIGSERIAL NOT NULL,
    "match_id" BIGINT NOT NULL,
    "market_type" "PredictionMarketType" NOT NULL,
    "options" JSONB NOT NULL,
    "base_points" INTEGER NOT NULL DEFAULT 0,
    "difficulty_multiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prediction_template_pkey" PRIMARY KEY ("prediction_template_id")
);

-- CreateTable
CREATE TABLE "prediction_entry" (
    "prediction_entry_id" BIGSERIAL NOT NULL,
    "template_id" BIGINT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "selection" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score_awarded" INTEGER,
    "status" "PredictionEntryStatus" NOT NULL DEFAULT 'PENDING',
    "resolution_meta" JSONB,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_entry_pkey" PRIMARY KEY ("prediction_entry_id")
);

-- CreateTable
CREATE TABLE "prediction_streak" (
    "user_id" INTEGER NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "max_streak" INTEGER NOT NULL DEFAULT 0,
    "last_prediction_at" TIMESTAMP(3),
    "last_resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_streak_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "achievement_level" (
    "achievement_level_id" SERIAL NOT NULL,
    "achievement_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "icon_url" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievement_level_pkey" PRIMARY KEY ("achievement_level_id")
);

-- CreateTable
CREATE TABLE "achievement_progress" (
    "achievement_progress_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "achievement_id" INTEGER NOT NULL,
    "current_level" INTEGER NOT NULL DEFAULT 0,
    "progress_count" INTEGER NOT NULL DEFAULT 0,
    "last_unlocked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievement_progress_pkey" PRIMARY KEY ("achievement_progress_id")
);

-- CreateTable
CREATE TABLE "user_rating" (
    "user_id" INTEGER NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "seasonal_points" INTEGER NOT NULL DEFAULT 0,
    "yearly_points" INTEGER NOT NULL DEFAULT 0,
    "mythic_rank" INTEGER,
    "current_level" "RatingLevel" NOT NULL DEFAULT 'BRONZE',
    "prediction_count" INTEGER NOT NULL DEFAULT 0,
    "prediction_wins" INTEGER NOT NULL DEFAULT 0,
    "last_recalculated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_rating_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "rating_snapshot" (
    "rating_snapshot_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "scope" "RatingScope" NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,

    CONSTRAINT "rating_snapshot_pkey" PRIMARY KEY ("rating_snapshot_id")
);

-- CreateTable
CREATE TABLE "rating_settings" (
    "rating_settings_id" SERIAL NOT NULL,
    "current_scope_days" INTEGER NOT NULL,
    "yearly_scope_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rating_settings_pkey" PRIMARY KEY ("rating_settings_id")
);

-- CreateTable
CREATE TABLE "rating_season" (
    "rating_season_id" BIGSERIAL NOT NULL,
    "scope" "RatingScope" NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "duration_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rating_season_pkey" PRIMARY KEY ("rating_season_id")
);

-- CreateTable
CREATE TABLE "rating_season_winner" (
    "rating_season_winner_id" BIGSERIAL NOT NULL,
    "season_id" BIGINT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "scope_points" INTEGER NOT NULL,
    "total_points" INTEGER NOT NULL,
    "prediction_count" INTEGER NOT NULL DEFAULT 0,
    "prediction_wins" INTEGER NOT NULL DEFAULT 0,
    "display_name" TEXT NOT NULL,
    "username" TEXT,
    "photo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_season_winner_pkey" PRIMARY KEY ("rating_season_winner_id")
);

-- CreateTable
CREATE TABLE "admin_point_adjustment" (
    "point_adjustment_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "admin_identifier" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "scope" "RatingScope",
    "reason" TEXT,
    "match_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_point_adjustment_pkey" PRIMARY KEY ("point_adjustment_id")
);

-- CreateTable
CREATE TABLE "admin_action_log" (
    "admin_action_log_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "admin_identifier" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "admin_action_log_pkey" PRIMARY KEY ("admin_action_log_id")
);

-- CreateTable
CREATE TABLE "achievement_type" (
    "achievement_type_id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "required_value" INTEGER NOT NULL,
    "metric" "AchievementMetric" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievement_type_pkey" PRIMARY KEY ("achievement_type_id")
);

-- CreateTable
CREATE TABLE "user_achievement" (
    "user_id" INTEGER NOT NULL,
    "achievement_type_id" INTEGER NOT NULL,
    "achieved_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_achievement_pkey" PRIMARY KEY ("user_id","achievement_type_id")
);

-- CreateTable
CREATE TABLE "news" (
    "news_id" BIGSERIAL NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "cover_url" TEXT,
    "send_to_telegram" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_pkey" PRIMARY KEY ("news_id")
);

-- CreateTable
CREATE TABLE "ad_banner" (
    "ad_banner_id" BIGSERIAL NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(160),
    "target_url" TEXT,
    "image_data" BYTEA NOT NULL,
    "image_mime" TEXT NOT NULL,
    "image_width" INTEGER NOT NULL,
    "image_height" INTEGER NOT NULL,
    "image_size" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_banner_pkey" PRIMARY KEY ("ad_banner_id")
);

-- CreateTable
CREATE TABLE "disqualification" (
    "disqualification_id" BIGSERIAL NOT NULL,
    "person_id" INTEGER NOT NULL,
    "club_id" INTEGER,
    "reason" "DisqualificationReason" NOT NULL,
    "sanction_date" TIMESTAMP(3) NOT NULL,
    "ban_duration_matches" INTEGER NOT NULL,
    "matches_missed" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disqualification_pkey" PRIMARY KEY ("disqualification_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "season_roster_season_id_club_id_shirt_number_key" ON "season_roster"("season_id", "club_id", "shirt_number");

-- CreateIndex
CREATE UNIQUE INDEX "season_round_season_id_label_key" ON "season_round"("season_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "unique_series_match_number" ON "match"("series_id", "series_match_number");

-- CreateIndex
CREATE UNIQUE INDEX "season_group_season_id_group_index_key" ON "season_group"("season_id", "group_index");

-- CreateIndex
CREATE UNIQUE INDEX "season_group_slot_group_id_position_key" ON "season_group_slot"("group_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_telegram_id_key" ON "app_user"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_user_id_match_id_key" ON "prediction"("user_id", "match_id");

-- CreateIndex
CREATE INDEX "prediction_template_match_market_idx" ON "prediction_template"("match_id", "market_type");

-- CreateIndex
CREATE INDEX "prediction_entry_template_status_idx" ON "prediction_entry"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_entry_user_template_unique" ON "prediction_entry"("user_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_level_achievement_id_level_key" ON "achievement_level"("achievement_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_progress_user_id_achievement_id_key" ON "achievement_progress"("user_id", "achievement_id");

-- CreateIndex
CREATE INDEX "rating_snapshot_scope_captured_idx" ON "rating_snapshot"("scope", "captured_at");

-- CreateIndex
CREATE INDEX "rating_season_scope_start_idx" ON "rating_season"("scope", "starts_at");

-- CreateIndex
CREATE INDEX "rating_season_scope_closed_idx" ON "rating_season"("scope", "closed_at");

-- CreateIndex
CREATE INDEX "rating_season_winner_user_idx" ON "rating_season_winner"("user_id", "season_id");

-- CreateIndex
CREATE UNIQUE INDEX "rating_season_winner_season_rank_unique" ON "rating_season_winner"("season_id", "rank");

-- CreateIndex
CREATE INDEX "point_adjustment_user_created_idx" ON "admin_point_adjustment"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_action_log_created_idx" ON "admin_action_log"("created_at");

-- CreateIndex
CREATE INDEX "news_created_at_desc" ON "news"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ad_banner_active_order" ON "ad_banner"("is_active", "display_order", "updated_at");

-- AddForeignKey
ALTER TABLE "season" ADD CONSTRAINT "season_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("competition_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_participant" ADD CONSTRAINT "season_participant_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_participant" ADD CONSTRAINT "season_participant_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_roster" ADD CONSTRAINT "season_roster_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_roster" ADD CONSTRAINT "season_roster_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_roster" ADD CONSTRAINT "season_roster_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("person_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_player" ADD CONSTRAINT "club_player_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_player" ADD CONSTRAINT "club_player_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_round" ADD CONSTRAINT "season_round_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_round" ADD CONSTRAINT "season_round_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "season_group"("season_group_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_series" ADD CONSTRAINT "match_series_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_series" ADD CONSTRAINT "match_series_home_club_id_fkey" FOREIGN KEY ("home_club_id") REFERENCES "club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_series" ADD CONSTRAINT "match_series_away_club_id_fkey" FOREIGN KEY ("away_club_id") REFERENCES "club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_series" ADD CONSTRAINT "match_series_winner_club_id_fkey" FOREIGN KEY ("winner_club_id") REFERENCES "club"("club_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "match_series"("series_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_stadium_id_fkey" FOREIGN KEY ("stadium_id") REFERENCES "stadium"("stadium_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "person"("person_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "season_round"("round_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "season_group"("season_group_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_group" ADD CONSTRAINT "season_group_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_group_slot" ADD CONSTRAINT "season_group_slot_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "season_group"("season_group_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_group_slot" ADD CONSTRAINT "season_group_slot_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_lineup" ADD CONSTRAINT "match_lineup_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_lineup" ADD CONSTRAINT "match_lineup_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("person_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_lineup" ADD CONSTRAINT "match_lineup_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "club"("club_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "person"("person_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_related_player_id_fkey" FOREIGN KEY ("related_player_id") REFERENCES "person"("person_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_statistic" ADD CONSTRAINT "match_statistic_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_statistic" ADD CONSTRAINT "match_statistic_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_club_career_stats" ADD CONSTRAINT "player_club_career_stats_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_club_career_stats" ADD CONSTRAINT "player_club_career_stats_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_season_stats" ADD CONSTRAINT "club_season_stats_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_season_stats" ADD CONSTRAINT "club_season_stats_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_league_player_id_fkey" FOREIGN KEY ("league_player_id") REFERENCES "person"("person_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_template" ADD CONSTRAINT "prediction_template_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_entry" ADD CONSTRAINT "prediction_entry_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prediction_template"("prediction_template_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_entry" ADD CONSTRAINT "prediction_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_streak" ADD CONSTRAINT "prediction_streak_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_level" ADD CONSTRAINT "achievement_level_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievement_type"("achievement_type_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievement_type"("achievement_type_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_rating" ADD CONSTRAINT "user_rating_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_snapshot" ADD CONSTRAINT "rating_snapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_season_winner" ADD CONSTRAINT "rating_season_winner_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "rating_season"("rating_season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_point_adjustment" ADD CONSTRAINT "admin_point_adjustment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_action_log" ADD CONSTRAINT "admin_action_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_achievement_type_id_fkey" FOREIGN KEY ("achievement_type_id") REFERENCES "achievement_type"("achievement_type_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disqualification" ADD CONSTRAINT "disqualification_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disqualification" ADD CONSTRAINT "disqualification_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migration: 0001_shop_catalog
-- Shop catalog and orders

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "shop_item" (
    "shop_item_id" SERIAL NOT NULL,
    "slug" TEXT,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(160),
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'RUB',
    "stock_quantity" INTEGER,
    "max_per_order" INTEGER NOT NULL DEFAULT 3,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "image_data" BYTEA,
    "image_mime" TEXT,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "image_size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_item_pkey" PRIMARY KEY ("shop_item_id"),
    CONSTRAINT "shop_item_slug_unique" UNIQUE ("slug")
);

-- CreateTable
CREATE TABLE "shop_order" (
    "shop_order_id" BIGSERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "user_id" INTEGER,
    "telegram_id" BIGINT,
    "username" TEXT,
    "first_name" TEXT,
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
    "total_cents" INTEGER NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'RUB',
    "customer_note" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_order_pkey" PRIMARY KEY ("shop_order_id"),
    CONSTRAINT "shop_order_order_number_unique" UNIQUE ("order_number")
);

-- CreateTable
CREATE TABLE "shop_order_item" (
    "shop_order_item_id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(160),
    "price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "image_url" TEXT,

    CONSTRAINT "shop_order_item_pkey" PRIMARY KEY ("shop_order_item_id")
);

-- CreateIndex
CREATE INDEX "shop_item_active_order_idx" ON "shop_item" ("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "shop_order_status_created_idx" ON "shop_order" ("status", "created_at");

-- CreateIndex
CREATE INDEX "shop_order_item_order_idx" ON "shop_order_item" ("order_id");

-- CreateIndex
CREATE INDEX "shop_order_item_item_idx" ON "shop_order_item" ("item_id");

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_item" ADD CONSTRAINT "shop_order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shop_order"("shop_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_item" ADD CONSTRAINT "shop_order_item_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "shop_item"("shop_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migration: 20251121173415_
-- RenameIndex
ALTER INDEX "shop_order_order_number_unique" RENAME TO "shop_order_order_number_key";

-- Migration: 20251124120000_daily_rewards
-- CreateTable
CREATE TABLE "daily_reward_claim" (
    "daily_reward_claim_id" BIGSERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "day_number" INTEGER NOT NULL,
    "streak_after" INTEGER NOT NULL,
    "points_awarded" INTEGER NOT NULL,
    "claim_date_key" VARCHAR(16) NOT NULL,
    "animation_key" VARCHAR(32) NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "daily_reward_claim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_reward_unique_day" ON "daily_reward_claim" ("user_id", "claim_date_key");
CREATE INDEX "daily_reward_date_idx" ON "daily_reward_claim" ("claim_date_key");

-- Migration: 20251125120000_streak_achievements
-- CreateEnum
CREATE TYPE "AchievementJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "user_achievement_rewards" (
    "user_achievement_reward_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "season_id" INTEGER,
    "points" INTEGER NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievement_rewards_pkey" PRIMARY KEY ("user_achievement_reward_id")
);

-- CreateTable
CREATE TABLE "achievement_jobs" (
    "achievement_job_id" BIGSERIAL NOT NULL,
    "status" "AchievementJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievement_jobs_pkey" PRIMARY KEY ("achievement_job_id")
);

-- CreateIndex
CREATE INDEX "user_achievement_reward_user_notified_idx" ON "user_achievement_rewards"("user_id", "notified");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievement_reward_unique" ON "user_achievement_rewards"("user_id", "group", "tier", "season_id");

-- CreateIndex
CREATE INDEX "achievement_job_status_created_idx" ON "achievement_jobs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "user_achievement_rewards" ADD CONSTRAINT "user_achievement_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migration: 20251125130000_add_predictions_achievement
-- Seed: Add TOTAL_PREDICTIONS achievement type if not exists
-- This migration adds the "Predictions" achievement for tracking total predictions count

-- Insert achievement type for TOTAL_PREDICTIONS (if not exists)
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'РџСЂРѕРіРЅРѕР·С‹', 'Р”РѕСЃС‚РёР¶РµРЅРёРµ Р·Р° РєРѕР»РёС‡РµСЃС‚РІРѕ СЃРґРµР»Р°РЅРЅС‹С… РїСЂРѕРіРЅРѕР·РѕРІ', 1, 'TOTAL_PREDICTIONS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'TOTAL_PREDICTIONS'
);

-- Insert levels for TOTAL_PREDICTIONS achievement
-- Level 1: 20 predictions = +50 points (Bronze)
-- Level 2: 100 predictions = +350 points (Silver)
-- Level 3: 250 predictions = +1000 points (Gold)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 20, '/achievements/betcount-bronze.png', 'Р›СЋР±РёС‚РµР»СЊ', 'РЎРґРµР»Р°РЅРѕ 20 РїСЂРѕРіРЅРѕР·РѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'TOTAL_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 100, '/achievements/betcount-silver.png', 'Р—РЅР°С‚РѕРє', 'РЎРґРµР»Р°РЅРѕ 100 РїСЂРѕРіРЅРѕР·РѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'TOTAL_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 250, '/achievements/betcount-gold.png', 'Р­РєСЃРїРµСЂС‚', 'РЎРґРµР»Р°РЅРѕ 250 РїСЂРѕРіРЅРѕР·РѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'TOTAL_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- Also ensure DAILY_LOGIN achievement exists with correct levels
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'РЎРµСЂРёСЏ РІС…РѕРґРѕРІ', 'Р”РѕСЃС‚РёР¶РµРЅРёРµ Р·Р° РµР¶РµРґРЅРµРІРЅС‹Рµ РІС…РѕРґС‹ РІ РїСЂРёР»РѕР¶РµРЅРёРµ', 1, 'DAILY_LOGIN', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'DAILY_LOGIN'
);

-- Insert levels for DAILY_LOGIN achievement
-- Level 1: 7 days = +20 points (Bronze)
-- Level 2: 60 days = +200 points (Silver)
-- Level 3: 180 days = +1000 points (Gold)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 7, '/achievements/streak-bronze.png', 'Р—Р°РїР°СЃРЅРѕР№', 'РЎРµСЂРёСЏ РІС…РѕРґРѕРІ 7 РґРЅРµР№', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'DAILY_LOGIN'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 60, '/achievements/streak-silver.png', 'РћСЃРЅРѕРІРЅРѕР№', 'РЎРµСЂРёСЏ РІС…РѕРґРѕРІ 60 РґРЅРµР№', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'DAILY_LOGIN'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 180, '/achievements/streak-gold.png', 'РљР°РїРёС‚Р°РЅ', 'РЎРµСЂРёСЏ РІС…РѕРґРѕРІ 180 РґРЅРµР№', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'DAILY_LOGIN'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- Migration: 20251125140000_season_points_achievement
-- Migration: Add SEASON_POINTS enum value
-- First part: just add the enum value (must be committed separately in PostgreSQL)

-- Add SEASON_POINTS to AchievementMetric enum
ALTER TYPE "AchievementMetric" ADD VALUE IF NOT EXISTS 'SEASON_POINTS';

-- Migration: 20251125140001_season_points_achievement_data
-- Migration: Seed SEASON_POINTS achievement data
-- This must run AFTER the enum value has been committed

-- Insert achievement type for SEASON_POINTS (if not exists)
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Р‘РѕРјР±Р°СЂРґРёСЂ СЃРµР·РѕРЅР°', 'Р”РѕСЃС‚РёР¶РµРЅРёРµ Р·Р° РЅР°РєРѕРїР»РµРЅРёРµ РѕС‡РєРѕРІ РІ СЃРµР·РѕРЅРЅРѕРј СЂРµР№С‚РёРЅРіРµ', 1, 'SEASON_POINTS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'SEASON_POINTS'
);

-- Insert levels for SEASON_POINTS achievement
-- Level 1: 200 points = +50 points to yearly rating (Bronze)
-- Level 2: 1000 points = +250 points to yearly rating (Silver)
-- Level 3: 5000 points = +1000 points to yearly rating (Gold)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 200, '/achievements/credits-bronze.png', 'Р¤РѕСЂРІР°СЂРґ', 'РќР°РєРѕРїР»РµРЅРѕ 200 РѕС‡РєРѕРІ РІ СЃРµР·РѕРЅРµ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'SEASON_POINTS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 1000, '/achievements/credits-silver.png', 'Р“РѕР»РµР°РґРѕСЂ', 'РќР°РєРѕРїР»РµРЅРѕ 1000 РѕС‡РєРѕРІ РІ СЃРµР·РѕРЅРµ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'SEASON_POINTS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 5000, '/achievements/credits-gold.png', 'Р›РµРіРµРЅРґР°', 'РќР°РєРѕРїР»РµРЅРѕ 5000 РѕС‡РєРѕРІ РІ СЃРµР·РѕРЅРµ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'SEASON_POINTS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- Migration: 20251127120000_subscriptions
-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum  
CREATE TYPE "NotificationMessageType" AS ENUM ('MATCH_REMINDER', 'MATCH_STARTED', 'MATCH_FINISHED', 'GOAL_SCORED');

-- CreateTable
CREATE TABLE "club_subscription" (
    "subscription_id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_subscription_pkey" PRIMARY KEY ("subscription_id")
);

-- CreateTable
CREATE TABLE "match_subscription" (
    "subscription_id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "match_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_subscription_pkey" PRIMARY KEY ("subscription_id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "settings_id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remind_before" INTEGER NOT NULL DEFAULT 30,
    "match_start_enabled" BOOLEAN NOT NULL DEFAULT true,
    "match_end_enabled" BOOLEAN NOT NULL DEFAULT false,
    "goal_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("settings_id")
);

-- CreateTable
CREATE TABLE "notification_queue" (
    "notification_id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "match_id" BIGINT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "message_type" "NotificationMessageType" NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_queue_pkey" PRIMARY KEY ("notification_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_subscription_user_id_club_id_key" ON "club_subscription"("user_id", "club_id");

-- CreateIndex
CREATE INDEX "club_subscription_club_id_idx" ON "club_subscription"("club_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_subscription_user_id_match_id_key" ON "match_subscription"("user_id", "match_id");

-- CreateIndex
CREATE INDEX "match_subscription_match_id_idx" ON "match_subscription"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_user_id_key" ON "notification_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_queue_user_id_match_id_message_type_key" ON "notification_queue"("user_id", "match_id", "message_type");

-- CreateIndex
CREATE INDEX "notification_queue_status_scheduled_at_idx" ON "notification_queue"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "notification_queue_user_id_status_idx" ON "notification_queue"("user_id", "status");

-- AddForeignKey
ALTER TABLE "club_subscription" ADD CONSTRAINT "club_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_subscription" ADD CONSTRAINT "club_subscription_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_subscription" ADD CONSTRAINT "match_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_subscription" ADD CONSTRAINT "match_subscription_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_queue" ADD CONSTRAINT "notification_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_queue" ADD CONSTRAINT "notification_queue_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("match_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migration: 20251128120000_cup_bracket_settings
-- Р”РѕР±Р°РІР»РµРЅРёРµ enum BracketType РґР»СЏ СЂР°Р·РґРµР»РµРЅРёСЏ С‚РёРїРѕРІ РїР»РµР№-РѕС„С„ СЃРµС‚РѕРє
-- (QUALIFICATION вЂ” РєРІР°Р»РёС„РёРєР°С†РёСЏ, GOLD вЂ” Р·РѕР»РѕС‚РѕР№ РєСѓР±РѕРє, SILVER вЂ” СЃРµСЂРµР±СЂСЏРЅС‹Р№ РєСѓР±РѕРє)
DO $$ BEGIN
  CREATE TYPE "BracketType" AS ENUM ('QUALIFICATION', 'GOLD', 'SILVER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Р”РѕР±Р°РІР»РµРЅРёРµ РїРѕР»РµР№ РґР»СЏ РЅР°СЃС‚СЂРѕР№РєРё РєРѕР»РёС‡РµСЃС‚РІР° РєСЂСѓРіРѕРІ РІ РіСЂСѓРїРїРµ Рё С„РѕСЂРјР°С‚Р° РїР»РµР№-РѕС„С„
ALTER TABLE "season" ADD COLUMN IF NOT EXISTS "group_rounds" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "season" ADD COLUMN IF NOT EXISTS "playoff_best_of" INTEGER NOT NULL DEFAULT 1;

-- Р”РѕР±Р°РІР»РµРЅРёРµ РїРѕР»СЏ bracketType РІ match_series РґР»СЏ СЂР°Р·РґРµР»РµРЅРёСЏ СЃРµС‚РѕРє Gold/Silver/Qualification
ALTER TABLE "match_series" ADD COLUMN IF NOT EXISTS "bracket_type" "BracketType";

-- РљРѕРјРјРµРЅС‚Р°СЂРёРё Рє РЅРѕРІС‹Рј РїРѕР»СЏРј
COMMENT ON COLUMN "season"."group_rounds" IS 'РљРѕР»РёС‡РµСЃС‚РІРѕ РєСЂСѓРіРѕРІ РІ РіСЂСѓРїРїРѕРІРѕРј СЌС‚Р°РїРµ (1 РёР»Рё 2)';
COMMENT ON COLUMN "season"."playoff_best_of" IS 'Р”Рѕ СЃРєРѕР»СЊРєРёС… РїРѕР±РµРґ РёРіСЂР°РµС‚СЃСЏ СЃРµСЂРёСЏ РїР»РµР№-РѕС„С„ (1, 3, 5, 7)';
COMMENT ON COLUMN "match_series"."bracket_type" IS 'РўРёРї СЃРµС‚РєРё: QUALIFICATION вЂ” РєРІР°Р»РёС„РёРєР°С†РёСЏ, GOLD вЂ” Р·РѕР»РѕС‚РѕР№ РєСѓР±РѕРє, SILVER вЂ” СЃРµСЂРµР±СЂСЏРЅС‹Р№ РєСѓР±РѕРє';

-- Migration: 20251128142128_
-- DropIndex
DROP INDEX "notification_queue_user_id_status_idx";

-- AlterTable
ALTER TABLE "ad_banner" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "notification_queue_user_idx" ON "notification_queue"("user_id");

-- CreateIndex
CREATE INDEX "notification_queue_match_idx" ON "notification_queue"("match_id");

-- RenameIndex
ALTER INDEX "club_subscription_club_id_idx" RENAME TO "club_subscription_club_idx";

-- RenameIndex
ALTER INDEX "club_subscription_user_id_club_id_key" RENAME TO "club_subscription_user_club_unique";

-- RenameIndex
ALTER INDEX "match_subscription_match_id_idx" RENAME TO "match_subscription_match_idx";

-- RenameIndex
ALTER INDEX "match_subscription_user_id_match_id_key" RENAME TO "match_subscription_user_match_unique";

-- RenameIndex
ALTER INDEX "notification_queue_status_scheduled_at_idx" RENAME TO "notification_queue_status_scheduled_idx";

-- RenameIndex
ALTER INDEX "notification_queue_user_id_match_id_message_type_key" RENAME TO "notification_queue_user_match_type_unique";

-- RenameIndex
ALTER INDEX "user_achievement_reward_unique" RENAME TO "user_achievement_rewards_user_id_group_tier_season_id_key";

-- Migration: 20251129074419_express_bets
-- CreateEnum
CREATE TYPE "ExpressStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'CANCELLED', 'VOID');

-- CreateTable
CREATE TABLE "express_bet" (
    "express_bet_id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "ExpressStatus" NOT NULL DEFAULT 'PENDING',
    "multiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "base_points" INTEGER NOT NULL,
    "score_awarded" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "express_bet_pkey" PRIMARY KEY ("express_bet_id")
);

-- CreateTable
CREATE TABLE "express_bet_item" (
    "express_bet_item_id" BIGSERIAL NOT NULL,
    "express_id" BIGINT NOT NULL,
    "template_id" BIGINT NOT NULL,
    "selection" TEXT NOT NULL,
    "status" "PredictionEntryStatus" NOT NULL DEFAULT 'PENDING',
    "base_points" INTEGER NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "express_bet_item_pkey" PRIMARY KEY ("express_bet_item_id")
);

-- CreateIndex
CREATE INDEX "express_bet_user_status_idx" ON "express_bet"("user_id", "status");

-- CreateIndex
CREATE INDEX "express_bet_status_created_idx" ON "express_bet"("status", "created_at");

-- CreateIndex
CREATE INDEX "express_item_express_idx" ON "express_bet_item"("express_id");

-- CreateIndex
CREATE INDEX "express_item_template_status_idx" ON "express_bet_item"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "express_item_unique" ON "express_bet_item"("express_id", "template_id");

-- AddForeignKey
ALTER TABLE "express_bet" ADD CONSTRAINT "express_bet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "express_bet_item" ADD CONSTRAINT "express_bet_item_express_id_fkey" FOREIGN KEY ("express_id") REFERENCES "express_bet"("express_bet_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "express_bet_item" ADD CONSTRAINT "express_bet_item_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "prediction_template"("prediction_template_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migration: 20251130120000_bet_wins_achievement
-- Seed: Add CORRECT_PREDICTIONS achievement type for tracking correctly guessed predictions
-- This migration adds the "Bet Wins" achievement for tracking correct predictions count

-- Insert achievement type for CORRECT_PREDICTIONS (if not exists)
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'РЈРіР°РґР°РЅРЅС‹Рµ РїСЂРѕРіРЅРѕР·С‹', 'Р”РѕСЃС‚РёР¶РµРЅРёРµ Р·Р° РєРѕР»РёС‡РµСЃС‚РІРѕ СѓРіР°РґР°РЅРЅС‹С… РїСЂРѕРіРЅРѕР·РѕРІ', 1, 'CORRECT_PREDICTIONS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'CORRECT_PREDICTIONS'
);

-- Insert levels for CORRECT_PREDICTIONS achievement
-- Level 1: 10 correct predictions = +20 points (РЎС‡Р°СЃС‚Р»РёРІС‡РёРє)
-- Level 2: 50 correct predictions = +200 points (РЎРЅР°Р№РїРµСЂ)
-- Level 3: 200 correct predictions = +1000 points (Р§РµРјРїРёРѕРЅ)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 10, '/achievements/betwins-bronze.png', 'РЎС‡Р°СЃС‚Р»РёРІС‡РёРє', 'РЈРіР°РґР°РЅРѕ 10 РїСЂРѕРіРЅРѕР·РѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'CORRECT_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 50, '/achievements/betwins-silver.png', 'РЎРЅР°Р№РїРµСЂ', 'РЈРіР°РґР°РЅРѕ 50 РїСЂРѕРіРЅРѕР·РѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'CORRECT_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 200, '/achievements/betwins-gold.png', 'Р§РµРјРїРёРѕРЅ', 'РЈРіР°РґР°РЅРѕ 200 РїСЂРѕРіРЅРѕР·РѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'CORRECT_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- Migration: 20251203120000_season_archive
-- РЎРёСЃС‚РµРјР° Р°СЂС…РёРІРёСЂРѕРІР°РЅРёСЏ СЃРµР·РѕРЅРѕРІ
-- Р”РѕР±Р°РІР»СЏРµС‚ РїРѕР»СЏ isArchived, archivedAt, archivedBy РІ С‚Р°Р±Р»РёС†Сѓ Season
-- РЎРѕР·РґР°РµС‚ С‚Р°Р±Р»РёС†Сѓ SeasonArchive РґР»СЏ С…СЂР°РЅРµРЅРёСЏ JSON-СЃРЅРёРјРєРѕРІ Р·Р°РІРµСЂС€С‘РЅРЅС‹С… СЃРµР·РѕРЅРѕРІ

-- AlterTable: РґРѕР±Р°РІРёС‚СЊ РїРѕР»СЏ Р°СЂС…РёРІР°С†РёРё РІ Season
ALTER TABLE "season" ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "season" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "season" ADD COLUMN "archived_by" TEXT;

-- CreateTable: SeasonArchive РґР»СЏ С…СЂР°РЅРµРЅРёСЏ JSON-СЃРЅРёРјРєРѕРІ
CREATE TABLE "season_archive" (
    "season_archive_id" BIGSERIAL NOT NULL,
    "season_id" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_by" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "summary" JSONB NOT NULL,
    "standings" JSONB NOT NULL,
    "top_scorers" JSONB NOT NULL,
    "top_assists" JSONB NOT NULL,
    "playoff_bracket" JSONB NOT NULL,
    "groups" JSONB NOT NULL,
    "match_summaries" JSONB NOT NULL,
    "achievements" JSONB NOT NULL,
    "total_matches" INTEGER NOT NULL,
    "total_goals" INTEGER NOT NULL,
    "total_cards" INTEGER NOT NULL,
    "participants_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_archive_pkey" PRIMARY KEY ("season_archive_id")
);

-- CreateIndex: СѓРЅРёРєР°Р»СЊРЅС‹Р№ РёРЅРґРµРєСЃ РЅР° seasonId
CREATE UNIQUE INDEX "season_archive_season_id_key" ON "season_archive"("season_id");

-- CreateIndex: РёРЅРґРµРєСЃ РґР»СЏ СЃРѕСЂС‚РёСЂРѕРІРєРё РїРѕ РґР°С‚Рµ Р°СЂС…РёРІР°С†РёРё
CREATE INDEX "season_archive_archived_idx" ON "season_archive"("archived_at");

-- CreateIndex: СЃРѕСЃС‚Р°РІРЅРѕР№ РёРЅРґРµРєСЃ РґР»СЏ РѕРїС‚РёРјРёР·Р°С†РёРё Р·Р°РїСЂРѕСЃРѕРІ
CREATE INDEX "season_archived_start_idx" ON "season"("is_archived", "start_date");

-- CreateIndex: СЃРѕСЃС‚Р°РІРЅРѕР№ РёРЅРґРµРєСЃ РґР»СЏ С„РёР»СЊС‚СЂР°С†РёРё РїРѕ СЃРѕСЂРµРІРЅРѕРІР°РЅРёСЋ
CREATE INDEX "season_archived_competition_idx" ON "season"("is_archived", "competition_id");

-- AddForeignKey: СЃРІСЏР·СЊ СЃ С‚Р°Р±Р»РёС†РµР№ Season
ALTER TABLE "season_archive" ADD CONSTRAINT "season_archive_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migration: 20251204120000_prediction_streak_achievement
-- Р”РѕР±Р°РІР»СЏРµРј РЅРѕРІРѕРµ Р·РЅР°С‡РµРЅРёРµ PREDICTION_STREAK РІ enum AchievementMetric
ALTER TYPE "AchievementMetric" ADD VALUE 'PREDICTION_STREAK';

-- Migration: 20251204130000_express_wins_and_broadcast_achievements
-- Р”РѕР±Р°РІР»СЏРµРј РЅРѕРІС‹Рµ Р·РЅР°С‡РµРЅРёСЏ EXPRESS_WINS Рё BROADCAST_WATCH_TIME РІ enum AchievementMetric
ALTER TYPE "AchievementMetric" ADD VALUE 'EXPRESS_WINS';
ALTER TYPE "AchievementMetric" ADD VALUE 'BROADCAST_WATCH_TIME';

-- РЎРѕР·РґР°С‘Рј С‚Р°Р±Р»РёС†Сѓ РґР»СЏ РѕС‚СЃР»РµР¶РёРІР°РЅРёСЏ РІСЂРµРјРµРЅРё РїСЂРѕСЃРјРѕС‚СЂР° С‚СЂР°РЅСЃР»СЏС†РёР№
CREATE TABLE user_broadcast_watch_time (
  user_id INTEGER PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- РРЅРґРµРєСЃ РЅРµ РЅСѓР¶РµРЅ, С‚.Рє. user_id вЂ” РїРµСЂРІРёС‡РЅС‹Р№ РєР»СЋС‡

-- Migration: 20251204140000_seed_new_achievement_types
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'РЎРµСЂРёСЏ РїРѕР±РµРґ', 'Р”РѕСЃС‚РёР¶РµРЅРёРµ Р·Р° РїРѕР±РµРґС‹ РїРѕРґСЂСЏРґ РІ РїСЂРѕРіРЅРѕР·Р°С…', 15, 'PREDICTION_STREAK', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'PREDICTION_STREAK'
);

-- Level 1: 3 wins in a row = +50 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 3, '/achievements/prediction-streak-placeholder.svg', 'РЎС‡Р°СЃС‚Р»РёРІР°СЏ С‚СЂРѕР№РєР°', '3 РїРѕР±РµРґС‹ РїРѕРґСЂСЏРґ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'PREDICTION_STREAK'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

-- Level 2: 7 wins in a row = +250 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 7, '/achievements/prediction-streak-placeholder.svg', 'РЎРµРјС‘СЂРєР° СѓРґР°С‡Рё', '7 РїРѕР±РµРґ РїРѕРґСЂСЏРґ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'PREDICTION_STREAK'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

-- Level 3: 15 wins in a row = +1000 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 15, '/achievements/prediction-streak-placeholder.svg', 'РњР°РіРёС‡РµСЃРєР°СЏ СЃРµСЂРёСЏ', '15 РїРѕР±РµРґ РїРѕРґСЂСЏРґ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'PREDICTION_STREAK'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- ============================================================================
-- EXPRESS_WINS - СѓРіР°РґР°РЅРЅС‹Рµ СЌРєСЃРїСЂРµСЃСЃС‹
-- ============================================================================

INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'РњР°СЃС‚РµСЂ СЌРєСЃРїСЂРµСЃСЃРѕРІ', 'Р”РѕСЃС‚РёР¶РµРЅРёРµ Р·Р° СѓРіР°РґР°РЅРЅС‹Рµ СЌРєСЃРїСЂРµСЃСЃ-СЃС‚Р°РІРєРё', 50, 'EXPRESS_WINS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'EXPRESS_WINS'
);

-- Level 1: 5 express wins = +50 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 5, '/achievements/express-wins-placeholder.svg', 'Р­РєСЃРїСЂРµСЃСЃ-РїСЂРѕС„Рё', '5 СѓРіР°РґР°РЅРЅС‹С… СЌРєСЃРїСЂРµСЃСЃРѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'EXPRESS_WINS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

-- Level 2: 10 express wins = +250 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 10, '/achievements/express-wins-placeholder.svg', 'Р­РєСЃРїСЂРµСЃСЃ-РјР°СЃС‚РµСЂ', '10 СѓРіР°РґР°РЅРЅС‹С… СЌРєСЃРїСЂРµСЃСЃРѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'EXPRESS_WINS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

-- Level 3: 50 express wins = +1000 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 50, '/achievements/express-wins-placeholder.svg', 'Р­РєСЃРїСЂРµСЃСЃ-Р»РµРіРµРЅРґР°', '50 СѓРіР°РґР°РЅРЅС‹С… СЌРєСЃРїСЂРµСЃСЃРѕРІ', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'EXPRESS_WINS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- ============================================================================
-- BROADCAST_WATCH_TIME - РІСЂРµРјСЏ РїСЂРѕСЃРјРѕС‚СЂР° С‚СЂР°РЅСЃР»СЏС†РёР№ (РІ С‡Р°СЃР°С…)
-- ============================================================================

INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Р—СЂРёС‚РµР»СЊ С‚СЂР°РЅСЃР»СЏС†РёР№', 'Р”РѕСЃС‚РёР¶РµРЅРёРµ Р·Р° РїСЂРѕСЃРјРѕС‚СЂ С‚СЂР°РЅСЃР»СЏС†РёР№ РјР°С‚С‡РµР№', 100, 'BROADCAST_WATCH_TIME', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'BROADCAST_WATCH_TIME'
);

-- Level 1: 5 hours = +50 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 5, '/achievements/broadcast-watch-placeholder.svg', 'Р—СЂРёС‚РµР»СЊ', '5 С‡Р°СЃРѕРІ РїСЂРѕСЃРјРѕС‚СЂР°', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'BROADCAST_WATCH_TIME'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

-- Level 2: 25 hours = +200 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 25, '/achievements/broadcast-watch-placeholder.svg', 'Р¤Р°РЅР°С‚ С‚СЂР°РЅСЃР»СЏС†РёР№', '25 С‡Р°СЃРѕРІ РїСЂРѕСЃРјРѕС‚СЂР°', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'BROADCAST_WATCH_TIME'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

-- Level 3: 100 hours = +1500 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 100, '/achievements/broadcast-watch-placeholder.svg', 'РџРѕСЃС‚РѕСЏРЅРЅС‹Р№ Р·СЂРёС‚РµР»СЊ', '100 С‡Р°СЃРѕРІ РїСЂРѕСЃРјРѕС‚СЂР°', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'BROADCAST_WATCH_TIME'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- Migration: 20251204161858_
-- DropForeignKey
ALTER TABLE "user_broadcast_watch_time" DROP CONSTRAINT "user_broadcast_watch_time_user_id_fkey";

-- AlterTable
ALTER TABLE "user_broadcast_watch_time" ALTER COLUMN "last_updated_at" DROP DEFAULT,
ALTER COLUMN "last_updated_at" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "user_broadcast_watch_time" ADD CONSTRAINT "user_broadcast_watch_time_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

