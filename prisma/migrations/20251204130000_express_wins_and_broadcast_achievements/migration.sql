-- Добавляем новые значения EXPRESS_WINS и BROADCAST_WATCH_TIME в enum AchievementMetric
ALTER TYPE "AchievementMetric" ADD VALUE 'EXPRESS_WINS';
ALTER TYPE "AchievementMetric" ADD VALUE 'BROADCAST_WATCH_TIME';

-- Создаём таблицу для отслеживания времени просмотра трансляций
CREATE TABLE user_broadcast_watch_time (
  user_id INTEGER PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Индекс не нужен, т.к. user_id — первичный ключ
