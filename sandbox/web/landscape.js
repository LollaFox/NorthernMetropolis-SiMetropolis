import * as THREE from './vendor/three.module.js';
import { DISTRICTS, DISTRICT_LAND, DEEP_BAY, WETLANDS, RIVER, HILLS, RAIL_CORRIDORS, DEVELOPMENT_SITES } from './geography.js';
import { ribbon, roadTexture } from './mobility.js';

const noise = n => { const v = Math.sin(n * 127.13 + 173.42) * 43758.53; return v - Math.floor(v); };
const DISTRIBUTOR = [[-167, 83], [-120, 81], [-75, 81], [-25, 65], [13, 79], [60, 83], [103, 84], [149, 84]];
const asPoints = points => points.map(point => Array.isArray(point) ? point : [point.x, point.z]);
export function insidePolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export function terrainHeight(x, z) {
  let height = 0;
  for (const hill of HILLS) height += hill.height * Math.exp(-1.5 * (((x - hill.x) / hill.radiusX) ** 2 + ((z - hill.z) / hill.radiusZ) ** 2));
  let clearance = 1;
  for (const land of DISTRICT_LAND) {
    const xs = land.polygon.map(p => p.x), zs = land.polygon.map(p => p.z);
    const dx = Math.max(Math.min(...xs) - x, 0, x - Math.max(...xs));
    const dz = Math.max(Math.min(...zs) - z, 0, z - Math.max(...zs));
    clearance = Math.min(clearance, Math.min(1, Math.hypot(dx, dz) / 15));
  }
  const paths = [DISTRIBUTOR, ...RAIL_CORRIDORS.filter(route => route.status === 'existing').map(route => asPoints(route.points))];
  for (const path of paths) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], vx = b[0] - a[0], vz = b[1] - a[1];
    const t = THREE.MathUtils.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
    const distance = Math.hypot(x - a[0] - t * vx, z - a[1] - t * vz);
    clearance = Math.min(clearance, Math.min(1, distance / 8) ** 2);
  }
  return height * clearance;
}
export function isContextWater(x, z) {
  if (insidePolygon(x, z, DEEP_BAY.polygon) || WETLANDS.some(area => insidePolygon(x, z, area.polygon))) return true;
  for (let i = 1; i < RIVER.points.length; i++) {
    const a = RIVER.points[i - 1], b = RIVER.points[i];
    const vx = b.x - a.x, vz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz), 0, 1);
    if (Math.hypot(x - a.x - t * vx, z - a.z - t * vz) < RIVER.width * .6) return true;
  }
  return x < -174 && z < -35;
}

class StaticGeometry {
  constructor(scene) { this.scene = scene; this.bins = new Map(); this.meshes = []; }
  add(geometry, material, matrix = null, shadows = false) {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) copy.applyMatrix4(matrix);
    const bin = this.bins.get(material) || { geometries: [], shadows: false }; bin.geometries.push(copy); bin.shadows ||= shadows; this.bins.set(material, bin);
  }
  finish() {
    for (const [material, bin] of this.bins) {
      const count = bin.geometries.reduce((sum, geo) => sum + geo.attributes.position.count, 0);
      const geometry = new THREE.BufferGeometry();
      for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
        const values = new Float32Array(count * size); let offset = 0;
        for (const geo of bin.geometries) { if (geo.attributes[name]) values.set(geo.attributes[name].array, offset); offset += geo.attributes.position.count * size; }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
      }
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; mesh.castShadow = bin.shadows;
      this.scene.add(mesh); this.meshes.push(mesh);
      for (const geo of bin.geometries) geo.dispose();
    }
    this.bins.clear();
  }
  dispose() { for (const mesh of this.meshes) { this.scene.remove(mesh); mesh.geometry.dispose(); } }
}
function polygonGeometry(polygon, y = 0) {
  const shape = new THREE.Shape();
  polygon.forEach((point, index) => index ? shape.lineTo(point.x, -point.z) : shape.moveTo(point.x, -point.z));
  shape.closePath(); const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2); geo.translate(0, y, 0); return geo;
}

function fieldTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#92a282'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 50; i++) {
    const x = noise(i + 91) * 256, y = noise(i + 17) * 256;
    ctx.fillStyle = ['#a5ae8d', '#899f7f', '#a9a58b', '#85977a'][i % 4];
    ctx.fillRect(x, y, 25 + noise(i) * 45, 15 + noise(i + 12) * 30);
  }
  for (let i = 0; i < 500; i++) { ctx.fillStyle = 'rgba(45,75,42,.07)'; ctx.fillRect(noise(i + 650) * 256, noise(i + 920) * 256, 2, 1); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1 / 36, 1 / 36); return texture;
}

export class Landscape {
  constructor(scene, library) {
    this.scene = scene; this.library = library; this.static = new StaticGeometry(scene); this.materials = [];
    this.contextInstances = []; this.vacantSignature = ''; this.dummy = new THREE.Object3D(); this.roads = [];
    this.makeTerrain(); this.makeWater(); this.makeRoads(); this.makeRail(); this.makeContext(); this.makeVacantLand(); this.static.finish();
  }
  material(color, options = {}) { const material = new THREE.MeshStandardMaterial({ color, roughness: .9, ...options }); this.materials.push(material); return material; }
  box(x, y, z, w, h, d, material, shadows = false, rotation = 0) {
    this.dummy.position.set(x, y, z); this.dummy.rotation.set(0, rotation, 0); this.dummy.scale.set(w, h, d); this.dummy.updateMatrix();
    const geo = new THREE.BoxGeometry(1, 1, 1); this.static.add(geo, material, this.dummy.matrix, shadows); geo.dispose();
  }
  makeTerrain() {
    const farMaterial = this.material(0x879c83);
    const farGeo = new THREE.PlaneGeometry(3000, 2400); farGeo.rotateX(-Math.PI / 2);
    this.farGround = new THREE.Mesh(farGeo, farMaterial); this.farGround.position.y = -.22; this.scene.add(this.farGround);
    const width = 560, depth = 410, nx = 72, nz = 52, positions = [], colors = [], indices = [];
    const green = new THREE.Color(), a = new THREE.Color(0x889579), b = new THREE.Color(0x506d52), soil = new THREE.Color(0xb4b6a0);
    for (let row = 0; row <= nz; row++) for (let col = 0; col <= nx; col++) {
      const x = (col / nx - .5) * width, z = (row / nz - .5) * depth - 7;
      const height = terrainHeight(x, z);
      positions.push(x, height - .15, z);
      green.copy(a).lerp(b, Math.min(1, height / 30));
      if (DISTRICT_LAND.some(land => insidePolygon(x, z, land.polygon))) green.copy(soil);
      green.multiplyScalar(.96 + noise(row * 79 + col) * .08); colors.push(green.r, green.g, green.b);
      if (row < nz && col < nx) { const i = row * (nx + 1) + col; indices.push(i, i + nx + 1, i + 1, i + 1, i + nx + 1, i + nx + 2); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.setIndex(indices); geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, this.material(0xffffff, { vertexColors: true })); this.terrain.receiveShadow = true; this.scene.add(this.terrain);
    const land = this.material(0xffffff, { map: fieldTexture() });
    for (const area of DISTRICT_LAND) { const geo = polygonGeometry(area.polygon, -.04); this.static.add(geo, land); geo.dispose(); }
    // Restrained agricultural textures and field margins remain outside parcels.
    const field = this.material(0x9dab82), fieldDark = this.material(0x87966f);
    for (let i = 0; i < 35; i++) {
      const x = -164 + (i % 7) * 13.5, z = 80 + Math.floor(i / 7) * 8;
      if (terrainHeight(x, z) > 4) continue;
      const geo = new THREE.PlaneGeometry(11.6, 6.4); geo.rotateX(-Math.PI / 2); geo.translate(x, terrainHeight(x, z) + .08, z);
      this.static.add(geo, i % 3 ? field : fieldDark); geo.dispose();
    }
  }
  makeWater() {
    // Offset the shallow water surfaces at regional camera distances; the
    // offshore continuation ends at z=-40, clear of the western foreground.
    this.water = this.material(0x548a99, { roughness: .3, metalness: .1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const seaGeo = new THREE.PlaneGeometry(1500, 950); seaGeo.rotateX(-Math.PI / 2); seaGeo.translate(-924, .01, -515); this.static.add(seaGeo, this.water); seaGeo.dispose();
    const west = [{ x: -280, z: -180 }, { x: -92, z: -180 }, ...DEEP_BAY.polygon.slice(1), { x: -280, z: -40 }];
    const bay = polygonGeometry(west, .01); this.static.add(bay, this.water); bay.dispose();
    const river = ribbon(asPoints(RIVER.points), RIVER.width, .05); this.static.add(river, this.water); river.dispose();
    const wetland = this.material(0x748a70), pond = this.material(0x587f84, { roughness: .48 });
    for (const area of WETLANDS) {
      const patch = polygonGeometry(area.polygon, .07); this.static.add(patch, wetland); patch.dispose();
      const xs = area.polygon.map(p => p.x), zs = area.polygon.map(p => p.z);
      for (let z = Math.min(...zs) + 5; z < Math.max(...zs) - 3; z += 8) for (let x = Math.min(...xs) + 5; x < Math.max(...xs) - 3; x += 11) {
        if (!insidePolygon(x, z, area.polygon) || insidePolygon(x, z, DEEP_BAY.polygon)) continue;
        const cell = new THREE.PlaneGeometry(8.4, 5.7); cell.rotateX(-Math.PI / 2); cell.translate(x, .12, z); this.static.add(cell, pond); cell.dispose();
      }
    }
    const agriculture = this.material(0x99aa82), agricultureAlt = this.material(0xb3b397);
    for (let i = 0; i < 16; i++) {
      const strip = new THREE.PlaneGeometry(3.2, 12.5); strip.rotateX(-Math.PI / 2); strip.translate(26 + i * 3.8, .14, -51.5);
      this.static.add(strip, i % 3 ? agriculture : agricultureAlt); strip.dispose();
    }
    const bank = this.material(0x9aa27d);
    for (const offset of [-4.2, 4.2]) {
      const points = RIVER.points.map(p => [p.x, p.z + offset]); const edge = ribbon(points, 1.1, .12); this.static.add(edge, bank); edge.dispose();
    }
  }
  makeRoads() {
    const material = this.material(0xffffff, { map: roadTexture(), roughness: .97 });
    const add = (points, width = 3.1) => {
      this.roads.push(points);
      const geo = ribbon(points, width, .17, 16); this.static.add(geo, material); geo.dispose();
    };
    // Streets follow real mapped parcel rows, rather than an unrelated toy grid.
    for (const district of DISTRICTS) {
      const sites = DEVELOPMENT_SITES.filter(site => site.districtId === district.id);
      const rows = new Map(), columns = new Map();
      for (const site of sites) {
        const row = site.row ?? Math.round((site.z - district.z) / (district.id === 'ta-kwu-ling' ? 17 : 18.8) + (district.id === 'ta-kwu-ling' ? 3.5 : 2.5));
        const col = site.column ?? Math.round((site.x - district.x) / 14.4 + (district.id === 'ta-kwu-ling' ? 1 : 2.5));
        const rs = rows.get(row) || []; rs.push(site); rows.set(row, rs);
        const cs = columns.get(col) || []; cs.push(site); columns.set(col, cs);
      }
      const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);
      for (let index = 0; index < sortedRows.length; index++) {
        const sites = sortedRows[index][1].sort((a, b) => a.x - b.x);
        const offset = index === sortedRows.length - 1 ? 8.9 : -8.9;
        const points = [[sites[0].x - 7.2, sites[0].z + offset], ...sites.map(site => [site.x, site.z + offset]), [sites[sites.length - 1].x + 7.2, sites[sites.length - 1].z + offset]];
        add(points, 3.0);
      }
      const sortedColumns = [...columns.entries()].sort((a, b) => a[0] - b[0]);
      for (let index = 0; index < sortedColumns.length; index += 2) {
        const sites = sortedColumns[index][1].sort((a, b) => a.z - b.z);
        add([[sites[0].x - 7.2, sites[0].z - 8.9], ...sites.map(site => [site.x - 7.2, site.z]), [sites[sites.length - 1].x - 7.2, sites[sites.length - 1].z + 8.9]], 2.5);
      }
    }
    // Regional distributor stays on the southern side of the development pads.
    add(DISTRIBUTOR, 4.1);
  }
  makeRail() {
    const concrete = this.material(0xb2b9b7), rail = this.material(0x525f65), planned = new THREE.MeshBasicMaterial({ color: 0xccb784, transparent: true, opacity: .85 }); this.materials.push(planned);
    for (const route of RAIL_CORRIDORS) {
      const points = asPoints(route.points);
      const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, .4, z)), false, 'catmullrom', .12);
      const sampled = curve.getPoints(80).map(p => [p.x, p.z]);
      if (route.status === 'planned') {
        for (let i = 0; i < sampled.length - 3; i += 6) { const dashed = ribbon(sampled.slice(i, i + 4), .8, (x, z) => terrainHeight(x, z) + .34); this.static.add(dashed, planned); dashed.dispose(); }
        continue;
      }
      const deck = ribbon(sampled, 2.3, 1.2); this.static.add(deck, concrete); deck.dispose();
      const tracks = ribbon(sampled, 1.0, 1.25); this.static.add(tracks, rail); tracks.dispose();
      for (let i = 2; i < sampled.length; i += 8) { const [x, z] = sampled[i]; this.box(x, .55, z, .42, 1.1, 1.8, concrete); }
    }
  }
  makeContext() {
    const distant = this.material(0x9babb0, { map: this.library.get('glassSilver').map, roughness: .8 }), distantStone = this.material(0xa3b0b2, { map: this.library.get('housingStone').map }), villages = this.library.get('housingStone'), villageRoof = this.material(0x847d72);
    // Existing Shenzhen context is muted and unselectable, outside the model.
    for (let i = 0; i < 76; i++) {
      const cluster = [-85, -20, 62, 126][i % 4];
      const x = cluster + (noise(i + 1) - .5) * 58, z = -115 - noise(i + 60) * 57;
      const h = 7 + noise(i + 120) ** 2 * 31;
      this.box(x, h / 2, z, 4 + noise(i + 9) * 5, h, 4.2 + noise(i + 19) * 4, i % 3 ? distant : distantStone);
      this.box(x, h + .15, z, 4.3 + noise(i + 9) * 5, .3, 4.5 + noise(i + 19) * 4, distant);
      if (i % 3 === 0) this.box(x, 1.9, z, 8.6, 3.8, 8.1, distantStone);
      if (i % 7 === 0) this.box(x, h + 1.8, z, 3, 3.6, 3, distant);
    }
    // Small existing settlements provide a second scale beyond new developments.
    for (let i = 0; i < 105; i++) {
      const east = i > 58;
      const x = east ? 151 + noise(i + 5) * 14 : i < 28 ? -164 + noise(i + 5) * 5 : -164 + noise(i + 5) * 73;
      const z = east ? 30 + noise(i + 7) * 67 : i < 28 ? -27 + noise(i + 7) * 101 : 80 + noise(i + 7) * 14;
      if (terrainHeight(x, z) > 5 || isContextWater(x, z)) continue;
      const h = 2 + noise(i + 8) * 2.5, y = terrainHeight(x, z);
      this.box(x, y + h / 2, z, 2.8, h, 3.6, villages);
      this.box(x, y + h + .15, z, 3.1, .3, 3.9, villageRoof);
    }
    const treeGeometry = new THREE.IcosahedronGeometry(1, 0), trunkGeometry = new THREE.CylinderGeometry(.1, .1, 1.2, 5);
    const forest = [], trunks = [];
    for (let i = 0; i < 600; i++) {
      const x = -198 + noise(i + 200) * 396, z = -64 + noise(i + 450) * 221;
      const height = terrainHeight(x, z);
      if (isContextWater(x, z) || DISTRICT_LAND.some(land => insidePolygon(x, z, land.polygon))) continue;
      if (height < 1.2 && i % 4 !== 0) continue;
      forest.push({ x, z, height, scale: .9 + noise(i + 90) * 1.8 });
    }
    const crowns = new THREE.InstancedMesh(treeGeometry, this.library.get('foliage'), forest.length);
    const stems = new THREE.InstancedMesh(trunkGeometry, this.library.get('trunk'), forest.length);
    for (let i = 0; i < forest.length; i++) {
      const t = forest[i];
      this.dummy.position.set(t.x, t.height + 1.8 * t.scale, t.z); this.dummy.rotation.set(0, noise(i) * 3, 0); this.dummy.scale.set(t.scale, t.scale * 1.25, t.scale); this.dummy.updateMatrix(); crowns.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.y = t.height + .7 * t.scale; this.dummy.scale.setScalar(t.scale); this.dummy.updateMatrix(); stems.setMatrixAt(i, this.dummy.matrix);
      crowns.setColorAt(i, new THREE.Color().setHSL(.24 + noise(i + 8) * .04, .19, .31 + noise(i + 11) * .07));
    }
    crowns.castShadow = true; crowns.receiveShadow = true;
    this.scene.add(crowns, stems); this.contextInstances.push(crowns, stems); this.forestCrowns = crowns; this.forestFarGeometry = treeGeometry; this.forestNearGeometry = new THREE.SphereGeometry(1, 7, 5);
  }
  makeVacantLand() {
    this.vacantGeometry = new THREE.PlaneGeometry(11.8, 14.2); this.vacantGeometry.rotateX(-Math.PI / 2);
    this.vacantFields = new THREE.InstancedMesh(this.vacantGeometry, this.material(0xffffff, { map: fieldTexture() }), DEVELOPMENT_SITES.length);
    // The texture uses parcel UV coordinates here, rather than world UVs.
    this.vacantFields.material.map.repeat.set(1, 1);
    this.vacantTrees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.6, 0), this.library.get('foliage'), DEVELOPMENT_SITES.length * 2);
    this.scene.add(this.vacantFields, this.vacantTrees);
  }
  update(world) {
    const occupied = new Set(world.buildings.map(building => `${building.x}:${building.z}`));
    const signature = [...occupied].sort().join('|'); if (signature === this.vacantSignature) return; this.vacantSignature = signature;
    let field = 0, tree = 0;
    for (const site of DEVELOPMENT_SITES) {
      if (occupied.has(`${site.logicalX}:${site.logicalZ}`)) continue;
      this.dummy.position.set(site.x, .1, site.z); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix(); this.vacantFields.setMatrixAt(field, this.dummy.matrix);
      this.vacantFields.setColorAt(field++, new THREE.Color(site.row % 3 === 0 ? 0xc6be9c : site.column % 3 === 0 ? 0xb1c497 : 0x8ea782));
      for (let i = 0; i < 2; i++) {
        this.dummy.position.set(site.x - 4.4 + i * 8.7, 1.3, site.z + (i ? 4 : -4)); this.dummy.scale.set(1.1, 1.4, 1.1); this.dummy.updateMatrix(); this.vacantTrees.setMatrixAt(tree++, this.dummy.matrix);
      }
    }
    this.vacantFields.count = field; this.vacantTrees.count = tree;
    this.vacantFields.instanceMatrix.needsUpdate = this.vacantTrees.instanceMatrix.needsUpdate = true;
    if (this.vacantFields.instanceColor) this.vacantFields.instanceColor.needsUpdate = true;
    this.vacantFields.computeBoundingSphere(); this.vacantTrees.computeBoundingSphere();
  }
  setDetail(view) {
    this.forestCrowns.geometry = view === 'street' ? this.forestNearGeometry : this.forestFarGeometry;
    this.forestCrowns.computeBoundingSphere();
  }
  normalizedRail() { return RAIL_CORRIDORS.map(route => ({ ...route, points: asPoints(route.points), elevation: 1.3 })); }
  setTimeOfDay() { /* Existing context remains separate from simulated capacities. */ }
  dispose() { this.static.dispose(); this.scene.remove(this.terrain, this.farGround, this.vacantFields, this.vacantTrees); this.terrain.geometry.dispose(); this.farGround.geometry.dispose(); this.vacantFields.geometry.dispose(); this.vacantTrees.geometry.dispose(); this.vacantFields.dispose(); this.vacantTrees.dispose(); this.forestNearGeometry.dispose(); for (const mesh of this.contextInstances) { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); } for (const material of this.materials) { material.map?.dispose(); material.dispose(); } }
}
