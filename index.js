require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Use built-in fetch on Node 18+, fall back to node-fetch on Node 16/17.
const fetch = globalThis.fetch || require("node-fetch");

const PORT = process.env.PORT || 3000;
const AISENSY_PROJECT_ID = process.env.AISENSY_PROJECT_ID || "";
const AISENSY_API_PWD = process.env.AISENSY_API_PWD || "";
const AISENSY_TO = process.env.AISENSY_TO || "919810699203";

// Policy template with header document (sent on /api/trigger — e.g. payment success).
const AISENSY_POLICY_TEMPLATE_NAME =
  process.env.AISENSY_POLICY_TEMPLATE_NAME ||
  "25aprilinsurance_policy_01_8ejy5";
const AISENSY_POLICY_TEMPLATE_BODY =
  process.env.AISENSY_POLICY_TEMPLATE_BODY || "Dhananjay";
const AISENSY_DOC_LINK =
  process.env.AISENSY_DOC_LINK ||
  "https://d3jt6ku4g6z5l8.cloudfront.net/FILE/6765903d6b5d130bf22e427b/522040_bloomfiltertalk.pptx";
const AISENSY_DOC_FILENAME = process.env.AISENSY_DOC_FILENAME || "Policy";

// Failure template (sent on /api/abandon when user drops off).
const AISENSY_FAILURE_TEMPLATE_NAME =
  process.env.AISENSY_FAILURE_TEMPLATE_NAME || "25aprilmakemodel";
const AISENSY_FAILURE_TEMPLATE_BODY =
  process.env.AISENSY_FAILURE_TEMPLATE_BODY || "Maruti";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * WhatsApp / AiSensy expect international format without + (e.g. 919810699203).
 * Ten-digit Indian mobiles (starting 6–9) get 91 prefixed to match Postman.
 */
function normalizeWhatsAppRecipient(to) {
  if (to === undefined || to === null) return "";
  const trimmed = String(to).trim().replace(/^\+/, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return `91${digits}`;
  }
  return digits || trimmed;
}

function logAisensyBillingHint(status, parsed) {
  if (status === 402 && parsed && typeof parsed === "object") {
    const msg = parsed.message || "";
    if (String(msg).includes("WCC") || String(msg).includes("Credits")) {
      console.error(
        "[aisensy hint] 402 = insufficient WhatsApp Conversation Credits on this AiSensy project — top up WCC in the AiSensy dashboard."
      );
    }
  }
}

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
      AISENSY_POLICY_TEMPLATE_NAME,
      AISENSY_POLICY_TEMPLATE_BODY,
      AISENSY_DOC_LINK,
      AISENSY_DOC_FILENAME,
    },
  });
});

// --- Main trigger endpoint ---
// Sends WhatsApp template `AISENSY_POLICY_TEMPLATE_NAME` via AiSensy client API
// (header document + body text) — same host/headers pattern as /api/abandon.
app.post("/api/trigger", async (req, res) => {
  console.log(`[${new Date().toISOString()}] /api/trigger hit`);

  if (!AISENSY_PROJECT_ID || !AISENSY_API_PWD) {
    return res.status(500).json({
      ok: false,
      error:
        "Server missing AISENSY_PROJECT_ID or AISENSY_API_PWD. Set them in .env.",
    });
  }

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const to = normalizeWhatsAppRecipient(body.to || AISENSY_TO);
  const templateName = body.templateName || AISENSY_POLICY_TEMPLATE_NAME;
  const bodyText = body.bodyText ?? AISENSY_POLICY_TEMPLATE_BODY;
  const docLink = body.documentLink || AISENSY_DOC_LINK;
  const docFilename = body.documentFilename || AISENSY_DOC_FILENAME;

  const url = `https://backend.aisensy.com/client/t1/project-apis/v1/project/${AISENSY_PROJECT_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      language: { policy: "deterministic", code: "en" },
      name: templateName,
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "document",
              document: {
                link: docLink,
                filename: docFilename,
              },
            },
          ],
        },
        {
          type: "body",
          parameters: [{ type: "text", text: String(bodyText) }],
        },
      ],
    },
  };

  console.log(`[aisensy] -> policy template POST ${url} (to=${to} template=${templateName})`);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aisensy-project-api-pwd": AISENSY_API_PWD,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { parsed = text; }

    if (!upstream.ok) {
      logAisensyBillingHint(upstream.status, parsed);
      console.error(
        `[aisensy error] policy template status=${upstream.status} body=${
          typeof parsed === "string" ? parsed : JSON.stringify(parsed)
        }`
      );
    } else {
      console.log(`[aisensy] policy template sent status=${upstream.status}`);
    }

    return res.status(upstream.status).json({
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      data: parsed,
    });
  } catch (err) {
    console.error(`[aisensy error] policy template ${err.name}: ${err.message}`);
    return res.status(502).json({
      ok: false,
      error: err.message,
      name: err.name,
    });
  }
});

// --- Abandonment endpoint ---
// Called when the user drops off before reaching the success page.
// We accept JSON or sendBeacon (text/plain) bodies.
app.post(
  "/api/abandon",
  express.text({ type: "*/*", limit: "10kb" }), // catches sendBeacon Blob bodies
  async (req, res) => {
    let parsedBody = {};
    try {
      parsedBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    } catch (_) { /* keep empty */ }

    const to = normalizeWhatsAppRecipient(parsedBody.to || AISENSY_TO);
    const reason = parsedBody.reason || "unknown";
    console.log(`[${new Date().toISOString()}] /api/abandon hit  to=${to}  reason=${reason}`);

    if (!AISENSY_PROJECT_ID || !AISENSY_API_PWD) {
      return res.status(500).json({
        ok: false,
        error: "Server missing AISENSY_PROJECT_ID or AISENSY_API_PWD.",
      });
    }

    const url = `https://backend.aisensy.com/client/t1/project-apis/v1/project/${AISENSY_PROJECT_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        language: { policy: "deterministic", code: "en" },
        name: AISENSY_FAILURE_TEMPLATE_NAME,
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: AISENSY_FAILURE_TEMPLATE_BODY }],
          },
        ],
      },
    };

    console.log(`[aisensy] -> failure template POST ${url} (to=${to})`);
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-aisensy-project-api-pwd": AISENSY_API_PWD,
        },
        body: JSON.stringify(payload),
      });
      const text = await upstream.text();
      let parsedRes;
      try { parsedRes = JSON.parse(text); } catch (_) { parsedRes = text; }

      if (!upstream.ok) {
        logAisensyBillingHint(upstream.status, parsedRes);
        console.error(
          `[aisensy error] failure status=${upstream.status} body=${
            typeof parsedRes === "string" ? parsedRes : JSON.stringify(parsedRes)
          }`
        );
      } else {
        console.log(`[aisensy] failure template sent status=${upstream.status}`);
      }

      return res.status(upstream.status).json({
        ok: upstream.ok,
        upstreamStatus: upstream.status,
        data: parsedRes,
      });
    } catch (err) {
      console.error(`[aisensy error] failure ${err.name}: ${err.message}`);
      return res.status(502).json({ ok: false, error: err.message, name: err.name });
    }
  }
);

app.listen(PORT, () => {
  console.log(
    `WA integration node demo running on http://localhost:${PORT}\n` +
      `  GET  /health\n` +
      `  POST /api/trigger   (policy template + header document — payment success)\n` +
      `  POST /api/abandon   (failure template — payment dropped)`
  );
});
