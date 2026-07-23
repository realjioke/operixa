import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-16chars";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-16chars";

const findUnique = vi.fn();

vi.mock("../../src/lib/prisma", () => ({
  prisma: { membership: { findUnique: (...args: unknown[]) => findUnique(...args) }, auditLog: { create: vi.fn() } },
}));

import { assertRole } from "../../src/middleware/rbac";

describe("assertRole", () => {
  it("allows a caller whose role meets the minimum", async () => {
    findUnique.mockResolvedValueOnce({ role: "ADMIN" });
    await expect(assertRole("u1", "org1", "MEMBER" as any)).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("allows a caller whose role exactly matches the minimum", async () => {
    findUnique.mockResolvedValueOnce({ role: "MEMBER" });
    await expect(assertRole("u1", "org1", "MEMBER" as any)).resolves.toMatchObject({ role: "MEMBER" });
  });

  it("rejects a caller below the minimum role", async () => {
    findUnique.mockResolvedValueOnce({ role: "VIEWER" });
    await expect(assertRole("u1", "org1", "ADMIN" as any)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a caller with no membership at all", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(assertRole("u1", "org1", "VIEWER" as any)).rejects.toMatchObject({ status: 403 });
  });
});
