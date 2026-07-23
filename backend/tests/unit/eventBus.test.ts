import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-16chars";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-16chars";

const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue(1),
}));

vi.mock("ioredis", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      publish: publishMock,
      subscribe: vi.fn(),
      on: vi.fn(),
      call: vi.fn(),
      hset: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
      quit: vi.fn(),
    })),
  };
});

import { publishEvent, EVENT_SCHEMA_VERSION } from "../../src/realtime/eventBus";

describe("publishEvent", () => {
  beforeEach(() => publishMock.mockClear());

  it("publishes a correctly versioned, timestamped envelope on the shared channel", async () => {
    await publishEvent({ type: "task.updated", roomId: "project:abc", actorId: "user_1", payload: { id: "t1" } });

    expect(publishMock).toHaveBeenCalledTimes(1);
    const [channel, raw] = publishMock.mock.calls[0];
    expect(channel).toBe("syncforge:events");

    const event = JSON.parse(raw);
    expect(event.v).toBe(EVENT_SCHEMA_VERSION);
    expect(event.type).toBe("task.updated");
    expect(event.roomId).toBe("project:abc");
    expect(event.actorId).toBe("user_1");
    expect(event.payload).toEqual({ id: "t1" });
    expect(new Date(event.ts).toString()).not.toBe("Invalid Date");
  });
});
