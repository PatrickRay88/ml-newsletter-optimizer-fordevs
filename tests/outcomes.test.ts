import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContactStatus } from "@prisma/client";
import { determineOutcome, inferOutcomeFromTags, mapProviderLastEventToOutcome } from "@/lib/outcomes";

describe("inferOutcomeFromTags", () => {
  it("falls back to delivered when no outcome tag present", () => {
    assert.equal(inferOutcomeFromTags(["foo"]), "delivered");
  });

  it("resolves to bounced when tag present", () => {
    assert.equal(inferOutcomeFromTags(["outcome=bounced"]), "bounced");
  });

  it("handles suppressed tag", () => {
    assert.equal(inferOutcomeFromTags(["outcome=suppressed"]), "suppressed");
  });
});

describe("determineOutcome", () => {
  it("prioritizes contact status over tags", () => {
    const contact = { tags: ["outcome=delivered"], status: ContactStatus.SUPPRESSED };
    assert.equal(determineOutcome(contact), "suppressed");
  });

  it("falls back to tags when status active", () => {
    const contact = { tags: ["outcome=bounced"], status: ContactStatus.ACTIVE };
    assert.equal(determineOutcome(contact), "bounced");
  });
});

describe("mapProviderLastEventToOutcome", () => {
  it("maps delivered-like events", () => {
    assert.equal(mapProviderLastEventToOutcome("delivered"), "delivered");
    assert.equal(mapProviderLastEventToOutcome("delivery_succeeded"), "delivered");
  });

  it("maps bounced and complaint events", () => {
    assert.equal(mapProviderLastEventToOutcome("hard_bounced"), "bounced");
    assert.equal(mapProviderLastEventToOutcome("spam_complaint"), "complained");
  });

  it("returns null for non-terminal activity", () => {
    assert.equal(mapProviderLastEventToOutcome("opened"), null);
    assert.equal(mapProviderLastEventToOutcome(undefined), null);
  });
});
