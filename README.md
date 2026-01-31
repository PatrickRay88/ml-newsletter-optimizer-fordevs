# ml-newsletter-optimizer-fordevs

Resend-powered email autopilot demo for developers/data scientists. Includes segmentation, flows, send-time optimization, deliverability tracking, and synthetic Test Mode analytics.

## Stack
- Next.js App Router + TypeScript
- Prisma + PostgreSQL
- Resend API integrations (test mode)

## Local setup
1. Install dependencies: `npm install`
2. Configure environment variables in `.env` (see `.env.example`).
3. Start Postgres (Docker or local).
4. Run migrations: `npx prisma migrate deploy`
5. Seed data: `npm run db:seed`
6. Generate synthetic data: `npm run data:generate`
7. Start dev server: `npm run dev`

## Scripts
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — lint checks
- `npm run test` — unit tests
- `npm run data:generate` — deterministic synthetic data

## Demo flow
Onboarding → create test list → send test broadcast → poll outcomes → review dashboard and deliverability.
