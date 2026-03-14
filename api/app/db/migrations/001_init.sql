CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS detection_rules (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    severity      TEXT        NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    mitre_tactic  TEXT        NOT NULL DEFAULT '',
    sigma_yaml    TEXT        NOT NULL,
    enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_enabled  ON detection_rules (enabled);
CREATE INDEX IF NOT EXISTS idx_rules_severity ON detection_rules (severity);

CREATE TABLE IF NOT EXISTS alerts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id         UUID        NOT NULL REFERENCES detection_rules(id) ON DELETE CASCADE,
    event_id        TEXT        NOT NULL,
    severity        TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','suppressed')),
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    note            TEXT,
    event_snapshot  JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alerts_status     ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_rule_id    ON alerts (rule_id);
CREATE INDEX IF NOT EXISTS idx_alerts_matched_at ON alerts (matched_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rules_updated_at ON detection_rules;
CREATE TRIGGER rules_updated_at
    BEFORE UPDATE ON detection_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
