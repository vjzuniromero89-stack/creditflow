-- CreditFlow v13.1 — Automated Investigation
ALTER TABLE aggressive_compliance_findings
  ADD COLUMN IF NOT EXISTS investigation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS investigation_result TEXT,
  ADD COLUMN IF NOT EXISTS actionability TEXT NOT NULL DEFAULT 'review',
  ADD COLUMN IF NOT EXISTS investigation_json TEXT,
  ADD COLUMN IF NOT EXISTS investigated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ace_findings_actionability
  ON aggressive_compliance_findings(client_id, actionability);
