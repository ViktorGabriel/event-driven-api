import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { healthRoutes } from "./routes/health.routes.js";
import { notificationRoutes } from "./routes/notification.routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            transport: {
              target: "pino-pretty",
              options: {
                translateTime: "HH:MM:ss Z",
                ignore: "pid,hostname",
              },
            },
          },
  });

  // Zod Type Provider Compilers
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Security Plugins
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });

  // Swagger Documentation Setup
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Notification & Dispatch Event-Driven Engine API",
        description:
          "High-throughput event-driven notification dispatch engine with PostgreSQL, Redis BullMQ queues, strict Zod validation, and structured health checks.",
        version: "1.0.0",
        contact: {
          name: "Viktor Gabriel",
        },
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: "Development Server",
        },
      ],
      tags: [
        {
          name: "Notifications",
          description: "Event-driven notification ingestion & batching",
        },
        { name: "Health Check", description: "Structured readiness and liveness probes" },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  // Error Handling
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Payload validation failed",
        issues: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name || "Error",
        message: error.message,
      });
    }

    if (env.NODE_ENV !== "test") {
      app.log.error(error);
    }

    return reply.status(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: "An unexpected error occurred while processing the event.",
    });
  });

  // Register Routes
  await app.register(healthRoutes);
  await app.register(notificationRoutes, { prefix: "/api/v1" });

  return app;
}
