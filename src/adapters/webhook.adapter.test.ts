import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebhookAdapter } from "./webhook.adapter.js";

describe("WebhookAdapter Unit Tests", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should successfully dispatch webhook via POST and return response info", async () => {
    const adapter = new WebhookAdapter(3000);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('{"status":"received"}'),
    });

    const result = await adapter.send({
      notificationId: "notif-uuid-1",
      url: "https://partner.com/webhook",
      content: JSON.stringify({ event: "order_created" }),
      metadata: { traceId: "xyz" },
    });

    expect(result.statusCode).toBe(200);
    expect(result.url).toBe("https://partner.com/webhook");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://partner.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Notification-Id": "notif-uuid-1",
        }),
      }),
    );
  });

  it("should throw error for invalid URL", async () => {
    const adapter = new WebhookAdapter();

    await expect(
      adapter.send({
        notificationId: "notif-uuid-2",
        url: "invalid-url",
        content: "test",
      }),
    ).rejects.toThrow("Invalid webhook target URL: 'invalid-url'");
  });

  it("should throw error when target endpoint responds with non-2xx status", async () => {
    const adapter = new WebhookAdapter();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    });

    await expect(
      adapter.send({
        notificationId: "notif-uuid-3",
        url: "https://api.gateway.com/hook",
        content: "test",
      }),
    ).rejects.toThrow("Webhook endpoint responded with HTTP 502 (Bad Gateway)");
  });

  it("should handle timeout using AbortController and throw descriptive error", async () => {
    const adapter = new WebhookAdapter(50); // 50ms timeout

    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        setTimeout(() => reject(error), 60);
      });
    });

    await expect(
      adapter.send({
        notificationId: "notif-uuid-4",
        url: "https://slow-server.com/hook",
        content: "test",
        timeoutMs: 50,
      }),
    ).rejects.toThrow("timed out after 50ms");
  });
});
