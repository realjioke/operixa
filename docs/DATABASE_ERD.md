# Database ERD

Full schema: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma). This document covers the relationships and the reasoning behind the less obvious choices.

## Entity relationship diagram

```
 User ──< Membership >── Organization ──< Invitation
   │                          │
   │                          ├──< Project ──< Task ──< TaskLabel >── Label
   │                          │       │           │
   │                          │       │           ├──< Comment
   │                          │       │           └──< File
   │                          │       │
   │                          │       └──< Document ──< DocumentVersion
   │                          │                 │
   │                          │                 └──< Comment
   │                          │
   │                          └──< AuditLog
   │
   ├──< Session (refresh tokens)
   ├──< OAuthAccount
   ├──< Notification
   └──< WebSocketConnection
```

`>─<` denotes a many-to-many resolved through a join table (`TaskLabel`); everything else is one-to-many from the left entity.

## Key design decisions

**`Membership` is the RBAC join table**, not a `role` column on `User`. Role is scoped per-organization — the same person can be an `OWNER` of one workspace and a `VIEWER` on another — so it has to live on the relationship, not either side of it. `@@unique([userId, organizationId])` guarantees one role per person per org; `@@index([organizationId, role])` supports the common "list all admins of this org" query.

**`Task.position` is a `Float`, not an integer index.** Dragging a card between two others computes the midpoint of their positions (e.g., between `1.0` and `2.0` → `1.5`) rather than renumbering every card in the column. This keeps a drag-and-drop reorder an O(1) write instead of an O(n) one. (In the rare case of float precision exhaustion after many thousands of reorders in the same slot, a background job can renumber a column — not implemented here, noted as a known limitation.)

**`Document.content` and `DocumentVersion.content` are `Json`**, not a normalized rich-text schema. The document body is opaque to the database — this keeps swapping the client-side editor's data model (currently a simple block array; could become ProseMirror/Slate JSON, or CRDT state for true operational-transform collaboration later) from requiring a migration.

**`DocumentVersion` is append-only and never deleted.** Saving creates a new version row alongside updating `Document.content`; restoring an old version *also* creates a new version (a snapshot of what was current right before the restore) rather than deleting anything after the restore point. History is monotonic — there's no destructive "rewind," only "append the state I want to be current."

**`AuditLog` denormalizes `targetType` + `targetId` instead of a set of nullable foreign keys.** An audit trail needs to reference *any* entity type (a membership, an invitation, a task, a document) uniformly; a generic `(targetType, targetId)` pair avoids a wide table of mostly-null FK columns and keeps the audit writer (`middleware/rbac.ts#audit`) a single reusable function regardless of what changed.

**`WebSocketConnection.gatewayNode` records which process holds a given socket.** This isn't used for routing (Redis Pub/Sub handles fan-out regardless of which node a socket is on) but is essential for *operational* visibility — being able to answer "how many live connections does gateway replica 3 have" without instrumenting the process directly, and for reconciling stale rows if a node crashes without a clean disconnect (an ops job can sweep `WebSocketConnection` rows for a dead `gatewayNode` and mark them disconnected).

**Cascading deletes** are used deliberately at the aggregate-boundary level (deleting an `Organization` cascades to its `Membership`s, `Project`s, etc.; deleting a `Project` cascades to its `Task`s and `Document`s) so that removing a workspace can't leave orphaned rows, while cross-aggregate references (e.g., `Task.assigneeId → User`) are left as simple restrict-by-default foreign keys, since a user leaving an org shouldn't silently delete the tasks they were assigned.

## Indexing strategy

Every foreign key used in a hot-path `WHERE` clause has a matching index: `Membership(organizationId, role)`, `Project(organizationId, status)`, `Task(projectId, status)` (the kanban board's primary query), `Task(assigneeId)` ("my tasks" views), `DocumentVersion(documentId, createdAt)` (history, newest first), `AuditLog(organizationId, createdAt)` (audit log pagination), `Notification(userId, readAt)` (unread-count queries).

Full-text search indexes (`to_tsvector` + GIN) on `Project(name, description)`, `Task(title, description)`, and `Document(title)` back the search module — see `docs/API.md`.

## Migration strategy

Prisma Migrate with a linear migration history committed to the repo (`backend/prisma/migrations/`). `npm run prisma:migrate` (dev, interactive) generates and applies migrations locally; `npm run prisma:deploy` (CI/production) applies pending migrations non-interactively — this is what the `api` container runs on boot in `docker-compose.yml`, so a fresh environment is always schema-current without a manual step. Because every migration is a plain SQL file, they're reviewable in PRs like any other code change, and rollback is "write and apply a new forward migration" rather than relying on down-migrations, which is the safer default for a team environment.
