import { z } from "zod";

export const ChannelEnum = z.enum(["EMAIL", "SMS", "PUSH", "WEBHOOK"]);
export type Channel = z.infer<typeof ChannelEnum>;

export const NotificationPriorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
export type NotificationPriority = z.infer<typeof NotificationPriorityEnum>;

export const NotificationStatusEnum = z.enum([
  "PENDING",
  "QUEUED",
  "PROCESSING",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
]);
export type NotificationStatus = z.infer<typeof NotificationStatusEnum>;

export const createNotificationSchema = z.object({
  channel: ChannelEnum.describe("Delivery channel for notification"),
  recipient: z
    .string()
    .min(1, "Recipient cannot be empty")
    .describe("Recipient identifier (email, phone, device token, or webhook URL)"),
  subject: z.string().optional().describe("Subject line for emails"),
  content: z
    .string()
    .min(1, "Content cannot be empty")
    .describe("Notification body content"),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Optional key-value metadata or dynamic template variables"),
  priority: NotificationPriorityEnum.default("NORMAL").describe("Notification priority"),
  scheduledAt: z
    .string()
    .datetime()
    .optional()
    .describe("Optional ISO-8601 schedule timestamp"),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

export const bulkDispatchSchema = z.object({
  notifications: z
    .array(createNotificationSchema)
    .min(1, "At least one notification is required")
    .max(500, "Maximum batch limit is 500 notifications per request")
    .describe("Array of notifications to ingest and queue"),
});

export type BulkDispatchInput = z.infer<typeof bulkDispatchSchema>;

export const notificationFilterQuerySchema = z.object({
  channel: ChannelEnum.optional(),
  status: NotificationStatusEnum.optional(),
  recipient: z.string().optional(),
  batchId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  page: z.coerce.number().min(1).default(1),
});

export type NotificationFilterQuery = z.infer<typeof notificationFilterQuerySchema>;

export const notificationResponseSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  channel: ChannelEnum,
  recipient: z.string(),
  subject: z.string().nullable().optional(),
  content: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
  priority: NotificationPriorityEnum,
  status: NotificationStatusEnum,
  retryCount: z.number(),
  maxRetries: z.number(),
  lastError: z.string().nullable().optional(),
  scheduledAt: z.date().nullable().optional(),
  deliveredAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const batchResponseSchema = z.object({
  id: z.string().uuid(),
  totalItems: z.number(),
  processedItems: z.number(),
  successfulItems: z.number(),
  failedItems: z.number(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "PARTIALLY_FAILED", "FAILED"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});
