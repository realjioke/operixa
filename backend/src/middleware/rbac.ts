import { NextFunction, Request, Response } from "express";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "./errorHandler";

// Role hierarchy — higher number = more privilege. OWNER implicitly has
// every permission ADMIN has, and so on down the chain.
const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      membership?: { organizationId: string; role: Role };
    }
  }
}

/**
 * Loads the caller's membership for the org referenced by :organizationId
 * (or req.body.organizationId as a fallback) and enforces a minimum role.
 * Attaches the resolved membership to req.membership for downstream
 * handlers, so a single DB round-trip covers both authorization and
 * context-loading.
 */
export function requireRole(minRole: Role) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    }

    const organizationId = req.params.organizationId ?? req.body.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "organizationId is required" } });
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user.sub, organizationId } },
    });

    if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: `Requires role >= ${minRole} in this organization` },
      });
    }

    req.membership = { organizationId, role: membership.role };
    next();
  };
}

/**
 * Non-middleware variant for handlers that resolve the organizationId
 * indirectly (e.g. a task's org via its project) after loading the target
 * row, where the URL itself only carries a projectId/taskId. Throws
 * ApiError so it plugs straight into asyncHandler's catch chain.
 */
export async function assertRole(userId: string, organizationId: string, minRole: Role) {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new ApiError(403, "FORBIDDEN", `Requires role >= ${minRole} in this organization`);
  }
  return membership;
}

/** Records a permission-relevant action for the audit trail. Never throws. */
export async function audit(params: {
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.auditLog.create({ data: params });
  } catch (err) {
    // Auditing must never break the primary request flow.
    // eslint-disable-next-line no-console
    console.error("audit log write failed", err);
  }
}
