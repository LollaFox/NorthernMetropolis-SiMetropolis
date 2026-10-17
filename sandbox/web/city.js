import * as THREE from './vendor/three.module.js';
import { DISTRICTS, locateBuilding } from './geography.js';
import { development } from './architecture.js';
import { MaterialLibrary, DevelopmentBatches } from './scene-batches.js';
import { Landscape, terrainHeight, isContextWater } from './landscape.js';
import { Mobility } from './mobility.js';
import { PortFlows } from './port-flows.js';
import { WhiteModel } from './white-model.js';
import {startReplayTransition,advanceConstruction} from './city-transition.js';

const clamp = THREE.MathUtils.clamp;
const TYPES = { housing: 'Homes', office: 'Workplace', industry: 'Industry', park: 'Public park', solar: 'Solar garden', transit: 'Transit station', civic: 'Civic landmark' };

export class CityView {
  constructor(container, options = {}) {
    this.container = container; this.options = options;
    this.motionPreference=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9cb5c5);
    this.scene.fog = new THREE.Fog(0xb3c8d7, 350, 800);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.canvas = this.renderer.domElement; this.canvas.id = 'city-canvas'; this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Northern Metropolis schematic policy map. Drag to orbit and scroll to zoom. Flow lines show modeled passenger-trip direction and volume.');
    container.append(this.canvas);
    this.camera = new THREE.PerspectiveCamera(46, 1, .12, 1500);
    this.cameraTarget = new THREE.Vector3(-4, 3, -5); this.lookTarget = this.cameraTarget.clone();
    this.orbit = { theta: .17, phi: 1.05, radius: 350 }; this.currentOrbit = { ...this.orbit };
    this.view = 'overview'; this.overviewRegional = true; this.district = 'san-tin'; this.timeOfDay = 'day';
    this.street = { x: -28, z: 4, yaw: 0, pitch: .05 }; this.keys = new Set();
    this.playing = true; this.world = null; this.selectedId = null;
    this.buildings = new Map(); this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2(); this.pointers = new Map();
    this.frames = 0; this.elapsed = 0; this.lastTime = performance.now(); this.fpsTime = this.lastTime; this.sampleFrames = 0;
    this.quality = 'high'; this.qualityMode = 'auto'; this.slowSamples = 0; this.fastSamples = 0; this.lastShadow = 0; this.lastLabels = 0;
    this.library = new MaterialLibrary();
    this.createLighting(); this.createSky();
    this.landscape = new Landscape(this.scene, this.library);
    this.mobility = new Mobility(this.scene, this.landscape.roads, this.landscape.normalizedRail());
    this.batches = new DevelopmentBatches(this.scene, this.library);
    this.portFlows = new PortFlows(this.scene);
    this.createSelection(); this.createLabels(); this.bindControls();
    this.whiteModel = new WhiteModel(this); this.canvas.dataset.renderStyle = 'original';
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    this.animate = this.animate.bind(this); this.animationId = requestAnimationFrame(this.animate);
  }
  createLighting() {
    this.hemisphere = new THREE.HemisphereLight(0xb6d0e1, 0x777566, 1.55); this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight(0xffe4bd, 2.65); this.sun.position.set(-180, 220, 130); this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -210, right: 210, top: 145, bottom: -145, near: 10, far: 650 });
    this.sun.shadow.normalBias = .055; this.sun.shadow.bias = -.0001; this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0x9ac2dc, .55); this.fill.position.set(170, 100, -100); this.scene.add(this.fill);
  }
  createSky() {
    const geometry = new THREE.SphereGeometry(950, 24, 12); geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
    this.sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -100; this.scene.add(this.sky); this.updateSky();
  }
  updateSky() {
    const dusk = this.timeOfDay === 'dusk'; const positions = this.sky.geometry.attributes.position, colors = this.sky.geometry.attributes.color;
    const high = new THREE.Color(dusk ? 0x28374d : 0x779fbe), low = new THREE.Color(dusk ? 0xbfa291 : 0xbbd3df), color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const t = clamp((positions.getY(i) / 950 + .08) * 1.5, 0, 1); color.copy(low).lerp(high, t);
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }
  createSelection() {
    const material = new THREE.MeshBasicMaterial({ color: 0xf0cc7d, transparent: true, opacity: .92, depthWrite: false });
    this.selection = new THREE.Mesh(new THREE.RingGeometry(8.1, 8.3, 48), material); this.selection.rotation.x = -Math.PI / 2; this.selection.visible = false; this.scene.add(this.selection);
  }
  makeLabel(text, x, y, z, width = 45) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 48;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(19,36,47,.76)'; ctx.fillRect(0, 0, 512, 48);
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#dce5df'; ctx.fillText(text, 256, 25);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, fog: false });
    const sprite = new THREE.Sprite(material); sprite.position.set(x, y, z); sprite.scale.set(width, width * 48 / 512, 1); this.geographyLabels.add(sprite);
  }
  createLabels() {
    this.geographyLabels = new THREE.Group(); this.scene.add(this.geographyLabels);
    this.makeLabel('SHENZHEN · EXISTING CONTEXT', 22, 20, -139, 67);
    this.makeLabel('DEEP BAY / MAI PO · WETLAND CONTEXT', -139, 2.2, -77, 61);
    this.makeLabel('LONG VALLEY · CONSERVATION CONTEXT', 53, 1.8, -51, 56);
    this.makeLabel('NORTHERN LINK · PLANNED', -20, 2, 73, 46);
    this.makeLabel('GREEN TRANSIT · PLANNED', -158, 2, 10, 38);
  }
  update(world, playing = true, snap = false, {savedTransition=false}={}) {
    this.whiteModel?.prepareUpdate();
    this.world = world; this.playing = playing; let dirty = false;
    const ids = new Set(world.buildings.map(building => building.id));
    for (const id of this.buildings.keys()) if (!ids.has(id)) { this.buildings.delete(id); dirty = true; }
    for (const building of world.buildings) {
      const signature = [building.kind, building.height, building.capacity, building.x, building.z, building.owner].join(':');
      let record = this.buildings.get(building.id);const previousProgress=record?.progress;
      if (!record || record.signature !== signature) {
        const location = locateBuilding(building);
        record = { building, location, design: development(building, location), signature, progress: savedTransition?(previousProgress??0):Number(building.progress)||0, target: Number(building.progress) || 0 };
        this.buildings.set(building.id, record); dirty = true;
      }
      record.building = building; record.target = clamp(Number(building.progress) || 0, 0, 1);
      if(savedTransition)startReplayTransition(record,record.target,Boolean(this.motionPreference?.matches));
      else if (snap || !playing) {record.progress = record.target;delete record.replayTransition;}
    }
    if (dirty) this.batches.rebuild(this.buildings); else this.batches.updateTransforms();
    this.pickMeshes = this.batches.pickMeshes;
    this.mobility.update(world); this.landscape.update(world); this.batches.setDetail(this.view); this.landscape.setDetail(this.view);
    if (this.view === 'street') this.ensureStreetClear();
    if (this.selectedId && !ids.has(this.selectedId)) this.select(null);
    else if (this.selectedId) this.positionSelection();
    this.renderer.shadowMap.needsUpdate = true;
    this.whiteModel?.refresh();
    this.canvas.dataset.parcels = String(this.buildings.size);
    this.canvas.dataset.renderBatches = String(this.batches.meshes.size);
  }
  setRenderStyle(style) { this.whiteModel.set(style === 'white'); }
  setPortStudy(snapshot, mode, cohort) { this.portFlows.update(snapshot, mode, cohort); this.canvas.dataset.portFlowPaths = String(this.portFlows.paths.length); }
  showPortStudy(visible) { this.portFlows.group.visible = visible; }
  setPortMotion(playing) { this.portFlows.animated = playing; }
  setLayer(layer) { this.batches.setLayer(layer); }
  positionSelection() {
    const record = this.buildings.get(this.selectedId); this.selection.visible = Boolean(record);
    if (record) this.selection.position.set(record.location.x, .38, record.location.z);
  }
  select(id) {
    this.selectedId = this.buildings.has(id) ? id : null; this.canvas.dataset.selectedBuilding = this.selectedId || ''; this.positionSelection();
    const record = this.buildings.get(this.selectedId);
    if (record) { this.district = record.location.districtId; this.options.onDistrictChange?.(this.district); }
    this.options.onSelect?.(record?.building || null);
  }
  focus(id) {
    const record = this.buildings.get(id); if (!record) return;
    this.district = record.location.districtId; this.overviewRegional = false; this.options.onDistrictChange?.(this.district);
    if (this.view === 'street') { this.placeStreet(record.location.x, record.location.z + 8.9); return; }
    this.cameraTarget.set(record.location.x, Math.min(12, record.design.height * .25), record.location.z);
    this.orbit.radius = Math.max(44, record.design.height * 2.0); this.orbit.phi = 1.12;
  }
  focusDistrict(id) {
    const district = DISTRICTS.find(item => item.id === id); if (!district) return;
    this.district = id; this.overviewRegional = false; this.options.onDistrictChange?.(id);
    if (this.view === 'street') this.placeStreet(district.x, district.z + 2.8);
    else { this.cameraTarget.set(district.x, 4, district.z); this.orbit.radius = 146; this.orbit.phi = 1.02; this.orbit.theta = .12; }
  }
  placeStreet(x, z) {
    // Project arrival onto an actual street, then verify the occupied parcels
    // and water. A single offset can land inside the next row in a dense town.
    const candidates = [];
    for (const road of this.landscape.roads) for (let i = 1; i < road.length; i++) {
      const a = road[i - 1], b = road[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (length * length || 1), 0, 1);
      candidates.push({ x: a[0] + dx * t, z: a[1] + dz * t });
      for (let step = 0; step <= Math.ceil(length / 2); step++) {
        const fraction = step / Math.max(1, Math.ceil(length / 2));
        candidates.push({ x: a[0] + dx * fraction, z: a[1] + dz * fraction });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    const arrival = candidates.find(point => this.streetClear(point.x, point.z)
      && [[.65, 0], [-.65, 0], [0, .65], [0, -.65]].some(([dx, dz]) => this.streetClear(point.x + dx, point.z + dz)));
    if (!arrival) return false;
    this.street.x = arrival.x; this.street.z = arrival.z; this.street.yaw = 0; this.street.pitch = .055;
    return true;
  }
  streetClear(x, z) {
    return x >= -170 && x <= 169 && z >= -67 && z <= 98 && !isContextWater(x, z) && terrainHeight(x, z) < 3
      && ![...this.buildings.values()].some(record => record.building.kind !== 'park' && record.building.kind !== 'solar'
        && Math.abs(record.location.x - x) < 6.8 && Math.abs(record.location.z - z) < 6.8);
  }
  ensureStreetClear() {
    if (!this.streetClear(this.street.x, this.street.z)) {
      const { x, z, yaw, pitch } = this.street;
      if (this.placeStreet(x, z)) { this.street.yaw = yaw; this.street.pitch = pitch; }
    }
  }
  setView(mode) {
    if (!['overview', 'street'].includes(mode) || this.view === mode) return;
    this.view = mode; this.keys.clear(); this.camera.fov = mode === 'street' ? 68 : 46; this.camera.updateProjectionMatrix();
    this.geographyLabels.visible = mode === 'overview'; this.batches.setDetail(mode); this.landscape.setDetail(mode);
    if (mode === 'street') {
      const selected = this.buildings.get(this.selectedId), district = DISTRICTS.find(item => item.id === this.district) || DISTRICTS[1];
      this.placeStreet(selected?.location.x ?? district.x, (selected?.location.z ?? district.z) + 8.9);
    }
    this.options.onViewChange?.(mode);
    this.options.onDistrictChange?.(mode === 'overview' && this.overviewRegional ? null : this.district);
  }
  setTimeOfDay(value) {
    if (!['day', 'dusk'].includes(value)) return;
    this.timeOfDay = value; this.library.setTimeOfDay(value); this.batches.setTimeOfDay(); this.mobility.setTimeOfDay(value);
    const dusk = value === 'dusk'; this.hemisphere.color.setHex(dusk ? 0x7d96b6 : 0xb6d0e1); this.hemisphere.intensity = dusk ? 1.25 : 1.55;
    this.hemisphere.groundColor.setHex(dusk ? 0x63594d : 0x777566); this.sun.color.setHex(dusk ? 0xf2ae73 : 0xffe4bd); this.sun.intensity = dusk ? 1.5 : 2.65;
    this.sun.position.set(-180, dusk ? 95 : 220, 130); this.fill.intensity = dusk ? .35 : .55;
    this.scene.fog.color.setHex(dusk ? 0x9a8e99 : 0xb3c8d7); this.renderer.toneMappingExposure = dusk ? 1.14 : 1.0;
    this.updateSky(); this.renderer.shadowMap.needsUpdate = true;
  }
  setQuality(mode) {
    if (!['auto', 'high', 'balanced', 'light'].includes(mode)) return;
    this.qualityMode = mode; this.slowSamples = 0; this.fastSamples = 0;
    this.applyQuality(mode === 'auto' ? 'high' : mode);
    this.fpsTime = performance.now(); this.sampleFrames = 0;
  }
  applyQuality(level) {
    this.quality = level;
    const ratio = level === 'high' ? Math.min(window.devicePixelRatio || 1, 1.75) : level === 'balanced' ? Math.min(window.devicePixelRatio || 1, 1) : .75;
    const shadow = level === 'high' && this.qualityMode === 'high' ? 2048 : level === 'light' ? 512 : 1024;
    this.renderer.setPixelRatio(ratio);
    if (this.sun.shadow.mapSize.x !== shadow) {
      this.sun.shadow.mapSize.set(shadow, shadow);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true; this.resize();
    this.canvas.dataset.quality = level; this.canvas.dataset.qualityMode = this.qualityMode;
    this.options.onQuality?.(this.qualityMode, level);
  }
  resetCamera() {
    if (this.view !== 'overview') { this.view = 'overview'; this.options.onViewChange?.('overview'); }
    this.camera.fov = 46; this.camera.updateProjectionMatrix(); this.geographyLabels.visible = true; this.overviewRegional = true; this.district = 'san-tin'; this.options.onDistrictChange?.(null); this.batches.setDetail('overview'); this.landscape.setDetail('overview');
    this.cameraTarget.set(-4, 3, -5); this.orbit = { theta: .17, phi: 1.05, radius: window.innerWidth < 760 ? 455 : 350 }; this.keys.clear();
  }
  resize() {
    const rect = this.container.getBoundingClientRect(); this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / Math.max(1, rect.height); this.camera.updateProjectionMatrix();
    if (!this.frames && rect.width < 760) this.orbit.radius = this.currentOrbit.radius = 455;
  }
  hit(event) {
    const rect = this.canvas.getBoundingClientRect(); this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.batches.pickMeshes, false)) { const building = this.batches.pick(hit); if (building) return building; }
    return null;
  }
  pan(dx, dy) {
    const scale = this.orbit.radius / 750, theta = this.orbit.theta;
    this.cameraTarget.x = clamp(this.cameraTarget.x - dx * Math.cos(theta) * scale - dy * Math.sin(theta) * scale, -205, 205);
    this.cameraTarget.z = clamp(this.cameraTarget.z + dx * Math.sin(theta) * scale - dy * Math.cos(theta) * scale, -100, 125);
  }
  bindControls() {
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('pointerdown', event => {
      this.canvas.focus({ preventScroll: true }); this.canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, button: event.button, moved: false });
      this.options.onHover?.(null);
    });
    this.canvas.addEventListener('pointermove', event => {
      const p = this.pointers.get(event.pointerId);
      if (!p) { const building = this.hit(event); this.canvas.style.cursor = building ? 'pointer' : 'grab'; this.options.onHover?.(building, event.clientX, event.clientY); return; }
      const dx = event.clientX - p.x, dy = event.clientY - p.y; p.x = event.clientX; p.y = event.clientY;
      if (Math.hypot(p.x - p.startX, p.y - p.startY) > 4) p.moved = true;
      if (this.view === 'street') { this.street.yaw -= dx * .005; this.street.pitch = clamp(this.street.pitch - dy * .004, -.9, .95); }
      else if (p.button === 2 || event.shiftKey || this.pointers.size > 1) this.pan(dx, dy);
      else { this.orbit.theta -= dx * .005; this.orbit.phi = clamp(this.orbit.phi - dy * .004, .26, 1.42); }
    });
    this.canvas.addEventListener('pointerup', event => {
      const p = this.pointers.get(event.pointerId);
      if (p && !p.moved && p.button === 0) this.select(this.hit(event)?.id || null);
      this.pointers.delete(event.pointerId);
    });
    this.canvas.addEventListener('pointercancel', event => this.pointers.delete(event.pointerId));
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault(); if (this.view === 'overview') this.orbit.radius = clamp(this.orbit.radius * Math.exp(clamp(event.deltaY, -100, 100) * .0015), 32, 650);
    }, { passive: false });
    this.canvas.addEventListener('keydown', event => {
      if (event.target !== this.canvas) return;
      if (this.view === 'street' && ['w', 'a', 's', 'd', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift'].includes(event.key)) { event.preventDefault(); this.keys.add(event.key.toLowerCase()); }
      else {
        const moves = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] };
        if (moves[event.key]) { event.preventDefault(); this.pan(...moves[event.key]); }
        if (['+', '='].includes(event.key)) this.orbit.radius = clamp(this.orbit.radius * .9, 32, 650);
        if (event.key === '-') this.orbit.radius = clamp(this.orbit.radius * 1.1, 32, 650);
      }
      if (event.key.toLowerCase() === 'r') this.resetCamera();
    });
    document.addEventListener('keyup', event => this.keys.delete(event.key.toLowerCase()));
    this.canvas.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelAnimationFrame(this.animationId); this.canvas.dataset.rendered = 'false'; this.options.onError?.('The graphics context was lost. Reload to restore the region; saved city timelines remain available.'); });
  }
  moveStreet(dt) {
    this.ensureStreetClear();
    if (document.activeElement !== this.canvas) { this.keys.clear(); return; }
    const forward = Number(this.keys.has('w') || this.keys.has('arrowup')) - Number(this.keys.has('s') || this.keys.has('arrowdown'));
    const side = Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft'));
    const speed = this.keys.has('shift') ? 12 : 6;
    const x = clamp(this.street.x + (Math.sin(this.street.yaw) * forward + Math.cos(this.street.yaw) * side) * dt * speed, -170, 169);
    const z = clamp(this.street.z + (-Math.cos(this.street.yaw) * forward + Math.sin(this.street.yaw) * side) * dt * speed, -67, 98);
    if (this.streetClear(x, z)) { this.street.x = x; this.street.z = z; }
    else if (this.streetClear(x, this.street.z)) this.street.x = x;
    else if (this.streetClear(this.street.x, z)) this.street.z = z;
  }
  projectLabels(time) {
    if (!this.options.onLabels || time - this.lastLabels < 100) return;
    this.lastLabels = time;
    const rect = this.canvas.getBoundingClientRect();
    const labels = DISTRICTS.map(district => {
      const point = new THREE.Vector3(district.x, 1.5, district.z).project(this.camera);
      return { id: district.id, x: (point.x + 1) * rect.width / 2, y: (1 - point.y) * rect.height / 2, visible: this.view === 'overview' && point.z > -1 && point.z < 1 && Math.abs(point.x) < .93 && Math.abs(point.y) < .94 };
    });
    let headingDegrees;
    if (this.view === 'overview') {
      const origin = this.cameraTarget.clone().project(this.camera);
      const north = this.cameraTarget.clone().add(new THREE.Vector3(0, 0, -10)).project(this.camera);
      headingDegrees = Math.atan2(north.x - origin.x, north.y - origin.y) * 180 / Math.PI;
    } else { const direction = this.camera.getWorldDirection(new THREE.Vector3()); headingDegrees = Math.atan2(-direction.x, -direction.z) * 180 / Math.PI; }
    this.options.onLabels(labels, headingDegrees);
  }
  animate(time) {
    this.animationId = requestAnimationFrame(this.animate);
    const dt = Math.min(.1, Math.max(0, (time - this.lastTime) / 1000)); this.lastTime = time; this.elapsed += dt;
    const damping = 1 - Math.exp(-dt * 9);
    if (this.view === 'overview') {
      for (const key of ['theta', 'phi', 'radius']) this.currentOrbit[key] = THREE.MathUtils.lerp(this.currentOrbit[key], this.orbit[key], damping);
      this.lookTarget.lerp(this.cameraTarget, damping);
      const { theta, phi, radius } = this.currentOrbit;
      this.camera.position.set(this.lookTarget.x + radius * Math.sin(phi) * Math.sin(theta), this.lookTarget.y + radius * Math.cos(phi), this.lookTarget.z + radius * Math.sin(phi) * Math.cos(theta)); this.camera.lookAt(this.lookTarget);
    } else {
      this.moveStreet(dt); this.camera.position.set(this.street.x, terrainHeight(this.street.x, this.street.z) + 2.2, this.street.z);
      this.camera.lookAt(this.street.x + Math.sin(this.street.yaw), this.camera.position.y + Math.tan(this.street.pitch), this.street.z - Math.cos(this.street.yaw));
    }
    let constructionMoving = false;
    for (const record of this.buildings.values()) {
      if(advanceConstruction(record,dt,this.playing,Boolean(this.motionPreference?.matches)))constructionMoving=true;
    }
    if (constructionMoving) {
      this.batches.updateTransforms();
      if (this.elapsed - this.lastShadow > .5) { this.renderer.shadowMap.needsUpdate = true; this.lastShadow = this.elapsed; }
    }
    this.portFlows.animate(dt); if (this.portFlows.group.visible) this.canvas.dataset.portFlowPhase = this.portFlows.elapsed.toFixed(2); this.mobility.animate(dt, this.playing); this.sky.position.copy(this.camera.position); this.projectLabels(time);
    try {
      this.renderer.render(this.scene, this.camera); this.frames++; this.sampleFrames++;
      this.canvas.dataset.cameraPosition = JSON.stringify([this.camera.position.x, this.camera.position.y, this.camera.position.z].map(value => Number(value.toFixed(3))));
      this.canvas.dataset.view = this.view; this.canvas.dataset.district = this.view === 'overview' && this.overviewRegional ? 'region' : this.district; this.canvas.dataset.timeOfDay = this.timeOfDay;
      if (this.frames === 1) { this.canvas.dataset.rendered = 'true'; this.options.onReady?.(); }
      if (time - this.fpsTime >= 1500) {
        const fps = this.sampleFrames * 1000 / (time - this.fpsTime); this.canvas.dataset.frames = String(this.frames); this.canvas.dataset.fps = String(Math.round(fps));
        this.canvas.dataset.drawCalls = String(this.renderer.info.render.calls); this.canvas.dataset.triangles = String(this.renderer.info.render.triangles);
        if (this.qualityMode === 'auto' && !document.hidden && this.frames > 60) {
          this.slowSamples = fps < 24 ? this.slowSamples + 1 : 0;
          this.fastSamples = fps > 48 ? this.fastSamples + 1 : 0;
          if (this.slowSamples >= 3 && this.quality !== 'light') {
            this.applyQuality(this.quality === 'high' ? 'balanced' : 'light'); this.slowSamples = 0; this.fastSamples = 0;
          } else if (this.fastSamples >= 8 && this.quality !== 'high') {
            this.applyQuality(this.quality === 'light' ? 'balanced' : 'high'); this.slowSamples = 0; this.fastSamples = 0;
          }
        }
        this.canvas.dataset.quality = this.quality; this.fpsTime = time; this.sampleFrames = 0;
      }
    } catch (error) { cancelAnimationFrame(this.animationId); this.options.onError?.(`The region could not render: ${error.message}`); }
  }
  dispose() {
    this.whiteModel?.dispose();
    cancelAnimationFrame(this.animationId); this.resizeObserver.disconnect(); this.batches.dispose(); this.portFlows.dispose(); this.mobility.dispose(); this.landscape.dispose(); this.library.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose(); this.selection.geometry.dispose(); this.selection.material.dispose();
    for (const label of this.geographyLabels.children) { label.material.map.dispose(); label.material.dispose(); }
    this.renderer.dispose(); this.canvas.remove();
  }
}
export { TYPES };
