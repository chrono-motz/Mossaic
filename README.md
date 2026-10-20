# Mosaic — outcome compiler

Mosaic turns a natural-language goal into competing commerce plans, proves the deadline, lets a coordinator edit the plan in a live AG Grid / AG Studio control surface, and gates PayPal funding behind human approval.

## Current prototype

The first slice is intentionally runnable without credentials. It demonstrates the complete decision flow with deterministic fixtures:

1. Enter or edit a mission brief.
2. Compile three plans: fastest, best value, and lowest waste.
3. Compare confidence, delivery time, suppliers, impact, and reserve.
4. Edit a product choice in AG Grid and invalidate the old approval.
5. Inspect the Bryntum Scheduler dependency timeline.
6. Approve the exact plan revision.
7. Create and complete a PayPal Sandbox-style order flow.
8. Inspect the agent trace and AG Studio intelligence canvas.

The browser demo uses a deterministic PayPal adapter so judges can run it immediately. The production adapter seam is documented below; credentials must never be placed in `VITE_*` variables or committed.

## Run locally

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

Open `http://localhost:4173`.

To run the trusted API boundary locally as well, use a second terminal:

```bash
npm run dev:server
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8787`. With `DEMO_MODE=true` (the default), approvals, order creation, idempotency, and capture are real server-side state transitions while PayPal is represented by a deterministic demo provider. This lets the complete flow run without credentials.

The server API exposes:

- `POST /api/compile` — compiles a mission against the configured AI planner and product catalog adapter;
- `POST /api/approvals` — re-compiles and records an immutable approval bound to a plan hash;
- `POST /api/missions/:missionId/paypal/orders` — creates an idempotent, approval-bound order;
- `POST /api/payments/:paymentId/capture` — captures the stored PayPal order, or the demo provider in demo mode;
- `POST /api/paypal/webhooks` — verifies, deduplicates, and applies PayPal capture-completed events;
- `GET /api/health` — reports which live adapters are configured.

## Checks

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

The Playwright test uses the same deterministic demo mode and verifies that the main mission room renders, sponsor surfaces are present, and PayPal remains gated until approval.

## Sponsor surfaces

- **AG Grid / AG Studio** — the plan compiler is editable at cell level, and the Intelligence Canvas uses AG Studio’s embedded analytics data engine for self-serve mission views.
- **Bryntum Scheduler** — mission tasks, resource lanes, dependencies, and the hard deadline are rendered as a temporal proof surface.
- **Channel3** — `server/channel3.ts` calls `new Channel3({ apiKey })` and `client.products.search` server-side for the mission categories, then normalizes viable offers into `ProductOption`.
- **PayPal** — `server/paypal.ts` uses the APIMatic-generated `@paypal/paypal-server-sdk` from a trusted service. The API returns a PayPal approval URL in live mode and never accepts amount/currency from the browser.
- **AI** — `server/ai.ts` supports any OpenAI-compatible chat endpoint. It requests structured JSON, validates and normalizes the result, and falls back only when no server key is configured.
- **APIMatic** — the PayPal SDK dependency is the generated TypeScript server SDK. The APIMatic PayPal Context Plugin was used as the API-contract reference for the order/capture boundary.
- **Render** — `render.yaml` deploys the built frontend, API, and a managed Postgres database together as one web service. The server also serves `dist/` for a single-URL demo.
- **Zapier** — set `ZAPIER_WEBHOOK_URL` to send a non-blocking `mission.funded` event after capture or a verified webhook.

## Live integration plan

Add a server-side service with these environment variables:

```text
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com
CHANNEL3_API_KEY=...
DATABASE_URL=...
AI_API_KEY=...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
ZAPIER_WEBHOOK_URL=...
```

The trusted service must:

- derive amount and currency from the approved plan revision, never from browser input;
- reject an order request without a matching current approval and plan hash;
- use `@channel3/sdk` with `new Channel3({ apiKey })` for product search;
- use the server-only OpenAI-compatible planner adapter in `server/ai.ts` when `AI_API_KEY` is configured; the browser never sees the key;
- use `@paypal/paypal-server-sdk` `OrdersController.createOrder` and `captureOrder` in Sandbox;
- verify and deduplicate PayPal webhook events;
- persist immutable approvals, orders, and webhook receipts through `server/persistence.ts`; `DATABASE_URL` selects Postgres, while no-credential local runs use the in-memory adapter;
- keep the demo adapter behind a clearly labeled `DEMO_MODE` switch.

## Product thesis

Mosaic is not a shopping chatbot. It is a **mission compiler**: an AI-orchestrated decision room that compares ways to make an outcome happen, then moves money only after a human approves the exact executable plan.

## License

MIT. Sponsor SDKs and commercial trial components remain subject to their own licenses.
