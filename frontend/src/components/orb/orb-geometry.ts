import * as THREE from "three";

export function createOrbGeometry(compact = false) {
  const geometry = new THREE.SphereGeometry(1, compact ? 48 : 96, compact ? 48 : 96);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const deformation = 1 + Math.sin(x * 3.7 + y * 2.1) * 0.006 + Math.sin(z * 4.3 - y) * 0.004;
    position.setXYZ(i, x * deformation, y * deformation, z * deformation);
  }
  geometry.computeVertexNormals();
  return geometry;
}
