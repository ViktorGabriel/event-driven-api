export interface SmsDispatchOptions {
  recipient: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface SmsDispatchResult {
  messageSid: string;
  delivered: boolean;
  timestamp: string;
}

export class SmsAdapter {
  async send(options: SmsDispatchOptions): Promise<SmsDispatchResult> {
    const { recipient } = options;

    // Basic E.164 phone validation check
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(recipient.replace(/[\s()-]/g, ""))) {
      throw new Error(`Invalid phone number format: '${recipient}'`);
    }

    if (recipient.includes("999999999")) {
      throw new Error("Carrier failure: Gateway timeout delivering SMS");
    }

    return {
      messageSid: `SM${Math.random().toString(36).substring(2, 12)}`,
      delivered: true,
      timestamp: new Date().toISOString(),
    };
  }
}

export const smsAdapter = new SmsAdapter();
