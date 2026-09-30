import { describe, expect, it } from "vitest";

describe("test infrastructure", () => {
  it("runs vitest with the jsdom environment", () => {
    expect(typeof document).toBe("object");
    expect(1 + 1).toBe(2);
  });
});
