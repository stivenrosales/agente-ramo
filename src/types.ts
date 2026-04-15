export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Contact {
  contact_key: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  ruc: string | null;
  empresa: string | null;
  cargo: string | null;
  necesidad: string | null;
  modalidad: string | null;
  notes: string | null;
  first_seen: Date;
  last_seen: Date;
}

export type ChatwootChannel =
  | "instagram"
  | "facebook"
  | "whatsapp"
  | "api"
  | "web"
  | "sms"
  | "telegram"
  | "email"
  | "unknown";

export interface ChatwootSender {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  identifier?: string | null;
  additional_attributes?: Record<string, unknown> | null;
}

export interface ChatwootInbox {
  id?: number;
  name?: string;
  channel_type?: string;
}

export interface ChatwootConversationMeta {
  sender?: ChatwootSender;
  assignee?: unknown;
}

export interface ChatwootConversation {
  id?: number;
  inbox_id?: number;
  status?: string;
  meta?: ChatwootConversationMeta;
  contact_inbox?: {
    source_id?: string;
    contact_id?: number;
  };
}

export interface ChatwootWebhookPayload {
  event?: string;
  message_type?: "incoming" | "outgoing" | "template" | "activity";
  content?: string | null;
  private?: boolean;
  sender?: ChatwootSender;
  conversation?: ChatwootConversation;
  inbox?: ChatwootInbox;
  account?: { id?: number; name?: string };
  id?: number;
  [key: string]: unknown;
}
