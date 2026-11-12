import { describe, expect, it } from "vitest";
import { DOC_SUFFIX_LENGTH, docNumber } from "../../src/lib/numbering";

describe("docNumber", () => {
  it("uses prefix, UTC date and a readable base32 suffix", () => {
    const n = docNumber("TRP", new Date("2026-11-12T10:00:00Z"));
    expect(n).toMatch(new RegExp(`^TRP-20261112-[0-9A-HJKMNP-TV-Z]{${DOC_SUFFIX_LENGTH}}$`));
    expect(n.split("-")[2]).not.toMatch(/[ILOU]/);
  });

  it("does not collide across a busy day's worth of numbers", () => {
    // 20k numbers is far beyond a real day for one company; with ~1.07e9
    // possible suffixes the expected number of collisions is ≈0.19.
    // A handful would indicate a broken generator (the old 4-digit one gave thousands).
    const seen = new Set<string>();
    const date = new Date("2026-11-12T00:00:00Z");
    for (let i = 0; i < 20_000; i++) seen.add(docNumber("TRP", date));
    expect(20_000 - seen.size).toBeLessThan(3);
  });
});
