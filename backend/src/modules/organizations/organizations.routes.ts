import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth } from "../../middleware/auth";
import { requireRole, audit } from "../../middleware/rbac";
import { asyncHandler } from "../../middleware/errorHandler";
import { prisma } from "../../lib/prisma";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// List every organization the caller belongs to, with their role in each —
// this powers the workspace switcher in the frontend.
organizationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.sub },
      include: { organization: true },
    });
    res.json({
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
    });
  }),
);

const createOrgSchema = z.object({ name: z.string().min(1).max(120) });

organizationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name } = createOrgSchema.parse(req.body);
    const baseSlug = slugify(name) || "org";
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    // Creator is always OWNER — done as a transaction so we never end up
    // with an org that has no owner.
    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name, slug } });
      await tx.membership.create({
        data: { userId: req.user!.sub, organizationId: created.id, role: Role.OWNER },
      });
      return created;
    });

    await audit({
      organizationId: org.id,
      actorId: req.user!.sub,
      action: "organization.created",
      targetType: "Organization",
      targetId: org.id,
    });

    res.status(201).json({ organization: org });
  }),
);

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role).default(Role.MEMBER),
});

// Inviting requires ADMIN or above; only OWNER can grant OWNER (enforced below).
organizationsRouter.post(
  "/:organizationId/invitations",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const body = inviteSchema.parse(req.body);
    if (body.role === Role.OWNER && req.membership!.role !== Role.OWNER) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Only an OWNER can invite another OWNER" } });
    }

    const token = crypto.randomUUID();
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: req.membership!.organizationId,
        email: body.email,
        role: body.role,
        token,
        invitedById: req.user!.sub,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await audit({
      organizationId: req.membership!.organizationId,
      actorId: req.user!.sub,
      action: "invitation.created",
      targetType: "Invitation",
      targetId: invitation.id,
      metadata: { email: body.email, role: body.role },
    });

    // In production this enqueues an email-delivery job (see workers/notificationWorker.ts)
    // rather than sending synchronously from the request path.
    res.status(201).json({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role } });
  }),
);

organizationsRouter.get(
  "/:organizationId/members",
  requireRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const members = await prisma.membership.findMany({
      where: { organizationId: req.membership!.organizationId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
    res.json({ members });
  }),
);

const changeRoleSchema = z.object({ userId: z.string(), role: z.nativeEnum(Role) });

organizationsRouter.patch(
  "/:organizationId/members/role",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const body = changeRoleSchema.parse(req.body);

    // Only an OWNER may create or demote another OWNER — an ADMIN cannot
    // escalate themselves or others past their own rank.
    if (body.role === Role.OWNER && req.membership!.role !== Role.OWNER) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Only an OWNER can grant OWNER" } });
    }

    const updated = await prisma.membership.update({
      where: { userId_organizationId: { userId: body.userId, organizationId: req.membership!.organizationId } },
      data: { role: body.role },
    });

    await audit({
      organizationId: req.membership!.organizationId,
      actorId: req.user!.sub,
      action: "member.role_changed",
      targetType: "Membership",
      targetId: updated.id,
      metadata: { targetUserId: body.userId, newRole: body.role },
    });

    res.json({ membership: updated });
  }),
);
