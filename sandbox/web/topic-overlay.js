import * as THREE from './vendor/three.module.js';
import { DISTRICTS } from './geography.js';
import { getArea } from './policy-catalog.js';

const STYLES = Object.freeze({
  housing: Object.freeze({unit: 250, maxGlyphs: 80, noun: 'housing units', shortNoun: 'units', title: 'HOUSING', icon: 'home', width: 3.8, height: 10, depth: 3.6}),
  education: Object.freeze({unit: 100, maxGlyphs: 50, noun: 'school places', shortNoun: 'places', title: 'SCHOOL PLACES', icon: 'school', width: 4.3, height: 5.6, depth: 3.8})
});
const DATA_KEYS = ['topicPolicy', 'topicArea', 'topicModel', 'topicDelivered', 'topicGlyphs', 'topicDate', 'topicOverlay'];
const GOLD = 0xffbd4c;
const OUTLINE = 0x64747b;
const INK = 0x19333c;

// Capacity symbols on a schematic study map. These are neither buildings nor catchments.
export class TopicOverlay {
  constructor(city) {
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'Topic capacity study';
    this.group.userData.policyOverlay = true;
    this.group.visible = false;
    this.resources = {geometries: new Set(), materials: new Set(), textures: new Set()};
    this.disposed = false;
    city.scene.add(this.group);
  }

  own(kind, resource) { this.resources[kind].add(resource); return resource; }

  clear() {
    this.group.clear();
    for (const resources of Object.values(this.resources)) {
      for (const resource of resources) resource.dispose();
      resources.clear();
    }
    this.group.userData = {policyOverlay: true};
    for (const key of DATA_KEYS) delete this.city.canvas?.dataset?.[key];
  }

  show(policy, snapshot = null) {
    if (this.disposed) throw new Error('This study overlay has been disposed.');
    const style = STYLES[policy?.model];
    if (!style) throw new Error('A housing or education policy is required.');
    const area = getArea(policy.areaId);
    const district = DISTRICTS.find(item => item.id === area.districtId);
    if (!district) throw new Error('The selected policy has no schematic district.');
    if (snapshot?.policyId && snapshot.policyId !== policy.id) throw new Error('Snapshot policy does not match the study.');
    if (snapshot?.model && snapshot.model !== policy.model) throw new Error('Snapshot model does not match the study.');
    const delivered = snapshot === null ? 0 : snapshot.delivered;
    if (!Number.isSafeInteger(delivered) || delivered < 0 || delivered > style.unit * style.maxGlyphs) {
      throw new Error(`Commissioned capacity must be a whole number 0–${style.unit * style.maxGlyphs}.`);
    }

    this.clear();
    this.group.position.set(district.x, 0, district.z);
    this.group.visible = true;
    this.addOutline();
    const glyphs = delivered ? Math.ceil(delivered / style.unit) : 0;
    if (glyphs) this.addGlyphs(glyphs, delivered, style);
    this.addCategoryMarker(style, delivered, snapshot);
    const phase = snapshot === null ? `Planned · 0 commissioned ${style.noun} · analysis not run` : `${snapshot.date || 'Selected month'} · ${delivered.toLocaleString('en-US')} commissioned ${style.noun}`;
    const lines = [`${style.title} · ${area.label}`, phase, 'HYPOTHETICAL SCENARIO · SCHEMATIC LOCATION',
      `1 full symbol = ${style.unit} ${style.shortNoun} · partial height = partial capacity`,
      'Capacity symbols · not actual buildings / catchment'];
    this.addLabel(lines, delivered > 0);
    Object.assign(this.group.userData, {policyId: policy.id, areaId: policy.areaId, model: policy.model,
      delivered, glyphs, date: snapshot?.date ?? '', state: snapshot === null ? 'planned' : 'analysed', label: lines.join('\n')});
    const dataset = this.city.canvas?.dataset;
    if (dataset) Object.assign(dataset, {topicPolicy: policy.id, topicArea: policy.areaId, topicModel: policy.model,
      topicDelivered: String(delivered), topicGlyphs: String(glyphs), topicDate: snapshot?.date ?? '', topicOverlay: snapshot === null ? 'planned' : 'analysed'});
  }

