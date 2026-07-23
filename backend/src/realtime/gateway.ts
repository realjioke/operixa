import { IncomingMessage } from "http";
import os from "os";
import { WebSocket, WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import { verifyAccessToken } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { redis, REDIS_KEYS } from "../lib/redis";
import { logger } from "../lib/logger";
import { onEvent, publishEvent, RealtimeEvent } from "./eventBus";

const GATEWAY_NODE_ID = `${os.hostname()}-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface ClientState {
  id: string;
  userId: string;
  socket: WebSocket;
  rooms: Set<string>;
  isAlive: boolean;
}

// All sockets held by *this* process, keyed by connection id. Room
// membership is authoritative in-memory per gateway node; Redis carries
// presence state and the cross-node event fan-out.
const clients = new Map<string, ClientState>();
// roomId -> set of local connection ids subscribed to it, for O(1) fan-out.
const roomIndex = new Map<string, Set<string>>();

export function attachRealtimeGateway(server: import("http").Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (socket, req) => {
    const auth = await authenticateHandshake(req);
    if (!auth) {
      socket.close(4001, "unauthorized");
      return;
    }

    const client: ClientState = { id: nanoid(), userId: auth.userId, socket, rooms: new Set(), isAlive: true };
    clients.set(client.id, client);

    await onConnect(client);

    socket.on("pong", () => {
      client.isAlive = true;
    });

    socket.on("message", (raw) => handleClientMessage(client, raw.toString()));

    socket.on("close", () => onDisconnect(client));
  });

  // Ping every connection on an interval; sockets that don't respond with a
  // pong within one interval are assumed dead and terminated. This is what
  // lets the server detect flaky mobile connections instead of holding a
  // stale room subscription forever.
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.isAlive) {
        client.socket.terminate();
        continue;
      }
      client.isAlive = false;
      client.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  // Fan out events published on Redis (by this process or any other) to
  // whichever local sockets are subscribed to the target room.
  onEvent((event) => broadcastToLocalRoom(event));

  logger.info({ node: GATEWAY_NODE_ID }, "realtime gateway attached");
  return wss;
}

async function authenticateHandshake(req: IncomingMessage): Promise<{ userId: string } | null> {
  try {
    const url = new URL(req.url ?? "", "http://internal");
    const cookieToken = parseCookie(req.headers.cookie ?? "", "access_token");
    const token = url.searchParams.get("token") ?? cookieToken;
    if (!token) return null;
    const payload = verifyAccessToken(token);
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

function parseCookie(header: string, name: string): string | null {
  const match = header.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

async function onConnect(client: ClientState) {
  await prisma.webSocketConnection.create({
    data: { id: client.id, userId: client.userId, gatewayNode: GATEWAY_NODE_ID },
  });
  await redis.hset(REDIS_KEYS.presence(client.userId), { status: "online", lastSeenAt: Date.now() });
}

async function onDisconnect(client: ClientState) {
  clients.delete(client.id);
  for (const roomId of client.rooms) unindex(roomId, client.id);

  await prisma.webSocketConnection
    .update({ where: { id: client.id }, data: { disconnectedAt: new Date() } })
    .catch(() => undefined);

  // Only mark the user fully offline if they have no other live connections
  // (e.g. a second browser tab) on this or another gateway node.
  const stillConnected = await prisma.webSocketConnection.count({
    where: { userId: client.userId, disconnectedAt: null },
  });
  if (stillConnected === 0) {
    await redis.hset(REDIS_KEYS.presence(client.userId), { status: "offline", lastSeenAt: Date.now() });
    for (const roomId of client.rooms) {
      await publishEvent({ type: "presence.changed", roomId, actorId: client.userId, payload: { status: "offline" } });
    }
  }
}

type ClientMessage =
  | { type: "subscribe"; roomId: string }
  | { type: "unsubscribe"; roomId: string }
  | { type: "typing"; roomId: string; isTyping: boolean };

async function handleClientMessage(client: ClientState, raw: string) {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return; // silently drop malformed frames
  }

  switch (msg.type) {
    case "subscribe": {
      if (!(await canAccessRoom(client.userId, msg.roomId))) return;
      client.rooms.add(msg.roomId);
      index(msg.roomId, client.id);
      await publishEvent({ type: "presence.changed", roomId: msg.roomId, actorId: client.userId, payload: { status: "online" } });
      break;
    }
    case "unsubscribe": {
      client.rooms.delete(msg.roomId);
      unindex(msg.roomId, client.id);
      break;
    }
    case "typing": {
      if (!client.rooms.has(msg.roomId)) return;
      await publishEvent({
        type: "typing.changed",
        roomId: msg.roomId,
        actorId: client.userId,
        payload: { isTyping: msg.isTyping },
      });
      break;
    }
  }
}

/**
 * Authorization happens once at subscribe-time rather than per broadcast
 * event: a room maps to an org/project/document, and the caller must have
 * an active membership in the owning organization.
 */
async function canAccessRoom(userId: string, roomId: string): Promise<boolean> {
  const [kind, id] = roomId.split(":");

  // A user's personal notification room — only they may subscribe to it.
  if (kind === "user") return id === userId;

  let organizationId: string | null = null;

  if (kind === "org") organizationId = id;
  else if (kind === "project") {
    organizationId = (await prisma.project.findUnique({ where: { id }, select: { organizationId: true } }))
      ?.organizationId ?? null;
  } else if (kind === "document") {
    const doc = await prisma.document.findUnique({ where: { id }, select: { project: { select: { organizationId: true } } } });
    organizationId = doc?.project.organizationId ?? null;
  }

  if (!organizationId) return false;
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return Boolean(membership);
}

function index(roomId: string, clientId: string) {
  if (!roomIndex.has(roomId)) roomIndex.set(roomId, new Set());
  roomIndex.get(roomId)!.add(clientId);
}

function unindex(roomId: string, clientId: string) {
  roomIndex.get(roomId)?.delete(clientId);
}

function broadcastToLocalRoom(event: RealtimeEvent) {
  const memberIds = roomIndex.get(event.roomId);
  if (!memberIds || memberIds.size === 0) return;

  const frame = JSON.stringify(event);
  for (const clientId of memberIds) {
    const client = clients.get(clientId);
    if (client && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(frame);
    }
  }
}
