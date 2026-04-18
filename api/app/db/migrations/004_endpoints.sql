-- Migration 004: endpoint registry
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS endpoints (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL,
    hostname   TEXT        NOT NULL DEFAULT '',
    os         TEXT        NOT NULL DEFAULT '',
    api_key    TEXT        NOT NULL UNIQUE,
    last_seen  TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata   JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_endpoints_api_key   ON endpoints (api_key);
CREATE INDEX IF NOT EXISTS idx_endpoints_last_seen ON endpoints (last_seen DESC);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS endpoint_id UUID REFERENCES endpoints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_endpoint_id ON alerts (endpoint_id);
