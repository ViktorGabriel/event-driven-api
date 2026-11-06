import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import * as queueLib from "../lib/queue.js";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    batchDispatch: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
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
  enqueueNotification: vi.fn(),
  enqueueNotificationBulk: vi.fn(),
  notificationQueue: {
    name: "notification-dispatch",
    getJobCounts: vi.fn().mockResolvedValue({}),
  },
}));

describe("Notification Routes Integration Tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/v1/notifications - should accept valid payload and return 202", async () => {
    const mockCreated = {
      id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      channel: "EMAIL",
      recipient: "customer@domain.com",
      subject: "Welcome!",
      content: "Thank you for joining our platform.",
      priority: "NORMAL",
      status: "QUEUED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.notification.create).mockResolvedValue(mockCreated as any);
    vi.mocked(queueLib.enqueueNotification).mockResolvedValue({ id: "job-001" } as any);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/notifications",
      payload: {
        channel: "EMAIL",
        recipient: "customer@domain.com",
        subject: "Welcome!",
        content: "Thank you for joining our platform.",
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.payload);
    expect(body.message).toContain("accepted");
    expect(body.jobId).toBe("job-001");
  });

  it("POST /api/v1/notifications - should reject invalid payload with 400 Bad Request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/notifications",
      payload: {
        channel: "TELEPATHY", // Invalid channel
        recipient: "",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe("Bad Request");
    expect(body.issues).toBeDefined();
  });

  it("GET /api/v1/notifications/:id - returns 404 when notification does not exist", async () => {
    vi.mocked(prisma.notification.findUnique).mockResolvedValue(null);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/notifications/11111111-1111-1111-1111-111111111111",
    });

    expect(response.statusCode).toBe(404);
  });
});
