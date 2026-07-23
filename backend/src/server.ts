import http from "http";
import path from "path";
import express from "express";
import { createApp } from "./app";
import { attachRealtimeGateway } from "./realtime/gateway";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis, redisPub, redisSub } from "./lib/redis";

const app = createApp();

// Serve uploaded files in development. In production this route doesn't
// exist — the storage adapter would return signed cloud-storage URLs instead.
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

const server = http.createServer(app);

// The websocket gateway shares the same HTTP server/port as the REST API
// (upgrading on path /ws) rather than running as a separate listener —
// simpler to deploy behind a single load balancer target in this scale of
// system, while still being logically a distinct subsystem (see realtime/gateway.ts).
attachRealtimeGateway(server);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "SyncForge API listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit(), redisPub.quit(), redisSub.quit()]);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
