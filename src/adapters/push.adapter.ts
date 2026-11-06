export interface PushDispatchOptions {
  recipient: string;
  subject?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface PushDispatchResult {
  multicastId: string;
  delivered: boolean;
  timestamp: string;
}

export class PushAdapter {
  async send(options: PushDispatchOptions): Promise<PushDispatchResult> {
    const { recipient } = options;

    if (!recipient || recipient.length < 10) {
      throw new Error(`Invalid Push device token: '${recipient}'`);
    }

    if (recipient === "invalid-device-token-simulated") {
      throw new Error("FCM/APNS device registration token is no longer valid");
    }

    return {
      multicastId: `fcm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      delivered: true,
      timestamp: new Date().toISOString(),
    };
  }
}

export const pushAdapter = new PushAdapter();
