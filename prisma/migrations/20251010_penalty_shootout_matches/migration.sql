-- Серия пенальти сохраняется отдельными полями, чтобы не менять базовую статистику матча
ALTER TABLE "match" ADD COLUMN "has_penalty_shootout" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "match" ADD COLUMN "penalty_home_score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "match" ADD COLUMN "penalty_away_score" INTEGER NOT NULL DEFAULT 0;
