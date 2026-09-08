-- CreditFlow — esquema D1
--
-- Reconstruido a partir de las columnas y tablas realmente usadas por src/index.js (el backend
-- original recuperado), NO inventado. Los tokens de sesión (usuarios internos y portal de
-- clientes) son autocontenidos (HMAC firmado con SESSION_SECRET) — por eso no existen tablas
-- "sessions" ni "portal_sessions": no hace falta guardar sesiones en la base de datos.

PRAGMA foreign_keys = ON;

-- Usuarios internos (agentes/administradores) que usan el panel.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'agente' CHECK (role IN ('admin', 'agente')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Clientes de reparación de crédito, incluyendo sus credenciales de acceso al portal
-- (portal_username/portal_password_hash/portal_password_salt) — nunca se exponen en JSON
-- (ver sanitizeClient en src/index.js).
CREATE TABLE IF NOT EXISTS clients (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name             TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  zip                   TEXT,
  id_last4              TEXT,
  date_of_birth         TEXT,
  -- SSN completo, cifrado con AES-GCM (ver PII_ENCRYPTION_KEY / encryptSsn en src/index.js) —
  -- nunca se guarda en texto plano ni se manda por JSON normal; solo /clients/:id/ssn/reveal lo
  -- descifra, y cada uso queda registrado en activity_log.
  ssn_full_enc           TEXT,
  status                TEXT NOT NULL DEFAULT 'activo',
  notes                 TEXT,
  portal_username       TEXT UNIQUE,
  portal_password_hash  TEXT,
  portal_password_salt  TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Plantillas de cartas de disputa (nombre real de tabla: letter_templates, no "templates").
CREATE TABLE IF NOT EXISTS letter_templates (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL DEFAULT 'General',
  recipient_hint          TEXT,
  subject                 TEXT,
  body                    TEXT NOT NULL,
  is_active               INTEGER NOT NULL DEFAULT 1,
  include_id_copy         INTEGER NOT NULL DEFAULT 0,
  include_address_proof   INTEGER NOT NULL DEFAULT 0,
  include_ssn_copy        INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ítems negativos del reporte de crédito. Cada buró que reporta un ítem es una fila
-- independiente (ver bureauCountForItem / creditItemsSplitMultiBureau en src/index.js) —
-- cada una se puede disputar, marcar eliminada y cobrar por separado.
CREATE TABLE IF NOT EXISTS credit_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category        TEXT NOT NULL DEFAULT 'otro',
  creditor_name   TEXT NOT NULL,
  creditor_address TEXT,
  account_number  TEXT,
  status_raw      TEXT,
  balance         TEXT,
  past_due        TEXT,
  date_reported   TEXT,
  date_opened     TEXT,
  bureaus         TEXT,
  notes           TEXT,
  source_report   TEXT,
  removed_status  TEXT NOT NULL DEFAULT 'activo' CHECK (removed_status IN ('activo', 'eliminado')),
  billing_status  TEXT NOT NULL DEFAULT 'pendiente' CHECK (billing_status IN ('pendiente', 'pagado')),
  is_disputed     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cartas de disputa generadas para un cliente (opcionalmente ligadas a una plantilla y/o a un
-- ítem de crédito específico).
CREATE TABLE IF NOT EXISTS letters (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id               INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id             INTEGER REFERENCES letter_templates(id) ON DELETE SET NULL,
  credit_item_id          INTEGER REFERENCES credit_items(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL,
  recipient_name          TEXT,
  recipient_address       TEXT,
  round_number            INTEGER NOT NULL DEFAULT 1,
  body                    TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'borrador'
                          CHECK (status IN ('borrador', 'lista', 'enviada', 'en_transito', 'entregada', 'devuelta', 'respondida', 'completada')),
  include_id_copy         INTEGER NOT NULL DEFAULT 0,
  include_address_proof   INTEGER NOT NULL DEFAULT 0,
  include_ssn_copy        INTEGER NOT NULL DEFAULT 0,
  notes                   TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Envíos certificados (USPS) de cada carta, con su rastreo.
CREATE TABLE IF NOT EXISTS mailings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  letter_id             INTEGER NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
  tracking_number       TEXT NOT NULL,
  carrier               TEXT NOT NULL DEFAULT 'USPS Certified Mail',
  cost                  TEXT,
  mailed_at             TEXT NOT NULL DEFAULT (datetime('now')),
  last_status           TEXT,
  last_status_detail    TEXT,
  last_checked_at       TEXT,
  raw_tracking_json     TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de direcciones del cliente (se llena solo al importar un reporte de crédito, o a
-- mano) — permite ver cuándo una dirección vieja "desapareció" del reporte tras disputarla.
CREATE TABLE IF NOT EXISTS client_addresses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  address_line    TEXT NOT NULL,
  normalized_key  TEXT,
  bureaus         TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',
  status          TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'disputada', 'eliminada')),
  first_reported  TEXT,
  last_reported   TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documentos de identidad/domicilio del cliente (imagen guardada como base64 — ver DOC_MAX_SIZE
-- en src/index.js). Un solo documento activo por doc_type y cliente (se reemplaza al resubir).
CREATE TABLE IF NOT EXISTS client_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('id', 'proof_address', 'ssn')),
  file_name   TEXT,
  mime_type   TEXT NOT NULL,
  file_data   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, doc_type)
);

