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
