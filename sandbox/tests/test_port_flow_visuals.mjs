import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { PortFlows } from '../web/port-flows.js';
import { runStudy, GROUPS } from '../web/port-model.js';

globalThis.document={createElement(type){assert.equal(type,'canvas');return {getContext:()=>({fillRect(){},fillText(){}})};}};
const CYAN=0x28c3d7,GOLD=0xffbd4c;
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
function fixture(){
  const scene=new THREE.Scene(),flow=new PortFlows(scene),calls=[];
  const original=flow.addPath;
  flow.addPath=function(curve,volume,color,direction,opacity,moving,lift=0){
    calls.push({curve,volume,color,direction,opacity,moving,lift});
    return original.call(this,curve,volume,color,direction,opacity,moving,lift);
  };
  return {flow,calls,scene};
}
const sum=(calls,color,direction)=>calls.filter(c=>c.color===color&&(!direction||c.direction===direction)).reduce((total,c)=>total+c.volume,0);

test('all-passenger August visual uses independently correct baseline and additional directional totals',()=>{
  const {flow,calls}=fixture(),snapshot=runStudy().months[0];
  flow.update(snapshot);
  near(sum(calls,CYAN,'inbound'),10100);near(sum(calls,CYAN,'outbound'),9900);
  near(sum(calls,GOLD,'inbound'),682.7333333333333);near(sum(calls,GOLD,'outbound'),656.6);
  near(sum(calls,CYAN),snapshot.baseline);near(sum(calls,GOLD),snapshot.extra);
  assert.notEqual(sum(calls,GOLD,'inbound'),snapshot.extra*10100/20000);
  assert.equal(flow.group.userData.policyOverlay,true);flow.dispose();
});

for(const index of [0,1,2])test(`all passengers month ${index}: each visual route matches the model's four directional counts`,()=>{
  const {flow,calls}=fixture(),snapshot=runStudy().months[index],before=JSON.stringify(snapshot);
  flow.update(snapshot);
  snapshot.routes.forEach((route,i)=>{
    const pair=calls.slice(i*4,i*4+4);
    assert.deepEqual(pair.map(c=>[c.color,c.direction]),[[CYAN,'inbound'],[GOLD,'inbound'],[CYAN,'outbound'],[GOLD,'outbound']]);
    near(pair[0].volume,route.inboundBaseline);near(pair[1].volume,route.inboundExtra);
    near(pair[2].volume,route.outboundBaseline);near(pair[3].volume,route.outboundExtra);
    near(pair[0].volume+pair[2].volume,route.baseline);near(pair[1].volume+pair[3].volume,route.extra);
    for(const call of pair){const offset=call.direction==='inbound'?-2:2;
      assert.deepEqual(call.curve.v0.toArray(),[-14+offset,4,-87]);
      assert.deepEqual(call.curve.v2.toArray(),[route.x+offset,3.5,route.z]);}
  });
  assert.equal(JSON.stringify(snapshot),before);assert.equal(flow.group.userData.month,index);flow.dispose();
});

for(const id of GROUPS.map(g=>g.id))test(`${id}: filtered directions use cohort-specific share for baseline and extra across all three months`,()=>{
  const {flow,calls}=fixture();
  for(const snapshot of runStudy().months){
    calls.length=0;const group=snapshot.groups.find(g=>g.id===id);flow.update(snapshot,'policy',id);
    near(sum(calls,CYAN,'inbound'),group.baseline*group.inbound);near(sum(calls,CYAN,'outbound'),group.baseline*(1-group.inbound));
    near(sum(calls,GOLD,'inbound'),group.extra*group.inbound);near(sum(calls,GOLD,'outbound'),group.extra*(1-group.inbound));
    snapshot.routes.forEach((route,i)=>{const pair=calls.slice(i*4,i*4+4);
      near(pair[0].volume,group.baseline*route.share*group.inbound);
      near(pair[1].volume,group.extra*route.share*group.inbound);
      near(pair[2].volume,group.baseline*route.share*(1-group.inbound));
      near(pair[3].volume,group.extra*route.share*(1-group.inbound));});
  }flow.dispose();
});

