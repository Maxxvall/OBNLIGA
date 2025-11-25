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
