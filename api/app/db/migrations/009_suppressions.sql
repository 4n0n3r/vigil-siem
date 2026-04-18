-- Migration 009: global suppressions / allowlist
--
-- A suppression matches an event field against a value and, when matched,
-- prevents alert creation entirely. This is a platform-level allowlist that
-- applies across all rules (scope='global') or can be scoped to a single rule.
--
-- Examples:
--   field_path=event_data.ServiceName  value=Sysmon64        → blocks all alerts
--                                                               about Sysmon installs
--   field_path=event_data.ProcessName  value=MsMpEng.exe     → blocks Defender FPs
--   scope=rule:<uuid>                                         → rule-scoped suppression

CREATE TABLE IF NOT EXISTS suppressions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    field_path   TEXT        NOT NULL,        -- dot-notation: event_data.ServiceName
    field_value  TEXT        NOT NULL,
    match_type   TEXT        NOT NULL DEFAULT 'exact'
                             CHECK (match_type IN ('exact', 'contains', 'regex')),
    scope        TEXT        NOT NULL DEFAULT 'global',  -- 'global' | 'rule:<uuid>'
    enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    hit_count    INTEGER     NOT NULL DEFAULT 0,
    last_hit_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppressions_enabled ON suppressions (enabled);
CREATE INDEX IF NOT EXISTS idx_suppressions_scope   ON suppressions (scope);
