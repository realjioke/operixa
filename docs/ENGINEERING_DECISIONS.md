# Engineering Decisions

This document is the "why," aimed at the questions an interviewer would actually ask. Each section states the decision, the alternative that was considered, and why it lost.

## Why Redis Pub/Sub instead of, say, a single in-process EventEmitter?

An in-process event emitter only reaches sockets held by the *same* process. The moment the WS gateway runs as more than one replica — which it needs to, to handle more concurrent connections than one process can hold — a user on gateway node A would never see an update caused by a request that happened to land on API node B, or caused by a user connected to gateway node C. Redis Pub/Sub is the cheapest way to get a shared broadcast bus across processes without introducing a heavier message broker (Kafka, RabbitMQ) that this system's throughput doesn't remotely justify. The tradeoff: Pub/Sub is fire-and-forget — a message published while a subscriber is momentarily disconnected is lost. That's an acceptable loss for presence/typing/board-update events (the client reconciles via its next REST fetch or reconnect), but it's specifically *why* document saves aren't trusted to Pub/Sub alone — the source of truth is always the database row, and the event is a "go check" notification, not the payload of record for anything durable.

## Why BullMQ for notifications instead of writing the row and sending email directly in the request handler?

Two reasons. First, latency: email delivery (or push notification delivery) is slow and occasionally flaky, and nothing about "assign someone a task" should block on a third-party mail API responding. Second, retries: a queue gives at-least-once delivery with backoff for free; a synchronous `await sendEmail()` in a request handler gives you exactly one attempt, and if it fails, the notification is silently gone unless you build retry logic yourself. The cost is operational — a worker process to run and monitor — which is a reasonable price for a system that's explicitly meant to demonstrate production patterns.

## Why a Redis soft lock for documents instead of a hard database lock (or nothing at all)?

A hard lock (a `lockedById` column checked and enforced at the DB level) fails badly: if the lock holder's browser tab crashes, the document is stuck locked until someone manually intervenes. A TTL-based Redis lock (`SET key value NX EX 60`, renewed every 20s by an active editor) degrades gracefully — an abandoned lock expires within a minute on its own. The tradeoff is that it's not a *strict* mutual exclusion guarantee (a network partition could theoretically let two clients both believe they hold the lock briefly), which is why the document save endpoint *also* does optimistic-concurrency checking via `expectedUpdatedAt` — the lock is a UX nicety that prevents most collisions from happening in the first place; the version check is the actual correctness guarantee that catches the rest.

## Why plain JSON content for documents instead of building real CRDT-based collaborative editing (like Y.js)?

Character-level concurrent editing (what Google Docs actually does) requires either Operational Transform or a CRDT library, and building that correctly is a multi-week project on its own — it's a different problem from "build a collaborative workspace platform" and would have consumed the entire engineering budget here on one feature. The chosen design (block-level content, optimistic save with conflict detection, soft locking to make true collisions rare) is honest about that scope boundary rather than faking real-time character sync with something that would break under concurrent typing. If deeper collaborative editing were the next milestone, the schema already isolates the seam: `Document.content` is opaque JSON specifically so the client-side data model can be swapped for CRDT state without a migration.

## Why fractional-index positions for kanban ordering instead of integer positions?

Integer positions (`1, 2, 3, ...`) require rewriting every row after the insertion point on a reorder — an O(n) write for what the user experiences as a single drag. Fractional positions (insert at the midpoint between two neighbors) make a reorder an O(1) write to just the moved row. The known failure mode — repeatedly inserting in the same tiny gap can eventually exhaust float precision — is real but rare in practice for a kanban column's realistic size, and the fix (a background job that renumbers a column) is a small, isolated addition rather than a design change, so it was left as a documented limitation rather than pre-built.

## Why role checks resolved fresh per-request instead of embedding roles/permissions in the JWT?

Putting `role: "ADMIN"` in the access token is tempting because it avoids a database round-trip on every request. It's also how you end up serving requests with a stale permission for up to the token's TTL after someone's access is revoked or downgraded — an admin removed from an org would still be able to act as one until their 15-minute access token expires. Given this is a workspace tool where permission changes need to take effect promptly (someone leaving a company, an accidental over-grant being corrected), the DB round-trip per authorized request was the right tradeoff. It's also just one indexed lookup (`Membership` is indexed on `(organizationId, role)`), not a meaningfully expensive query.

## Why the OAuth endpoint is a stub instead of wired to a real provider

Wiring a real OAuth provider (Google, GitHub) requires registering an app with that provider and holding real client credentials, which don't belong in a portfolio repo regardless of how the code is structured. The `OAuthAccount` table, the `/oauth/:provider/callback` route, and the "exchange code → resolve or create user → issue a session exactly like password login" flow are all in place; the only missing piece is the provider-specific token exchange call, which is intentionally the one piece that can't be meaningfully demonstrated without live credentials.

## Why Postgres full-text search instead of standing up Elasticsearch

At the scale a single workspace tool like this operates at, Postgres FTS with GIN indexes handles ranked text search perfectly well, and running it means one fewer stateful system to operate, back up, and keep in sync with the source of truth (no separate indexing pipeline that can drift). The search module's response shape (`{ type, id, title, subtitle? }`) is deliberately provider-agnostic — if a future scale requirement genuinely needed a dedicated search cluster, that's a change contained entirely to `modules/search/search.routes.ts`, not a change to any caller.
