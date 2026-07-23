import { Router } from "express";
import { z } from "zod";
import { ProjectStatus, Role } from "@prisma/client";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { asyncHandler } from "../../middleware/errorHandler";
import { prisma } from "../../lib/prisma";
import { publishEvent } from "../../realtime/eventBus";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const createProjectSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  deadline: z.coerce.date().optional(),
});

projectsRouter.post(
  "/",
  requireRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const body = createProjectSchema.parse(req.body);
    const project = await prisma.project.create({ data: body });
    await publishEvent({
      type: "project.created",
      roomId: `org:${body.organizationId}`,
      actorId: req.user!.sub,
      payload: project,
    });
    res.status(201).json({ project });
  }),
);

projectsRouter.get(
  "/organization/:organizationId",
  requireRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: { organizationId: req.membership!.organizationId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ projects });
  }),
);

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  deadline: z.coerce.date().nullable().optional(),
});

projectsRouter.patch(
  "/:projectId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.project.findUniqueOrThrow({ where: { id: req.params.projectId } });
    req.body.organizationId = existing.organizationId;
    await requireRole(Role.MEMBER)(req, res, async () => {
      const body = updateProjectSchema.parse(req.body);
      const project = await prisma.project.update({ where: { id: existing.id }, data: body });
      await publishEvent({
        type: "project.updated",
        roomId: `org:${existing.organizationId}`,
        actorId: req.user!.sub,
        payload: project,
      });
      res.json({ project });
    });
  }),
);
