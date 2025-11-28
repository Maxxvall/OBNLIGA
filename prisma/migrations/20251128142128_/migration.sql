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
