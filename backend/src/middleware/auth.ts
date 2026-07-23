import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

/**
 * Populates req.user from either:
 *  - the `access_token` httpOnly cookie (browser clients), or
 *  - an `Authorization: Bearer <token>` header (service-to-service / tests)
 * Rejects with 401 if neither is present or the token is invalid/expired.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const token = req.cookies?.access_token ?? bearer;

  if (!token) {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Missing access token" } });
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: { code: "TOKEN_INVALID", message: "Access token is invalid or expired" } });
  }
}
