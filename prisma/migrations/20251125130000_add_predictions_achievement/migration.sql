-- Seed: Add TOTAL_PREDICTIONS achievement type if not exists
-- This migration adds the "Predictions" achievement for tracking total predictions count

-- Insert achievement type for TOTAL_PREDICTIONS (if not exists)
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Прогнозы', 'Достижение за количество сделанных прогнозов', 1, 'TOTAL_PREDICTIONS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'TOTAL_PREDICTIONS'
);

-- Insert levels for TOTAL_PREDICTIONS achievement
-- Level 1: 20 predictions = +50 points (Bronze)
-- Level 2: 100 predictions = +350 points (Silver)
-- Level 3: 250 predictions = +1000 points (Gold)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 20, '/achievements/betcount-bronze.png', 'Любитель', 'Сделано 20 прогнозов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'TOTAL_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 100, '/achievements/betcount-silver.png', 'Знаток', 'Сделано 100 прогнозов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'TOTAL_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 250, '/achievements/betcount-gold.png', 'Эксперт', 'Сделано 250 прогнозов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'TOTAL_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- Also ensure DAILY_LOGIN achievement exists with correct levels
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Серия входов', 'Достижение за ежедневные входы в приложение', 1, 'DAILY_LOGIN', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'DAILY_LOGIN'
);

-- Insert levels for DAILY_LOGIN achievement
-- Level 1: 7 days = +20 points (Bronze)
-- Level 2: 60 days = +200 points (Silver)
-- Level 3: 180 days = +1000 points (Gold)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 7, '/achievements/streak-bronze.png', 'Запасной', 'Серия входов 7 дней', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'DAILY_LOGIN'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 60, '/achievements/streak-silver.png', 'Основной', 'Серия входов 60 дней', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'DAILY_LOGIN'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 180, '/achievements/streak-gold.png', 'Капитан', 'Серия входов 180 дней', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'DAILY_LOGIN'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);
