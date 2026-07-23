import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/errorHandler";
import { prisma } from "../../lib/prisma";

export const searchRouter = Router();
searchRouter.use(requireAuth);

const searchSchema = z.object({ q: z.string().min(1).max(200) });

/**
 * Global search using Postgres full-text search (to_tsvector/plainto_tsquery)
 * rather than a separate search cluster: for the data volumes a workspace
 * tool like this handles, Postgres FTS with proper GIN indexes (see the
 * migration in prisma/migrations) is plenty fast and avoids running and
 * keeping a second system in sync. The query shape is deliberately written
 * so swapping in an Elasticsearch-compatible client later only touches this
 * file — callers get back the same { type, id, title, snippet } shape either way.
 */
searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = searchSchema.parse(req.query);
    const orgIds = (
      await prisma.membership.findMany({ where: { userId: req.user!.sub }, select: { organizationId: true } })
    ).map((m) => m.organizationId);

    if (orgIds.length === 0) return res.json({ results: [] });

    const [projects, tasks, documents, users] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM "Project"
        WHERE "organizationId" = ANY(${orgIds})
          AND to_tsvector('english', name || ' ' || coalesce(description, '')) @@ plainto_tsquery('english', ${q})
        LIMIT 10`,
      prisma.$queryRaw<Array<{ id: string; title: string }>>`
        SELECT t.id, t.title FROM "Task" t
        JOIN "Project" p ON p.id = t."projectId"
        WHERE p."organizationId" = ANY(${orgIds})
          AND to_tsvector('english', t.title || ' ' || coalesce(t.description, '')) @@ plainto_tsquery('english', ${q})
        LIMIT 10`,
      prisma.$queryRaw<Array<{ id: string; title: string }>>`
        SELECT d.id, d.title FROM "Document" d
        JOIN "Project" p ON p.id = d."projectId"
        WHERE p."organizationId" = ANY(${orgIds})
          AND to_tsvector('english', d.title) @@ plainto_tsquery('english', ${q})
        LIMIT 10`,
      prisma.user.findMany({
        where: { memberships: { some: { organizationId: { in: orgIds } } }, name: { contains: q, mode: "insensitive" } },
        select: { id: true, name: true, email: true },
        take: 10,
      }),
    ]);

    res.json({
      results: [
        ...projects.map((p) => ({ type: "project", id: p.id, title: p.name })),
        ...tasks.map((t) => ({ type: "task", id: t.id, title: t.title })),
        ...documents.map((d) => ({ type: "document", id: d.id, title: d.title })),
        ...users.map((u) => ({ type: "user", id: u.id, title: u.name, subtitle: u.email })),
      ],
    });
  }),
);
