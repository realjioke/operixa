# Operixa

A real-time collaborative workspace platform — organizations, projects, kanban boards, and collaborative documents, all synced live across clients over a horizontally-scalable WebSocket layer.

Built as a system-design and production-engineering portfolio piece: the emphasis is less on feature count and more on the architecture underneath — RBAC, optimistic concurrency, presence, and a Redis-backed event bus that lets the realtime gateway scale independently of the API.

## What's here

| Area | Highlights |
|---|---|
| **Auth** | Password + refresh-token rotation with theft detection, RBAC middleware, rate limiting |
| **Realtime** | WebSocket gateway, Redis Pub/Sub event bus, room-scoped authorization, presence, reconnect/backoff |
| **Kanban** | Fractional-index ordering (drag-and-drop reorder never rewrites siblings), live updates |
| **Documents** | Optimistic updates with explicit conflict detection (409), Redis soft-locking, full version history + restore |
| **Notifications** | BullMQ-backed queue decouples slow delivery channels from the request path |
| **Search** | Postgres full-text search, swappable behind a stable response shape |
| **Observability** | Request correlation IDs, structured JSON logs, audit trail on every permission-relevant action |

See `/docs` for the design documents:
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, realtime architecture, scaling story
- [`DATABASE_ERD.md`](docs/DATABASE_ERD.md) — schema and relationships
- [`API.md`](docs/API.md) — REST + WebSocket contracts
- [`TESTING.md`](docs/TESTING.md) — test strategy across unit/integration/realtime
- [`ENGINEERING_DECISIONS.md`](docs/ENGINEERING_DECISIONS.md) — the tradeoffs and why

## Stack

**Frontend** — Next.js 15 (App Router), TypeScript, Tailwind CSS, TanStack Query, Zustand, native WebSocket client
**Backend** — Node.js, TypeScript, Express, PostgreSQL + Prisma, Redis (cache/presence/pub-sub/queues), BullMQ workers
**Infra** — Docker Compose for local dev, GitHub Actions CI (lint, unit tests, integration tests against real Postgres/Redis, Docker build verification)

## Quickstart

```bash
git clone <this-repo> syncforge && cd syncforge
docker compose up --build
```

This starts Postgres, Redis, the API, the notification worker, and the Next.js frontend. The API container runs `prisma migrate deploy` on boot.

Seed demo data (org, users, project, tasks, a document):

```bash
docker compose exec api npm run prisma:seed
```

Then open **http://localhost:3000** and sign in with `ada@syncforge.dev` / `password123`.

### Running without Docker

```bash
# Terminal 1 — infra only
docker compose up postgres redis

# Terminal 2 — API
cd backend && cp .env.example .env && npm install
npm run prisma:generate && npm run prisma:migrate
npm run dev

# Terminal 3 — worker
cd backend && npm run worker

# Terminal 4 — frontend
cd frontend && cp .env.example .env && npm install && npm run dev
```

## Testing

```bash
cd backend
npm test                 # unit tests (no external services required)
npm run test:integration # full API + realtime gateway tests (needs Postgres + Redis running)
```

See [`docs/TESTING.md`](docs/TESTING.md) for what's covered at each layer, including a test that opens a real WebSocket connection and asserts an event fired by one REST call is delivered to a subscribed client.

## Deployment shape

Four independently-scalable processes, all stateless except Postgres/Redis:

- **api** — REST + WebSocket gateway (can run as N replicas behind a load balancer with sticky-free WS routing, since room state is coordinated through Redis, not in-process)
- **worker** — notification delivery, scales independently of request volume
- **postgres** / **redis** — managed services in production (RDS/Cloud SQL, ElastiCache/Memorystore)
- **web** — Next.js, deployable to any Node host or as static+edge functions

Environment-based config throughout (see `.env.example` in both `backend/` and `frontend/`); no secrets committed.
