import { emailAdapter } from "./email.adapter.js";
import { webhookAdapter } from "./webhook.adapter.js";
import { smsAdapter } from "./sms.adapter.js";
import { pushAdapter } from "./push.adapter.js";

export interface DispatchPayload {
  notificationId: string;
  channel: "EMAIL" | "SMS" | "PUSH" | "WEBHOOK";
  recipient: string;
  subject?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export async function dispatchByChannel(payload: DispatchPayload) {
  switch (payload.channel) {
    case "EMAIL":
      return emailAdapter.send({
        recipient: payload.recipient,
        subject: payload.subject,
        content: payload.content,
        metadata: payload.metadata,
      });

    case "WEBHOOK":
      return webhookAdapter.send({
        notificationId: payload.notificationId,
        url: payload.recipient,
        content: payload.content,
        metadata: payload.metadata,
      });

    case "SMS":
      return smsAdapter.send({
        recipient: payload.recipient,
        content: payload.content,
        metadata: payload.metadata,
      });

    case "PUSH":
      return pushAdapter.send({
        recipient: payload.recipient,
        subject: payload.subject,
        content: payload.content,
        metadata: payload.metadata,
      });

    default:
      throw new Error(`Unsupported channel: '${payload.channel}'`);
  }
}

export { emailAdapter, webhookAdapter, smsAdapter, pushAdapter };
