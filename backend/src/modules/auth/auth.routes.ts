import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { asyncHandler } from "../../middleware/errorHandler";
import { authRateLimit } from "../../middleware/rateLimit";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { loginUser, registerUser, rotateRefreshToken, revokeRefreshToken } from "./auth.service";

export const authRouter = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
};

function setSessionCookies(res: import("express").Response, accessToken: string, refreshToken: string, expiresAt: Date) {
  res.cookie("access_token", accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
  res.cookie("refresh_token", refreshToken, { ...COOKIE_OPTS, expires: expiresAt });
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(120),
});

authRouter.post(
  "/register",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const { accessToken, refreshToken, expiresAt } = await registerUser(body);
    setSessionCookies(res, accessToken, refreshToken, expiresAt);
    res.status(201).json({ accessToken });
  }),
);

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  "/login",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const { accessToken, refreshToken, expiresAt } = await loginUser({
      ...body,
      userAgent: req.header("user-agent"),
      ip: req.ip,
    });
    setSessionCookies(res, accessToken, refreshToken, expiresAt);
    res.json({ accessToken });
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (!token) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "No refresh token" } });

    const { accessToken, refreshToken, expiresAt } = await rotateRefreshToken(token);
    setSessionCookies(res, accessToken, refreshToken, expiresAt);
    res.json({ accessToken });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (token) await revokeRefreshToken(token);
    res.clearCookie("access_token", COOKIE_OPTS);
    res.clearCookie("refresh_token", COOKIE_OPTS);
    res.status(204).send();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.sub },
      select: { id: true, email: true, name: true, avatarUrl: true, createdAt: true },
    });
    res.json({ user });
  }),
);

// OAuth is implemented as a provider-agnostic callback: in production this
// exchanges `code` with the provider, resolves/creates the OAuthAccount +
// User, then issues a session exactly like password login. Wiring a real
// provider just means filling in `exchangeCodeForProfile` below.
authRouter.get(
  "/oauth/:provider/callback",
  asyncHandler(async (req, res) => {
    res.status(501).json({
      error: {
        code: "NOT_CONFIGURED",
        message: `OAuth provider '${req.params.provider}' has no client credentials configured in this environment`,
      },
    });
  }),
);
