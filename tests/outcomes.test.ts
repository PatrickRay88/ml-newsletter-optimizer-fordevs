import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContactStatus } from "@prisma/client";
import { determineOutcome, inferOutcomeFromTags } from "@/lib/outcomes";

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
