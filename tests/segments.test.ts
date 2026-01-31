import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContactStatus } from "@prisma/client";
import { buildSegmentDefinition } from "@/lib/segments";

describe("buildSegmentDefinition", () => {
  it("deduplicates identical filters", () => {
    const definition = buildSegmentDefinition([
      { type: "status", value: ContactStatus.ACTIVE },
      { type: "status", value: ContactStatus.ACTIVE },
      { type: "tag", value: "test" }
    ]);

    assert.equal(definition.filters.length, 2);
  });
});
