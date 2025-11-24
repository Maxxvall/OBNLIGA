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
