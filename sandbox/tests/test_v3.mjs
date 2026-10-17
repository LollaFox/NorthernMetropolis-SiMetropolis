import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSetup,schedule,validatePDF,reviewResponse,runResponse,snapshotResponse,hkToday} from '../web/v3-contract.js';
import {V3Session,HttpTransport} from '../web/v3-api.js';
import {FixtureTransport,fixtureSnapshot} from '../web/v3-fixture.js';
import {terrainGeometry} from '../web/v3-map.js';
import {toMap,fromMap} from '../web/v3-region.js';
const setup={bounds:{west:114,south:22.45,east:114.15,north:22.6},start:'2026-08-01',end:'2026-10-01',step:'month'};
const file=new File(['%PDF-1.4\nTEST'],'test.pdf',{type:'application/pdf'});
const frame=()=>fixtureSnapshot('2026-08-01');
const review={initializationId:'init',reviewVersion:'r1',items:[]};
const opts={today:'2026-10-14',sleep:async()=>{},key:()=>crypto.randomUUID()};
test('clockwise lon/lat bounds reject zero area, out-of-region and NaN',()=>{
 assert.deepEqual(validateSetup(setup,opts.today).vertices,[[114,22.6],[114.15,22.6],[114.15,22.45],[114,22.45]]);
 for(const b of [{west:115},{east:114},{south:NaN}])assert.throws(()=>validateSetup({...setup,bounds:{...setup.bounds,...b}},opts.today));
});
test('Hong Kong past-start validation, invalid dates, reversed range and step',()=>{
 assert.equal(hkToday(new Date('2026-10-13T17:00:00Z')),'2026-10-14');
 for(const extra of [{start:'2026-10-14'},{start:'2026-02-30'},{end:'2026-07-01'},{step:'day'}])assert.throws(()=>validateSetup({...setup,...extra},opts.today));
 assert.equal(validateSetup({...setup,end:'2027-01-01'},opts.today).end,'2027-01-01');
});
test('month/quarter/year schedules clamp month-end without drift',()=>{
 assert.deepEqual(schedule({start:'2024-01-31',end:'2024-03-31',step:'month'}),['2024-01-31','2024-02-29','2024-03-31']);
 assert.deepEqual(schedule({...setup,step:'quarter',end:'2027-02-01'}),['2026-08-01','2026-11-01','2027-02-01']);
 assert.deepEqual(schedule({start:'2024-02-29',end:'2026-02-28',step:'year'}),['2024-02-29','2025-02-28','2026-02-28']);
 assert.throws(()=>validateSetup({...setup,start:'2000-01-01',end:'2030-01-01'},opts.today));
});
test('PDF extension, size and signature enforced',async()=>{
 await validatePDF(file);await assert.rejects(validatePDF(new File(['hello'],'fake.pdf')));await assert.rejects(validatePDF(new File(['%PDF-'],'file.txt')));await assert.rejects(validatePDF({name:'x.pdf',size:21*1024*1024}));
});
test('sourced findings need safe source links; duplicate review IDs rejected',()=>{
 const item={id:'a',field:'x',description:'d',kind:'sourced',value:'v',sources:[{title:'Source',url:'https://example.org/source'}]};
 reviewResponse({...review,items:[item]});
 for(const url of ['javascript:alert(1)','data:text/html,x'])assert.throws(()=>reviewResponse({...review,items:[{...item,sources:[{title:'x',url}]}]}));
 assert.throws(()=>reviewResponse({...review,items:[item,item]}));assert.throws(()=>reviewResponse({...review,items:[{...item,sources:[]}]}));
});
test('sparse returned dates accepted; duplicate, unordered and off-step dates rejected',()=>{
 runResponse({simulationId:'r',snapshots:[{id:'a',date:'2026-08-01'},{id:'c',date:'2026-10-01'}]},setup);
 for(const snapshots of [[{id:'a',date:'2026-08-02'}],[{id:'a',date:'2026-08-01'},{id:'a',date:'2026-09-01'}],[{id:'b',date:'2026-09-01'},{id:'a',date:'2026-08-01'}]])assert.throws(()=>runResponse({simulationId:'r',snapshots},setup));
});
test('full 1000×1000 rasters and 4×5000 column pollution validated',()=>{
 const s=snapshotResponse(frame(),'2026-08-01');assert.equal(s.height.length,1e6);assert.ok(s.landType instanceof Int16Array);assert.deepEqual(s.pollution,[[400,600,60,0],[720,320,80,1]]);
});
test('grid scale/origin, dimensions, NaN, unknown land code and wrong date rejected',()=>{
 for(const mutate of [f=>delete f.grid.cellSizeM,f=>f.grid.origin='south-west',f=>f.schema='v2',f=>f.height.values=new Float32Array(10),f=>f.height.values[3]=NaN,f=>f.landType.values[1]=6]){const f=frame();mutate(f);assert.throws(()=>snapshotResponse(f,'2026-08-01'));}
 assert.throws(()=>snapshotResponse(frame(),'2026-09-01'));
});
test('pollution sentinel, int limits, closed polygons and segment cardinality enforced',()=>{
 for(const mutate of [f=>f.pollution.values[15001]=5,f=>f.roads[0].congestion.pop(),f=>f.roads[0].points[0][0]=1000,f=>f.zones[0].boundary.pop(),f=>f.zones[0].population=2147483648,f=>f.zones[0].satisfaction=1.5]){const f=frame();mutate(f);assert.throws(()=>snapshotResponse(f,'2026-08-01'));}
 const f=frame();f.landType.values=Array.from(f.landType.values);f.landType.values[0]=65536;assert.throws(()=>snapshotResponse(f,'2026-08-01'));
});
test('missing metrics stay null; raw int16 is not coerced into percentages',()=>{
 const f=frame();f.roads[0].congestion[0]=null;f.zones[0].satisfaction=-99;const s=snapshotResponse(f,f.date);assert.equal(s.roads[0].congestion[0],null);assert.equal(s.zones[0].satisfaction,-99);
});
test('full staged fixture workflow; running before confirmation rejected',async()=>{
 const s=new V3Session(new FixtureTransport(),opts);await assert.rejects(s.simulate());await s.initialize(setup,file);assert.equal(s.state,'review');await assert.rejects(s.confirm(false));await s.confirm(true);await s.simulate();assert.equal(s.run.snapshots.length,3);const f=await s.snapshot(1);assert.equal(f.date,'2026-09-01');assert.equal(f.zones[0].population,12120);
});
test('unresolved information and wrong confirmation version block next stage',async()=>{
 const s=new V3Session({request:async()=>({...review,items:[{id:'x',field:'f',kind:'unresolved',description:'missing'}]})},opts);await s.initialize(setup,file);await assert.rejects(s.confirm(true),/unresolved/);s.review.items=[];await assert.rejects(s.confirm(true),/not acknowledged/);assert.equal(s.state,'review');
});
test('pending jobs poll to completion and failed jobs never create results',async()=>{
 const calls=[];const t={request:async path=>{calls.push(path);return path==='/initializations'?{status:'queued',jobId:'j1'}:{status:'complete',result:review};}};const s=new V3Session(t,opts);await s.initialize(setup,file);assert.deepEqual(calls,['/initializations','/jobs/j1']);s.state='confirmed';t.request=async()=>({status:'failed',error:'model failed'});await assert.rejects(s.simulate(),/model failed/);assert.equal(s.run,null);
});
test('duplicate clicks prevented; late response after reset discarded',async()=>{
 let release;const s=new V3Session({request:()=>new Promise(r=>release=r)},opts);const pending=s.initialize(setup,file);await assert.rejects(s.initialize(setup,file),/in progress/);while(!release)await new Promise(r=>setImmediate(r));s.reset();release(review);await assert.rejects(pending,/stopped|stale/);assert.equal(s.state,'draft');assert.equal(s.review,null);
});
test('retry keeps operation key; edited input gets a fresh key',async()=>{
 const keys=[];const s=new V3Session({request:async(p,b,s,key)=>{keys.push(key);throw new Error('timeout');}},opts);await assert.rejects(s.initialize(setup,file));await assert.rejects(s.initialize(setup,file));await assert.rejects(s.initialize({...setup,end:'2026-11-01'},file));assert.equal(keys[0],keys[1]);assert.notEqual(keys[1],keys[2]);
});
test('HTTP multipart, JSON key, malformed response and HTTP failure handling',async()=>{
 const calls=[];const t=new HttpTransport(async(url,options)=>{calls.push({url,options});return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});});const form=new FormData();form.append('plan',file);await t.request('/initializations',form,undefined,'key');assert.equal(calls[0].options.body,form);assert.equal(calls[0].options.headers['Content-Type'],undefined);await t.request('/simulations',{},undefined,'k2');assert.equal(calls[1].options.headers['Idempotency-Key'],'k2');
 await assert.rejects(new HttpTransport(async()=>new Response('<html>bad</html>',{status:502})).request('/x'),/Expected JSON/);await assert.rejects(new HttpTransport(async()=>new Response('{"error":"Unavailable"}',{status:503,headers:{'Content-Type':'application/json'}})).request('/x'),/Unavailable/);
});
test('geographic projection round trip preserves coordinates',()=>{for(const p of [[113.7,22.1],[114.7,22.9],[114.08,22.54]]){const q=fromMap(...toMap(...p));assert.ok(Math.abs(q[0]-p[0])<1e-9);assert.ok(Math.abs(q[1]-p[1])<1e-9);}});
test('terrain keeps full data, decimates presentation and masks outside cells',()=>{
 const f=snapshotResponse(frame(),'2026-08-01'),g=terrainGeometry(f);assert.equal(g.getAttribute('position').count,10201);assert.ok(g.index.count>0&&g.index.count<60000);assert.equal(f.height.length,1e6);g.dispose();f.landType.fill(-1);const empty=terrainGeometry(f);assert.equal(empty.index.count,0);empty.dispose();
});
test('invalid IDs and assumption source links cannot bypass contract validation',()=>{
 assert.throws(()=>reviewResponse({...review,initializationId:'a/b'}));
 assert.throws(()=>reviewResponse({...review,items:[{id:'a',field:'x',description:'x',kind:'assumption',value:'x',sources:[{title:'x',url:'javascript:alert(1)'}]}]}));
});
test('legacy scene stays isolated across camera resets and snapshot disposal',async()=>{
 const THREE=await import('../web/vendor/three.module.js');const {V3Map}=await import('../web/v3-map.js');
 const scene=new THREE.Scene(),legacy=new THREE.Group();scene.add(legacy,new THREE.AmbientLight());
 const city={scene,portFlows:{group:new THREE.Group()},canvas:{setAttribute(){},dataset:{}},renderer:{shadowMap:{}}};
 const map=new V3Map(city);legacy.visible=true;assert.equal(legacy.parent.visible,false);assert.equal(map.root.visible,true);
 map.show(snapshotResponse(frame(),'2026-08-01'));map.toggle('roads',false);assert.equal(map.layers.roads.visible,false);map.clear();assert.equal(map.root.children.length,0);assert.equal(legacy.parent.visible,false);
});
