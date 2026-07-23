import { Router } from "express";
import { z } from "zod";
import { Priority, Role, TaskStatus } from "@prisma/client";
import { requireAuth } from "../../middleware/auth";
import { assertRole } from "../../middleware/rbac";
import { asyncHandler, ApiError } from "../../middleware/errorHandler";
import { prisma } from "../../lib/prisma";
import { publishEvent } from "../../realtime/eventBus";
import { enqueueNotification } from "../notifications/notifications.service";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

async function loadProjectOrgId(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  return project.organizationId;
}

const createTaskSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  assigneeId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
});

tasksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createTaskSchema.parse(req.body);
    const organizationId = await loadProjectOrgId(body.projectId);
    await assertRole(req.user!.sub, organizationId, Role.MEMBER);

    // New cards go to the top of TODO: fractional index one less than the
    // current minimum, so re-ordering never requires rewriting other rows.
    const min = await prisma.task.aggregate({
      where: { projectId: body.projectId, status: TaskStatus.TODO },
      _min: { position: true },
    });
    const position = (min._min.position ?? 1) - 1;

    const task = await prisma.task.create({ data: { ...body, position, status: TaskStatus.TODO } });

    await publishEvent({
      type: "task.created",
      roomId: `project:${body.projectId}`,
      actorId: req.user!.sub,
      payload: task,
    });

    if (body.assigneeId && body.assigneeId !== req.user!.sub) {
      await enqueueNotification({
        userId: body.assigneeId,
        type: "task.assigned",
        payload: { taskId: task.id, title: task.title },
      });
    }

    res.status(201).json({ task });
  }),
);

tasksRouter.get(
  "/project/:projectId",
  asyncHandler(async (req, res) => {
    const organizationId = await loadProjectOrgId(req.params.projectId);
    await assertRole(req.user!.sub, organizationId, Role.VIEWER);

    const tasks = await prisma.task.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { position: "asc" },
      include: { labels: { include: { label: true } }, assignee: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.json({ tasks });
  }),
);

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  // Drag-and-drop reordering: the client computes the new fractional
  // position (midpoint between neighbors) so a move never touches other rows.
  position: z.number().optional(),
});

tasksRouter.patch(
  "/:taskId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Task not found");

    const organizationId = await loadProjectOrgId(existing.projectId);
    await assertRole(req.user!.sub, organizationId, Role.MEMBER);

    const body = updateTaskSchema.parse(req.body);
    const task = await prisma.task.update({ where: { id: existing.id }, data: body });

    // This is the payload every other viewer of the board receives live —
    // optimistic local updates on the client get reconciled against it.
    await publishEvent({
      type: "task.updated",
      roomId: `project:${existing.projectId}`,
      actorId: req.user!.sub,
      payload: task,
    });

    if (body.assigneeId && body.assigneeId !== existing.assigneeId && body.assigneeId !== req.user!.sub) {
      await enqueueNotification({
        userId: body.assigneeId,
        type: "task.assigned",
        payload: { taskId: task.id, title: task.title },
      });
    }

    res.json({ task });
  }),
);

tasksRouter.delete(
  "/:taskId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Task not found");

    const organizationId = await loadProjectOrgId(existing.projectId);
    await assertRole(req.user!.sub, organizationId, Role.MEMBER);

    await prisma.task.delete({ where: { id: existing.id } });
    await publishEvent({
      type: "task.deleted",
      roomId: `project:${existing.projectId}`,
      actorId: req.user!.sub,
      payload: { id: existing.id },
    });
    res.status(204).send();
  }),
);
