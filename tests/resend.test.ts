import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapResendErrorMessage, parseRetryAfterMs, shouldRetryResendStatus } from "@/lib/resend";

describe("mapResendErrorMessage", () => {
  it("returns message from response body when present", () => {
    const message = mapResendErrorMessage(400, { message: "Invalid payload" });
    assert.equal(message, "Invalid payload");
  });

  it("maps HTTP 401 to invalid key message", () => {
    const message = mapResendErrorMessage(401, null);
    assert.equal(message, "Invalid Resend API key");
  });

  it("maps server errors to service error message", () => {
    const message = mapResendErrorMessage(503, null);
    assert.equal(message, "Resend service returned an error");
  });

  it("falls back to unexpected response message", () => {
    const message = mapResendErrorMessage(422, {});
    assert.equal(message, "Unexpected response from Resend");
  });
});

describe("parseRetryAfterMs", () => {
  it("parses numeric retry-after seconds", () => {
    assert.equal(parseRetryAfterMs("2"), 2000);
  });

  it("parses date retry-after header", () => {
    const now = Date.parse("2026-03-06T10:00:00.000Z");
    const header = "Fri, 06 Mar 2026 10:00:03 GMT";
    assert.equal(parseRetryAfterMs(header, now), 3000);
  });

  it("returns zero for missing or invalid header", () => {
    assert.equal(parseRetryAfterMs(null), 0);
    assert.equal(parseRetryAfterMs("not-a-header"), 0);
  });
});

describe("shouldRetryResendStatus", () => {
  it("retries on 429 and 5xx", () => {
    assert.equal(shouldRetryResendStatus(429), true);
    assert.equal(shouldRetryResendStatus(500), true);
  });

  it("does not retry on 4xx client errors other than 429", () => {
    assert.equal(shouldRetryResendStatus(400), false);
    assert.equal(shouldRetryResendStatus(403), false);
  });
});
