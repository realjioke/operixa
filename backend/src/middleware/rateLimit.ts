import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../lib/redis";

// Shared Redis-backed store means the limit holds even when the API runs as
// multiple instances behind a load balancer, not just per-process.
function store(prefix: string) {
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis.call(...(args as [string, ...string[]])) as Promise<any>,
  });
}

// Tight limit on auth endpoints to blunt credential-stuffing / brute force.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: store("auth"),
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts, try again later" } },
});

// Looser general-purpose limit for the rest of the API.
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: store("api"),
  message: { error: { code: "RATE_LIMITED", message: "Too many requests" } },
});
