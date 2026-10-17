import * as THREE from './vendor/three.module.js';

export function ribbon(points, width, y = .11, repeat = 16) {
  const positions = [], uv = [], indices = [];
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i], previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    if (i) distance += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    const angle = Math.atan2(next[1] - previous[1], next[0] - previous[0]);
    const dx = -Math.sin(angle) * width / 2, dz = Math.cos(angle) * width / 2;
    const elevation = typeof y === 'function' ? y(point[0], point[1]) : y;
    positions.push(point[0] + dx, elevation, point[1] + dz, point[0] - dx, elevation, point[1] - dz);
    uv.push(distance / repeat, 0, distance / repeat, 1);
    if (i < points.length - 1) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

export function roadTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext('2d'); context.fillStyle = '#657074'; context.fillRect(0, 0, 256, 64);
  context.fillStyle = '#b8b8a3'; context.fillRect(0, 0, 256, 5); context.fillRect(0, 59, 256, 5);
  context.fillStyle = '#d5c57d'; context.fillRect(0, 9, 256, 1); context.fillRect(0, 54, 256, 1);
  context.fillStyle = '#e0e1d6'; context.fillRect(15, 31, 78, 1.2); context.fillRect(142, 31, 78, 1.2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; texture.anisotropy = 2; return texture;
}

function boundMovingMeshes(meshes, paths, padding) {
  const box = new THREE.Box3();
  // Uniform Catmull-Rom segments are cubic Beziers. Their control-point hull
  // bounds every position, including interpolation overshoot between stops.
  for (const path of paths) for (let i = 0; i < path.points.length - 1; i++) {
    const p1 = path.points[i], p2 = path.points[i + 1];
    const p0 = path.points[i - 1] || p1.clone().multiplyScalar(2).sub(p2);
    const p3 = path.points[i + 2] || p2.clone().multiplyScalar(2).sub(p1);
    box.expandByPoint(p1); box.expandByPoint(p2);
    box.expandByPoint(p1.clone().add(p2.clone().sub(p0).multiplyScalar(path.tension / 3)));
    box.expandByPoint(p2.clone().sub(p3.clone().sub(p1).multiplyScalar(path.tension / 3)));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());
  box.expandByScalar(padding);
  for (const mesh of meshes) { mesh.boundingBox = box.clone(); mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); }
}

