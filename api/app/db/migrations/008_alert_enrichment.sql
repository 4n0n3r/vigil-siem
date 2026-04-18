-- Migration 008: alert enrichment — hit_count, first_seen, last_seen
--
-- Converts ON CONFLICT DO NOTHING into an upsert that increments hit_count and
-- updates last_seen. This surfaces alert bursts (e.g. 2,855 alerts from 15
-- events) as a single row with hit_count > 1 instead of thousands of rows.
--
-- first_seen mirrors matched_at for backwards compatibility (existing rows get
-- matched_at as first_seen via the DEFAULT expression in the UPDATE path).

ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS hit_count  INTEGER     NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_seen  TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill first_seen for existing rows that pre-date this migration.
UPDATE alerts SET first_seen = matched_at WHERE first_seen IS NULL;

-- Make first_seen NOT NULL now that it is backfilled.
ALTER TABLE alerts ALTER COLUMN first_seen SET NOT NULL;
ALTER TABLE alerts ALTER COLUMN first_seen SET DEFAULT now();

-- Index for dashboard "top rules by hit_count" queries.
CREATE INDEX IF NOT EXISTS idx_alerts_hit_count ON alerts (hit_count DESC);
