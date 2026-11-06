import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { redisConnection } from "../lib/redis.js";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../lib/redis.js", () => ({
  redisConnection: {
    ping: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock("../lib/queue.js", () => ({
  notificationQueue: {
    name: "notification-dispatch",
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 10,
      failed: 0,
    }),
  },
}));

describe("Health Check Endpoint Tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should return 200 and healthy status when DB and Redis are up", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }] as any);
    vi.mocked(redisConnection.ping).mockResolvedValue("PONG" as any);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe("healthy");
    expect(body.services.database).toBe("up");
    expect(body.services.redis).toBe("up");
    expect(body.system).toBeDefined();
    expect(body.system.memoryUsageMb).toBeGreaterThan(0);
  });

  it("should return 503 and degraded status when database is unreachable", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("Connection refused"));
    vi.mocked(redisConnection.ping).mockResolvedValue("PONG" as any);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe("degraded");
    expect(body.services.database).toBe("down");
  });
});
