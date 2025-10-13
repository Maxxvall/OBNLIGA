-- Добавление нового формата серии для кубка с групповым этапом
ALTER TYPE "SeriesFormat" ADD VALUE IF NOT EXISTS 'GROUP_SINGLE_ROUND_PLAYOFF';

-- Создание таблицы season_group
CREATE TABLE "season_group" (
  "season_group_id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "group_index" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "qualify_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "season_group_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "unique_group_index_per_season" ON "season_group" ("season_id", "group_index");

-- Таблица слотов для ручного распределения команд по группам
CREATE TABLE "season_group_slot" (
    "season_group_slot_id" SERIAL PRIMARY KEY,
    "group_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "club_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "season_group_slot_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "season_group"("season_group_id") ON DELETE CASCADE,
    CONSTRAINT "season_group_slot_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "club"("club_id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "unique_slot_per_group" ON "season_group_slot" ("group_id", "position");

-- Связь туров и матчей с группами
ALTER TABLE "season_round" ADD COLUMN     "group_id" INTEGER;
ALTER TABLE "season_round"
  ADD CONSTRAINT "season_round_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "season_group"("season_group_id") ON DELETE SET NULL;

ALTER TABLE "match" ADD COLUMN     "group_id" INTEGER;
ALTER TABLE "match"
  ADD CONSTRAINT "match_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "season_group"("season_group_id") ON DELETE SET NULL;
