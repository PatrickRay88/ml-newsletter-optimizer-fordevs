# DispatchIQ (Email Autopilot Demo)

Resend-powered email autopilot demo for developers and data scientists. This project layers a lightweight “brain” on top of Resend: segmentation, send-time optimization, hygiene scoring, and synthetic Test Mode analytics.

## What it does
- **Send-time optimizer (ML v1)**: recommends the best hour-of-week using Bayesian-smoothed click histograms.
- **Hygiene scoring**: scores deliverability risk and optionally suppresses risky contacts.
- **Test Mode demo**: uses resend.dev inboxes + deterministic synthetic clicks for repeatable results.
- **Observability**: stores optimizer decisions, outcomes, and model versions for explainability.

## Stack
- Next.js App Router + TypeScript
- Prisma + PostgreSQL
- Resend API integrations (Test Mode)

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

## Day‑one demo flow
1. Settings → connect Resend key (Test Mode).
2. Dev utilities → Create Test List.
3. Broadcasts → create + send (optimizer or immediate).
4. Dev utilities → Train ML Models.
5. Dev utilities → Poll Email Status + Run Hygiene Sweep.
6. Dashboard → review delivery + CTR uplift.

## ML + data pipeline
- **Training**: `/api/jobs/train-models` persists ModelVersion metrics + predictions.
- **Inference**: send-time optimizer uses per-contact/segment/global histograms with 24h cooldown.
- **Synthetic data**: deterministic generator feeds clicks + events for repeatable demos.

## Dev utilities
Use the Dev utilities page to run Test Mode workflows:
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
