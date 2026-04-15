-- 001_init_messages.sql
-- Esquema inicial para el agente de Fitness Space.
-- Ejecutar UNA VEZ al crear la DB en EasyPanel.

CREATE TABLE IF NOT EXISTS messages (
  id           BIGSERIAL PRIMARY KEY,
  subscriber_id TEXT        NOT NULL,
  role         TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice compuesto para la query más común: historial por subscriber ordenado por fecha
CREATE INDEX IF NOT EXISTS idx_messages_subscriber_created
  ON messages (subscriber_id, created_at DESC);
