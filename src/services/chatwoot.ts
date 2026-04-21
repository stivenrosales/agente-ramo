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

  async sendMessageWithImage(
    conversationId: number | string,
    content: string,
    imageUrl: string,
  ): Promise<string> {
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        console.error(
          `[chatwoot] fallo descarga de imagen ${imageUrl}: ${imgRes.status}`,
        );
        return sendSingle(conversationId, content);
      }

      const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
      const extFromHeader = contentType.split("/")[1]?.split(";")[0] ?? "jpg";
      const urlName = new URL(imageUrl).pathname.split("/").pop() ?? `img.${extFromHeader}`;
      const filename = urlName.includes(".") ? urlName : `${urlName}.${extFromHeader}`;

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const blob = new Blob([buffer], { type: contentType });

      const form = new FormData();
      form.append("content", content);
      form.append("message_type", "outgoing");
      form.append("private", "false");
      form.append("attachments[]", blob, filename);

      const res = await fetch(conversationUrl(conversationId), {
        method: "POST",
        headers: { api_access_token: config.chatwootApiToken },
        body: form,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error("Chatwoot send-with-image failed:", res.status, text);
      }
      return text;
    } catch (err) {
      console.error("[chatwoot] sendMessageWithImage error:", err);
      return sendSingle(conversationId, content);
    }
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
