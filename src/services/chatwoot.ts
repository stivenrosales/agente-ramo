import { config } from "../config.js";

const DELAY_BETWEEN_MESSAGES_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const headers = {
  api_access_token: config.chatwootApiToken,
  "Content-Type": "application/json",
};

function base(): string {
  return `${config.chatwootBaseUrl}/api/v1/accounts/${config.chatwootAccountId}`;
}

function conversationUrl(conversationId: number | string): string {
  return `${base()}/conversations/${conversationId}`;
}

async function postSafe(url: string, body: unknown): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) console.warn(`Chatwoot ${url} ${res.status}: ${text.slice(0, 160)}`);
    return text;
  } catch (err) {
    console.warn(`Chatwoot ${url} error:`, err);
    return "";
  }
}

async function toggleTyping(
  conversationId: number | string,
  on: boolean,
): Promise<void> {
  await postSafe(`${conversationUrl(conversationId)}/toggle_typing_status`, {
    typing_status: on ? "on" : "off",
  });
}

async function sendSingle(
  conversationId: number | string,
  content: string,
): Promise<string> {
  return postSafe(`${conversationUrl(conversationId)}/messages`, {
    content,
    message_type: "outgoing",
    private: false,
  });
}

export const chatwoot = {
  async markRead(conversationId: number | string): Promise<void> {
    // Marca todos los mensajes del cliente como leídos (doble check azul).
    await postSafe(
      `${conversationUrl(conversationId)}/update_last_seen`,
      {},
    );
  },

  async startTyping(conversationId: number | string): Promise<void> {
    await toggleTyping(conversationId, true);
  },

  async stopTyping(conversationId: number | string): Promise<void> {
    await toggleTyping(conversationId, false);
  },

  async sendMessages(
    conversationId: number | string,
    text: string,
  ): Promise<string> {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    let lastResult = "";
    try {
      for (let i = 0; i < paragraphs.length; i++) {
        await toggleTyping(conversationId, true);
        // Simula pausa de "escribiendo" proporcional al tamaño del mensaje.
        const typingMs = Math.min(
          2500,
          400 + paragraphs[i].length * 18,
        );
        await sleep(typingMs);
        await toggleTyping(conversationId, false);
        lastResult = await sendSingle(conversationId, paragraphs[i]);
        if (i < paragraphs.length - 1) await sleep(DELAY_BETWEEN_MESSAGES_MS);
      }
    } finally {
      // Seguridad: nunca dejar el indicador colgado.
      await toggleTyping(conversationId, false).catch(() => {});
    }

    return lastResult;
  },
};
