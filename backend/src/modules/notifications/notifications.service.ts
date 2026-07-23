import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../../config/env";

// BullMQ needs its own dedicated ioredis connection with maxRetriesPerRequest
// disabled (its blocking-command usage is incompatible with ioredis's default retry behavior).
const bullConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Application events (task assigned, mention, comment) enqueue a job here
// rather than writing the Notification row and sending email synchronously
// from the request path. A worker process (see workers/notificationWorker.ts)
// consumes the queue: it persists the in-app notification, pushes it over
// the realtime gateway, and — for channels that warrant it — sends email.
// This keeps slow delivery channels off the request/response latency path
// and gives us retries for free.
export const notificationQueue = new Queue("notifications", { connection: bullConnection });

export interface NotificationJobData {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
}

export async function enqueueNotification(data: NotificationJobData) {
  await notificationQueue.add("deliver", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
