import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth } from "../../middleware/auth";
import { assertRole } from "../../middleware/rbac";
import { asyncHandler, ApiError } from "../../middleware/errorHandler";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/storage";

export const filesRouter = Router();
filesRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const uploadMetaSchema = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
});

filesRouter.post(
  "/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "BAD_REQUEST", "No file provided");
    const body = uploadMetaSchema.parse(req.body);
    if (!body.projectId && !body.taskId) {
      throw new ApiError(400, "BAD_REQUEST", "projectId or taskId is required");
    }

    const projectId =
      body.projectId ?? (await prisma.task.findUniqueOrThrow({ where: { id: body.taskId! } })).projectId;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await assertRole(req.user!.sub, project.organizationId, Role.MEMBER);

    const storageKey = await storage.put(req.file.buffer, req.file.originalname);
    const file = await prisma.file.create({
      data: {
        projectId: body.projectId,
        taskId: body.taskId,
        uploaderId: req.user!.sub,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storageKey,
      },
    });

    res.status(201).json({ file: { ...file, url: storage.url(storageKey) } });
  }),
);

filesRouter.get(
  "/project/:projectId",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: req.params.projectId } });
    await assertRole(req.user!.sub, project.organizationId, Role.VIEWER);

    const files = await prisma.file.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: "desc" } });
    res.json({ files: files.map((f) => ({ ...f, url: storage.url(f.storageKey) })) });
  }),
);
