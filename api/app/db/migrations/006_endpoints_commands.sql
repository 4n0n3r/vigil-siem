-- Migration 006: IP address on endpoints + remote command queue
-- Item 2: add ip_address to endpoints
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';

-- Item 4: endpoint command queue (heartbeat piggyback)
CREATE TABLE IF NOT EXISTS endpoint_commands (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id  UUID        NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
    command      TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_endpoint_commands_pending
    ON endpoint_commands (endpoint_id, status)
    WHERE status = 'pending';
