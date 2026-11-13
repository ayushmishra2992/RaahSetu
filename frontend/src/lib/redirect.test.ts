import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

const O = "https://app.example.test";
describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/orders?open=4", O)).toBe("/orders?open=4");
    expect(safeNext("/trips/1#stops", O)).toBe("/trips/1#stops");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "/\\/evil.example", "https://evil.example", "javascript:alert(1)", "/\tevil", "", null, "orders"]) {
      expect(safeNext(bad, O), String(bad)).toBe("/dashboard");
    }
  });
});
