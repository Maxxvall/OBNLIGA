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
