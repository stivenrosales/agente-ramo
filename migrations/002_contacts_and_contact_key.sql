-- 002_contacts_and_contact_key.sql
-- Memoria de largo plazo: identificadores estables + tabla de contactos.

-- 1. Agregar contact_key a messages (identificador estable por canal)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact_key TEXT;

-- 2. Backfill: mensajes existentes usan subscriber_id con prefijo mc:
UPDATE messages SET contact_key = 'mc:' || subscriber_id WHERE contact_key IS NULL;

-- 3. Hacer NOT NULL después del backfill
ALTER TABLE messages ALTER COLUMN contact_key SET NOT NULL;

-- 4. Índice para queries por contact_key (reemplaza al de subscriber_id)
CREATE INDEX IF NOT EXISTS idx_messages_contact_key_created
  ON messages (contact_key, created_at DESC);

-- 5. Tabla de contactos — memoria de largo plazo
CREATE TABLE IF NOT EXISTS contacts (
  id              BIGSERIAL PRIMARY KEY,
  contact_key     TEXT NOT NULL UNIQUE,
  name            TEXT,
  phone           TEXT,
  email           TEXT,
  ig_username     TEXT,
  preferred_sucursal TEXT,
  investment_plan TEXT,
  motivation      TEXT,
  requirement     TEXT,
  notes           TEXT,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
