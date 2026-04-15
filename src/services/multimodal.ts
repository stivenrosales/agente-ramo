import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";

export interface ChatwootAttachment {
  file_type?: string;
  data_url?: string;
  thumb_url?: string;
  extension?: string;
  [k: string]: unknown;
}

export interface EnrichedText {
  text: string;
  processed: number;
  skipped: number;
}

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.openrouterApiKey,
});

const MODEL = "google/gemini-3.1-flash-lite-preview";

const AUDIO_PROMPT =
  "Transcribe este audio en español, solo la transcripción literal sin prefijos.";
const IMAGE_PROMPT =
  "Describe esta imagen en una sola frase breve y útil (máximo 30 palabras). Español.";

type ProcessResult =
  | { kind: "audio"; ok: true; text: string }
  | { kind: "image"; ok: true; text: string }
  | { kind: "audio"; ok: false }
  | { kind: "image"; ok: false }
  | { kind: "skip" };

function guessAudioMime(ext?: string): string {
  if (!ext) return "audio/ogg";
  const e = ext.toLowerCase().replace(/^\./, "");
  switch (e) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "ogg":
    case "oga":
    case "opus":
    default:
      return "audio/ogg";
  }
}

function guessImageMime(ext?: string): string {
  if (!ext) return "image/jpeg";
  const e = ext.toLowerCase().replace(/^\./, "");
  switch (e) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
}

async function downloadAttachment(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { api_access_token: config.chatwootApiToken },
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function transcribeAudio(
  att: ChatwootAttachment,
): Promise<ProcessResult> {
  if (!att.data_url) return { kind: "audio", ok: false };
  try {
    const buf = await downloadAttachment(att.data_url);
    const mimeType = guessAudioMime(att.extension);
    const { text } = await generateText({
      model: openrouter(MODEL),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: AUDIO_PROMPT },
            { type: "file", data: buf, mimeType },
          ],
        },
      ],
    });
    const trimmed = text.trim();
    if (!trimmed) return { kind: "audio", ok: false };
    return { kind: "audio", ok: true, text: trimmed };
  } catch (err) {
    console.warn(
      "[multimodal] audio processing failed:",
      err instanceof Error ? err.message : err,
    );
    return { kind: "audio", ok: false };
  }
}

async function describeImage(
  att: ChatwootAttachment,
): Promise<ProcessResult> {
  if (!att.data_url) return { kind: "image", ok: false };
  try {
    const buf = await downloadAttachment(att.data_url);
    const mimeType = guessImageMime(att.extension);
    const { text } = await generateText({
      model: openrouter(MODEL),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: IMAGE_PROMPT },
            { type: "image", image: buf, mimeType },
          ],
        },
      ],
    });
    const trimmed = text.trim();
    if (!trimmed) return { kind: "image", ok: false };
    return { kind: "image", ok: true, text: trimmed };
  } catch (err) {
    console.warn(
      "[multimodal] image processing failed:",
      err instanceof Error ? err.message : err,
    );
    return { kind: "image", ok: false };
  }
}

async function processOne(att: ChatwootAttachment): Promise<ProcessResult> {
  switch (att.file_type) {
    case "audio":
      return transcribeAudio(att);
    case "image":
      return describeImage(att);
    default:
      return { kind: "skip" };
  }
}

export const multimodal = {
  async enrichUserMessage(
    originalText: string,
    attachments: ChatwootAttachment[] | undefined,
  ): Promise<EnrichedText> {
    const base = originalText ?? "";

    if (!attachments || attachments.length === 0) {
      return { text: base, processed: 0, skipped: 0 };
    }

    const results = await Promise.all(attachments.map((a) => processOne(a)));

    let processed = 0;
    let skipped = 0;
    const lines: string[] = [];

    for (const r of results) {
      if (r.kind === "skip") {
        skipped += 1;
        continue;
      }
      if (r.ok) {
        processed += 1;
        if (r.kind === "audio") {
          lines.push(`[Audio transcrito: "${r.text}"]`);
        } else {
          lines.push(`[Imagen: "${r.text}"]`);
        }
      } else {
        skipped += 1;
        if (r.kind === "audio") {
          lines.push("[Audio recibido pero no se pudo procesar]");
        } else {
          lines.push("[Imagen recibida pero no se pudo procesar]");
        }
      }
    }

    const trimmedBase = base.trim();
    let finalText: string;
    if (lines.length === 0) {
      finalText = trimmedBase;
    } else if (trimmedBase) {
      finalText = `${trimmedBase}\n\n${lines.join("\n")}`;
    } else {
      finalText = lines.join("\n");
    }

    return { text: finalText, processed, skipped };
  },
};
