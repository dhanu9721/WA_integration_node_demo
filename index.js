require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Use built-in fetch on Node 18+, fall back to node-fetch on Node 16/17.
const fetch = globalThis.fetch || require("node-fetch");

const PORT = process.env.PORT || 3000;
const AISENSY_PROJECT_ID = process.env.AISENSY_PROJECT_ID || "";
const AISENSY_API_PWD = process.env.AISENSY_API_PWD || "";
const AISENSY_TO = process.env.AISENSY_TO || "918858318301";

// First call — text message
const AISENSY_TEXT_BODY = process.env.AISENSY_TEXT_BODY || "hello test";

// Second call — document message
const AISENSY_DOC_CAPTION =
  process.env.AISENSY_DOC_CAPTION || "Your document caption here";
const AISENSY_DOC_LINK =
  process.env.AISENSY_DOC_LINK ||
  "https://s3.ap-south-1.amazonaws.com/pibpl-fe-prod.paytminsurance.co.in/pdf/IndiaFirst%20Life%20Protect%20Shield%20Plan_Brochure.pdf";
const AISENSY_DOC_FILENAME = process.env.AISENSY_DOC_FILENAME || "wds";

// Gap between the text and document messages.
const DELAY_BETWEEN_CALLS_MS =
  Number(process.env.DELAY_BETWEEN_CALLS_MS) || 5000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.set("trust proxy", true);
app.use(
  cors({ origin: ALLOWED_ORIGINS.includes("*") ? true : ALLOWED_ORIGINS })
);
app.use(express.json({ limit: "100kb" }));

// --- Health check ---
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wa-integration-node-demo",
    aisensyConfigured: Boolean(AISENSY_PROJECT_ID && AISENSY_API_PWD),
    env: {
      AISENSY_PROJECT_ID: AISENSY_PROJECT_ID ? "set" : "MISSING",
      AISENSY_API_PWD: AISENSY_API_PWD ? "set" : "MISSING",
      AISENSY_TO: AISENSY_TO || "MISSING",
      AISENSY_TEXT_BODY,
      AISENSY_DOC_LINK,
      AISENSY_DOC_CAPTION,
      AISENSY_DOC_FILENAME,
      DELAY_BETWEEN_CALLS_MS,
    },
  });
});

// --- Main trigger endpoint ---
// Fires a text WhatsApp message immediately, then a document message
// after DELAY_BETWEEN_CALLS_MS.
app.post("/api/trigger", async (req, res) => {
  console.log(`[${new Date().toISOString()}] /api/trigger hit`);

  if (!AISENSY_PROJECT_ID || !AISENSY_API_PWD) {
    return res.status(500).json({
      ok: false,
      error:
        "Server missing AISENSY_PROJECT_ID or AISENSY_API_PWD. Set them in .env.",
    });
  }

  const to = (req.body && req.body.to) || AISENSY_TO;

  // 1. Send the text message, await so we can report its outcome to the frontend.
  const textResult = await sendTextMessage(to);

  // 2. Schedule the document message (fire-and-forget). The Node process
  //    keeps the setTimeout alive even after the HTTP response is sent.
  setTimeout(() => {
    sendDocumentMessage(to).catch((err) =>
      console.error(`[aisensy error] document call: ${err.name}: ${err.message}`)
    );
  }, DELAY_BETWEEN_CALLS_MS);

  return res.status(textResult.ok ? 200 : 502).json({
    ok: textResult.ok,
    text: textResult,
    document: { scheduled: true, delayMs: DELAY_BETWEEN_CALLS_MS },
  });
});

// ----- AiSensy helpers --------------------------------------------------

async function sendTextMessage(to) {
  const url = `https://backend.aisensy.com/client/t1/project-apis/v1/project/${AISENSY_PROJECT_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: AISENSY_TEXT_BODY },
  };
  return postToAiSensy(url, payload, "text", {
    "x-aisensy-project-api-pwd": AISENSY_API_PWD,
    "Content-Type": "application/json",
  });
}

async function sendDocumentMessage(to) {
  const url = `https://apis.aisensy.com/project-apis/v1/project/${AISENSY_PROJECT_ID}/messages`;
  const payload = {
    to,
    type: "document",
    document: {
      caption: AISENSY_DOC_CAPTION,
      link: AISENSY_DOC_LINK,
      filename: AISENSY_DOC_FILENAME,
    },
  };
  return postToAiSensy(url, payload, "document", {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-AiSensy-Project-API-Pwd": AISENSY_API_PWD,
  });
}

async function postToAiSensy(url, payload, label, headers) {
  console.log(`[aisensy] -> ${label} POST ${url}`);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { parsed = text; }

    if (!upstream.ok) {
      console.error(
        `[aisensy error] ${label} status=${upstream.status} body=${
          typeof parsed === "string" ? parsed : JSON.stringify(parsed)
        }`
      );
    } else {
      console.log(`[aisensy] ${label} sent status=${upstream.status}`);
    }

    return { ok: upstream.ok, status: upstream.status, data: parsed };
  } catch (err) {
    console.error(`[aisensy error] ${label} ${err.name}: ${err.message}`);
    return { ok: false, error: err.message, name: err.name };
  }
}

app.listen(PORT, () => {
  console.log(
    `WA integration node demo running on http://localhost:${PORT}\n` +
      `  GET  /health\n` +
      `  POST /api/trigger`
  );
});
