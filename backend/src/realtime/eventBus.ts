import { redisPub, redisSub } from "../lib/redis";
import { logger } from "../lib/logger";

export const EVENT_SCHEMA_VERSION = 1 as const;

export interface RealtimeEvent<T = unknown> {
  v: typeof EVENT_SCHEMA_VERSION;
  type: string; // e.g. "task.updated", "presence.changed", "document.version_created"
  roomId: string; // e.g. "org:123", "project:123", "document:123"
  actorId: string;
  payload: T;
  ts: string;
}

const CHANNEL = "syncforge:events";
type Handler = (event: RealtimeEvent) => void;
const handlers = new Set<Handler>();

let subscribed = false;

/**
 * Publishes an event to every gateway process via Redis Pub/Sub. This is
 * the seam that lets the API, the websocket gateway, and background workers
 * all run as independently-scaled processes: whoever holds the socket for a
 * given room hears about the change, regardless of which process caused it.
 */
export async function publishEvent<T>(event: Omit<RealtimeEvent<T>, "v" | "ts">) {
  const full: RealtimeEvent<T> = { ...event, v: EVENT_SCHEMA_VERSION, ts: new Date().toISOString() };
  await redisPub.publish(CHANNEL, JSON.stringify(full));
}

/** Registers a local in-process handler invoked for every event received from Redis. */
export function onEvent(handler: Handler) {
  handlers.add(handler);
  ensureSubscribed();
  return () => handlers.delete(handler);
}

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  redisSub.subscribe(CHANNEL, (err) => {
    if (err) logger.error({ err }, "failed to subscribe to realtime event channel");
  });
  redisSub.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as RealtimeEvent;
      for (const handler of handlers) handler(event);
    } catch (err) {
      logger.error({ err }, "failed to parse realtime event");
    }
  });
}
