import * as THREE from './vendor/three.module.js';

const FACADES = {
  housingWarm: { wall: '#d9cfbb', window: '#52626a', rows: 20, columns: 9 },
  housingWhite: { wall: '#e0e1dc', window: '#506c75', rows: 22, columns: 9 },
  housingStone: { wall: '#b9bdbe', window: '#425d70', rows: 20, columns: 8 },
  glassBlue: { wall: '#466b81', window: '#7292a6', rows: 20, columns: 10, glass: true },
  glassSilver: { wall: '#7893a1', window: '#a6bec8', rows: 21, columns: 11, glass: true },
  laboratory: { wall: '#d9ddda', window: '#596f7c', rows: 9, columns: 10 },
  retail: { wall: '#b7b7aa', window: '#415563', rows: 2, columns: 11 },
  logistics: { wall: '#bcc4c4', window: '#5e727a', rows: 4, columns: 14, industrial: true },
  station: { wall: '#d6d7cb', window: '#647a87', rows: 3, columns: 14 },
  civic: { wall: '#ded9c8', window: '#526a77', rows: 5, columns: 9 }
};
const SOLIDS = { roof: 0xb5bbb6, roofEquipment: 0x647473, civicRoof: 0x879998, lawn: 0x75976a, roofGarden: 0x718e64, foliage: 0x52714e, trunk: 0x78664e, paving: 0xc3c4b7, water: 0x548f9d, bench: 0x7d6851, loadingDoor: 0x667f88, container: 0xaa6f52, stationAccent: 0xdbaa57, crane: 0xd2ae63, cable: 0x485b64 };
function facadeTexture(spec, dusk) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = spec.wall; context.fillRect(0, 0, 512, 512);
  const cellW = 512 / spec.columns, cellH = 512 / spec.rows;
  for (let row = 0; row < spec.rows; row++) for (let col = 0; col < spec.columns; col++) {
    const x = col * cellW, y = row * cellH;
    const illuminated = dusk && ((row * 17 + col * 29) % 11 < 4);
    context.fillStyle = illuminated ? '#e6b96e' : spec.window;
    const insetX = spec.glass ? 1 : cellW * .19, insetY = spec.glass ? 1 : cellH * .19;
    context.fillRect(x + insetX, y + insetY, cellW - insetX * 2, cellH - insetY * 2);
    if (spec.glass && !illuminated) {
      context.fillStyle = `rgba(220,237,241,${.035 + (col % 3) * .025})`;
      context.fillRect(x + 2, y + 1, cellW * .45, cellH - 2);
    }
    if (!spec.glass && !spec.industrial) {
      context.strokeStyle = 'rgba(205,211,205,.45)'; context.lineWidth = 1;
      context.strokeRect(x + insetX, y + insetY, cellW - insetX * 2, cellH - insetY * 2);
      if ((row * 3 + col) % 5 === 0) { context.fillStyle = 'rgba(207,201,181,.32)'; context.fillRect(x + insetX + 2, y + insetY + 1, cellW * .24, cellH * .56); }
      context.fillStyle = 'rgba(55,70,72,.18)';
      context.fillRect(x + insetX, y + cellH * .72, cellW - insetX * 2, 1.6);
    }
  }
  if (spec === FACADES.retail) {
    const names = ['茶', 'MARKET', '麵', 'CAFÉ', '生活', 'BOOKS', '北城', 'FOOD', '花', 'DESIGN', '商店'];
    const shades = ['#4b6b5e', '#89655b', '#536978', '#b1976d'];
    const y = 276;
    for (let col = 0; col < spec.columns; col++) {
      const x = col * cellW;
      context.fillStyle = shades[col % shades.length]; context.fillRect(x + 1, y, cellW - 2, 35);
      context.font = '600 10px -apple-system, sans-serif'; context.textAlign = 'center'; context.fillStyle = '#f0e6ca'; context.fillText(names[col % names.length], x + cellW / 2, y + 22);
      context.fillStyle = dusk ? '#b89763' : '#3d565c'; context.fillRect(x + 2, y + 38, cellW - 4, 193);
      context.fillStyle = dusk ? '#d5bc86' : '#829391'; context.fillRect(x + 6, y + 90, cellW - 12, 5); context.fillRect(x + 6, y + 151, cellW - 12, 4);
      context.fillStyle = '#b7c0b9'; context.fillRect(x + cellW / 2, y + 39, 2, 192); context.fillRect(x + 1, y + 232, cellW - 2, 4);
      context.fillStyle = 'rgba(231,234,218,.23)'; context.fillRect(x + 4, y + 42, cellW * .24, 170);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}
function solarTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d'); context.fillStyle = '#2d506c'; context.fillRect(0, 0, 128, 128);
  context.strokeStyle = '#668898'; context.lineWidth = 1;
  for (let i = 0; i <= 128; i += 16) { context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 128); context.stroke(); }
  for (let i = 0; i <= 128; i += 32) { context.beginPath(); context.moveTo(0, i); context.lineTo(128, i); context.stroke(); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export class MaterialLibrary {
  constructor() {
    this.day = new Map(); this.dusk = new Map(); this.timeOfDay = 'day';
    for (const [key, color] of Object.entries(SOLIDS)) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: key === 'water' ? .35 : .82, metalness: key === 'water' ? .08 : .02 });
      this.day.set(key, material); this.dusk.set(key, material);
    }
    const solar = new THREE.MeshStandardMaterial({ color: 0xffffff, map: solarTexture(), roughness: .5, metalness: .12 });
    this.day.set('solarPanel', solar); this.dusk.set('solarPanel', solar);
    for (const [key, spec] of Object.entries(FACADES)) {
      this.day.set(key, new THREE.MeshStandardMaterial({ color: 0xffffff, map: facadeTexture(spec, false), roughness: spec.glass ? .36 : .83, metalness: spec.glass ? .08 : .015 }));
      const map = facadeTexture(spec, true);
      this.dusk.set(key, new THREE.MeshStandardMaterial({ color: 0xffffff, map, emissiveMap: map, emissive: 0xc5965e, emissiveIntensity: .25, roughness: spec.glass ? .36 : .83, metalness: .015 }));
    }
  }
  get(key) { return (this.timeOfDay === 'dusk' ? this.dusk : this.day).get(key) || this.day.get('civic'); }
  setTimeOfDay(value) { this.timeOfDay = value; }
  dispose() {
    const unique = new Set([...this.day.values(), ...this.dusk.values()]);
    for (const material of unique) { material.map?.dispose(); material.dispose(); }
  }
}

