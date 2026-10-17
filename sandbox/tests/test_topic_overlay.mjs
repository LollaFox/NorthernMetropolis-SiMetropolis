import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { TopicOverlay } from '../web/topic-overlay.js';
import { WhiteModel } from '../web/white-model.js';
import { getPolicy } from '../web/policy-catalog.js';
import { DISTRICTS } from '../web/geography.js';

globalThis.document = {body: {classList: {toggle(){}}}, createElement(type) {
  assert.equal(type, 'canvas');
  const context = {paints:[], texts:[], paths:[], fillRect(){this.paints.push(this.fillStyle);},
    fillText(value){this.paints.push(this.fillStyle);this.texts.push(String(value));},
    beginPath(){},moveTo(){},lineTo(){},strokeRect(){this.paints.push(this.strokeStyle);},
    stroke(){this.paints.push(this.strokeStyle);},arc(){this.paths.push('arc');}};
  return {getContext: () => context};
}};
const housing = getPolicy('kwu-tung-housing'), school = getPolicy('hung-shui-kiu-school');
function fixture() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x123456); scene.fog = new THREE.Fog(0x123456, 1, 100);
  const world = {buildings: [{id: 'untouched', capacity: 42}]};
  const city = {scene, world, canvas:{dataset:{}}, renderer:{toneMappingExposure:1,shadowMap:{}},
    sky:{visible:true}, selection:{}, portFlows:{group:new THREE.Group()},
    hemisphere:new THREE.HemisphereLight(), sun:new THREE.DirectionalLight(), fill:new THREE.DirectionalLight(),
    landscape:{}, library:{get:()=>undefined}, mobility:{}};
  return {city, overlay:new TopicOverlay(city)};
}
const glyphs = overlay => overlay.group.children.filter(child => child.userData.kind === 'capacity-glyph');
function snapshot(policy, delivered, date='2027-02-01') { return {policyId:policy.id, model:policy.model, delivered, date}; }

test('planned and zero-delivery months have a clearly hypothetical envelope and category marker without capacity blocks', () => {
  const {city,overlay} = fixture(), before = JSON.stringify(city.world);
  overlay.show(housing);
  assert.equal(overlay.group.userData.policyOverlay, true);
  assert.equal(glyphs(overlay).length, 0);
  assert.equal(city.canvas.dataset.topicOverlay, 'planned');
  assert.match(overlay.group.userData.label, /HYPOTHETICAL SCENARIO.*SCHEMATIC LOCATION/);
  assert.match(overlay.group.userData.label, /analysis not run/);
  assert.match(overlay.group.userData.label, /not actual buildings \/ catchment/);
  assert.equal(overlay.group.children.filter(child=>child.userData.kind==='study-outline').length, 1);
  const plannedMarker = overlay.group.children.find(child=>child.userData.kind==='category-marker');
  assert.equal(plannedMarker.userData.icon,'home');
  assert.equal(plannedMarker.userData.state,'PLANNED · 0 COMMISSIONED');
  assert.equal(plannedMarker.userData.commissioned,0);
  assert.ok(overlay.group.children.some(child=>child.userData.kind==='study-tray'));
  overlay.show(housing, snapshot(housing,0));
  assert.equal(glyphs(overlay).length, 0);
  assert.match(overlay.group.userData.label, /0 commissioned housing units/);
  assert.equal(city.canvas.dataset.topicOverlay, 'analysed');
  assert.equal(JSON.stringify(city.world), before);
  overlay.dispose();
});

test('housing and education resolve separate districts without moving the camera', () => {
  const {city,overlay} = fixture();
  city.camera = {position:new THREE.Vector3(1,2,3)};
  overlay.show(housing);
  const kwuTung = DISTRICTS.find(d=>d.id==='kwu-tung');
  assert.deepEqual(overlay.group.position.toArray(),[kwuTung.x,0,kwuTung.z]);
  overlay.show(school,snapshot(school,900,'2027-09-01'));
  const hsk = DISTRICTS.find(d=>d.id==='hung-shui-kiu');
  assert.deepEqual(overlay.group.position.toArray(),[hsk.x,0,hsk.z]);
  assert.deepEqual(city.camera.position.toArray(),[1,2,3]);
  assert.equal(city.canvas.dataset.topicArea,'hung-shui-kiu');
  assert.equal(city.canvas.dataset.topicDate,'2027-09-01');
  assert.equal(city.canvas.dataset.topicGlyphs,'9');
  overlay.dispose();
});

