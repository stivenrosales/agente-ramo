import { config } from "../config.js";

const DELAY_BETWEEN_MESSAGES_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const headers = {
  api_access_token: config.chatwootApiToken,
  "Content-Type": "application/json",
};

function conversationUrl(conversationId: number | string): string {
  return `${config.chatwootBaseUrl}/api/v1/accounts/${config.chatwootAccountId}/conversations/${conversationId}/messages`;
}

async function sendSingle(
  conversationId: number | string,
  content: string,
): Promise<string> {
  const res = await fetch(conversationUrl(conversationId), {
    method: "POST",
    headers,
    body: JSON.stringify({
      content,
      message_type: "outgoing",
      private: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("Chatwoot send failed:", res.status, text);
  }
  return text;
}

export const chatwoot = {
  async sendMessages(
    conversationId: number | string,
    text: string,
  ): Promise<string> {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    let lastResult = "";
    for (let i = 0; i < paragraphs.length; i++) {
      if (i > 0) await sleep(DELAY_BETWEEN_MESSAGES_MS);
      lastResult = await sendSingle(conversationId, paragraphs[i]);
    }
    return lastResult;
  },

  async sendPrivateNote(
    conversationId: number | string,
    content: string,
  ): Promise<string> {
    const res = await fetch(conversationUrl(conversationId), {
      method: "POST",
      headers,
      body: JSON.stringify({
        content,
        message_type: "outgoing",
        private: true,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("Chatwoot private note failed:", res.status, text);
    }
    return text;
  },
};
