import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import IORedis from "ioredis";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { publishEvent } from "../realtime/eventBus";
import type { NotificationJobData } from "../modules/notifications/notifications.service";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Delivery channels a notification can fan out to. Email is a stub here —
// swapping in a real provider (SES/Postmark/Resend) means implementing
// `sendEmail` without touching the queue, job, or realtime-push logic.
async function sendEmail(userId: string, type: string, payload: Prisma.InputJsonValue) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return;
  logger.info({ to: user.email, type, payload }, "[email:stub] would send notification email");
}

export const notificationWorker = new Worker<NotificationJobData>(
  "notifications",
  async (job) => {
    const { userId, type } = job.data;
const payload = job.data.payload as Prisma.InputJsonValue;

    const notification = await prisma.notification.create({ data: { userId, type, payload } });

    // Push it live to the user if they have an open socket, in addition to
    // the row that now backs their in-app notification bell / activity feed.
    await publishEvent({
      type: "notification.created",
      roomId: `user:${userId}`,
      actorId: "system",
      payload: notification,
    });

    await sendEmail(userId, type, payload);
  },
  { connection, concurrency: 10 },
);

notificationWorker.on("completed", (job) => logger.info({ jobId: job.id }, "notification delivered"));
notificationWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "notification delivery failed"));

logger.info("notification worker started");
