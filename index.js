require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Use built-in fetch on Node 18+, fall back to node-fetch on Node 16/17.
const fetch = globalThis.fetch || require("node-fetch");

const PORT = process.env.PORT || 3000;
const AISENSY_PROJECT_ID = process.env.AISENSY_PROJECT_ID || "";
const AISENSY_API_PWD = process.env.AISENSY_API_PWD || "";
const AISENSY_TO = process.env.AISENSY_TO || "919810699203";

// Document message (the only call this backend makes).
const AISENSY_DOC_CAPTION =
  process.env.AISENSY_DOC_CAPTION || "Your document caption here";
const AISENSY_DOC_LINK =
  process.env.AISENSY_DOC_LINK ||
  "https://s3.ap-south-1.amazonaws.com/pibpl-fe-prod.paytminsurance.co.in/pdf/IndiaFirst%20Life%20Protect%20Shield%20Plan_Brochure.pdf";
const AISENSY_DOC_FILENAME = process.env.AISENSY_DOC_FILENAME || "wds";

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
      AISENSY_DOC_LINK,
      AISENSY_DOC_CAPTION,
      AISENSY_DOC_FILENAME,
    },
  });
});

// --- Main trigger endpoint ---
// Sends a WhatsApp *document* message via AiSensy.
// The *text* message is fired directly from the frontend — this backend
// only handles the document call, and fires it immediately (no delay).
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

  console.log(`[aisensy] -> document POST ${url} (to=${to})`);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Pwd": AISENSY_API_PWD,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { parsed = text; }

    if (!upstream.ok) {
      console.error(
        `[aisensy error] document status=${upstream.status} body=${
          typeof parsed === "string" ? parsed : JSON.stringify(parsed)
        }`
      );
    } else {
      console.log(`[aisensy] document sent status=${upstream.status}`);
    }

    return res.status(upstream.status).json({
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      data: parsed,
    });
  } catch (err) {
    console.error(`[aisensy error] document ${err.name}: ${err.message}`);
    return res.status(502).json({
      ok: false,
      error: err.message,
      name: err.name,
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `WA integration node demo running on http://localhost:${PORT}\n` +
      `  GET  /health\n` +
      `  POST /api/trigger  (document message only)`
  );
});
