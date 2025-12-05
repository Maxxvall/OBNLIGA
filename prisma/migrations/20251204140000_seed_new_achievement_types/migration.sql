INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Серия побед', 'Достижение за победы подряд в прогнозах', 15, 'PREDICTION_STREAK', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'PREDICTION_STREAK'
);

-- Level 1: 3 wins in a row = +50 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 3, '/achievements/prediction-streak-placeholder.svg', 'Счастливая тройка', '3 победы подряд', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'PREDICTION_STREAK'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

-- Level 2: 7 wins in a row = +250 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 7, '/achievements/prediction-streak-placeholder.svg', 'Семёрка удачи', '7 побед подряд', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'PREDICTION_STREAK'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

-- Level 3: 15 wins in a row = +1000 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 15, '/achievements/prediction-streak-placeholder.svg', 'Магическая серия', '15 побед подряд', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'PREDICTION_STREAK'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- ============================================================================
-- EXPRESS_WINS - угаданные экспрессы
-- ============================================================================

INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Мастер экспрессов', 'Достижение за угаданные экспресс-ставки', 50, 'EXPRESS_WINS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'EXPRESS_WINS'
);

-- Level 1: 5 express wins = +50 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 5, '/achievements/express-wins-placeholder.svg', 'Экспресс-профи', '5 угаданных экспрессов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'EXPRESS_WINS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

-- Level 2: 10 express wins = +250 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 10, '/achievements/express-wins-placeholder.svg', 'Экспресс-мастер', '10 угаданных экспрессов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'EXPRESS_WINS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

-- Level 3: 50 express wins = +1000 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 50, '/achievements/express-wins-placeholder.svg', 'Экспресс-легенда', '50 угаданных экспрессов', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'EXPRESS_WINS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

-- ============================================================================
-- BROADCAST_WATCH_TIME - время просмотра трансляций (в часах)
-- ============================================================================

INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Зритель трансляций', 'Достижение за просмотр трансляций матчей', 100, 'BROADCAST_WATCH_TIME', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'BROADCAST_WATCH_TIME'
);

-- Level 1: 5 hours = +50 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 5, '/achievements/broadcast-watch-placeholder.svg', 'Зритель', '5 часов просмотра', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'BROADCAST_WATCH_TIME'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

-- Level 2: 25 hours = +200 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 25, '/achievements/broadcast-watch-placeholder.svg', 'Фанат трансляций', '25 часов просмотра', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'BROADCAST_WATCH_TIME'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

-- Level 3: 100 hours = +1500 points
INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 100, '/achievements/broadcast-watch-placeholder.svg', 'Постоянный зритель', '100 часов просмотра', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'BROADCAST_WATCH_TIME'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);

