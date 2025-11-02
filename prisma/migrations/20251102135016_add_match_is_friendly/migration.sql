/*
  Warnings:

  - You are about to drop the `friendly_match` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "friendly_match" DROP CONSTRAINT "friendly_match_referee_id_fkey";

-- DropForeignKey
ALTER TABLE "friendly_match" DROP CONSTRAINT "friendly_match_stadium_id_fkey";

-- AlterTable
ALTER TABLE "match" ADD COLUMN     "event_name" TEXT,
ADD COLUMN     "is_friendly" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "season_id" DROP NOT NULL;

-- DropTable
DROP TABLE "friendly_match";
