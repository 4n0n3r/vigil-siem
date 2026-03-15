-- Migration 003: add 'resolved' as a valid alert status
-- Run once after 002_dedup.sql

ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_status_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_status_check
    CHECK (status IN ('open', 'acknowledged', 'suppressed', 'resolved'));
