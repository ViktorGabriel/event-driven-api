import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { healthCheckHandler } from "../controllers/health.controller.js";

const healthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  timestamp: z.string(),
  latencyMs: z.number(),
  uptimeSeconds: z.number(),
  services: z.object({
    database: z.string(),
    redis: z.string(),
  }),
  queue: z.object({
    name: z.string(),
    metrics: z.record(z.number()),
  }),
  system: z.object({
    nodeVersion: z.string(),
    memoryUsageMb: z.number(),
  }),
});

export async function healthRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get(
    "/health",
    {
      schema: {
        tags: ["Health Check"],
        summary: "Structured system health check",
        description:
          "Checks connectivity to PostgreSQL, Redis cache/queue, and returns memory and uptime metrics.",
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    healthCheckHandler,
  );
}
