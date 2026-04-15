import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { handleWebhook } from "./handlers/webhook.js";
import { startFollowupScheduler } from "./services/followup-scheduler.js";

const app = new Hono();

app.get("/", (c) => c.json({ status: "ok", service: "agente-ramo" }));

// Chatwoot webhook endpoint — configure this URL in:
// Chatwoot → Settings → Integrations → Webhooks → Add new webhook
app.post("/webhook", (c) => handleWebhook(c.req.raw));
app.post("/webhook/chatwoot", (c) => handleWebhook(c.req.raw));

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("Unhandled route error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `🚀 agente-ramo listening on http://localhost:${info.port} [${config.nodeEnv}]`,
  );
});

startFollowupScheduler();
