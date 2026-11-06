export interface WebhookDispatchOptions {
  notificationId: string;
  url: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  timeoutMs?: number;
}

export interface WebhookDispatchResult {
  statusCode: number;
  durationMs: number;
  url: string;
  responseBody?: string;
}

export class WebhookAdapter {
  private defaultTimeoutMs: number;

  constructor(defaultTimeoutMs = 5000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async send(options: WebhookDispatchOptions): Promise<WebhookDispatchResult> {
    const { notificationId, url, content, metadata, timeoutMs } = options;
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid webhook target URL: '${url}'`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Event-Driven-Notification-Engine/1.0",
          "X-Notification-Id": notificationId,
          "X-Timestamp": new Date().toISOString(),
        },
        body: JSON.stringify({
          id: notificationId,
          payload: content,
          metadata: metadata ?? {},
        }),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(
          `Webhook endpoint responded with HTTP ${response.status} (${response.statusText})`,
        );
      }

      let responseBody: string | undefined;
      try {
        responseBody = await response.text();
      } catch {
        // Body reading optional
      }

      return {
        statusCode: response.status,
        durationMs,
        url,
        responseBody,
      };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "AbortError") {
        throw new Error(`Webhook request to '${url}' timed out after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const webhookAdapter = new WebhookAdapter();
