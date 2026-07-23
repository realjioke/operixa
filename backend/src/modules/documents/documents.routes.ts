import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth } from "../../middleware/auth";
import { assertRole } from "../../middleware/rbac";
import { asyncHandler, ApiError } from "../../middleware/errorHandler";
import { prisma } from "../../lib/prisma";
import { redis, REDIS_KEYS } from "../../lib/redis";
import { publishEvent } from "../../realtime/eventBus";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

async function loadProjectOrgId(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  return project.organizationId;
}

const LOCK_TTL_SECONDS = 60; // renewed by the client every ~20s while actively editing

const createDocSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(300),
  content: z.unknown().default({}),
});

documentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createDocSchema.parse(req.body);
    const organizationId = await loadProjectOrgId(body.projectId);
    await assertRole(req.user!.sub, organizationId, Role.MEMBER);

    const doc = await prisma.document.create({
      data: { projectId: body.projectId, title: body.title, content: body.content as object },
    });
    res.status(201).json({ document: doc });
  }),
);

documentsRouter.get(
  "/project/:projectId",
  asyncHandler(async (req, res) => {
    const organizationId = await loadProjectOrgId(req.params.projectId);
    await assertRole(req.user!.sub, organizationId, Role.VIEWER);
    const documents = await prisma.document.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ documents });
  }),
);

documentsRouter.get(
  "/:documentId",
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
    const organizationId = await loadProjectOrgId(doc.projectId);
    await assertRole(req.user!.sub, organizationId, Role.VIEWER);
    res.json({ document: doc });
  }),
);

/**
 * Soft locking strategy: rather than a hard DB lock that can strand a
 * document if a client crashes, an editor holds a short-TTL Redis lock that
 * must be renewed while active. If it expires, the document is implicitly
 * unlocked — no manual recovery step needed. This trades strict mutual
 * exclusion for availability, which is the right tradeoff for a document
 * editor (a stale lock blocking everyone forever is worse than a rare
 * two-writer race, which optimistic-update conflict handling below catches).
 */
documentsRouter.post(
  "/:documentId/lock",
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
    const organizationId = await loadProjectOrgId(doc.projectId);
    await assertRole(req.user!.sub, organizationId, Role.MEMBER);

    const key = REDIS_KEYS.docLock(doc.id);
    const acquired = await redis.set(key, req.user!.sub, "EX", LOCK_TTL_SECONDS, "NX");

    if (!acquired) {
      const holder = await redis.get(key);
      if (holder !== req.user!.sub) {
        return res.status(409).json({ error: { code: "LOCKED", message: "Document is being edited by another user", holder } });
      }
      // Same user re-acquiring / renewing: refresh the TTL.
      await redis.expire(key, LOCK_TTL_SECONDS);
    }

    await publishEvent({
      type: "document.locked",
      roomId: `document:${doc.id}`,
      actorId: req.user!.sub,
      payload: { documentId: doc.id },
    });
    res.json({ locked: true, ttlSeconds: LOCK_TTL_SECONDS });
  }),
);

documentsRouter.post(
  "/:documentId/unlock",
  asyncHandler(async (req, res) => {
    const key = REDIS_KEYS.docLock(req.params.documentId);
    const holder = await redis.get(key);
    if (holder === req.user!.sub) {
      await redis.del(key);
      await publishEvent({
        type: "document.unlocked",
        roomId: `document:${req.params.documentId}`,
        actorId: req.user!.sub,
        payload: { documentId: req.params.documentId },
      });
    }
    res.status(204).send();
  }),
);

const updateDocSchema = z.object({
  content: z.unknown(),
  // The client sends back the updatedAt it last saw. If the row has moved
  // on since, we reject with 409 instead of silently overwriting a
  // concurrent edit — this is the conflict-handling half of the "optimistic
  // update" pattern: the client applies changes locally immediately, then
  // reconciles against this response.
  expectedUpdatedAt: z.coerce.date(),
  versionNote: z.string().max(200).optional(),
});

documentsRouter.put(
  "/:documentId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Document not found");
    const organizationId = await loadProjectOrgId(existing.projectId);
    await assertRole(req.user!.sub, organizationId, Role.MEMBER);

    const body = updateDocSchema.parse(req.body);
    if (existing.updatedAt.getTime() !== body.expectedUpdatedAt.getTime()) {
      return res.status(409).json({
        error: { code: "CONFLICT", message: "Document changed since you last loaded it" },
        current: existing,
      });
    }

    const [doc] = await prisma.$transaction([
      prisma.document.update({ where: { id: existing.id }, data: { content: body.content as object } }),
      prisma.documentVersion.create({
        data: { documentId: existing.id, content: existing.content as object, authorId: req.user!.sub, note: body.versionNote },
      }),
    ]);

    await publishEvent({
      type: "document.updated",
      roomId: `document:${existing.id}`,
      actorId: req.user!.sub,
      payload: { id: doc.id, content: doc.content, updatedAt: doc.updatedAt },
    });

    res.json({ document: doc });
  }),
);

documentsRouter.get(
  "/:documentId/versions",
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
    const organizationId = await loadProjectOrgId(doc.projectId);
    await assertRole(req.user!.sub, organizationId, Role.VIEWER);

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.json({ versions });
  }),
);

documentsRouter.post(
  "/:documentId/versions/:versionId/restore",
  asyncHandler(async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
    const organizationId = await loadProjectOrgId(doc.projectId);
    await assertRole(req.user!.sub, organizationId, Role.MEMBER);

    const version = await prisma.documentVersion.findUniqueOrThrow({ where: { id: req.params.versionId } });

    // Restoring doesn't delete history — it snapshots the *current* state
    // as a new version first, then applies the old content. So "undo the
    // restore" is always just restoring the version created a moment ago.
    const [restored] = await prisma.$transaction([
      prisma.document.update({ where: { id: doc.id }, data: { content: version.content as object } }),
      prisma.documentVersion.create({
        data: { documentId: doc.id, content: doc.content as object, authorId: req.user!.sub, note: "pre-restore snapshot" },
      }),
    ]);

    await publishEvent({
      type: "document.updated",
      roomId: `document:${doc.id}`,
      actorId: req.user!.sub,
      payload: { id: restored.id, content: restored.content, updatedAt: restored.updatedAt },
    });

    res.json({ document: restored });
  }),
);
