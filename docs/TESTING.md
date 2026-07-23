# Testing Strategy

Three layers, each answering a different question, run separately so a slow or infra-dependent layer never blocks fast feedback on the others.

## Unit tests — `backend/tests/unit/`

**Question:** does this piece of logic do the right thing in isolation? No database, no Redis — external dependencies are mocked.

- `auth.test.ts` — JWT signing/verification round-trips correctly, rejects tampered and empty tokens.
- `rbac.test.ts` — the role-hierarchy check (`assertRole`) allows/denies correctly across every boundary case: exact match, above minimum, below minimum, no membership at all. Prisma is mocked so this runs in milliseconds with no infra.
- `eventBus.test.ts` — `publishEvent` produces the correct versioned envelope shape and publishes it on the expected Redis channel. `ioredis` is mocked at the module level.

Run: `npm test` (no external services required — this is what should run on every save during development).

## Integration tests — `backend/tests/integration/`

**Question:** does a real request through the real Express app, against a real Postgres + Redis, produce the right result end-to-end? These exercise the actual middleware chain, Prisma queries, and cross-request state (like refresh token rotation).

- `auth.integration.test.ts` — full register → duplicate-email rejection → login (wrong then right password) → `/me` with a bearer token → `/me` with no token → refresh rotation → **replay of a revoked refresh token is rejected**, proving the theft-detection behavior actually works against the database, not just in the mental model.
- `tasks.integration.test.ts` — creates two real users and an org, assigns one `VIEWER`, and asserts: a `MEMBER`-or-above can create a task, a `VIEWER` is blocked from creating one but can still read the board, and a user with **no membership at all** in the org is blocked entirely. This is the RBAC middleware tested against a real membership row instead of a mock.
- `realtime.integration.test.ts` — see below.

Run: `npm run test:integration` — requires `DATABASE_URL`/`REDIS_URL` pointing at real instances (the same ones `docker compose up postgres redis` provides; CI spins up service containers for this).

## Realtime event testing

This is the test worth calling out specifically, because "the websocket layer works" is easy to assert and easy to get wrong by testing the wrong thing.

`realtime.integration.test.ts` starts an actual `http.Server` with the real gateway attached (`attachRealtimeGateway`), opens genuine `ws` client connections against it, and:

1. Confirms a connection with **no token is closed with code `4001`** — the handshake auth actually runs, not just the route existing.
2. Opens a socket, subscribes it to `project:{id}`, then fires a real `POST /api/tasks` over HTTP against the same server, and asserts the **exact `task.created` event** (room, type, schema version, payload) arrives on the socket — proving the full path (REST handler → `publishEvent` → Redis → gateway fan-out → client frame) works, not just that Redis received a publish call.
3. Opens a second socket that **never subscribes** to the room and asserts it receives nothing after the same task-creation call — proving room-scoped isolation, not just that broadcast works when everyone's listening.

This is deliberately black-box: the test never reaches into gateway internals (the in-memory room index, the Redis subscriber) — it only observes what a real client would see, which is what actually matters for correctness.

## What's not covered (honestly)

- **Frontend tests** — the frontend has a `vitest` script wired up but component/hook tests aren't included in this pass; the highest-value additions would be the `RealtimeClient` reconnect/backoff logic and the kanban board's optimistic-update-then-reconcile behavior, both of which are pure enough to unit test without a browser.
- **Load/soak testing** of the WebSocket gateway under many concurrent connections — the architecture is designed for horizontal scale (see `ARCHITECTURE.md`) but that claim isn't backed by a load test in this repo.
- **End-to-end (browser) tests** (Playwright/Cypress) covering full user flows through the actual UI — the integration tests cover the API/realtime contract the frontend depends on, but nothing drives the frontend itself in CI yet.

## CI

`.github/workflows/ci.yml` runs on every push/PR: backend lint (`tsc --noEmit`) → unit tests → integration tests against real Postgres/Redis service containers → build, then the same for the frontend, then a final job verifies all three Docker images (`api`, `worker`, `web`) actually build. A red integration-test run blocks merge — the realtime test in particular is treated as a first-class correctness signal, not an optional extra.
