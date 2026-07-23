import Redis from "ioredis";
import { env } from "../config/env";

// ioredis connections in subscriber mode can't issue other commands, so we
// keep three separate connections: general cache/presence ops, a dedicated
// publisher, and a dedicated subscriber for the realtime event bus.
export const redis = new Redis(env.REDIS_URL);
export const redisPub = new Redis(env.REDIS_URL);
export const redisSub = new Redis(env.REDIS_URL);

export const REDIS_KEYS = {
  presence: (userId: string) => `presence:${userId}`,
  orgOnlineSet: (orgId: string) => `org:${orgId}:online`,
  rateLimit: (bucket: string, key: string) => `ratelimit:${bucket}:${key}`,
  docLock: (docId: string) => `doclock:${docId}`,
};
