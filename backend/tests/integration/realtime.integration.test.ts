import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import { AddressInfo } from "net";
import request from "supertest";
import WebSocket from "ws";
import { createApp } from "../../src/app";
import { attachRealtimeGateway } from "../../src/realtime/gateway";
import { prisma } from "../../src/lib/prisma";

const suffix = Date.now();
const email = `realtime-${suffix}@syncforge.dev`;

let server: http.Server;
let baseUrl: string;
let wsUrl: string;
let accessToken: string;
let organizationId: string;
let projectId: string;

beforeAll(async () => {
  const app = createApp();
  server = http.createServer(app);
  attachRealtimeGateway(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}`;

  await request(baseUrl).post("/api/auth/register").send({ email, password: "correct-horse-battery", name: "Realtime Test" });
  const login = await request(baseUrl).post("/api/auth/login").send({ email, password: "correct-horse-battery" });
  accessToken = login.body.accessToken;

  const orgRes = await request(baseUrl)
    .post("/api/organizations")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: `Realtime Org ${suffix}` });
  organizationId = orgRes.body.organization.id;

  const projectRes = await request(baseUrl)
    .post("/api/projects")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ organizationId, name: "Realtime Project" });
  projectId = projectRes.body.project.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  await new Promise((resolve) => server.close(resolve));
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}/ws?token=${accessToken}`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket, predicate: (event: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for realtime event")), timeoutMs);
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (predicate(event)) {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
}

describe("realtime gateway", () => {
  it("rejects a connection with no auth token", async () => {
    const socket = new WebSocket(`${wsUrl}/ws`);
    const closeCode = await new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    expect(closeCode).toBe(4001);
  });

  it("delivers a task.created event to a client subscribed to the project room", async () => {
    const socket = await connect();
    socket.send(JSON.stringify({ type: "subscribe", roomId: `project:${projectId}` }));

    // Give the subscribe message a beat to be processed before triggering the event.
    await new Promise((r) => setTimeout(r, 200));

    const eventPromise = nextMessage(socket, (e) => e.type === "task.created");

    await request(baseUrl)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ projectId, title: "Realtime task" });

    const event = await eventPromise;
    expect(event.roomId).toBe(`project:${projectId}`);
    expect(event.payload.title).toBe("Realtime task");
    expect(event.v).toBe(1);

    socket.close();
  });

  it("does not deliver events for a room the client never subscribed to", async () => {
    const socket = await connect();
    // Deliberately not subscribing to project:{projectId}.

    let received = false;
    socket.on("message", () => {
      received = true;
    });

    await request(baseUrl)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ projectId, title: "Should not be seen" });

    await new Promise((r) => setTimeout(r, 500));
    expect(received).toBe(false);
    socket.close();
  });
});
