import * as THREE from './vendor/three.module.js';

// Presentation only: never modifies world, policy ledger, routes or trip counts.
export const WHITE_MODEL = Object.freeze({background: 0xe9edef, building: 0xf0efeb, ground: 0xc9ced0, water: 0xb9c7cd, vegetation: 0xd1d5cf, road: 0xaaaeb0});
export class WhiteModel {
  constructor(city) { this.city = city; this.enabled = false; this.records = new Map(); this.materials = new Map(); }
  set(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    const c = this.city;
    if (enabled) {
      this.original = {background: c.scene.background.clone(), fog: c.scene.fog.color.clone(), sky: c.sky.visible, exposure: c.renderer.toneMappingExposure,
        hemi: c.hemisphere.color.clone(), ground: c.hemisphere.groundColor.clone(), hemiIntensity: c.hemisphere.intensity,
        sun: c.sun.color.clone(), sunIntensity: c.sun.intensity, fill: c.fill.color.clone(), fillIntensity: c.fill.intensity};
      c.scene.background.setHex(WHITE_MODEL.background); c.scene.fog.color.setHex(WHITE_MODEL.background); c.sky.visible = false;
      c.hemisphere.color.setHex(0xffffff); c.hemisphere.groundColor.setHex(0xa3abb1); c.hemisphere.intensity = 2.0;
      c.sun.color.setHex(0xffffff); c.sun.intensity = 2.0; c.fill.color.setHex(0xffffff); c.fill.intensity = .65; c.renderer.toneMappingExposure = 1.05;
      this.refresh();
    } else {
      this.restoreMeshes(); const o = this.original;
      c.scene.background.copy(o.background); c.scene.fog.color.copy(o.fog); c.sky.visible = o.sky; c.renderer.toneMappingExposure = o.exposure;
      c.hemisphere.color.copy(o.hemi); c.hemisphere.groundColor.copy(o.ground); c.hemisphere.intensity = o.hemiIntensity;
      c.sun.color.copy(o.sun); c.sun.intensity = o.sunIntensity; c.fill.color.copy(o.fill); c.fill.intensity = o.fillIntensity;
    }
    document.body.classList.toggle('white-model', enabled); c.canvas.dataset.renderStyle = enabled ? 'white' : 'original';
    c.renderer.shadowMap.needsUpdate = true;
  }
  restoreMeshes() {
    for (const [mesh, old] of this.records) { mesh.material = old.material; mesh.instanceColor = old.instanceColor; mesh.visible = old.visible; }
    this.records.clear();
  }
  prepareUpdate() { if (this.enabled) this.restoreMeshes(); }
  refresh() {
    if (!this.enabled) return;
    const c = this.city, excluded = new Set([c.sky, c.selection]);
    c.portFlows.group.traverse(o => excluded.add(o));
    c.scene.traverse(o => {if(o.userData?.policyOverlay)o.traverse(child=>excluded.add(child));});
    const mobility = new Set([c.mobility.body, c.mobility.windows, c.mobility.trainBody, c.mobility.trainGlass, c.mobility.pedestrians]);
    c.scene.traverse(mesh => {
      if (!mesh.isMesh || excluded.has(mesh) || this.records.has(mesh)) return;
      const original = mesh.material;
      this.records.set(mesh, {material: original, instanceColor: mesh.instanceColor, visible: mesh.visible});
      if (mobility.has(mesh)) { mesh.visible = false; return; }
      const convert = material => {
        if (this.materials.has(material)) return this.materials.get(material);
        let color = WHITE_MODEL.building;
        if (mesh === c.landscape.terrain || mesh === c.landscape.farGround || mesh === c.landscape.vacantFields) color = WHITE_MODEL.ground;
        else if (material === c.landscape.water || material === c.library.get('water')) color = WHITE_MODEL.water;
        else if (['foliage','trunk','lawn','roofGarden'].some(key => material === c.library.get(key))) color = WHITE_MODEL.vegetation;
        else if (material === c.library.get('paving')) color = WHITE_MODEL.road;
        const neutral = new THREE.MeshStandardMaterial({color, roughness: .95, metalness: 0, side: material.side, transparent: material.transparent, opacity: material.opacity,
          polygonOffset: material.polygonOffset, polygonOffsetFactor: material.polygonOffsetFactor, polygonOffsetUnits: material.polygonOffsetUnits});
        this.materials.set(material, neutral); return neutral;
      };
      mesh.material = Array.isArray(original) ? original.map(convert) : convert(original);
      // Instance colours are separate from vertexColors; removing them avoids green/blue tints.
      if (mesh.isInstancedMesh) mesh.instanceColor = null;
    });
    c.renderer.shadowMap.needsUpdate = true;
  }
  dispose() { if (this.enabled) this.set(false); for (const m of this.materials.values()) m.dispose(); this.materials.clear(); }
}
