# DispatchIQ (Email Autopilot Demo)

Resend-powered email autopilot demo for developers and data scientists. This project layers a lightweight "brain" on top of Resend: segmentation, send-time optimization, hygiene scoring, and synthetic Sandbox analytics.

## What it does
- **Send-time optimizer (ML v1)**: recommends the best hour-of-week using Bayesian-smoothed click histograms.
- **Hygiene scoring**: scores deliverability risk and optionally suppresses risky contacts.
- **Sandbox demo**: uses resend.dev inboxes + deterministic synthetic clicks for repeatable results.
- **Observability**: stores optimizer decisions, outcomes, and model versions for explainability.

## Stack
- Next.js App Router + TypeScript
- Prisma + PostgreSQL
- Resend API integrations (Sandbox/Live)

## Environment variables
Required:
- DATABASE_URL
- APP_BASE_URL
Optional:
- APP_ENCRYPTION_KEY (required to store secrets)

## Local setup
1. Install dependencies: `npm install`
2. Configure environment variables in `.env` (see `.env.example`).
3. Start Postgres (Docker or local).
4. Run migrations: `npx prisma migrate deploy`
5. Seed data: `npm run db:seed`
6. Generate synthetic data: `npm run data:generate`
7. Start dev server: `npm run dev`
8. Optional local scheduler for queued sends: `npm run dev:scheduler`

## Day‑one demo flow
1. Settings -> connect Resend key (Sandbox).
2. Dev utilities → Create Test List.
3. Broadcasts → create + send (optimizer or immediate).
4. Dev utilities → Train ML Models.
5. Dev utilities → Poll Email Status + Run Hygiene Sweep.
6. Dashboard → review delivery + CTR uplift.

## Scheduled sends and automation
- Optimizer-window sends are queued with per-message `scheduledSendAt`.
- Queued sends are dispatched by calling `POST /api/jobs/poll-email-status`.
- In local dev, run `npm run dev:scheduler` to auto-trigger dispatch every 2 minutes.
- In hosted environments, configure a cron/job runner to call that route every 2-5 minutes.

## ML + data pipeline
- **Training**: `/api/jobs/train-models` persists ModelVersion metrics + predictions.
- **Inference**: send-time optimizer uses per-contact/segment/global histograms with 24h cooldown.
- **Synthetic data**: deterministic generator feeds clicks + events for repeatable demos.

## Dev utilities
Use the Dev utilities page to run Sandbox workflows:
- Create Test List
- Send Test Broadcast
- Train ML Models
- Poll Email Status
- Hygiene Sweep

## Scripts
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — lint checks
- `npm run test` — unit tests
- `npm run data:generate` — deterministic synthetic data

## Future features
- One-click “Run Full Simulation” action (generate data → train models → send broadcast → poll outcomes → hygiene sweep).