export class Mobility {
  constructor(scene, roads, corridors = []) {
    this.scene = scene; this.elapsed = 0; this.roads = roads;
    this.paths = roads.filter(points => points.length >= 2).map(points => new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, .24, z)), false, 'catmullrom', .05));
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.body = new THREE.InstancedMesh(this.geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .7 }), 76);
    this.windows = new THREE.InstancedMesh(this.geometry, new THREE.MeshStandardMaterial({ color: 0x354b5b, roughness: .3 }), 76);
    this.body.count = this.windows.count = 0;
    this.body.castShadow = true;
    scene.add(this.body, this.windows);
    this.dummy = new THREE.Object3D();
    const colors = [0xf0eee1, 0xad4240, 0xb0bdc2, 0x697e83, 0xd5b16d, 0x436b78];
    for (let i = 0; i < 76; i++) this.body.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    const existing = corridors.filter(route => route.status === 'existing' || route.type === 'existing');
    this.railPaths = existing.map(route => new THREE.CatmullRomCurve3((route.points || route.path).map(([x, z]) => new THREE.Vector3(x, route.elevation || .5, z)), false, 'catmullrom', .15));
    this.trainBody = new THREE.InstancedMesh(this.geometry, new THREE.MeshStandardMaterial({ color: 0xb5bebd, roughness: .72 }), Math.max(1, this.railPaths.length * 4));
    this.trainGlass = new THREE.InstancedMesh(this.geometry, new THREE.MeshStandardMaterial({ color: 0x32586d, roughness: .4 }), Math.max(1, this.railPaths.length * 4));
    this.trainBody.count = this.trainGlass.count = 0;
    scene.add(this.trainBody, this.trainGlass);
    this.pedestrians = new THREE.InstancedMesh(new THREE.CylinderGeometry(.12, .12, .75, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9 }), 64);
    this.pedestrians.count = 0; scene.add(this.pedestrians);
    const clothing = [0x35515d, 0xbc9d76, 0x729985, 0xdfd8c5, 0x72829b];
    for (let i = 0; i < 64; i++) this.pedestrians.setColorAt(i, new THREE.Color(clothing[i % clothing.length]));
    boundMovingMeshes([this.body, this.windows, this.pedestrians], this.paths, 3);
    boundMovingMeshes([this.trainBody, this.trainGlass], this.railPaths, 3);
    this.illuminated = false;
  }
  update(world) {
    this.body.count = this.windows.count = this.paths.length ? Math.min(76, Math.max(18, Math.round((world.metrics.population || 0) / 700))) : 0;
    this.pedestrians.count = this.paths.length ? Math.min(64, Math.max(12, Math.round((world.metrics.population || 0) / 900))) : 0;
  }
  setTimeOfDay(value) {
    this.illuminated = value === 'dusk';
    this.windows.material.emissive.setHex(value === 'dusk' ? 0x57685d : 0x000000);
    this.windows.material.emissiveIntensity = .2;
    this.trainGlass.material.emissive.setHex(value === 'dusk' ? 0x7e7355 : 0x000000);
    this.trainGlass.material.emissiveIntensity = .25;
  }
  animate(dt, playing) {
    if (playing) this.elapsed += dt;
    for (let i = 0; i < this.body.count; i++) {
      const curve = this.paths[i % this.paths.length];
      const bus = i % 13 === 0;
      const length = curve.getLength();
      const t = (this.elapsed * (bus ? 3 : 4.2) / length + i * .137) % 1;
      const p = curve.getPoint(t), tangent = curve.getTangent(t);
      const heading = Math.atan2(tangent.x, tangent.z);
      const direction = i % 2 ? -1 : 1;
      p.x += Math.cos(heading) * .61 * direction; p.z -= Math.sin(heading) * .61 * direction;
      this.dummy.position.set(p.x, bus ? .8 : .51, p.z);
      this.dummy.rotation.set(0, heading, 0); this.dummy.scale.set(bus ? .9 : .66, bus ? 1.12 : .47, bus ? 3.4 : 1.55);
      this.dummy.updateMatrix(); this.body.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.y += bus ? .17 : .17; this.dummy.scale.set(bus ? .93 : .62, bus ? .31 : .25, bus ? 3 : .9);
      this.dummy.updateMatrix(); this.windows.setMatrixAt(i, this.dummy.matrix);
    }
    this.body.instanceMatrix.needsUpdate = this.windows.instanceMatrix.needsUpdate = true;
    let index = 0;
    for (let r = 0; r < this.railPaths.length; r++) {
      const path = this.railPaths[r], length = path.getLength();
      for (let i = 0; i < 4; i++) {
        const t = (this.elapsed * 7 / length + r * .4 - i * 4.2 / length + 2) % 1;
        const p = path.getPoint(t), tangent = path.getTangent(t);
        this.dummy.position.set(p.x, p.y + .6, p.z); this.dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0); this.dummy.scale.set(1.15, 1.15, 3.8);
        this.dummy.updateMatrix(); this.trainBody.setMatrixAt(index, this.dummy.matrix);
        this.dummy.position.y += .13; this.dummy.scale.set(1.17, .42, 3.3); this.dummy.updateMatrix(); this.trainGlass.setMatrixAt(index++, this.dummy.matrix);
      }
    }
    this.trainBody.count = this.trainGlass.count = index;
    this.trainBody.instanceMatrix.needsUpdate = this.trainGlass.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.pedestrians.count; i++) {
      const curve = this.paths[(i * 7) % this.paths.length], length = curve.getLength();
      const t = (this.elapsed * .45 / length + i * .193) % 1;
      const p = curve.getPoint(t), direction = curve.getTangent(t);
      const heading = Math.atan2(direction.x, direction.z);
      this.dummy.position.set(p.x + Math.cos(heading) * 1.52, .62, p.z - Math.sin(heading) * 1.52);
      this.dummy.rotation.set(0, heading, 0); this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); this.pedestrians.setMatrixAt(i, this.dummy.matrix);
    }
    this.pedestrians.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    for (const mesh of [this.body, this.windows, this.trainBody, this.trainGlass, this.pedestrians]) { this.scene.remove(mesh); mesh.dispose(); mesh.material.dispose(); }
    this.geometry.dispose(); this.pedestrians.geometry.dispose();
  }
}
