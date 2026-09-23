-- CreditFlow v13 — Aggressive Compliance Engine
CREATE TABLE IF NOT EXISTS aggressive_compliance_runs (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  findings_count INTEGER NOT NULL DEFAULT 0,
  actionable_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ace_runs_client
  ON aggressive_compliance_runs(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS aggressive_compliance_findings (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES aggressive_compliance_runs(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL,
  credit_item_id BIGINT,
  creditor_name TEXT,
  account_number TEXT,
  bureau TEXT,
  category TEXT,
  finding_code TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'review',
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  legal_basis TEXT,
  recommended_action TEXT,
  evidence_needed TEXT,
  confidence INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'new',
  adopted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ace_findings_client
  ON aggressive_compliance_findings(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ace_findings_run
  ON aggressive_compliance_findings(run_id);
