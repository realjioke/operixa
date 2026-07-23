import pino from "pino";
import { env } from "../config/env";

// Structured JSON logs in production; pretty-printed in development.
// Every request-scoped log line is expected to carry a `requestId` field
// (attached by middleware/requestId.ts) so logs can be correlated across
// the API, workers, and the websocket gateway.
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
  base: { service: "syncforge-api" },
});
