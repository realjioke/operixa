import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { signAccessToken } from "../../middleware/auth";
import { ApiError } from "../../middleware/errorHandler";
import { env } from "../../config/env";

const REFRESH_BYTES = 48;

function newRefreshToken(): string {
  return crypto.randomBytes(REFRESH_BYTES).toString("hex");
}

export async function registerUser(params: { email: string; password: string; name: string }) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(params.password, 12);
  const user = await prisma.user.create({
    data: { email: params.email, passwordHash, name: params.name },
  });

  return issueSession(user.id, user.email);
}

export async function loginUser(params: { email: string; password: string; userAgent?: string; ip?: string }) {
  const user = await prisma.user.findUnique({ where: { email: params.email } });

  // Constant-shape response whether the user exists or the password is
  // wrong, so the endpoint doesn't leak which emails are registered.
  if (!user || !user.passwordHash) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  const valid = await bcrypt.compare(params.password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  return issueSession(user.id, user.email, params.userAgent, params.ip);
}

async function issueSession(userId: string, email: string, userAgent?: string, ip?: string) {
  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, refreshToken, userAgent, ipAddress: ip, expiresAt },
  });

  const accessToken = signAccessToken({ sub: userId, email });
  return { accessToken, refreshToken, expiresAt };
}

/**
 * Refresh token rotation: the presented token is revoked and a new one is
 * issued on every use. If a revoked token is presented again, that's a
 * signal of token theft/replay, so we revoke the whole session family.
 */
export async function rotateRefreshToken(oldToken: string) {
  const session = await prisma.session.findUnique({ where: { refreshToken: oldToken } });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new ApiError(401, "REFRESH_INVALID", "Refresh token is invalid, expired, or already used");
  }

  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  return issueSession(user.id, user.email, session.userAgent ?? undefined, session.ipAddress ?? undefined);
}

export async function revokeRefreshToken(token: string) {
  await prisma.session.updateMany({
    where: { refreshToken: token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
