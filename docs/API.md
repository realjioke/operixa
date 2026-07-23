# API Documentation

Base URL: `http://localhost:4000/api` (local dev). All endpoints except `/auth/register`, `/auth/login`, and `/auth/refresh` require authentication via the `access_token` httpOnly cookie or an `Authorization: Bearer <token>` header.

Every response follows one shape on success (`{ ...resourceKey: data }`) and one on error:

```json
{ "error": { "code": "FORBIDDEN", "message": "Requires role >= MEMBER in this organization" } }
```

## Auth — `/api/auth`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | — | `{ email, password, name }` → `201 { accessToken }`, sets `access_token` + `refresh_token` cookies. Rate limited (20/15min). |
| POST | `/login` | — | `{ email, password }` → `200 { accessToken }`. Same rate limit. |
| POST | `/refresh` | refresh cookie | Rotates the refresh token (old one is revoked); reuse of a revoked token returns `401` — signals possible theft. |
| POST | `/logout` | — | Revokes the current refresh token, clears cookies. |
| GET | `/me` | required | Current user profile. |
| GET | `/oauth/:provider/callback` | — | Stubbed (`501`) — see `ENGINEERING_DECISIONS.md` for what wiring a real provider involves. |

## Organizations — `/api/organizations`

| Method | Path | Min role | Notes |
|---|---|---|---|
| GET | `/` | any (own memberships) | Every org the caller belongs to, with their role in each. |
| POST | `/` | — (creator becomes OWNER) | `{ name }` → creates org + OWNER membership atomically. |
| POST | `/:organizationId/invitations` | ADMIN | `{ email, role }`. Only an OWNER can invite another OWNER. |
| GET | `/:organizationId/members` | VIEWER | List members + roles. |
| PATCH | `/:organizationId/members/role` | ADMIN | `{ userId, role }`. Only an OWNER can grant OWNER. |

## Projects — `/api/projects`

| Method | Path | Min role |
|---|---|---|
| POST | `/` | MEMBER — `{ organizationId, name, description?, deadline? }` |
| GET | `/organization/:organizationId` | VIEWER |
| PATCH | `/:projectId` | MEMBER — `{ name?, description?, status?, deadline? }` |

## Tasks — `/api/tasks`

| Method | Path | Min role |
|---|---|---|
| POST | `/` | MEMBER — `{ projectId, title, description?, priority?, assigneeId?, dueDate? }`. Broadcasts `task.created`. |
| GET | `/project/:projectId` | VIEWER |
| PATCH | `/:taskId` | MEMBER — any subset of `{ title, description, status, priority, assigneeId, dueDate, position }`. Broadcasts `task.updated`. |
| DELETE | `/:taskId` | MEMBER — broadcasts `task.deleted`. |

`position` is a float; the client computes the midpoint between the two neighboring cards' positions to reorder without touching other rows (see `DATABASE_ERD.md`).

## Documents — `/api/documents`

| Method | Path | Min role | Notes |
|---|---|---|---|
| POST | `/` | MEMBER | `{ projectId, title, content? }` |
| GET | `/project/:projectId` | VIEWER | List documents in a project. |
| GET | `/:documentId` | VIEWER | |
| PUT | `/:documentId` | MEMBER | `{ content, expectedUpdatedAt, versionNote? }`. Returns `409 { current }` if `expectedUpdatedAt` doesn't match the server's current value. On success, snapshots the *previous* content as a new `DocumentVersion` and broadcasts `document.updated`. |
| POST | `/:documentId/lock` | MEMBER | Acquires/renews a 60s soft edit lock. `409` if held by someone else. |
| POST | `/:documentId/unlock` | MEMBER | Releases the lock if the caller holds it. |
| GET | `/:documentId/versions` | VIEWER | Full version history, newest first. |
| POST | `/:documentId/versions/:versionId/restore` | MEMBER | Restores a version (snapshotting current state first). |

## Notifications — `/api/notifications`

| Method | Path |
|---|---|
| GET | `/` — last 50, newest first |
| POST | `/:id/read` |
| POST | `/read-all` |

## Search — `/api/search`

`GET /?q=<query>` — returns `{ results: [{ type, id, title, subtitle? }] }` across projects, tasks, documents, and users, scoped to organizations the caller belongs to.

## Files — `/api/files`

| Method | Path | Notes |
|---|---|---|
| POST | `/upload` | `multipart/form-data`, field `file` (25MB max) + `projectId` or `taskId`. Returns `{ file: { ...metadata, url } }`. |
| GET | `/project/:projectId` | List files attached to a project. |

---

## WebSocket API — `/ws`

Connect: `wss://<host>/ws?token=<access_token>` (or rely on the `access_token` cookie if connecting from a browser same-origin). Connections with no valid token are closed immediately with code `4001`.

**Client → server messages:**

```ts
{ type: "subscribe", roomId: string }     // e.g. "project:abc123"
{ type: "unsubscribe", roomId: string }
{ type: "typing", roomId: string, isTyping: boolean }
```

**Server → client (every message is a `RealtimeEvent`):**

```ts
{
  v: 1,
  type: string,       // "task.updated", "document.updated", "presence.changed", "typing.changed",
                        // "task.created", "task.deleted", "project.created", "project.updated",
                        // "document.locked", "document.unlocked", "notification.created"
  roomId: string,
  actorId: string,
  payload: unknown,
  ts: string           // ISO 8601
}
```

**Room naming:** `org:{organizationId}`, `project:{projectId}`, `document:{documentId}`, `user:{userId}` (personal — only that user may subscribe; used for notification push). Subscribing to any room is authorized server-side against the caller's current organization membership at the moment of the subscribe call — see `ARCHITECTURE.md`.
