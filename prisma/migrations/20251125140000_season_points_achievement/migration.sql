-- Migration: Add SEASON_POINTS enum value
-- First part: just add the enum value (must be committed separately in PostgreSQL)

-- Add SEASON_POINTS to AchievementMetric enum
ALTER TYPE "AchievementMetric" ADD VALUE IF NOT EXISTS 'SEASON_POINTS';
