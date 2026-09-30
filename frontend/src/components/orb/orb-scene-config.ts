export const ORB_CAMERA = { distance: 4.6, fov: 34 } as const;
export function projectedHalfExtent(radius: number, distance: number, fovDegrees: number) {
  return radius / Math.sqrt(distance * distance - radius * radius) / Math.tan((fovDegrees * Math.PI) / 360);
}
