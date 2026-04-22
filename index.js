require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Use built-in fetch on Node 18+, fall back to node-fetch on Node 16/17.
const fetch = globalThis.fetch || require("node-fetch");

const PORT = process.env.PORT || 3000;
const AISENSY_PROJECT_ID = process.env.AISENSY_PROJECT_ID || "";
const AISENSY_API_PWD = process.env.AISENSY_API_PWD || "";
const AISENSY_TO = process.env.AISENSY_TO || "9742569189";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();

// Render sits behind a proxy — trust it so req.ip shows the real client IP.
app.set("trust proxy", true);

app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes("*") ? true : ALLOWED_ORIGINS,
  })
);
app.use(express.json({ limit: "100kb" }));

// --- Request / response logger ---
// Logs every incoming request, the body, and the response status + duration.
app.use((req, res, next) => {
  const started = Date.now();
  const reqId = Math.random().toString(36).slice(2, 8);
  const ip = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
  const origin = req.headers.origin || "-";
  const ua = (req.headers["user-agent"] || "-").slice(0, 80);

  console.log(
    `\n[${new Date().toISOString()}] ──▶ ${req.method} ${req.originalUrl}  id=${reqId}`
  );
  console.log(`   ip=${ip}  origin=${origin}`);
  console.log(`   ua=${ua}`);
  if (req.body && Object.keys(req.body).length) {
    console.log(`   body=${truncate(JSON.stringify(req.body), 500)}`);
  }

  res.on("finish", () => {
    const ms = Date.now() - started;
    console.log(
      `[${new Date().toISOString()}] ◀── ${req.method} ${req.originalUrl}  id=${reqId}  status=${res.statusCode}  ${ms}ms`
    );
  });
  next();
});

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n} chars)` : s;
}

// --- Health check ---
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wa-integration-node-demo",
    aisensyConfigured: Boolean(AISENSY_PROJECT_ID && AISENSY_API_PWD),
  });
});

// --- Main trigger endpoint ---
// The frontend calls this when the payment flow completes.
// We forward a WhatsApp message request to AiSensy.
app.post("/api/trigger", async (req, res) => {
  console.log("   🔔 /api/trigger hit — payment flow completed on frontend");

  if (!AISENSY_PROJECT_ID || !AISENSY_API_PWD) {
    console.error("   ⚠️  missing AISENSY_PROJECT_ID or AISENSY_API_PWD");
    return res.status(500).json({
      ok: false,
      error:
        "Server missing AISENSY_PROJECT_ID or AISENSY_API_PWD. Set them in .env.",
    });
  }

  // Allow the frontend to override the recipient phone if it wants to,
  // otherwise fall back to the server-configured default.
  const to = (req.body && req.body.to) || AISENSY_TO;

  const url = `https://apis.aisensy.com/project-apis/v1/project/${AISENSY_PROJECT_ID}/messagesto:${to}`;
  const body = req.body && Object.keys(req.body).length ? req.body : {};

  console.log(`   📤 forwarding to AiSensy: to=${to}`);
  console.log(`      url=${url}`);

  const t0 = Date.now();
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Pwd": AISENSY_API_PWD,
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = text;
    }

    const dt = Date.now() - t0;
    const emoji = upstream.ok ? "✅" : "❌";
    console.log(`   ${emoji} AiSensy responded: status=${upstream.status}  ${dt}ms`);
    console.log(`      body=${truncate(typeof parsed === "string" ? parsed : JSON.stringify(parsed), 500)}`);

    return res.status(upstream.status).json({
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      data: parsed,
    });
  } catch (err) {
    const dt = Date.now() - t0;
    console.error(`   💥 AiSensy call failed after ${dt}ms: ${err.name}: ${err.message}`);
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
      `  POST /api/trigger`
  );
});
