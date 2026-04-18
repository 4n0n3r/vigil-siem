-- migration 007: SIEM connector registry
-- Stores connection configs for external SIEM connectors (Wazuh, Elastic, etc.)
-- NOTE: config JSONB stores credentials in cleartext for now.
--       Encrypt with AES-256-GCM (VIGIL_CONNECTOR_KEY) before production OSS launch.

CREATE TABLE IF NOT EXISTS siem_connectors (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    siem_type    TEXT        NOT NULL,  -- 'wazuh', 'elastic', 'splunk', 'sentinel'
    config       JSONB       NOT NULL,  -- connection params + credentials
    enabled      BOOL        NOT NULL DEFAULT true,
    last_polled  TIMESTAMPTZ,
    last_error   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_siem_connectors_name ON siem_connectors (name);
