import { describe, expect, it } from "vitest";
import { sourceDigest } from "@/lib/ingestion/github-agent-adapter";

describe("sourceDigest with duplicate JSON keys", () => {
  it("last-wins: server digest matches manually-sorted canonical digest", () => {
    // RFC 8259: duplicate keys are allowed, last value wins.
    // The server's JSON.parse handles this identically to the client.
    const duplicatePayload = JSON.parse(
      '{"z":1,"a":"first","a":"last","b":2}'
    );
    // After parse: { z:1, a:"last", b:2 }
    const expected = JSON.parse('{"a":"last","b":2,"z":1}');
    // Both should produce the same canonical JSON: {"a":"last","b":2,"z":1}
    const digest = sourceDigest(duplicatePayload);
    const expectedDigest = sourceDigest(expected);
    expect(digest).toBe(expectedDigest);
  });

  it("deterministic: same duplicate keys produce same digest", () => {
    const p1 = JSON.parse('{"x":1,"x":2,"y":3}');
    const p2 = JSON.parse('{"x":1,"x":2,"y":3}');
    expect(sourceDigest(p1)).toBe(sourceDigest(p2));
  });
});