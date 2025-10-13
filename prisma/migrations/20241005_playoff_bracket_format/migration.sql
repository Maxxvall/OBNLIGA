-- Добавляем новый формат "PLAYOFF_BRACKET" в перечисление SeriesFormat
ALTER TYPE "SeriesFormat" ADD VALUE IF NOT EXISTS 'PLAYOFF_BRACKET';
