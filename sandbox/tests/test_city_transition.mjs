import test from 'node:test';
import assert from 'node:assert/strict';
import {CityView} from '../web/city.js';
import {startReplayTransition,advanceConstruction,REPLAY_TRANSITION_SECONDS} from '../web/city-transition.js';
const building=(id,progress=1,capacity=100)=>({id,kind:'housing',height:18,x:-44,z:-44,capacity,owner:'government',progress});
function view(){const city=Object.create(CityView.prototype);Object.assign(city,{view:'overview',buildings:new Map(),selectedId:null,canvas:{dataset:{}},renderer:{shadowMap:{}},landscape:{update(){},setDetail(){}},mobility:{update(){}},batches:{rebuild(){},updateTransforms(){},setDetail(){},pickMeshes:[],meshes:new Map()}});return city;}

test('new saved-month buildings grow from zero even when replay is paused',()=>{
 const city=view();city.update({buildings:[]},false,true);const input=building('R1',.6);city.update({buildings:[input]},false,true,{savedTransition:true});const record=city.buildings.get('R1');assert.equal(record.progress,0);assert.equal(record.target,.6);
 advanceConstruction(record,REPLAY_TRANSITION_SECONDS/2,false);assert.ok(Math.abs(record.progress-.3)<1e-9);assert.equal(input.progress,.6);
 advanceConstruction(record,REPLAY_TRANSITION_SECONDS/2,false);assert.equal(record.progress,.6);assert.equal(record.replayTransition,undefined);
});
test('construction-to-completion transition preserves current visual progress across a capacity change',()=>{
 const city=view();city.update({buildings:[building('R1',.25,0)]},false,true);city.update({buildings:[building('R1',1,25000)]},false,true,{savedTransition:true});const record=city.buildings.get('R1');assert.equal(record.progress,.25);assert.equal(record.target,1);advanceConstruction(record,.325,false);assert.ok(record.progress>.25&&record.progress<1);
});
test('rewind eases existing construction toward the exact earlier saved progress',()=>{
 const city=view();city.update({buildings:[building('R1',1)]},false,true);city.update({buildings:[building('R1',.25)]},false,true,{savedTransition:true});const r=city.buildings.get('R1');advanceConstruction(r,.325,false);assert.ok(r.progress>.25&&r.progress<1);advanceConstruction(r,1,false);assert.equal(r.progress,.25);
});
test('first-load snap and reduced motion show exact saved progress immediately',()=>{
 for(const reduced of [false,true]){const city=view();city.motionPreference={matches:reduced};city.update({buildings:[building('R1',1)]},false,true,reduced?{savedTransition:true}:{});assert.equal(city.buildings.get('R1').progress,1);assert.equal(city.buildings.get('R1').replayTransition,undefined);}
});
test('turning reduced motion on during an animation completes it without changing the target',()=>{
 const r={progress:0,target:1};startReplayTransition(r,1);advanceConstruction(r,.1,false);advanceConstruction(r,.01,false,true);assert.equal(r.progress,1);assert.equal(r.replayTransition,undefined);
});
test('rapid direction changes restart from current visual progress, without overshoot or canonical edits',()=>{
 const r={progress:0,target:1};startReplayTransition(r,1);advanceConstruction(r,.2,false);const mid=r.progress;startReplayTransition(r,.1);assert.equal(r.progress,mid);advanceConstruction(r,10,false);assert.equal(r.progress,.1);
});
test('objects absent from an earlier month are removed rather than retained as historical ghosts',()=>{
 const city=view();city.update({buildings:[building('R1')]},false,true);city.update({buildings:[]},false,true,{savedTransition:true});assert.equal(city.buildings.size,0);
});
test('legacy paused and playing construction behavior is preserved',()=>{
 const r={progress:0,target:1};advanceConstruction(r,.1,true);assert.ok(r.progress>0&&r.progress<1);advanceConstruction(r,.1,false);assert.equal(r.progress,1);
});
