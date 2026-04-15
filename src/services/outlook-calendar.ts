import { config } from "../config.js";

/**
 * outlook-calendar.ts
 *
 * Servicio de calendario Outlook (Microsoft Graph).
 *
 * ESTADO: stub. Cuando las 4 variables MS_* están vacías o faltantes,
 * `createEvent` NO llama a Microsoft — registra en log y retorna una
 * confirmación simulada. Apenas se configuren las credenciales (MS_TENANT_ID,
 * MS_CLIENT_ID, MS_CLIENT_SECRET, MS_CALENDAR_MAILBOX), el flujo real se
 * activa automáticamente sin tocar el resto del código.
 */

export interface CreateEventInput {
  subject: string;
  body: string;
  startIso: string; // ISO 8601 con offset (ej. 2026-04-16T15:00:00-05:00)
  endIso: string;
  attendeeEmail: string;
  attendeeName?: string | null;
  modalidad: "virtual" | "oficina_ramo" | "oficina_cliente";
  location?: string | null;
}

export interface CreateEventResult {
  success: boolean;
  simulated: boolean;
  eventId: string | null;
  joinUrl: string | null;
  error?: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Real-mode helpers (no se ejecutan hasta que MS_* esté seteado)           */
/* ────────────────────────────────────────────────────────────────────────── */

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const { tenantId, clientId, clientSecret } = config.microsoft;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function createGraphEvent(
  input: CreateEventInput,
): Promise<CreateEventResult> {
  const token = await getGraphToken();
  const mailbox = config.microsoft.mailbox;

  const isVirtual = input.modalidad === "virtual";

  const payload: Record<string, unknown> = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.body },
    start: { dateTime: input.startIso, timeZone: config.ramo.timezone },
    end: { dateTime: input.endIso, timeZone: config.ramo.timezone },
    attendees: [
      {
        emailAddress: {
          address: input.attendeeEmail,
          name: input.attendeeName ?? undefined,
        },
        type: "required",
      },
    ],
    isOnlineMeeting: isVirtual,
    onlineMeetingProvider: isVirtual ? "teamsForBusiness" : undefined,
    location: input.location ? { displayName: input.location } : undefined,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: `outlook.timezone="${config.ramo.timezone}"`,
      },
      body: JSON.stringify(payload),
    },
  );

  const text = await res.text();
  if (!res.ok) {
    return {
      success: false,
      simulated: false,
      eventId: null,
      joinUrl: null,
      error: `Graph ${res.status}: ${text}`,
    };
  }

  const data = JSON.parse(text) as {
    id: string;
    onlineMeeting?: { joinUrl?: string };
  };
  return {
    success: true,
    simulated: false,
    eventId: data.id,
    joinUrl: data.onlineMeeting?.joinUrl ?? null,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Public API                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export const outlookCalendar = {
  isLive(): boolean {
    return config.microsoft.enabled;
  },

  async createEvent(input: CreateEventInput): Promise<CreateEventResult> {
    if (!config.microsoft.enabled) {
      const simulatedId = `stub-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      console.log(
        "[outlook:stub] Simulando evento →",
        JSON.stringify({ ...input, simulatedId }),
      );
      return {
        success: true,
        simulated: true,
        eventId: simulatedId,
        joinUrl: null,
      };
    }

    try {
      return await createGraphEvent(input);
    } catch (err) {
      console.error("[outlook] createEvent failed:", err);
      return {
        success: false,
        simulated: false,
        eventId: null,
        joinUrl: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