for (const [policy,quantity,expectedCount,lastCapacity,fraction] of [
  [housing,1600,7,100,.4], [school,925,10,25,.25], [housing,20000,80,250,1], [school,5000,50,100,1]
]) test(`${policy.model}: ${quantity} capacity uses ${expectedCount} glyphs with an accurate partial height`, () => {
  const {overlay} = fixture(); overlay.show(policy,snapshot(policy,quantity));
  const items=glyphs(overlay);
  assert.equal(items.length,expectedCount);
  assert.equal(items.reduce((sum,g)=>sum+g.userData.capacity,0),quantity);
  assert.equal(items.at(-1).userData.capacity,lastCapacity);
  assert.equal(items.at(-1).scale.y,fraction);
  assert.equal(items.at(-1).position.y,3+items.at(-1).userData.baseHeight*fraction/2);
  assert.ok(items.slice(0,-1).every(g=>g.scale.y===1));
  assert.ok(items.every(g=>g.material.transparent&&g.material.color.getHex()===0xffbd4c));
  assert.match(overlay.group.userData.label,new RegExp(quantity.toLocaleString('en-US')));
  overlay.dispose();
});

test('housing and school symbols use distinct building profiles, matching icon markers and clear outlines',()=>{
  const {overlay}=fixture();
  overlay.show(housing,snapshot(housing,250));
  const home=glyphs(overlay)[0],homeMarker=overlay.group.children.find(c=>c.userData.kind==='category-marker');
  assert.equal(home.geometry.type,'BoxGeometry');assert.equal(home.userData.icon,'home');
  assert.ok(home.geometry.parameters.height>home.geometry.parameters.width);
  assert.equal(home.children.find(c=>c.userData.kind==='capacity-roof').geometry.type,'ConeGeometry');
  assert.ok(home.children.some(c=>c.userData.kind==='capacity-outline'));
  assert.equal(home.children.filter(c=>c.userData.kind==='capacity-facade').length,2);
  assert.equal(homeMarker.userData.icon,'home');assert.equal(homeMarker.userData.state,'250 COMMISSIONED');
  const fullHousingHeight=home.geometry.parameters.height;
  overlay.show(school,snapshot(school,100));
  const education=glyphs(overlay)[0],schoolMarker=overlay.group.children.find(c=>c.userData.kind==='category-marker');
  assert.equal(education.geometry.type,'BoxGeometry');assert.equal(education.userData.icon,'school');
  assert.ok(education.geometry.parameters.height<fullHousingHeight);
  assert.ok(education.geometry.parameters.width>home.geometry.parameters.width);
  assert.equal(education.children.find(c=>c.userData.kind==='capacity-roof').geometry.type,'BoxGeometry');
  assert.equal(schoolMarker.userData.icon,'school');assert.equal(schoolMarker.userData.schematic,true);
  assert.ok(schoolMarker.material.map.image.getContext('2d').paths.includes('arc'));
  const annotation=overlay.group.children.find(c=>c.userData.kind==='study-label');
  assert.ok(annotation.scale.y>20);assert.match(annotation.userData.text,/Capacity symbols/);
  assert.match(annotation.userData.text,/100 commissioned school places/);
  overlay.dispose();
});

test('planned, scheduled and zero-addition states never use gold commissioned colours or invent a facility',()=>{
  const {overlay}=fixture();
  for(const [policy,frame,state] of [
    [housing,null,'PLANNED · 0 COMMISSIONED'],
    [school,{...snapshot(school,0),policyState:'scheduled'},'PLANNED · 0 COMMISSIONED'],
    [housing,{...snapshot(housing,0),policyState:'not_applied'},'NOT APPLIED · 0 COMMISSIONED'],
    [school,{...snapshot(school,0),policyState:'in_effect'},'NO ADDITIONS · 0 COMMISSIONED']
  ]){
    overlay.show(policy,frame);assert.equal(glyphs(overlay).length,0);
    const marker=overlay.group.children.find(c=>c.userData.kind==='category-marker');assert.equal(marker.userData.state,state);
    overlay.group.traverse(object=>{
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!material)continue;
        assert.notEqual(material.color?.getHex(),0xffbd4c);
        const paints=material.map?.image?.getContext('2d')?.paints??[];
        assert.ok(!paints.includes('#ffbd4c')&&!paints.includes('#ffcf75'));
      }
    });
    assert.match(overlay.group.userData.label,/not actual buildings \/ catchment/);
  }
  overlay.dispose();
});

