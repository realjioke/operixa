import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-16chars";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-16chars";

import { signAccessToken, verifyAccessToken } from "../../src/middleware/auth";

describe("access token", () => {
  it("round-trips a signed payload", () => {
    const token = signAccessToken({ sub: "user_123", email: "ada@syncforge.dev" });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe("user_123");
    expect(decoded.email).toBe("ada@syncforge.dev");
  });

  it("rejects a tampered token", () => {
    const token = signAccessToken({ sub: "user_123", email: "ada@syncforge.dev" });
    const tampered = token.slice(0, -2) + "xx";
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it("rejects an empty token", () => {
    expect(() => verifyAccessToken("")).toThrow();
  });
});
