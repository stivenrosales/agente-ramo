interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function base64url(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64urlEncode(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64url");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function getAccessToken(
  credentials: ServiceAccountCredentials,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/calendar.events",
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );

  const unsignedToken = `${header}.${claim}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsignedToken),
  );

  const jwt = `${unsignedToken}.${base64urlEncode(signature)}`;

  const res = await fetch(credentials.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function createCalendarEvent(
  credentials: ServiceAccountCredentials,
  calendarId: string,
  params: {
    summary: string;
    description: string;
    start: string;
    end: string;
  },
): Promise<{ success: boolean; error?: string; eventId?: string }> {
  try {
    const token = await getAccessToken(credentials);

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: params.summary,
          description: params.description,
          start: { dateTime: params.start, timeZone: "America/Mexico_City" },
          end: { dateTime: params.end, timeZone: "America/Mexico_City" },
        }),
      },
    );

    const body = await res.text();
    console.log("Google Calendar response:", res.status, body);

    if (!res.ok) {
      return { success: false, error: `Calendar API error: ${res.status}` };
    }

    const event = JSON.parse(body) as { id: string };
    return { success: true, eventId: event.id };
  } catch (err) {
    console.error("Calendar error:", err);
    return { success: false, error: String(err) };
  }
}
