import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContactStatus } from "@prisma/client";
import { generateTestContactSpecs, summarizeOutcomeCounts } from "@/lib/test_contacts";

const EXPECTED_COUNTS = {
  delivered: 200,
  bounced: 20,
  suppressed: 5,
  complained: 3
};

function countByStatus(status: ContactStatus, specs: ReturnType<typeof generateTestContactSpecs>) {
  return specs.filter((spec) => spec.status === status).length;
}

describe("generateTestContactSpecs", () => {
  it("generates deterministic test contacts with unique emails", () => {
    const specs = generateTestContactSpecs();

    assert.equal(specs.length, 228);

    const uniqueEmails = new Set(specs.map((spec) => spec.email));
    assert.equal(uniqueEmails.size, specs.length);

    assert.equal(countByStatus(ContactStatus.ACTIVE, specs), EXPECTED_COUNTS.delivered);
    assert.equal(countByStatus(ContactStatus.BOUNCED, specs), EXPECTED_COUNTS.bounced);
    assert.equal(countByStatus(ContactStatus.SUPPRESSED, specs), EXPECTED_COUNTS.suppressed);
    assert.equal(countByStatus(ContactStatus.COMPLAINED, specs), EXPECTED_COUNTS.complained);
  });

  it("cycles through supported timezones in order", () => {
    const specs = generateTestContactSpecs();
    const slice = specs.slice(0, 8);
    const expectedRotation = [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles"
    ];

    assert.deepEqual(
      slice.map((spec) => spec.timezone),
      expectedRotation
    );
  });
});

describe("summarizeOutcomeCounts", () => {
  it("summarizes counts by outcome key", () => {
    const specs = generateTestContactSpecs();
    const summary = summarizeOutcomeCounts(specs);

    assert.deepEqual(summary, EXPECTED_COUNTS);
  });
});
