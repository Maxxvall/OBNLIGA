-- CreateEnum
CREATE TYPE "PredictionMarketType" AS ENUM ('MATCH_OUTCOME', 'TOTAL_GOALS', 'CUSTOM_BOOLEAN');

-- CreateEnum
CREATE TYPE "PredictionEntryStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'VOID', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RatingScope" AS ENUM ('CURRENT', 'YEARLY');

-- CreateEnum
CREATE TYPE "RatingLevel" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MYTHIC');

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
CREATE INDEX "point_adjustment_user_created_idx" ON "admin_point_adjustment"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_action_log_created_idx" ON "admin_action_log"("created_at");

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
ALTER TABLE "admin_point_adjustment" ADD CONSTRAINT "admin_point_adjustment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_action_log" ADD CONSTRAINT "admin_action_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
