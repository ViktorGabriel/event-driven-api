import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { redisConnection } from "../lib/redis.js";
import { notificationQueue } from "../lib/queue.js";

export async function healthCheckHandler(_request: FastifyRequest, reply: FastifyReply) {
  const startTime = Date.now();
  let dbStatus = "up";
  let redisStatus = "up";
  let queueMetrics = { waiting: 0, active: 0, completed: 0, failed: 0 };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = "down";
  }

  try {
    const pong = await redisConnection.ping();
    if (pong !== "PONG") redisStatus = "down";
  } catch (err) {
    redisStatus = "down";
  }

  try {
    queueMetrics = await notificationQueue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
    );
  } catch {
    // Queue metrics optional if redis degraded
  }

  const isHealthy = dbStatus === "up" && redisStatus === "up";
  const statusCode = isHealthy ? 200 : 503;

  return reply.status(statusCode).send({
    status: isHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startTime,
    uptimeSeconds: Math.floor(process.uptime()),
    services: {
      database: dbStatus,
      redis: redisStatus,
    },
    queue: {
      name: notificationQueue.name,
      metrics: queueMetrics,
    },
    system: {
      nodeVersion: process.version,
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
  });
}
