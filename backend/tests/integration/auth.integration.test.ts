import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const app = createApp();
const testEmail = `auth-test-${Date.now()}@syncforge.dev`;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: testEmail } });
  await prisma.$disconnect();
});

describe("auth flow", () => {
  let refreshCookie: string;

  it("registers a new user and sets session cookies", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: testEmail, password: "correct-horse-battery", name: "Test User" });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers["set-cookie"]).toBeTruthy();
  });

  it("rejects registering the same email twice", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: testEmail, password: "correct-horse-battery", name: "Test User" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const bad = await request(app).post("/api/auth/login").send({ email: testEmail, password: "wrong-password" });
    expect(bad.status).toBe(401);

    const good = await request(app).post("/api/auth/login").send({ email: testEmail, password: "correct-horse-battery" });
    expect(good.status).toBe(200);
    expect(good.body.accessToken).toBeTruthy();
    refreshCookie = good.headers["set-cookie"].find((c: string) => c.startsWith("refresh_token"));
  });

  it("returns the current user on /me with a valid access token", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: testEmail, password: "correct-horse-battery" });
    const accessToken = login.body.accessToken;

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testEmail);
  });

  it("rejects /me with no token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rotates the refresh token and rejects reuse of the old one", async () => {
    const first = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(first.status).toBe(200);

    // Presenting the same (now-revoked) refresh token again must fail —
    // this is the replay-detection behavior of rotation.
    const replay = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(replay.status).toBe(401);
  });
});
