-- Extend match event and disqualification enums for new discipline rules

BEGIN;

ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'OWN_GOAL';
ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'PENALTY_MISSED';
ALTER TYPE "MatchEventType" ADD VALUE IF NOT EXISTS 'SECOND_YELLOW_CARD';

ALTER TYPE "DisqualificationReason" ADD VALUE IF NOT EXISTS 'SECOND_YELLOW';

COMMIT;
