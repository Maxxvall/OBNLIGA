-- Система архивирования сезонов
-- Добавляет поля isArchived, archivedAt, archivedBy в таблицу Season
-- Создает таблицу SeasonArchive для хранения JSON-снимков завершённых сезонов

-- AlterTable: добавить поля архивации в Season
ALTER TABLE "season" ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "season" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "season" ADD COLUMN "archived_by" TEXT;

-- CreateTable: SeasonArchive для хранения JSON-снимков
CREATE TABLE "season_archive" (
    "season_archive_id" BIGSERIAL NOT NULL,
    "season_id" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_by" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "summary" JSONB NOT NULL,
    "standings" JSONB NOT NULL,
    "top_scorers" JSONB NOT NULL,
    "top_assists" JSONB NOT NULL,
    "playoff_bracket" JSONB NOT NULL,
    "groups" JSONB NOT NULL,
    "match_summaries" JSONB NOT NULL,
    "achievements" JSONB NOT NULL,
    "total_matches" INTEGER NOT NULL,
    "total_goals" INTEGER NOT NULL,
    "total_cards" INTEGER NOT NULL,
    "participants_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_archive_pkey" PRIMARY KEY ("season_archive_id")
);

-- CreateIndex: уникальный индекс на seasonId
CREATE UNIQUE INDEX "season_archive_season_id_key" ON "season_archive"("season_id");

-- CreateIndex: индекс для сортировки по дате архивации
CREATE INDEX "season_archive_archived_idx" ON "season_archive"("archived_at");

-- CreateIndex: составной индекс для оптимизации запросов
CREATE INDEX "season_archived_start_idx" ON "season"("is_archived", "start_date");

-- CreateIndex: составной индекс для фильтрации по соревнованию
CREATE INDEX "season_archived_competition_idx" ON "season"("is_archived", "competition_id");

-- AddForeignKey: связь с таблицей Season
ALTER TABLE "season_archive" ADD CONSTRAINT "season_archive_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE CASCADE ON UPDATE CASCADE;
