# WA Integration Node Demo

Proxy backend for the [`WA_Integration_demo`](../WA_Integration_demo/) frontend.
When the payment flow completes, the frontend calls this backend and this backend
fires a WhatsApp message through **AiSensy**.

## Endpoints

| Method | Path           | Purpose                                                       |
|--------|----------------|---------------------------------------------------------------|
| GET    | `/health`      | Liveness + reports whether env vars are configured            |
| POST   | `/api/trigger` | Called by the frontend; forwards a request to AiSensy's API   |

## Setup

```bash
cd WA_integration_node_demo
cp .env.example .env   # then fill in the values
npm install
npm start              # or `npm run dev` for auto-reload on file change
```

Server comes up on `http://localhost:3000`.

### Required env vars

| Name                   | Description                                          |
|------------------------|------------------------------------------------------|
| `PORT`                 | Port to listen on (default `3000`)                   |
| `AISENSY_PROJECT_ID`   | Your AiSensy project ID                              |
| `AISENSY_API_PWD`      | Value for the `X-AiSensy-Project-API-Pwd` header     |
| `AISENSY_TO`           | Default WhatsApp recipient phone number              |
| `ALLOWED_ORIGINS`      | CORS allow-list, comma-separated, or `*` (default)   |

## Quick test

```bash
# Health
curl http://localhost:3000/health

# Trigger (uses the default AISENSY_TO)
curl -X POST http://localhost:3000/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{}'

# Trigger with an override recipient
curl -X POST http://localhost:3000/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"to":"9742569189"}'
```

## How it wires to the frontend

The frontend currently hits `/api/customer-quote` (via a Netlify Function that
proxies Paytm). To use this backend instead, point the frontend at
`POST <this-backend-url>/api/trigger` from `paid.js` / `upi-pin.js`.

## Deploying

Render / Railway / Fly.io are all one-click for this kind of Express app:

- **Render**: new Web Service → point at the repo → build `npm install` /
  start `npm start` → set env vars in the dashboard.
- **Railway**: `railway up`, set the env vars in the project settings.
- **Fly.io**: `fly launch` (it auto-detects Node), `fly secrets set ...`.

Once deployed, update `ALLOWED_ORIGINS` to the Netlify domain of the frontend
so CORS only lets that origin through.
