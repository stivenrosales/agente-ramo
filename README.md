# 🤖 agente-chatwoot

Agente conversacional con IA conectado a **Chatwoot** como canal de mensajería.
Fork de `agente-fitnessspace` con la capa de ManyChat reemplazada por Chatwoot.

## Stack
- Node 20 + TypeScript + Hono
- OpenRouter (LLM) + Vercel AI SDK
- Postgres (memoria larga + historial)
- Google Calendar (agenda)
- Chatwoot (canal: Instagram, Facebook, WhatsApp, API, Web, etc.)

## Endpoint
```
POST /webhook           ← configura esta URL en Chatwoot
POST /webhook/chatwoot  ← alias
GET  /                  ← healthcheck
```

## Setup local
```bash
cp env.example .env     # rellena las variables
npm install
npm run migrate         # crea tablas en Postgres
npm run dev
```

## Chatwoot — configuración del webhook

1. **Chatwoot → Settings → Integrations → Webhooks → Add new webhook**
2. URL: `https://TU-DOMINIO/webhook`
3. Marcar evento: **Message Created** (`message_created`).
4. (Opcional pero recomendado) agregar header `X-Webhook-Secret: <WEBHOOK_SECRET>` si tu Chatwoot lo soporta en custom headers, o validar en proxy.

El handler:
- Solo procesa `event=message_created` + `message_type=incoming` + `private=false`.
- Si `CHATWOOT_INBOX_IDS` está seteado, filtra por inbox.
- Si `CHATWOOT_ALLOWED_SENDER_IDS` está seteado, filtra por contacto (útil para testing).
- Responde vía `POST /api/v1/accounts/{account_id}/conversations/{id}/messages` usando `CHATWOOT_API_TOKEN`.

## Variables de entorno
Ver [`env.example`](./env.example). Las críticas:

| Variable | Descripción |
|---|---|
| `CHATWOOT_BASE_URL` | `https://app.chatwoot.com` o tu self-hosted |
| `CHATWOOT_ACCOUNT_ID` | ID numérico de tu cuenta Chatwoot |
| `CHATWOOT_API_TOKEN` | User Access Token o Agent Bot token |
| `CHATWOOT_INBOX_IDS` | (opcional) inboxes permitidos, CSV |
| `DATABASE_URL` | Postgres con SSL |
| `OPENROUTER_API_KEY` | Key de OpenRouter |
| `GOOGLE_SERVICE_ACCOUNT_B64` | Service account JSON en base64 |
| `WEBHOOK_SECRET` | Header compartido para validar webhooks |

## Deploy (EasyPanel desde GitHub)
1. En EasyPanel → crear app → source: este repo de GitHub.
2. Build: Dockerfile (incluido). Puerto: `3000`.
3. Setear todas las variables de entorno del bloque anterior.
4. Ejecutar `npm run migrate` una sola vez (como comando manual o one-off) contra la DB.
5. Apuntar un dominio con HTTPS a la app y configurar ese dominio como webhook en Chatwoot.
