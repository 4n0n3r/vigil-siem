-- Track IP address changes per endpoint over time.
CREATE TABLE IF NOT EXISTS endpoint_ip_history (
    id          BIGSERIAL PRIMARY KEY,
    endpoint_id UUID        NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
    ip_address  TEXT        NOT NULL,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_history_endpoint_id ON endpoint_ip_history(endpoint_id);