test('unchanged unit scale keeps glyph heights comparable across months', () => {
  const {overlay} = fixture();
  overlay.show(housing,snapshot(housing,100));const partialHeight=glyphs(overlay)[0].scale.y;
  overlay.show(housing,snapshot(housing,350));
  assert.equal(glyphs(overlay)[0].scale.y,1);
  assert.equal(glyphs(overlay)[1].scale.y,partialHeight);
  overlay.dispose();
});

test('replacement and disposal free every owned resource once and leave city resources intact', () => {
  const {city,overlay} = fixture();
  const cityGeometry = new THREE.BoxGeometry(), cityMaterial = new THREE.MeshBasicMaterial();
  let cityDisposals=0; cityGeometry.addEventListener('dispose',()=>cityDisposals++); cityMaterial.addEventListener('dispose',()=>cityDisposals++);
  const existing = new THREE.Mesh(cityGeometry, cityMaterial);city.scene.add(existing);
  const watched = [];
  function watchResources() {
    for(const resources of Object.values(overlay.resources)) for(const resource of resources) {
      const record={count:0};resource.addEventListener('dispose',()=>record.count++);watched.push(record);
    }
  }
  overlay.show(housing,snapshot(housing,1600));watchResources();
  const oldChildren=[...overlay.group.children];
  overlay.show(school,snapshot(school,900));
  assert.ok(watched.every(r=>r.count===1));
  assert.ok(oldChildren.every(child=>child.parent===null));
  watchResources();overlay.dispose();overlay.dispose();
  assert.ok(watched.every(r=>r.count===1));
  assert.equal(cityDisposals,0);assert.equal(existing.parent,city.scene);
  assert.equal(overlay.group.parent,null);
  assert.ok(Object.values(overlay.resources).every(resources=>resources.size===0));
  assert.deepEqual(city.canvas.dataset,{});
});

test('hide clears topic metadata, and show can restore the selected study', () => {
  const {city,overlay} = fixture();city.canvas.dataset.renderStyle='white';
  overlay.show(housing,snapshot(housing,1600));overlay.hide();
  assert.equal(overlay.group.visible,false);
  assert.deepEqual(city.canvas.dataset,{renderStyle:'white'});
  overlay.show(school,snapshot(school,900));assert.equal(overlay.group.visible,true);
  assert.equal(city.canvas.dataset.topicPolicy,school.id);overlay.dispose();
});

test('white-model preparation and refresh preserve capacity symbols and neutral study outline', () => {
  const {city,overlay} = fixture();overlay.show(housing,snapshot(housing,1600));
  const items=glyphs(overlay), material=items[0].material;
  const preset=new WhiteModel(city);preset.set(true);preset.prepareUpdate();preset.refresh();
  assert.equal(items[0].material,material);assert.equal(material.color.getHex(),0xffbd4c);
  assert.equal(items[0].visible,true);
  assert.ok(items[0].children.every(child=>child.material));
  const childMaterials=items[0].children.map(child=>child.material);
  preset.prepareUpdate();preset.refresh();
  assert.deepEqual(items[0].children.map(child=>child.material),childMaterials);
  const marker=overlay.group.children.find(child=>child.userData.kind==='category-marker');
  const markerMaterial=marker.material;preset.refresh();assert.equal(marker.material,markerMaterial);
  // Replacing the overlay after a white-mode update also keeps every new material excluded.
  overlay.show(school,snapshot(school,900));const replacement=glyphs(overlay)[0].material;
  preset.refresh();assert.equal(glyphs(overlay)[0].material,replacement);
  assert.equal(replacement.color.getHex(),0xffbd4c);
  preset.dispose();overlay.dispose();
});

test('invalid capacity and mismatched snapshots cannot create misleading map symbols', () => {
  const {overlay} = fixture();overlay.show(housing,snapshot(housing,1600));
  for(const value of [-1,NaN,Infinity,1.5,20001,'1600']) assert.throws(()=>overlay.show(housing,snapshot(housing,value)),/whole number/);
  assert.throws(()=>overlay.show(school,snapshot(school,5001)),/whole number/);
  assert.throws(()=>overlay.show(housing,snapshot(school,900)),/policy/);
  assert.throws(()=>overlay.show(housing,{delivered:100,model:'education'}),/model/);
  assert.throws(()=>overlay.show(getPolicy('huanggang-opening')),/housing or education/);
  assert.equal(overlay.group.userData.delivered,1600);
  overlay.dispose();assert.throws(()=>overlay.show(housing),/disposed/);
});
