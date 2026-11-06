import { describe, it, expect } from "vitest";
import {
  createNotificationSchema,
  bulkDispatchSchema,
  notificationFilterQuerySchema,
} from "./notification.schema.js";

describe("Notification Schema Validation", () => {
  describe("createNotificationSchema", () => {
    it("should validate a valid email notification payload", () => {
      const validPayload = {
        channel: "EMAIL",
        recipient: "user@example.com",
        subject: "Order Confirmation",
        content: "Your order #12345 has been confirmed.",
        priority: "HIGH",
        metadata: { orderId: 12345, customerTier: "VIP" },
      };

      const result = createNotificationSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.channel).toBe("EMAIL");
        expect(result.data.priority).toBe("HIGH");
      }
    });

    it("should validate a valid SMS notification with default priority", () => {
      const validPayload = {
        channel: "SMS",
        recipient: "+5511999999999",
        content: "Seu codigo de verificacao e 482910.",
      };

      const result = createNotificationSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe("NORMAL");
      }
    });

    it("should reject an invalid channel", () => {
      const invalidPayload = {
        channel: "INVALID_CHANNEL",
        recipient: "user@example.com",
        content: "Testing",
      };

      const result = createNotificationSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject an empty recipient or content", () => {
      const emptyRecipient = {
        channel: "PUSH",
        recipient: "",
        content: "Alert",
      };

      const result = createNotificationSchema.safeParse(emptyRecipient);
      expect(result.success).toBe(false);

      const emptyContent = {
        channel: "WEBHOOK",
        recipient: "https://api.partner.com/webhook",
        content: "",
      };

      const result2 = createNotificationSchema.safeParse(emptyContent);
      expect(result2.success).toBe(false);
    });

    it("should accept scheduledAt in ISO-8601 format", () => {
      const payload = {
        channel: "EMAIL",
        recipient: "user@example.com",
        content: "Reminder",
        scheduledAt: "2026-11-06T18:00:00.000Z",
      };

      const result = createNotificationSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("bulkDispatchSchema", () => {
    it("should validate an array of valid notifications", () => {
      const validBulk = {
        notifications: [
          {
            channel: "EMAIL",
            recipient: "user1@example.com",
            content: "Message 1",
          },
          {
            channel: "SMS",
            recipient: "+5511988888888",
            content: "Message 2",
          },
        ],
      };

      const result = bulkDispatchSchema.safeParse(validBulk);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notifications).toHaveLength(2);
      }
    });

    it("should reject empty notifications array", () => {
      const emptyBulk = {
        notifications: [],
      };

      const result = bulkDispatchSchema.safeParse(emptyBulk);
      expect(result.success).toBe(false);
    });
  });

  describe("notificationFilterQuerySchema", () => {
    it("should supply default pagination values", () => {
      const parsed = notificationFilterQuerySchema.parse({});
      expect(parsed.limit).toBe(20);
      expect(parsed.page).toBe(1);
    });

    it("should coerce string numbers into integer limits", () => {
      const parsed = notificationFilterQuerySchema.parse({
        limit: "50",
        page: "3",
        status: "DELIVERED",
      });
      expect(parsed.limit).toBe(50);
      expect(parsed.page).toBe(3);
      expect(parsed.status).toBe("DELIVERED");
    });
  });
});
