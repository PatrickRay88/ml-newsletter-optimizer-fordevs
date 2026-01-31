import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseContactsCsv } from "@/lib/contacts";

describe("parseContactsCsv", () => {
  it("parses CSV rows with email, timezone, and tags", () => {
    const csv = "email,timezone,tags\nuser@example.com,America/New_York,tag-a;tag-b";
    const rows = parseContactsCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "user@example.com");
    assert.equal(rows[0].timezone, "America/New_York");
    assert.deepEqual(rows[0].tags, ["tag-a", "tag-b"]);
  });

  it("throws when email column missing", () => {
    assert.throws(() => parseContactsCsv("timezone\nAmerica/New_York"));
  });
});
