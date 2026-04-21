# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

TypeScript (ESM, `NodeNext`) · Node 20+ · Hono (HTTP) · postgres.js · Vercel AI SDK + `@ai-sdk/openai` apuntando a OpenRouter · Zod (env). No hay test runner configurado.

## Comandos

```bash
npm install
npm run migrate      # aplica migrations/*.sql en orden (usa DATABASE_URL; default SSL=require)
npm run dev          # tsx watch src/index.ts → http://localhost:3000
npm run typecheck    # tsc --noEmit (única forma de validar correctitud)
npm run build        # emite a dist/
npm start            # node dist/index.js
```

No existe `lint` ni suite de tests. `npm run typecheck` es el gate. `scripts/test-agendar.ts` es un script manual ad-hoc, no automatizado.

## Arquitectura

Webhook de Chatwoot → agente LLM con tools → respuesta vía API de Chatwoot. Persistencia en Postgres. Outlook en modo stub hasta que las 4 `MS_*` estén seteadas.

```
POST /webhook → handlers/webhook.ts
  1. Valida HMAC (WEBHOOK_SECRET) + filtros inbox/sender
  2. Deriva contact_key estable: wa:+51… | ig:handle | em:correo | cw:<id>
  3. upsert contacto + append mensaje
  4. carga historial → services/agent.ts
  5. POST respuesta a Chatwoot
```

### Piezas clave

- **`src/profiles/`** — sistema de perfiles intercambiables. `active.ts` exporta `ACTIVE_PROFILE` (`"ramo"` | `"demo"`); es el ÚNICO switch entre agentes. Cada perfil implementa `AgentProfile` (`llmModel`, `buildSystemPrompt(ctx)`, opcional `createTools(ctx)`, opcional `hideContactName`). Sin `createTools` → conversación pura (`maxSteps: 1`).
- **`src/services/agent.ts`** — `generateText` de Vercel AI SDK contra OpenRouter. Detecta `[convenio]` en mensajes del usuario y lo pasa como `hasConvenio` al prompt. Inyecta ficha del contacto al final del system prompt (salvo `hideContactName`).
- **`src/services/tools.ts`** — tools del perfil Ramo: `guardar_lead`, `sugerir_horarios`, `confirmar_reserva`. Los horarios respetan `config.ramo.businessHours`, `lunchBlock`, `businessDaysIso`, zona `America/Lima`.
- **`src/services/outlook-calendar.ts`** — Graph API real si `config.microsoft.enabled` (las 4 `MS_*` llenas), stub en caso contrario. `bookings.simulated` registra el modo.
- **`src/services/system-prompt.ts`** — prompt del perfil Ramo (~5k tokens). El prompt del perfil demo vive en `src/profiles/demo.ts`.
- **`src/services/database.ts`** — tablas `messages`, `contacts`, `bookings`, `conversation_state`. `contact_key` es la PK lógica; sobrevive a cambios de `subscriber_id` de Chatwoot.
- **`src/services/followup-scheduler.ts`** — scheduler que arranca en `index.ts` (`startFollowupScheduler()`).
- **`src/config.ts`** — Zod env parsing + derivaciones (`businessHours`, `lunchBlock`, `microsoft.enabled`). Falla el boot si falta algo requerido.

### Convenciones no obvias

- **ESM estricto**: los imports internos llevan `.js` (`./config.js`) aunque el fuente sea `.ts` — requerido por `moduleResolution: NodeNext`.
- **Cambiar de agente**: editar `src/profiles/active.ts` y redeploy. No hay variable de entorno para eso.
- **Gatillo de descuento (`demo`)**: la lógica de descuento SOLO entra al prompt si el regex `/^\s*\[convenio\]/i` matchea algún mensaje del usuario. Mencionar "Pacífico" no es suficiente — ver commits recientes `3a82637`, `9019d60`.
- **Fechas al usuario**: siempre formato humano en español, zona Lima (GMT-5) fija.
- **HMAC**: si `WEBHOOK_SECRET` está vacío, NO se valida firma (útil en dev). En prod, setearlo = obligatorio.
- **Migrations**: numeradas `NNN_nombre.sql`, se aplican alfabéticamente con `sql.unsafe(content)`. No hay tracking de migraciones aplicadas — son idempotentes (`CREATE TABLE IF NOT EXISTS`).
- **`docs/architecture.md`** está desactualizado (describe un bot de Fitness Space anterior). El README.md es la fuente de verdad para la arquitectura.
