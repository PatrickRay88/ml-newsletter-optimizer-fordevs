import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContactStatus, HygieneRiskLevel } from "@prisma/client";
import { computeHygieneScore } from "@/lib/hygiene";

describe("computeHygieneScore", () => {
  it("flags bounced contacts as high risk and suppressible", () => {
    const result = computeHygieneScore({
      id: "contact-1",
      status: ContactStatus.BOUNCED,
      tags: [],
      lastEventAt: new Date(),
      lastMessageSentAt: new Date(),
      propensity: 0.45,
      suppressions: []
    });

    assert.equal(result.riskLevel, HygieneRiskLevel.HIGH);
    assert.ok(result.shouldSuppress);
    assert.ok(result.reasons.some((reason) => reason.includes("bounce")));
  });

  it("avoids suppressing synthetic contacts even when high risk", () => {
    const result = computeHygieneScore({
      id: "contact-2",
      status: ContactStatus.SUPPRESSED,
      tags: ["synthetic"],
      lastEventAt: new Date(),
      lastMessageSentAt: new Date(),
      propensity: 0.5,
      suppressions: []
    });

    assert.equal(result.riskLevel, HygieneRiskLevel.HIGH);
    assert.equal(result.shouldSuppress, false);
    assert.ok(result.reasons.includes("Synthetic contact safeguard"));
  });

  it("returns medium risk for stale contacts with low propensity", () => {
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const result = computeHygieneScore({
      id: "contact-3",
      status: ContactStatus.ACTIVE,
      tags: [],
      lastEventAt: ninetyOneDaysAgo,
      lastMessageSentAt: ninetyOneDaysAgo,
      propensity: 0.05,
      suppressions: []
    });

    assert.equal(result.riskLevel, HygieneRiskLevel.MEDIUM);
    assert.ok(result.reasons.some((reason) => reason.toLowerCase().includes("90 days")));
  });

  it("keeps engaged contacts at low risk", () => {
    const result = computeHygieneScore({
      id: "contact-4",
      status: ContactStatus.ACTIVE,
      tags: ["test"],
      lastEventAt: new Date(),
      lastMessageSentAt: new Date(),
      propensity: 0.6,
      suppressions: []
    });

    assert.equal(result.riskLevel, HygieneRiskLevel.LOW);
    assert.equal(result.shouldSuppress, false);
  });
});
