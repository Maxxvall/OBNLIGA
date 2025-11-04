-- AlterTable
ALTER TABLE "prediction_entry" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "user_rating" ADD COLUMN     "prediction_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "prediction_wins" INTEGER NOT NULL DEFAULT 0;

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

-- CreateIndex
CREATE INDEX "rating_season_scope_start_idx" ON "rating_season"("scope", "starts_at");

-- CreateIndex
CREATE INDEX "rating_season_scope_closed_idx" ON "rating_season"("scope", "closed_at");

-- CreateIndex
CREATE INDEX "rating_season_winner_user_idx" ON "rating_season_winner"("user_id", "season_id");

-- CreateIndex
CREATE UNIQUE INDEX "rating_season_winner_season_rank_unique" ON "rating_season_winner"("season_id", "rank");

-- AddForeignKey
ALTER TABLE "rating_season_winner" ADD CONSTRAINT "rating_season_winner_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "rating_season"("rating_season_id") ON DELETE CASCADE ON UPDATE CASCADE;
