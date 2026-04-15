import { createHmac, timingSafeEqual } from "node:crypto";
import { agent } from "../services/agent.js";
import { database } from "../services/database.js";
import { chatwoot } from "../services/chatwoot.js";
import { multimodal } from "../services/multimodal.js";
import { config } from "../config.js";
import type {
  ChatwootChannel,
  ChatwootSender,
  ChatwootWebhookPayload,
} from "../types.js";

/**
 * Verifica la firma HMAC-SHA256 que manda Chatwoot en el header
 * `X-Chatwoot-Signature` (hex del digest del body crudo, clave = WEBHOOK_SECRET).
 * Permite también los headers legacy `x-webhook-secret` / `x-chatwoot-secret`
 * (comparación plana) por si otro cliente los usa.
 */
function verifySignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const signature =
    headers.get("x-chatwoot-signature") ??
    headers.get("x-hub-signature-256") ??
    "";

  if (signature) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = signature.replace(/^sha256=/, "").trim();
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return false;
    }
  }

  // Fallback: plain shared secret en header custom (útil para tests/n8n/curl).
  const plain =
    headers.get("x-webhook-secret") ?? headers.get("x-chatwoot-secret");
  return plain === secret;
}

function mapChannel(channelType?: string): ChatwootChannel {
  if (!channelType) return "unknown";
  const c = channelType.toLowerCase();
  if (c.includes("instagram")) return "instagram";
  if (c.includes("facebook")) return "facebook";
  if (c.includes("whatsapp")) return "whatsapp";
  if (c.includes("telegram")) return "telegram";
  if (c.includes("email")) return "email";
  if (c.includes("sms")) return "sms";
  if (c.includes("api")) return "api";
  if (c.includes("web")) return "web";
  return "unknown";
}

/**
 * Derives a stable contact key. Priority:
 *  - channel-specific identifier (phone for WA, identifier/ig for IG, email, etc.)
 *  - falls back to Chatwoot contact id.
 */
function getContactKey(
  sender: ChatwootSender | undefined,
  channel: ChatwootChannel,
): string {
  const phone = sender?.phone_number?.trim();
  const email = sender?.email?.trim();
  const identifier = sender?.identifier?.trim();
  const id = sender?.id;

  if (channel === "whatsapp" && phone) return `wa:${phone}`;
  if (channel === "instagram" && identifier) return `ig:${identifier}`;
  if (channel === "facebook" && identifier) return `fb:${identifier}`;
  if (channel === "email" && email) return `em:${email}`;
  if (channel === "sms" && phone) return `sms:${phone}`;
  if (channel === "telegram" && identifier) return `tg:${identifier}`;
  if (phone) return `ph:${phone}`;
  if (email) return `em:${email}`;
  if (identifier) return `idf:${identifier}`;
  if (id != null) return `cw:${id}`;
  return `cw:unknown`;
}

