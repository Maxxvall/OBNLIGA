-- Seed: Add CORRECT_PREDICTIONS achievement type for tracking correctly guessed predictions
-- This migration adds the "Bet Wins" achievement for tracking correct predictions count

-- Insert achievement type for CORRECT_PREDICTIONS (if not exists)
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Угаданные прогнозы', 'Достижение за количество угаданных прогнозов', 1, 'CORRECT_PREDICTIONS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'CORRECT_PREDICTIONS'
);

-- Insert levels for CORRECT_PREDICTIONS achievement
-- Level 1: 10 correct predictions = +20 points (Счастливчик)
-- Level 2: 50 correct predictions = +200 points (Снайпер)
-- Level 3: 200 correct predictions = +1000 points (Чемпион)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 10, '/achievements/betwins-bronze.png', 'Счастливчик', 'Угадано 10 прогнозов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'CORRECT_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 50, '/achievements/betwins-silver.png', 'Снайпер', 'Угадано 50 прогнозов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'CORRECT_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 200, '/achievements/betwins-gold.png', 'Чемпион', 'Угадано 200 прогнозов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'CORRECT_PREDICTIONS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);
