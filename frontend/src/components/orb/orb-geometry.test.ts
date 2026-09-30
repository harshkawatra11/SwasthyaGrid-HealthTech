import { describe, expect, it } from "vitest";
import { ORB_CAMERA, projectedHalfExtent } from "./orb-scene-config";

describe("orb camera framing", () => {
  it("keeps the maximum animated shell inside a safe frame", () => {
    const maximumRadius = 1.012 * 1.026;
    expect(projectedHalfExtent(maximumRadius, ORB_CAMERA.distance, ORB_CAMERA.fov)).toBeLessThan(0.8);
  });
});
