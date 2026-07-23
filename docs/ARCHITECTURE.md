# Architecture

## System overview

```
                              ┌───────────────────────────┐
                              │   Next.js 15 (App Router)  │
                              │  TanStack Query · Zustand  │
                              └──────────────┬─────────────┘
                          REST (HTTPS, cookies)  │  WebSocket (WSS)
                     ┌──────────────────────────┴──────────────────────────┐
                     ▼                                                      ▼
           ┌───────────────────┐                                ┌────────────────────┐
           │   Express API      │                                │  WS Gateway (/ws)   │
           │  auth · rbac ·     │                                │  handshake auth ·   │
           │  rate limit ·      │                                │  room subscriptions │
           │  validation        │                                │  presence · heartbeat│
           └─────────┬──────────┘                                └──────────┬──────────┘
                     │                                                       │
        ┌────────────┼───────────────────────────────────────────────────────┤
        ▼            ▼                                                       ▼
 ┌─────────────┐ ┌────────────┐                                   ┌──────────────────────┐
 │ Domain       │ │ BullMQ      │◄─────────── enqueue ─────────────┤  Event Bus             │
 │ modules      │ │ workers     │                                   │  (Redis Pub/Sub)       │
 │ (auth, orgs, │ └─────┬──────┘                                   └───────────┬────────────┘
 │  projects,   │       │ persist + push                                       │ fan-out
 │  tasks,      │       ▼                                                      ▼
 │  documents…) │  ┌──────────┐                                     every gateway process's
 └──────┬───────┘  │ Postgres  │                                     locally-subscribed sockets
        │          │ (audit,   │
        ▼          │ notifs)   │
 ┌─────────────┐   └──────────┘
 │ PostgreSQL   │
 │ (Prisma ORM) │        ┌──────────┐
 └─────────────┘        │  Redis    │  cache · presence · rate-limit buckets ·
                          │           │  soft document locks · pub/sub · BullMQ
                          └──────────┘
```

## Why this shape

**The WebSocket gateway is a separate concern from the REST API, connected only through Redis.** A client authenticates once at handshake (JWT from the `access_token` cookie or a `?token=` query param), and from then on the gateway just relays room-scoped frames. Any process — an API instance handling a POST, a background worker, or another gateway node — publishes an event to a single Redis channel; every gateway node fans it out to whichever local sockets are subscribed to that room. This is what lets the API and the gateway scale independently: add API replicas for request throughput, add gateway replicas for concurrent connections, and neither needs to know how many of the other exist. A client can also be routed to any gateway node behind the load balancer without losing events, because room membership isn't pinned to a single process.

**Authorization happens once, at subscribe-time, not per-event.** When a client sends `{"type":"subscribe","roomId":"project:123"}`, the gateway resolves the project's owning organization and checks the caller's membership exactly once. After that, every event broadcast to that room is trusted to be visible to that connection — we don't re-check permissions on every single frame, which would be both slower and redundant (a user's access to a project org doesn't change frame-to-frame).

**Rooms map directly to the entities they represent** — `org:{id}`, `project:{id}`, `document:{id}`, `user:{id}` (the last one for personal notification delivery). This keeps the room graph legible: there's no separate "channel" concept to reason about independently of the domain model.

## Realtime event architecture

Every event on the bus is a versioned envelope:

```ts
interface RealtimeEvent<T> {
  v: 1;              // schema version — lets the client detect and handle breaking changes
  type: string;       // "task.updated" | "document.updated" | "presence.changed" | ...
  roomId: string;      // "project:123"
  actorId: string;      // who caused it (or "system" for worker-originated events)
  payload: T;
  ts: string;           // ISO timestamp
}
```

Event types currently in use: `task.created` / `task.updated` / `task.deleted`, `project.created` / `project.updated`, `document.updated` / `document.locked` / `document.unlocked`, `presence.changed`, `typing.changed`, `notification.created`.

**Connection lifecycle:**
1. Client opens `wss://.../ws?token=<access_token>`.
2. Gateway verifies the JWT; on failure, closes with code `4001` immediately (no anonymous connections are ever accepted).
3. Gateway records a `WebSocketConnection` row (which node holds it) and marks the user online in Redis.
4. Client sends `subscribe` messages for the rooms the current view needs.
5. Server pings every connection every 30s; a connection that doesn't `pong` within one interval is terminated — this is what surfaces a dead mobile connection instead of leaving a phantom subscription.
6. On disconnect, the gateway checks whether the user has any other live connections (e.g., a second tab) before marking them fully offline — closing one tab shouldn't broadcast "offline" if another tab is still open.

**Reconnection** is the client's responsibility: the frontend's `RealtimeClient` (`frontend/src/lib/ws.ts`) reconnects with exponential backoff (500ms → 15s cap) and replays every room subscription that was active before the drop, so a flaky connection is invisible to the UI beyond a brief gap — no manual "click to reconnect."

## Optimistic updates & conflict handling

Two different strategies are used deliberately, because tasks and documents have different collision profiles:

- **Tasks (kanban)** — last-write-wins with a live broadcast. Card moves are frequent, low-stakes, and rarely truly concurrent on the *same* card; a client applies the move locally, sends the PATCH, and the `task.updated` broadcast reconciles every other viewer. If two people drag the same card in the same second, latest write simply wins — an acceptable tradeoff for kanban ordering.
- **Documents** — optimistic-with-explicit-conflict. The client sends the `updatedAt` it last saw; if the row has moved on server-side, the request is rejected with `409` and the current server state, rather than silently overwriting a concurrent edit. Combined with the soft edit lock (below), true collisions are rare and always surfaced rather than swallowed.

**Document locking** uses a short-TTL Redis key (`SET NX EX`) rather than a hard database lock. An editor "holds" the lock only as long as they keep renewing it (every 20s while the editor is open); if their tab crashes or the network drops, the lock simply expires within 60 seconds instead of requiring manual recovery. This trades strict mutual exclusion for availability — a stale lock blocking every collaborator indefinitely is a worse failure mode than an occasional two-writer race, which the `updatedAt` conflict check catches anyway.

## Scaling story

- **API**: stateless, horizontally scalable behind a load balancer.
- **WS gateway**: stateless *across* processes (in-memory room index is per-process, but coordination happens through Redis), so it scales the same way — add nodes, no sticky sessions required for correctness, only for connection-level stickiness which any standard L4/L7 LB handles.
- **Workers**: scale independently based on notification queue depth (BullMQ concurrency + replica count).
- **Postgres**: read scaling via replicas is straightforward since the domain modules are already organized around clear aggregate boundaries (org → project → task/document); write scaling is out of scope at this stage but the schema avoids anything that would block sharding by `organizationId` later.
- **Redis**: presence/cache/pub-sub/queues currently share one Redis instance for local-dev simplicity; in production these are typically split (a dedicated pub/sub-tier Redis vs. a queue-tier Redis) since they have different latency/persistence requirements — the code already isolates them behind `lib/redis.ts` and a dedicated BullMQ connection, so splitting is a config change, not a refactor.