export async function handleWebhook(request: Request): Promise<Response> {
  // Security: verify shared secret header if configured.
  // Configure the same value as "HMAC Token" / custom header in your Chatwoot webhook.
  // Leemos el body crudo primero (necesario para validar HMAC).
  const rawBody = await request.text();

  // Log de headers para debug (útil para entender qué firma envía Chatwoot).
  if (config.nodeEnv !== "production" || process.env.DEBUG_WEBHOOK === "1") {
    const headersObj: Record<string, string> = {};
    request.headers.forEach((v, k) => (headersObj[k] = v));
    console.log("WEBHOOK HEADERS:", JSON.stringify(headersObj));
  }

  if (config.webhookSecret) {
    if (!verifySignature(rawBody, request.headers, config.webhookSecret)) {
      console.log("REJECTED: invalid or missing webhook signature");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: ChatwootWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ChatwootWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = payload.event;
  console.log("PAYLOAD RECEIVED:", event, "| msg_type:", payload.message_type);

  // Only react to incoming user messages.
  if (event !== "message_created") {
    return Response.json({ status: "ignored", reason: "not message_created" });
  }
  if (payload.message_type !== "incoming") {
    return Response.json({ status: "ignored", reason: "not incoming" });
  }
  if (payload.private === true) {
    return Response.json({ status: "ignored", reason: "private note" });
  }

  const rawText = (payload.content ?? "").trim();
  const rawAttachments = (payload as { attachments?: unknown }).attachments;
  const attachments = Array.isArray(rawAttachments)
    ? (rawAttachments as Array<Record<string, unknown>>)
    : [];
  const conversation = payload.conversation;
  const conversationId = conversation?.id;
  const sender: ChatwootSender | undefined =
    payload.sender ?? conversation?.meta?.sender;
  const channel = mapChannel(payload.inbox?.channel_type);

  // Requiere al menos texto O attachments + conversación + sender.
  if ((!rawText && attachments.length === 0) || !conversationId || !sender) {
    console.log("REJECTED: missing content/conversation/sender");
    return Response.json(
      { error: "Missing content, conversation.id, or sender" },
      { status: 400 },
    );
  }

  // Optional inbox allowlist
  const inboxId = payload.inbox?.id ?? conversation?.inbox_id;
  if (
    config.allowedInboxIds.length > 0 &&
    inboxId != null &&
    !config.allowedInboxIds.includes(String(inboxId))
  ) {
    console.log("REJECTED: inbox not in allowlist", inboxId);
    return Response.json({ status: "ignored", reason: "inbox not allowed" });
  }

  // Optional sender allowlist (contact ids)
  if (
    config.allowedSenderIds.length > 0 &&
    sender.id != null &&
    !config.allowedSenderIds.includes(String(sender.id))
  ) {
    console.log("REJECTED: sender not in allowlist", sender.id);
    return Response.json({ status: "ignored", reason: "sender not allowed" });
  }

  const contactKey = getContactKey(sender, channel);
  console.log(
    "Channel:",
    channel,
    "| ConvId:",
    conversationId,
    "| ContactKey:",
    contactKey,
  );

  // Fire-and-forget
  processAndReply(
    conversationId,
    contactKey,
    rawText,
    attachments,
    channel,
    sender,
  ).catch((err) => {
    console.error("Unhandled error in background processing:", err);
  });

  return Response.json({ status: "processing" });
}

async function processAndReply(
  conversationId: number,
  contactKey: string,
  rawText: string,
  attachments: Array<Record<string, unknown>>,
  channel: ChatwootChannel,
  sender: ChatwootSender,
): Promise<void> {
  try {
    await database.upsertContact(contactKey, {
      name: sender.name ?? null,
      phone: sender.phone_number ?? null,
      email: sender.email ?? null,
    });

    // Marca conversación como activa — resetea timer de follow-up.
    await database
      .touchConversation(contactKey, conversationId)
      .catch((err) => console.warn("touchConversation failed:", err));

    // Enriquece el mensaje con transcripciones/descripciones de attachments.
    const enriched = await multimodal.enrichUserMessage(rawText, attachments);
    if (enriched.processed > 0 || enriched.skipped > 0) {
      console.log(
        `Multimodal: processed=${enriched.processed} skipped=${enriched.skipped}`,
      );
    }
    const userMessage = enriched.text;

    const contact = await database.getContact(contactKey);
    console.log("Contact:", contact?.name ?? "new", `(${contactKey})`);

    const history = await database.getHistory(contactKey);
    console.log(`History: ${history.length} messages`);

    const senderRef = String(sender.id ?? contactKey);
    await database.saveMessage(contactKey, senderRef, "user", userMessage);

    console.log("Calling LLM with history + contact profile...");
    const reply = await agent.chat(userMessage, history, contactKey, conversationId, contact);
    console.log("AI reply length:", reply.length);

    await database.saveMessage(contactKey, senderRef, "assistant", reply);

    console.log("Sending to Chatwoot conversation", conversationId);
    const result = await chatwoot.sendMessages(conversationId, reply);
    console.log("Chatwoot response:", result.slice(0, 200));
  } catch (err) {
    console.error("ERROR in processAndReply:", err);
  }
}
