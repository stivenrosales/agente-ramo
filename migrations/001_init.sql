-- 001_init.sql — Schema inicial para agente-ramo (Ramo LATAM · SAP Business One).
-- Ejecutar UNA vez al crear la DB.

CREATE TABLE IF NOT EXISTS messages (
  id            BIGSERIAL PRIMARY KEY,
  subscriber_id TEXT        NOT NULL,
  contact_key   TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content       TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_contact_created
  ON messages (contact_key, created_at DESC);

CREATE TABLE IF NOT EXISTS contacts (
  contact_key  TEXT PRIMARY KEY,
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  ruc          TEXT,
  empresa      TEXT,
  cargo        TEXT,
  necesidad    TEXT,
  modalidad    TEXT,
  notes        TEXT,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bookings (si bien Outlook es fuente de verdad, guardamos una copia local para auditoría).
CREATE TABLE IF NOT EXISTS bookings (
  id            BIGSERIAL PRIMARY KEY,
  contact_key   TEXT        NOT NULL REFERENCES contacts(contact_key),
  event_id      TEXT,
  simulated     BOOLEAN     NOT NULL DEFAULT FALSE,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  duration_min  INT         NOT NULL DEFAULT 30,
  modalidad     TEXT        NOT NULL,
  email_cliente TEXT,
  topic         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_contact
  ON bookings (contact_key, scheduled_at DESC);
