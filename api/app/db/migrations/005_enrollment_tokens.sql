-- Migration 005: enrollment tokens
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash  TEXT        NOT NULL UNIQUE,
    label       TEXT        NOT NULL DEFAULT '',
    single_use  BOOL        NOT NULL DEFAULT TRUE,
    used        BOOL        NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_hash ON enrollment_tokens (token_hash);
