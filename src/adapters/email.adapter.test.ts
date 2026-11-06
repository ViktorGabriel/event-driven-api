import { describe, it, expect } from "vitest";
import { emailAdapter } from "./email.adapter.js";

describe("EmailAdapter Unit Tests", () => {
  it("should successfully send an email to a valid recipient", async () => {
    const result = await emailAdapter.send({
      recipient: "customer@domain.com",
      subject: "Test Subject",
      content: "Hello World",
    });

    expect(result.delivered).toBe(true);
    expect(result.accepted).toContain("customer@domain.com");
    expect(result.messageId).toContain("@smtp.internal");
  });

  it("should throw an error when recipient has invalid email format", async () => {
    await expect(
      emailAdapter.send({
        recipient: "not-an-email",
        content: "Hello",
      }),
    ).rejects.toThrow("Invalid email recipient format: 'not-an-email'");
  });

  it("should throw a simulated transient error for resilience testing", async () => {
    await expect(
      emailAdapter.send({
        recipient: "transient-error@fail.com",
        content: "Testing retry",
      }),
    ).rejects.toThrow("Temporary SMTP connection timeout (503 Service Unavailable)");
  });

  it("should throw a simulated permanent error for DLQ testing", async () => {
    await expect(
      emailAdapter.send({
        recipient: "permanent-error@fail.com",
        content: "Testing DLQ",
      }),
    ).rejects.toThrow("Permanent SMTP bounce: 550 Mailbox not found");
  });
});
