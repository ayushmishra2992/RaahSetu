import { describe, expect, it } from "vitest";
import { passwordProblem } from "./validation";

describe("passwordProblem", () => {
  it("mirrors the backend password rule", () => {
    expect(passwordProblem("short1")).toMatch(/8 characters/);
    expect(passwordProblem("onlyletters")).toMatch(/letter and one number/);
    expect(passwordProblem("12345678")).toMatch(/letter and one number/);
    expect(passwordProblem("Strong-pass1")).toBeNull();
  });
});
