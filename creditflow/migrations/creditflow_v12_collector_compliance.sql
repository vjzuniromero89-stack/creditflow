-- CreditFlow v12 — Collector Compliance Registry
CREATE TABLE IF NOT EXISTS collector_compliance_checks (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL,
  credit_item_id BIGINT,
  collector_name TEXT NOT NULL,
  legal_name TEXT,
  jurisdiction TEXT NOT NULL DEFAULT 'MD',
  regulator TEXT,
  nmls_id TEXT,
  license_number TEXT,
  license_status TEXT NOT NULL DEFAULT 'pending_review',
  license_required_status TEXT NOT NULL DEFAULT 'review_required',
  source_url TEXT,
  source_title TEXT,
  source_checked_at TIMESTAMPTZ,
  effective_date DATE,
  expiration_date DATE,
  reviewer_notes TEXT,
  human_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_collector_checks_client ON collector_compliance_checks(client_id);
CREATE INDEX IF NOT EXISTS idx_collector_checks_item ON collector_compliance_checks(credit_item_id);
CREATE INDEX IF NOT EXISTS idx_collector_checks_name ON collector_compliance_checks(lower(collector_name));