test('baseline mode omits gold paths and delta mode retains static faint baseline context without changing quantities',()=>{
  const {flow,calls}=fixture(),snapshot=runStudy().months[0];
  flow.update(snapshot,'baseline');assert.equal(calls.length,8);assert.ok(calls.every(c=>c.color===CYAN&&c.opacity===.8&&c.moving));
  assert.equal(flow.paths.length,8);near(sum(calls,CYAN),20000);
  calls.length=0;flow.update(snapshot,'delta');
  const baseline=calls.filter(c=>c.color===CYAN),additional=calls.filter(c=>c.color===GOLD);
  assert.equal(baseline.length,8);assert.ok(baseline.every(c=>c.opacity===.16&&!c.moving));
  assert.equal(additional.length,8);assert.ok(additional.every(c=>c.opacity===.95&&c.moving&&c.lift===1.4));
  assert.equal(flow.paths.length,8);near(sum(calls,CYAN),20000);
  near(sum(calls,GOLD,'inbound'),682.7333333333333);near(sum(calls,GOLD,'outbound'),656.6);flow.dispose();
});

test('zero additional demand does not create gold meshes, arrows or directional volume',()=>{
  const {flow,calls}=fixture();
  for(const inputs of [{reach:0},{clearance:30},{capacity:20000},{timing:'announced'}]){
    const snapshot=runStudy(inputs).months[0];
    for(const cohort of ['all',...GROUPS.map(g=>g.id)]){
      calls.length=0;flow.update(snapshot,'policy',cohort);
      near(sum(calls,GOLD),0);assert.ok(calls.filter(c=>c.color===GOLD).every(c=>c.volume===0));
      assert.ok(flow.group.children.every(child=>child.material?.color?.getHex()!==GOLD));
      assert.equal(flow.paths.length,8);
    }
  }flow.dispose();
});

test('path radii, arrows per 500 trips, colours and movement remain unchanged by directional correction',()=>{
  const {flow,calls}=fixture();flow.update(runStudy().months[0]);
  const tubes=flow.group.children.filter(child=>child.geometry?.type==='TubeGeometry');
  assert.equal(tubes.length,16);assert.equal(flow.paths.length,16);
  calls.forEach((call,i)=>{
    near(tubes[i].geometry.parameters.radius,Math.min(1.4,.2+Math.sqrt(call.volume/1000)*.28));
    assert.equal(tubes[i].material.color.getHex(),call.color);
    assert.equal(flow.paths[i].count,Math.min(36,Math.max(1,Math.ceil(call.volume/500))));
    assert.equal(flow.paths[i].mesh.material.color.getHex(),call.color);
    assert.equal(flow.paths[i].direction,call.direction);
  });
  flow.group.visible=true;flow.animate(1);assert.equal(flow.elapsed,1);
  flow.animated=false;flow.animate(5);assert.equal(flow.elapsed,1);
  calls.length=0;flow.update(null);assert.equal(flow.paths.length,0);assert.equal(flow.group.children.length,0);
  assert.equal(flow.group.userData.policyOverlay,true);flow.dispose();
});

test('capacity-constrained and official-date visual directions still conserve the model totals',()=>{
  const {flow,calls}=fixture();
  for(const inputs of [{capacity:20001},{capacity:21000},{timing:'announced'}])for(const snapshot of runStudy(inputs).months){
    calls.length=0;flow.update(snapshot);
    near(sum(calls,CYAN),snapshot.baseline);near(sum(calls,GOLD),snapshot.extra);
    near(sum(calls,GOLD,'inbound'),snapshot.groups.reduce((total,g)=>total+g.extra*g.inbound,0));
    near(sum(calls,GOLD,'outbound'),snapshot.groups.reduce((total,g)=>total+g.extra*(1-g.inbound),0));
  }flow.dispose();
});
