import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapResendErrorMessage } from "@/lib/resend";

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
