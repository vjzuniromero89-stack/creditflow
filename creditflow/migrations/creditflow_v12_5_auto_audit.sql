-- CreditFlow v12.5 — Auto Audit Engine
ALTER TABLE dispute_assessments
  ADD COLUMN IF NOT EXISTS auto_assessed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_ready BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS assessment_source TEXT,
  ADD COLUMN IF NOT EXISTS auto_findings_json TEXT,
  ADD COLUMN IF NOT EXISTS auto_assessed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dispute_assessments_auto_ready
  ON dispute_assessments(client_id, auto_ready);
