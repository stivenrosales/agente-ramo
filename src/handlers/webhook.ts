import { agent } from "../services/agent.js";
import { database } from "../services/database.js";
import { chatwoot } from "../services/chatwoot.js";
import { config } from "../config.js";
import type {
  ChatwootChannel,
  ChatwootSender,
  ChatwootWebhookPayload,
} from "../types.js";

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
  if (config.webhookSecret) {
    const provided =
      request.headers.get("x-webhook-secret") ??
      request.headers.get("x-chatwoot-secret");
    if (provided !== config.webhookSecret) {
      console.log("REJECTED: invalid or missing webhook secret header");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: ChatwootWebhookPayload;
  try {
    payload = (await request.json()) as ChatwootWebhookPayload;
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

  const userMessage = (payload.content ?? "").trim();
  const conversation = payload.conversation;
  const conversationId = conversation?.id;
  const sender: ChatwootSender | undefined =
    payload.sender ?? conversation?.meta?.sender;
  const channel = mapChannel(payload.inbox?.channel_type);

  if (!userMessage || !conversationId || !sender) {
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
  processAndReply(conversationId, contactKey, userMessage, channel, sender).catch(
    (err) => {
      console.error("Unhandled error in background processing:", err);
    },
  );

  return Response.json({ status: "processing" });
}

async function processAndReply(
  conversationId: number,
  contactKey: string,
  userMessage: string,
  channel: ChatwootChannel,
  sender: ChatwootSender,
): Promise<void> {
  try {
    await database.upsertContact(contactKey, {
      name: sender.name ?? null,
      phone: sender.phone_number ?? null,
      email: sender.email ?? null,
    });

    const contact = await database.getContact(contactKey);
    console.log("Contact:", contact?.name ?? "new", `(${contactKey})`);

    const history = await database.getHistory(contactKey);
    console.log(`History: ${history.length} messages`);

    const senderRef = String(sender.id ?? contactKey);
    await database.saveMessage(contactKey, senderRef, "user", userMessage);

    console.log("Calling LLM with history + contact profile...");
    const reply = await agent.chat(userMessage, history, contactKey, contact);
    console.log("AI reply length:", reply.length);

    await database.saveMessage(contactKey, senderRef, "assistant", reply);

    console.log("Sending to Chatwoot conversation", conversationId);
    const result = await chatwoot.sendMessages(conversationId, reply);
    console.log("Chatwoot response:", result.slice(0, 200));
  } catch (err) {
    console.error("ERROR in processAndReply:", err);
  }
}
