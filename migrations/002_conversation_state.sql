-- Estado por conversación para el scheduler de follow-up automático.
-- Estados posibles: 'open' | 'booked' | 'escalated' | 'rejected' | 'done'.
--
-- Transiciones:
--   - Mensaje entrante        -> state='open', last_msg_at=NOW(), followup_sent=false
--   - confirmar_reserva OK    -> state='booked'
--   - solicitar_asesor_humano -> state='escalated'
--   - mini-IA decide no enviar -> state='rejected' o 'done'
--   - follow-up enviado        -> followup_sent=true (state sigue 'open')

CREATE TABLE IF NOT EXISTS conversation_state (
  contact_key       TEXT PRIMARY KEY REFERENCES contacts(contact_key) ON DELETE CASCADE,
  conversation_id   BIGINT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'open',
  last_msg_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  followup_sent     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_followup
  ON conversation_state(state, followup_sent, last_msg_at);