export class DevelopmentBatches {
  constructor(scene, library) {
    this.scene = scene; this.library = library; this.meshes = new Map(); this.pickMeshes = [];
    this.geometry = { box: new THREE.BoxGeometry(1, 1, 1), cylinder: new THREE.CylinderGeometry(.5, .5, 1, 6), crown: new THREE.IcosahedronGeometry(.6, 0), crownDetail: new THREE.SphereGeometry(.55, 8, 6) };
    this.dummy = new THREE.Object3D(); this.baseColor = new THREE.Color(); this.layer = 'city';
  }
  rebuild(records) {
    for (const mesh of this.meshes.values()) { this.scene.remove(mesh); mesh.dispose(); }
    this.meshes.clear(); this.pickMeshes = [];
    const bins = new Map();
    for (const record of records.values()) for (const item of record.design.items) {
      const key = `${item.shape || 'box'}:${item.material}:${item.selectable === false ? 'context' : 'asset'}`;
      const entries = bins.get(key) || []; entries.push({ record, item }); bins.set(key, entries);
    }
    for (const [key, entries] of bins) {
      const [shape, material, pick] = key.split(':');
      const mesh = new THREE.InstancedMesh(this.geometry[shape], this.library.get(material), entries.length);
      mesh.castShadow = !['paving', 'lawn', 'water', 'cable'].includes(material);
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.entries = entries; mesh.userData.materialKey = material;
      mesh.userData.ids = entries.map(entry => entry.record.building.id);
      this.scene.add(mesh); this.meshes.set(key, mesh);
      if (pick === 'asset') this.pickMeshes.push(mesh);
    }
    this.updateTransforms(); this.updateColors();
  }
  updateTransforms() {
    for (const mesh of this.meshes.values()) {
      const entries = mesh.userData.entries;
      for (let i = 0; i < entries.length; i++) {
        const { record, item } = entries[i]; const p = record.progress;
        let visible = !item.phase || p >= item.phase;
        if (item.construction) visible = record.target < 1;
        const growth = item.fixed || item.construction ? 1 : Math.max(.015, p);
        this.dummy.position.set(record.location.x + item.x, item.y * growth + .13, record.location.z + item.z);
        this.dummy.rotation.set(item.tilt || 0, item.rotation || 0, 0);
        this.dummy.scale.set(visible ? item.w : .00001, visible ? item.h * growth : .00001, visible ? item.d : .00001);
        this.dummy.updateMatrix(); mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
  updateColors() {
    for (const mesh of this.meshes.values()) {
      for (let i = 0; i < mesh.userData.entries.length; i++) {
        const { record, item } = mesh.userData.entries[i]; const kind = record.building.kind;
        let color = 0xffffff;
        if (this.layer === 'housing') color = kind === 'housing' ? 0x95c883 : 0xb7c5c5;
        if (this.layer === 'mobility') color = kind === 'transit' ? 0xf5c965 : kind === 'office' ? 0x89c7d2 : 0xb8c2c4;
        if (this.layer === 'climate') color = ['solar', 'park'].includes(kind) ? 0xa8cd83 : kind === 'industry' ? 0xdb9b72 : 0xbbc9c5;
        if (item.construction || item.material === 'foliage' || item.material === 'trunk') color = 0xffffff;
        this.baseColor.setHex(color); mesh.setColorAt(i, this.baseColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  setDetail(view) { for (const [key, mesh] of this.meshes) if (key.startsWith('crown:')) { mesh.geometry = view === 'street' ? this.geometry.crownDetail : this.geometry.crown; mesh.computeBoundingSphere(); } }
  setLayer(value) { this.layer = value; this.updateColors(); }
  setTimeOfDay() { for (const mesh of this.meshes.values()) mesh.material = this.library.get(mesh.userData.materialKey); }
  pick(hit) {
    const entry = hit.object.userData.entries?.[hit.instanceId];
    if (!entry) return null;
    if (entry.item.phase && entry.record.progress < entry.item.phase) return null;
    return entry.record.building;
  }
  dispose() { for (const mesh of this.meshes.values()) { this.scene.remove(mesh); mesh.dispose(); } for (const geometry of Object.values(this.geometry)) geometry.dispose(); }
}
