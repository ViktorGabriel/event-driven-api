import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createNotificationSchema,
  bulkDispatchSchema,
  notificationFilterQuerySchema,
} from "../schemas/notification.schema.js";
import {
  createNotificationHandler,
  bulkDispatchHandler,
  listNotificationsHandler,
  getNotificationByIdHandler,
  getBatchStatusHandler,
} from "../controllers/notification.controller.js";

export async function notificationRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<ZodTypeProvider>();

  // Ingest single notification
  router.post(
    "/notifications",
    {
      schema: {
        tags: ["Notifications"],
        summary: "Ingest and dispatch a single notification",
        description:
          "Validates the payload, stores the notification with audit tracking, and places it into the BullMQ Redis queue.",
        body: createNotificationSchema,
      },
    },
    createNotificationHandler,
  );

  // Bulk dispatch notifications
  router.post(
    "/notifications/bulk",
    {
      schema: {
        tags: ["Notifications"],
        summary: "Ingest and dispatch a batch of notifications",
        description:
          "Atomically batches up to 500 notifications, records a BatchDispatch entity, and enqueues tasks.",
        body: bulkDispatchSchema,
      },
    },
    bulkDispatchHandler,
  );

  // Query notifications
  router.get(
    "/notifications",
    {
      schema: {
        tags: ["Notifications"],
        summary: "Filter and list notifications",
        description:
          "Retrieves paginated notifications filtered by channel, status, recipient, or batchId.",
        querystring: notificationFilterQuerySchema,
      },
    },
    listNotificationsHandler,
  );

  // Get notification by ID
  router.get(
    "/notifications/:id",
    {
      schema: {
        tags: ["Notifications"],
        summary: "Get notification by ID",
        description:
          "Retrieves notification details along with its lifecycle audit log history.",
        params: z.object({
          id: z.string().uuid(),
        }),
      },
    },
    getNotificationByIdHandler,
  );

  // Get batch dispatch status
  router.get(
    "/notifications/batch/:batchId",
    {
      schema: {
        tags: ["Notifications"],
        summary: "Get batch dispatch status",
        description: "Tracks the progress and item counts of a bulk dispatch batch.",
        params: z.object({
          batchId: z.string().uuid(),
        }),
      },
    },
    getBatchStatusHandler,
  );
}
