ALTER TABLE clients ADD COLUMN IF NOT EXISTS intake_token text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS intake_token_expires_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS intake_completed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_intake_token ON clients(intake_token) WHERE intake_token IS NOT NULL;
