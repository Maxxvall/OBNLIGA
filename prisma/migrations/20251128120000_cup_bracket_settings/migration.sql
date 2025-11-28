-- Добавление enum BracketType для разделения типов плей-офф сеток
-- (QUALIFICATION — квалификация, GOLD — золотой кубок, SILVER — серебряный кубок)
DO $$ BEGIN
  CREATE TYPE "BracketType" AS ENUM ('QUALIFICATION', 'GOLD', 'SILVER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Добавление полей для настройки количества кругов в группе и формата плей-офф
ALTER TABLE "season" ADD COLUMN IF NOT EXISTS "group_rounds" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "season" ADD COLUMN IF NOT EXISTS "playoff_best_of" INTEGER NOT NULL DEFAULT 1;

-- Добавление поля bracketType в match_series для разделения сеток Gold/Silver/Qualification
ALTER TABLE "match_series" ADD COLUMN IF NOT EXISTS "bracket_type" "BracketType";

-- Комментарии к новым полям
COMMENT ON COLUMN "season"."group_rounds" IS 'Количество кругов в групповом этапе (1 или 2)';
COMMENT ON COLUMN "season"."playoff_best_of" IS 'До скольких побед играется серия плей-офф (1, 3, 5, 7)';
COMMENT ON COLUMN "match_series"."bracket_type" IS 'Тип сетки: QUALIFICATION — квалификация, GOLD — золотой кубок, SILVER — серебряный кубок';
