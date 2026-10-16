import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";

describe("engine", () => {
  it("runs", () => {
    expect(new Engine({ name: "a" }).run(2, 1)).toBe(1);
  });
  it("picks a mode", () => {
    for (const k of ["fast", "slow"]) {
      expect(new Engine({ name: "a" }).mode(k)).toBeGreaterThan(0);
    }
  });
});
