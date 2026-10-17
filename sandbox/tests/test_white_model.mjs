import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { WhiteModel } from '../web/white-model.js';
globalThis.document = {body: {classList: {toggle(){}}}};
function fixture() {
 const scene = new THREE.Scene(); scene.background = new THREE.Color(0x123456); scene.fog = new THREE.Fog(0x123456,1,100);
 const material = new THREE.MeshStandardMaterial({color:0x334455});
 const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 1); mesh.setColorAt(0,new THREE.Color(0x34ff56)); scene.add(mesh);
 const flow = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({color:0xffbd4c}));
 const group = new THREE.Group();group.add(flow);scene.add(group);
 const body = new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(body);
 const city = {scene,canvas:{dataset:{}},renderer:{toneMappingExposure:1,shadowMap:{}},sky:{visible:true},selection:{},portFlows:{group},
  hemisphere:new THREE.HemisphereLight(),sun:new THREE.DirectionalLight(),fill:new THREE.DirectionalLight(),
  landscape:{},library:{get:()=>undefined},mobility:{body}};
 return {city,mesh,material,flow,body,preset:new WhiteModel(city)};
}
test('white preset preserves policy overlay, geometry and instance matrices and restores colours',()=>{
 const f=fixture(), geom=f.mesh.geometry, colors=f.mesh.instanceColor, matrices=f.mesh.instanceMatrix, overlay=f.flow.material;
 f.preset.set(true);
 assert.notEqual(f.mesh.material,f.material);assert.equal(f.mesh.instanceColor,null);assert.equal(f.flow.material,overlay);assert.equal(f.body.visible,false);
 assert.equal(f.mesh.geometry,geom);assert.equal(f.mesh.instanceMatrix,matrices);
 f.preset.set(false);assert.equal(f.mesh.material,f.material);assert.equal(f.mesh.instanceColor,colors);assert.equal(f.body.visible,true);assert.equal(f.city.scene.background.getHex(),0x123456);
});
test('refresh handles replacement meshes without changing hidden state or allocating on every refresh',()=>{
 const f=fixture();f.preset.set(true);const n=f.preset.materials.size;f.preset.refresh();assert.equal(f.preset.materials.size,n);
 f.preset.prepareUpdate();f.city.scene.remove(f.mesh);const replacement=new THREE.Mesh(new THREE.BoxGeometry(),f.material);replacement.visible=false;f.city.scene.add(replacement);
 f.preset.refresh();assert.notEqual(replacement.material,f.material);f.preset.set(false);assert.equal(replacement.material,f.material);assert.equal(replacement.visible,false);
 f.preset.dispose();assert.equal(f.preset.materials.size,0);
});
test('API analytical groups preserve coloured materials through white-mode refresh',()=>{
 const f=fixture();const group=new THREE.Group();group.userData.policyOverlay=true;const material=new THREE.MeshBasicMaterial({color:0x0099dd});const overlay=new THREE.Mesh(new THREE.PlaneGeometry(),material);group.add(overlay);f.city.scene.add(group);
 f.preset.set(true);f.preset.prepareUpdate();f.preset.refresh();assert.equal(overlay.material,material);assert.equal(overlay.material.color.getHex(),0x0099dd);f.preset.dispose();
});