-- Historial manual de scores de crédito por buró.
CREATE TABLE IF NOT EXISTS credit_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bureau       TEXT NOT NULL,
  score        INTEGER NOT NULL,
  recorded_on  TEXT NOT NULL,
  source       TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tarifas por categoría de ítem negativo (una sola fila, id=1) — usada para calcular ganancias.
CREATE TABLE IF NOT EXISTS pricing_settings (
  id                  INTEGER PRIMARY KEY,
  fee_coleccion       REAL NOT NULL DEFAULT 80,
  fee_charge_off      REAL NOT NULL DEFAULT 70,
  fee_pago_tardio     REAL NOT NULL DEFAULT 40,
  fee_liquidada       REAL NOT NULL DEFAULT 50,
  fee_repossesion     REAL NOT NULL DEFAULT 120,
  fee_foreclosure     REAL NOT NULL DEFAULT 150,
  fee_bancarrota      REAL NOT NULL DEFAULT 100,
  fee_inquiry         REAL NOT NULL DEFAULT 20,
  fee_otro            REAL NOT NULL DEFAULT 30,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tarifas personalizadas POR CLIENTE (opcional) — permite cobrarle a un cliente distinto que la
-- tarifa general de pricing_settings, categoría por categoría. Todas las columnas son NULL por
-- defecto: NULL significa "usa la tarifa general de Configuración para esta categoría"; un valor
-- no-NULL significa "para este cliente, esta categoría se cobra a este monto en vez del general".
-- Se edita directamente donde dice "Tarifa" en la ficha de cada cliente (panel de Ganancia).
CREATE TABLE IF NOT EXISTS client_pricing (
  client_id           INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  fee_coleccion       REAL,
  fee_charge_off      REAL,
  fee_pago_tardio     REAL,
  fee_liquidada       REAL,
  fee_repossesion     REAL,
  fee_foreclosure     REAL,
  fee_bancarrota      REAL,
  fee_inquiry         REAL,
  fee_otro            REAL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bitácora de actividad genérica (polimórfica): entity_type + entity_id identifican a qué
-- registro pertenece cada evento (cliente, carta, plantilla, ajustes, etc.).
CREATE TABLE IF NOT EXISTS activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER NOT NULL,
  action       TEXT NOT NULL,
  detail       TEXT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Congelamiento (security freeze) de identidad en las agencias secundarias de verificación —
-- una fila por cliente/agencia. Se dispara desde la sección "Freeze" en la ficha del cliente.
CREATE TABLE IF NOT EXISTS client_freezes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id          INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  agency             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'no_iniciado'
                     CHECK (status IN ('no_iniciado', 'solicitado', 'congelado', 'requiere_llamada', 'no_disponible')),
  requested_at       TEXT,
  confirmed_at       TEXT,
  confirmation_code  TEXT,
  notes              TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, agency)
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_client_freezes_client ON client_freezes(client_id);
CREATE INDEX IF NOT EXISTS idx_credit_items_client ON credit_items(client_id);
CREATE INDEX IF NOT EXISTS idx_credit_items_category ON credit_items(category);
CREATE INDEX IF NOT EXISTS idx_letters_client ON letters(client_id);
CREATE INDEX IF NOT EXISTS idx_letters_status ON letters(status);
CREATE INDEX IF NOT EXISTS idx_mailings_letter ON mailings(letter_id);
CREATE INDEX IF NOT EXISTS idx_client_addresses_client ON client_addresses(client_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON client_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_credit_scores_client ON credit_scores(client_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
