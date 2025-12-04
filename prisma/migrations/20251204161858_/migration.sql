-- DropForeignKey
ALTER TABLE "user_broadcast_watch_time" DROP CONSTRAINT "user_broadcast_watch_time_user_id_fkey";

-- AlterTable
ALTER TABLE "user_broadcast_watch_time" ALTER COLUMN "last_updated_at" DROP DEFAULT,
ALTER COLUMN "last_updated_at" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "user_broadcast_watch_time" ADD CONSTRAINT "user_broadcast_watch_time_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
