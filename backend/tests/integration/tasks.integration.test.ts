import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

const app = createApp();
const suffix = Date.now();
const ownerEmail = `owner-${suffix}@syncforge.dev`;
const viewerEmail = `viewer-${suffix}@syncforge.dev`;

let ownerToken: string;
let viewerToken: string;
let organizationId: string;
let projectId: string;

async function registerAndLogin(email: string) {
  await request(app).post("/api/auth/register").send({ email, password: "correct-horse-battery", name: email });
  const res = await request(app).post("/api/auth/login").send({ email, password: "correct-horse-battery" });
  return res.body.accessToken as string;
}

beforeAll(async () => {
  ownerToken = await registerAndLogin(ownerEmail);
  viewerToken = await registerAndLogin(viewerEmail);

  const orgRes = await request(app)
    .post("/api/organizations")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: `Test Org ${suffix}` });
  organizationId = orgRes.body.organization.id;

  const viewerUser = await prisma.user.findUniqueOrThrow({ where: { email: viewerEmail } });
  await prisma.membership.create({
    data: { userId: viewerUser.id, organizationId, role: "VIEWER" },
  });

  const projectRes = await request(app)
    .post("/api/projects")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ organizationId, name: "Test Project" });
  projectId = projectRes.body.project.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, viewerEmail] } } });
  await prisma.$disconnect();
});

describe("task RBAC", () => {
  it("lets a MEMBER-or-above create a task", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ projectId, title: "Ship the feature" });
    expect(res.status).toBe(201);
    expect(res.body.task.status).toBe("TODO");
  });

  it("blocks a VIEWER from creating a task", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ projectId, title: "Should be blocked" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("still lets a VIEWER read the board", async () => {
    const res = await request(app).get(`/api/tasks/project/${projectId}`).set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it("blocks a user outside the organization entirely", async () => {
    const outsiderToken = await registerAndLogin(`outsider-${suffix}@syncforge.dev`);
    const res = await request(app).get(`/api/tasks/project/${projectId}`).set("Authorization", `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
    await prisma.user.deleteMany({ where: { email: `outsider-${suffix}@syncforge.dev` } });
  });
});