  addOutline() {
    // A translucent analytical tray separates symbols from the original white city.
    // Its dimensions are schematic presentation coordinates, not policy boundaries.
    const trayGeometry = this.own('geometries', new THREE.BoxGeometry(57, .45, 45));
    const trayMaterial = this.own('materials', new THREE.MeshBasicMaterial({color: OUTLINE,
      transparent: true, opacity: .18, depthTest: false, depthWrite: false, toneMapped: false}));
    const tray = new THREE.Mesh(trayGeometry, trayMaterial); tray.position.y = 2.5; tray.renderOrder = 11;
    tray.name = 'Schematic symbol tray'; tray.userData.kind = 'study-tray'; this.group.add(tray);
    const geometry = this.own('geometries', new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-28, 3, -22), new THREE.Vector3(28, 3, -22),
      new THREE.Vector3(28, 3, 22), new THREE.Vector3(-28, 3, 22)
    ]));
    const material = this.own('materials', new THREE.LineDashedMaterial({color: OUTLINE,
      dashSize: 2.5, gapSize: 1.8, transparent: true, opacity: .85, depthTest: false, depthWrite: false, toneMapped: false}));
    const outline = new THREE.LineLoop(geometry, material);
    outline.name = 'Schematic study envelope';
    outline.userData.kind = 'study-outline';
    outline.renderOrder = 13;
    outline.computeLineDistances();
    this.group.add(outline);
    const cornerGeometry = this.own('geometries', new THREE.BoxGeometry(1.1, .65, 6));
    const cornerMaterial = this.own('materials', new THREE.MeshBasicMaterial({color: INK,
      transparent: true, opacity: .85, depthTest: false, depthWrite: false, toneMapped: false}));
    for (const x of [-28, 28]) for (const z of [-22, 22]) {
      const corner = new THREE.Mesh(cornerGeometry, cornerMaterial); corner.position.set(x, 3, z);
      corner.userData.kind = 'study-corner'; corner.renderOrder = 13; this.group.add(corner);
      const cross = new THREE.Mesh(cornerGeometry, cornerMaterial); cross.position.copy(corner.position); cross.rotation.y = Math.PI / 2;
      cross.userData.kind = 'study-corner'; cross.renderOrder = 13; this.group.add(cross);
    }
  }

  addGlyphs(count, delivered, style) {
    // Fixed capacity scale across all months. Only the final glyph can be partial.
    const {unit, width, height, depth} = style;
    const geometry = this.own('geometries', new THREE.BoxGeometry(width, height, depth));
    const material = this.own('materials', new THREE.MeshBasicMaterial({color: GOLD,
      transparent: true, opacity: .96, depthTest: false, depthWrite: false, toneMapped: false}));
    const edgesGeometry = this.own('geometries', new THREE.EdgesGeometry(geometry));
    const edgesMaterial = this.own('materials', new THREE.LineBasicMaterial({color: INK,
      transparent: true, opacity: .98, depthTest: false, depthWrite: false, toneMapped: false}));
    const roofGeometry = this.own('geometries', style.icon === 'home'
      ? new THREE.ConeGeometry(2.65, 1.2, 4) : new THREE.BoxGeometry(width + .3, .45, depth + .3));
    const roofMaterial = this.own('materials', new THREE.MeshBasicMaterial({color: INK,
      transparent: true, opacity: .92, depthTest: false, depthWrite: false, toneMapped: false}));
    const facadeGeometry = this.own('geometries', new THREE.PlaneGeometry(width * .85, height * .85));
    const facadeCanvas = document.createElement('canvas'); facadeCanvas.width = 128; facadeCanvas.height = 256;
    const facadeContext = facadeCanvas.getContext('2d');
    if (facadeContext) {
      facadeContext.fillStyle = '#19333c';
      const rows = style.icon === 'home' ? 4 : 2;
      for (let row = 0; row < rows; row++) for (let column = 0; column < 2; column++) facadeContext.fillRect(18 + column * 65, 14 + row * 47, 25, 25);
      facadeContext.fillRect(48, 205, 32, 51);
    }
    const facadeTexture = this.own('textures', new THREE.CanvasTexture(facadeCanvas)); facadeTexture.colorSpace = THREE.SRGBColorSpace;
    const facadeMaterial = this.own('materials', new THREE.MeshBasicMaterial({map: facadeTexture, transparent: true,
      depthTest: false, depthWrite: false, toneMapped: false}));
    const columns = 10, rows = Math.ceil(count / columns);
    for (let i = 0; i < count; i++) {
      const capacity = Math.min(unit, delivered - i * unit), fraction = capacity / unit;
      const glyph = new THREE.Mesh(geometry, material);
      glyph.name = `${style.title} commissioned capacity symbol`;
      glyph.userData = {kind: 'capacity-glyph', capacity, fraction, icon: style.icon, baseHeight: height};
      glyph.scale.y = fraction;
      glyph.position.set((i % columns - (columns - 1) / 2) * 5, 3 + height * fraction / 2,
        (Math.floor(i / columns) - (rows - 1) / 2) * 5);
      glyph.renderOrder = 14;
      const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial); edges.renderOrder = 15;
      edges.userData.kind = 'capacity-outline'; glyph.add(edges);
      const roof = new THREE.Mesh(roofGeometry, roofMaterial); roof.position.y = height / 2 + (style.icon === 'home' ? .6 : .225);
      if (style.icon === 'home') roof.rotation.y = Math.PI / 4;
      roof.renderOrder = 15; roof.userData.kind = 'capacity-roof'; glyph.add(roof);
      for (const side of [-1, 1]) {
        const facade = new THREE.Mesh(facadeGeometry, facadeMaterial); facade.position.z = side * (depth / 2 + .025);
        if (side < 0) facade.rotation.y = Math.PI;
        facade.renderOrder = 16; facade.userData.kind = 'capacity-facade'; glyph.add(facade);
      }
      this.group.add(glyph);
    }
  }

  addCategoryMarker(style, delivered, snapshot) {
    const canvas = document.createElement('canvas'); canvas.width = 448; canvas.height = 432;
    const context = canvas.getContext('2d'); if (!context) return;
    const active = delivered > 0, foreground = active ? '#ffbd4c' : '#f0f4f5';
    context.fillStyle = '#19333c'; context.fillRect(0, 0, 448, 432);
    context.fillStyle = foreground; context.fillRect(0, 0, 448, 12);
    context.strokeStyle = foreground; context.lineWidth = 13; context.lineJoin = 'round'; context.lineCap = 'round';
    context.beginPath(); context.moveTo(100, 166); context.lineTo(224, 65); context.lineTo(348, 166); context.stroke();
    if (style.icon === 'home') {
      context.strokeRect(131, 166, 186, 112); context.fillRect(203, 211, 42, 67);
      context.fillRect(154, 191, 26, 27); context.fillRect(268, 191, 26, 27);
    } else {
      context.strokeRect(107, 166, 234, 112); context.fillRect(206, 228, 36, 50);
      context.fillRect(130, 198, 29, 27); context.fillRect(289, 198, 29, 27);
      context.beginPath(); context.arc(224, 190, 17, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.moveTo(224, 180); context.lineTo(224, 190); context.lineTo(232, 195); context.stroke();
      context.beginPath(); context.moveTo(224, 65); context.lineTo(224, 26); context.lineTo(276, 38); context.lineTo(224, 51); context.stroke();
    }
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.font = '700 38px sans-serif'; context.fillText(style.title, 224, 320, 416);
    const state = active ? `${delivered.toLocaleString('en-US')} COMMISSIONED`
      : snapshot?.policyState === 'not_applied' ? 'NOT APPLIED · 0 COMMISSIONED'
      : snapshot?.policyState === 'in_effect' ? 'NO ADDITIONS · 0 COMMISSIONED' : 'PLANNED · 0 COMMISSIONED';
    context.font = '700 24px sans-serif'; context.fillStyle = active ? '#ffcf75' : '#d9e2e6'; context.fillText(state, 224, 369, 416);
    context.font = '21px sans-serif'; context.fillStyle = '#d9e2e6'; context.fillText('CAPACITY SYMBOL · SCHEMATIC', 224, 407, 416);
    const marker = this.addCanvasSprite(canvas, 25, 25 * 432 / 448);
    marker.position.set(-37, 23, 0); marker.renderOrder = 18; marker.name = `${style.title} study marker`;
    marker.userData = {kind: 'category-marker', icon: style.icon, state, commissioned: delivered, schematic: true};
    const leaderGeometry = this.own('geometries', new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-28, 3, 0), new THREE.Vector3(-37, 12, 0)
    ]));
    const leaderMaterial = this.own('materials', new THREE.LineBasicMaterial({color: INK,
      transparent: true, opacity: .9, depthTest: false, depthWrite: false, toneMapped: false}));
    const leader = new THREE.Line(leaderGeometry, leaderMaterial); leader.renderOrder = 13; leader.userData.kind = 'marker-leader'; this.group.add(leader);
  }

  addCanvasSprite(canvas, width, height) {
    const texture = this.own('textures', new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace;
    const material = this.own('materials', new THREE.SpriteMaterial({map: texture, transparent: true,
      depthTest: false, depthWrite: false, fog: false, toneMapped: false}));
    const sprite = new THREE.Sprite(material); sprite.scale.set(width, height, 1); this.group.add(sprite); return sprite;
  }

  addLabel(lines, active) {
    const canvas = document.createElement('canvas');
    canvas.width = 1536; canvas.height = 330;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = 'rgba(22,40,47,.94)'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    lines.forEach((line, index) => {
      context.fillStyle = index === 1 && active ? '#ffcf75' : '#edf1ee';
      context.font = index === 0 ? '700 49px sans-serif' : index === 1 ? '600 41px sans-serif' : '31px sans-serif';
      context.fillText(line, canvas.width / 2, 41 + index * 62, canvas.width - 40);
    });
    const label = this.addCanvasSprite(canvas, 112, 112 * 330 / 1536);
    label.name = 'Hypothetical study annotation';
    label.userData = {kind: 'study-label', text: lines.join('\n')};
    label.position.set(0, 44, -28); label.renderOrder = 19;
  }

  hide() { this.group.visible = false; for (const key of DATA_KEYS) delete this.city.canvas?.dataset?.[key]; }

  dispose() {
    if (this.disposed) return;
    this.hide(); this.clear(); this.group.removeFromParent(); this.disposed = true;
  }
}
