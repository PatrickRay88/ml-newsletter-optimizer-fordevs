import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContactStatus } from "@prisma/client";
import { buildTagRecord, formatBroadcastSummary, partitionContactsByEligibility } from "@/lib/broadcasts";

describe("partitionContactsByEligibility", () => {
  it("excludes suppressed, complained, and contacts without email", () => {
    const contacts = [
      { id: "1", email: "a@example.com", status: ContactStatus.ACTIVE, tags: [] },
      { id: "2", email: null, status: ContactStatus.ACTIVE, tags: [] },
      { id: "3", email: "b@example.com", status: ContactStatus.SUPPRESSED, tags: [] },
      { id: "4", email: "c@example.com", status: ContactStatus.COMPLAINED, tags: [] },
      { id: "5", email: "d@example.com", status: ContactStatus.BOUNCED, tags: [] }
    ];

    const result = partitionContactsByEligibility(contacts);

    assert.equal(result.sendable.length, 1);
    assert.deepEqual(
      result.sendable.map((contact) => contact.id),
      ["1"]
    );
    assert.equal(result.skipped.length, 4);
  });
});

describe("formatBroadcastSummary", () => {
  it("summarizes optimizer activity and recipient counts", () => {
    const summary = formatBroadcastSummary({
      broadcastId: "test",
      totalRecipients: 5,
      skippedRecipients: 1,
      scheduledRecipients: 2,
      sendStrategy: "bulk",
      alreadySent: false,
      durationMs: 42,
      messageIds: ["mid-1", "mid-2", "mid-3"],
      optimizerSummary: {
        evaluated: 5,
        scheduled: 2,
        sentImmediately: 3,
        throttled: 1,
        skipped: 1,
        reasons: { "Global recommendation": 5 }
      }
    });

    assert.equal(summary, "Broadcast processed: 3 sent now, 2 scheduled, 1 skipped, optimizer evaluated 5, bulk mode");
  });

  it("reports already processed broadcasts", () => {
    const summary = formatBroadcastSummary({
      broadcastId: "test",
      totalRecipients: 0,
      skippedRecipients: 0,
      scheduledRecipients: 0,
      sendStrategy: "individual",
      alreadySent: true,
      durationMs: 0,
      messageIds: [],
      optimizerSummary: {
        evaluated: 0,
        scheduled: 0,
        sentImmediately: 0,
        throttled: 0,
        skipped: 0,
        reasons: {}
      }
    });

    assert.equal(summary, "Broadcast test was already processed");
  });
});

describe("buildTagRecord", () => {
  it("maps tags to indexed keys and limits length", () => {
    const tags = Array.from({ length: 10 }, (_, index) => `tag-${index + 1}`);
    const record = buildTagRecord(tags) ?? {};

    assert.equal(Object.keys(record).length, 8);
    assert.equal(record.tag_1, "tag-1");
    assert.equal(record.tag_8, "tag-8");
    assert.equal(record.tag_9, undefined);
  });

  it("returns undefined for empty tags", () => {
    assert.equal(buildTagRecord([]), undefined);
  });

  it("sanitizes tags for provider-safe ASCII format", () => {
    const record = buildTagRecord(["outcome=delivered", "segment=trial", "free form tag"]) ?? {};

    assert.equal(record.tag_1, "outcome-delivered");
    assert.equal(record.tag_2, "segment-trial");
    assert.equal(record.tag_3, "free-form-tag");
  });

  it("drops tags that become empty after sanitation", () => {
    const record = buildTagRecord(["===", "!!!", "kept_tag"]) ?? {};

    assert.equal(record.tag_1, "kept_tag");
    assert.equal(Object.keys(record).length, 1);
  });
});
