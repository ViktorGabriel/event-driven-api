export interface EmailDispatchOptions {
  recipient: string;
  subject?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface EmailDispatchResult {
  messageId: string;
  delivered: boolean;
  accepted: string[];
  rejected: string[];
  timestamp: string;
}

export class EmailAdapter {
  async send(options: EmailDispatchOptions): Promise<EmailDispatchResult> {
    const { recipient, subject: _subject, content } = options;

    if (!content) {
      throw new Error("Email body content cannot be empty");
    }

    // Simulate validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      throw new Error(`Invalid email recipient format: '${recipient}'`);
    }

    // Simulate transient network or provider failure for testing resilience
    if (recipient.includes("transient-error@fail.com")) {
      throw new Error("Temporary SMTP connection timeout (503 Service Unavailable)");
    }

    if (recipient.includes("permanent-error@fail.com")) {
      throw new Error("Permanent SMTP bounce: 550 Mailbox not found");
    }

    // Mock Nodemailer transmission
    const messageId = `<mock-${Date.now()}-${Math.random().toString(36).substring(2, 9)}@smtp.internal>`;

    return {
      messageId,
      delivered: true,
      accepted: [recipient],
      rejected: [],
      timestamp: new Date().toISOString(),
    };
  }
}

export const emailAdapter = new EmailAdapter();
