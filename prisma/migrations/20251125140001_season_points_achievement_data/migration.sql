-- Migration: Seed SEASON_POINTS achievement data
-- This must run AFTER the enum value has been committed

-- Insert achievement type for SEASON_POINTS (if not exists)
INSERT INTO "achievement_type" ("name", "description", "required_value", "metric", "created_at", "updated_at")
SELECT 'Бомбардир сезона', 'Достижение за накопление очков в сезонном рейтинге', 1, 'SEASON_POINTS', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "achievement_type" WHERE "metric" = 'SEASON_POINTS'
);

-- Insert levels for SEASON_POINTS achievement
-- Level 1: 200 points = +50 points to yearly rating (Bronze)
-- Level 2: 1000 points = +250 points to yearly rating (Silver)
-- Level 3: 5000 points = +1000 points to yearly rating (Gold)

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 1, 200, '/achievements/credits-bronze.png', 'Форвард', 'Накоплено 200 очков в сезоне', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'SEASON_POINTS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 1
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 2, 1000, '/achievements/credits-silver.png', 'Голеадор', 'Накоплено 1000 очков в сезоне', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'SEASON_POINTS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 2
);

INSERT INTO "achievement_level" ("achievement_id", "level", "threshold", "icon_url", "title", "description", "created_at", "updated_at")
SELECT at.achievement_type_id, 3, 5000, '/achievements/credits-gold.png', 'Легенда', 'Накоплено 5000 очков в сезоне', NOW(), NOW()
FROM "achievement_type" at
WHERE at.metric = 'SEASON_POINTS'
AND NOT EXISTS (
    SELECT 1 FROM "achievement_level" al 
    WHERE al.achievement_id = at.achievement_type_id AND al.level = 3
);
