-- Migration 002: alert deduplication via source_event_id
--
-- source_event_id is a stable identifier derived from the originating log
-- source (e.g. "winlog:Security:record_id:12345"). Events re-ingested after
-- an agent restart carry the same source_event_id, so the unique constraint
-- on (rule_id, source_event_id) silently discards the duplicate alert.
--
-- For events without a stable record_id (e.g. synthetic test events) the
-- column falls back to the ingested event UUID, which is unique per ingest —
-- those events will still generate alerts on re-ingest, which is acceptable.

ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS source_event_id TEXT NOT NULL DEFAULT '';

-- Only create the index if the unique constraint does not already exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_alerts_rule_source_event'
    ) THEN
        CREATE UNIQUE INDEX uq_alerts_rule_source_event
            ON alerts (rule_id, source_event_id)
            WHERE source_event_id <> '';
    END IF;
END;
$$;
