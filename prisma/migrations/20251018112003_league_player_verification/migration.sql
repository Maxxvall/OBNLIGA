-- CreateEnum
CREATE TYPE "LeaguePlayerStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED');

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "league_player_id" INTEGER,
ADD COLUMN     "league_player_requested_at" TIMESTAMP(3),
ADD COLUMN     "league_player_status" "LeaguePlayerStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "league_player_verified_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_league_player_id_fkey" FOREIGN KEY ("league_player_id") REFERENCES "person"("person_id") ON DELETE SET NULL ON UPDATE CASCADE;
