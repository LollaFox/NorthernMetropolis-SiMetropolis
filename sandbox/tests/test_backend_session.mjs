import test from 'node:test';
import assert from 'node:assert/strict';
import {V3Session,HttpTransport} from '../web/v3-api.js';

const setup={bounds:{west:114,south:22.45,east:114.15,north:22.6},start:'2026-08-01',end:'2026-10-01',step:'month'};
const file=new File(['%PDF-1.4\nSESSION TEST'],'plan.pdf',{type:'application/pdf'});
const review={initializationId:'init_test',reviewVersion:'review_1',items:[]};
const run={simulationId:'sim_test',snapshots:[{id:'frame_20260801',date:'2026-08-01'},{id:'frame_20260901',date:'2026-09-01'},{id:'frame_20261001',date:'2026-10-01'}],providerMetrics:{attempts:[{status:'ok',role:'firm'}],summary:{callCount:12,attemptCount:13,successfulCalls:12}}};
const fullExport=()=>({schemaVersion:1,run:structuredClone(run),setup:structuredClone(setup),review:structuredClone(review),scale:{housingUnit:'resident places'},monthlyStates:[{date:'2026-08-01',canonical:'complete world',population:1234}],monthlyBuildingTotals:[{date:'2026-08-01',completed:3}]});
const opts=(extra={})=>({today:'2026-10-16',sleep:async()=>{},...extra});
const memory=()=>{const records=new Map();return {records,getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};};
const transport=(handler)=>{const calls=[];return {calls,async request(path,body,signal,key){calls.push({path,body,signal,key});if(handler){const value=await handler(path,body,signal,key,calls);if(value!==undefined)return value;}if(path==='/initializations')return structuredClone(review);if(path.endsWith('/confirm'))return {confirmed:true,reviewVersion:review.reviewVersion};if(path==='/simulations')return structuredClone(run);if(path.endsWith('/export'))return fullExport();throw new Error('Unexpected test route '+path);}};};
async function confirmed(t=transport(),options={}){const s=new V3Session(t,opts(options));await s.initialize(setup,file);await s.confirm(true);return s;}
async function ready(t=transport(),options={}){const s=await confirmed(t,options);await s.simulate();return s;}

test('default polling supports a 355-second simulated long task beyond the old 120-poll cutoff',async()=>{
 let polls=0,waited=0;const progress=[];
 const t=transport(path=>path==='/simulations'?{status:'queued',jobId:'job_long'}:path==='/jobs/job_long'?(++polls<=355?{jobId:'job_long',status:'running',simulationId:'sim_test',completedMonths:Math.floor(polls/120),totalMonths:3,progress:{activeMonth:'2026-09-01',callCount:polls},providerMetrics:{callCount:polls,attemptCount:polls}}:{jobId:'job_long',status:'complete',result:structuredClone(run)}):undefined);
 const s=await confirmed(t,{sleep:async ms=>{waited+=ms;},onProgress:event=>progress.push(event)});await s.simulate();
 assert.equal(s.state,'ready');assert.equal(polls,356);assert.equal(waited,356000);assert.ok(progress.some(p=>p.status==='running'&&p.providerMetrics.callCount===355));assert.equal(s.providerMetrics.callCount,12);assert.equal(progress.at(-1).status,'complete');
});
test('progress callback preserves active month, completed/total counts and provider summary',async()=>{
 const events=[];const t=transport(path=>path==='/simulations'?{jobId:'job_1',status:'queued'}:path==='/jobs/job_1'?{jobId:'job_1',status:'complete',simulationId:'sim_test',completedMonths:3,totalMonths:3,progress:{activeMonth:null,completedMonths:3,attemptCount:13},providerMetrics:{attemptCount:13,successfulCalls:12},result:structuredClone(run)}:undefined);
 const s=await confirmed(t,{onProgress:event=>events.push(event)});await s.simulate();const e=events.at(-1);assert.equal(e.completedMonths,3);assert.equal(e.totalMonths,3);assert.equal(e.progress.activeMonth,null);assert.equal(e.providerMetrics.successfulCalls,12);assert.equal(e.simulationId,'sim_test');
});
for(const state of ['review','confirmed','ready'])test(`refresh restores ${state} without making a backend request or losing keys`,async()=>{
 const storage=memory(),t=transport(),s=new V3Session(t,opts({storage,storageKey:'test-session'}));await s.initialize(setup,file);if(state!=='review')await s.confirm(true);if(state==='ready')await s.simulate();const saved=s.serialize(),freshTransport=transport(),restored=new V3Session(freshTransport,opts({storage,storageKey:'test-session'}));
 assert.equal(restored.state,state);assert.equal(restored.busy,false);assert.deepEqual(restored.keys,saved.keys);assert.deepEqual(restored.setup,saved.setup);assert.deepEqual(restored.review,saved.review);assert.deepEqual(restored.run,saved.run);assert.equal(freshTransport.calls.length,0);assert.deepEqual(await restored.resume(),state==='ready'?restored.run:restored.review);
});
test('refresh restores a running job and resumes it with GET instead of creating another simulation',async()=>{
 const storage=memory(),t=transport(path=>path==='/simulations'?{jobId:'job_saved',status:'queued'}:path==='/jobs/job_saved'?{jobId:'job_saved',status:'running',simulationId:'sim_test',completedMonths:1,totalMonths:3,progress:{activeMonth:'2026-09-01'}}:undefined);
 const s=await confirmed(t,{storage,pollLimit:1});await assert.rejects(s.simulate(),/polling limit/);assert.equal(s.state,'running');const simulationKey=s.keys.simulate;
 const next=transport(path=>path==='/jobs/job_saved'?{jobId:'job_saved',status:'complete',result:structuredClone(run)}:undefined),restored=new V3Session(next,opts({storage}));assert.equal(restored.pending.jobId,'job_saved');assert.equal(restored.busy,false);await restored.resume();assert.equal(restored.state,'ready');assert.equal(restored.keys.simulate,simulationKey);assert.deepEqual(next.calls.map(c=>c.path),['/jobs/job_saved']);
});
test('recoverable failed job explicitly retries the same POST key and the same saved job',async()=>{
 const storage=memory(),keys=[];let retried=false;
 const t=transport((path,body,signal,key)=>{if(path==='/simulations'){keys.push(key);return {jobId:'job_recoverable',status:'queued'};}if(path==='/jobs/job_recoverable')return {jobId:'job_recoverable',status:'failed',recoverable:true,error:'Restarted; same key required.'};});
 const s=await confirmed(t,{storage});await assert.rejects(s.simulate(),/same key/);assert.equal(s.state,'confirmed');assert.equal(s.lastError.recoverable,true);
 const next=transport((path,body,signal,key)=>{if(path==='/jobs/job_recoverable')return retried?{jobId:'job_recoverable',status:'complete',result:structuredClone(run)}:{jobId:'job_recoverable',status:'failed',recoverable:true,error:'Restarted; same key required.'};if(path==='/simulations'){keys.push(key);retried=true;return {jobId:'job_recoverable',status:'queued'};}}),restored=new V3Session(next,opts({storage}));
 await restored.resume();assert.equal(restored.state,'ready');assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.deepEqual(next.calls.map(c=>c.path),['/jobs/job_recoverable','/simulations','/jobs/job_recoverable']);
});
test('unrecoverable failed jobs are surfaced without automatically posting another run',async()=>{
 const t=transport(path=>path==='/simulations'?{jobId:'job_terminal',status:'queued'}:path==='/jobs/job_terminal'?{jobId:'job_terminal',status:'failed',recoverable:false,error:'Terminal backend failure.'}:undefined),s=await confirmed(t);await assert.rejects(s.simulate(),/Terminal/);await assert.rejects(s.resume(),/Terminal/);assert.equal(t.calls.filter(c=>c.path==='/simulations').length,1);assert.equal(s.run,null);
});
test('stopping waiting preserves the job and does not claim or request backend cancellation',async()=>{
 let s,stopped=false;const t=transport(path=>path==='/simulations'?{jobId:'job_wait',status:'queued'}:path==='/jobs/job_wait'?{jobId:'job_wait',status:'complete',result:structuredClone(run)}:undefined);
 s=await confirmed(t,{sleep:async()=>{if(!stopped){stopped=true;s.stopWaiting();}}});await assert.rejects(s.simulate(),/Waiting stopped/);assert.equal(s.state,'running');assert.equal(s.pending.jobId,'job_wait');assert.equal(s.busy,false);await s.resume();assert.equal(s.state,'ready');assert.ok(t.calls.every(c=>!c.path.includes('cancel')));assert.equal(t.calls.filter(c=>c.path==='/simulations').length,1);
});
test('unknown simulation POST outcome is retryable after refresh with the original operation key',async()=>{
 const storage=memory(),keys=[];const t=transport((path,body,signal,key)=>{if(path==='/simulations'){keys.push(key);throw new Error('Connection lost after POST.');}}),s=await confirmed(t,{storage});await assert.rejects(s.simulate(),/Connection lost/);assert.equal(s.pending.jobId,null);assert.equal(s.state,'running');
 const next=transport((path,body,signal,key)=>{if(path==='/simulations')keys.push(key);}),restored=new V3Session(next,opts({storage}));await restored.resume();assert.equal(restored.state,'ready');assert.equal(keys[0],keys[1]);
});
test('unknown initialization POST outcome requires PDF reselection and does not persist its bytes',async()=>{
 const storage=memory(),keys=[],t=transport((path,body,signal,key)=>{if(path==='/initializations'){keys.push(key);throw new Error('Upload outcome unknown.');}}),s=new V3Session(t,opts({storage}));await assert.rejects(s.initialize(setup,file),/unknown/);const serialized=JSON.stringify(s.serialize());assert.ok(!serialized.includes('%PDF-'));assert.ok(!serialized.includes('SESSION TEST'));assert.equal(s.needsFile,true);
 const next=transport((path,body,signal,key)=>{if(path==='/initializations')keys.push(key);}),restored=new V3Session(next,opts({storage}));await assert.rejects(restored.resume(),/Reselect the original PDF/);assert.equal(next.calls.length,0);await restored.resume(file);assert.equal(restored.state,'review');assert.equal(keys[0],keys[1]);
});
test('initialization with a known pending job resumes without storing or reselecting a PDF',async()=>{
 const storage=memory(),t=transport(path=>path==='/initializations'?{jobId:'job_init',status:'queued'}:path==='/jobs/job_init'?{jobId:'job_init',status:'running'}:undefined),s=new V3Session(t,opts({storage,pollLimit:1}));await assert.rejects(s.initialize(setup,file),/polling limit/);assert.equal(s.needsFile,false);
 const next=transport(path=>path==='/jobs/job_init'?{jobId:'job_init',status:'complete',result:structuredClone(review)}:undefined),restored=new V3Session(next,opts({storage}));await restored.resume();assert.equal(restored.state,'review');assert.deepEqual(next.calls.map(c=>c.path),['/jobs/job_init']);
});
test('recoverable initialization jobs require matching original PDF bytes on retry',async()=>{
 let failed=true;const keys=[],t=transport((path,body,signal,key)=>{if(path==='/initializations'){keys.push(key);return failed?{jobId:'job_init_retry',status:'queued'}:structuredClone(review);}if(path==='/jobs/job_init_retry')return {jobId:'job_init_retry',status:'failed',recoverable:true,error:'Retry initialization.'};}),s=new V3Session(t,opts());await assert.rejects(s.initialize(setup,file),/Retry/);await assert.rejects(s.resume(),/Reselect/);await assert.rejects(s.resume(new File(['%PDF-1.4\nChanged'],'plan.pdf')),/unchanged bytes/);failed=false;await s.resume(file);assert.equal(s.state,'review');assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});
test('confirmation POST interrupted by refresh retries the acknowledged version and its same key',async()=>{
 const storage=memory(),keys=[],t=transport((path,body,signal,key)=>{if(path.endsWith('/confirm')){keys.push(key);throw new Error('Confirm outcome unknown.');}}),s=new V3Session(t,opts({storage}));await s.initialize(setup,file);await assert.rejects(s.confirm(true),/unknown/);assert.equal(s.state,'confirming');
 const next=transport((path,body,signal,key)=>{if(path.endsWith('/confirm')){keys.push(key);assert.deepEqual(body,{reviewVersion:'review_1'});}}),restored=new V3Session(next,opts({storage}));await restored.resume();assert.equal(restored.state,'confirmed');assert.equal(keys[0],keys[1]);
});
test('operation keys survive ordinary retries but changed initialization input receives a fresh key',async()=>{
 const keys=[],t=transport((path,body,signal,key)=>{if(path==='/initializations'){keys.push(key);throw new Error('Retry.');}}),s=new V3Session(t,opts());await assert.rejects(s.initialize(setup,file));await assert.rejects(s.initialize(setup,file));await assert.rejects(s.initialize({...setup,end:'2026-11-01'},file));assert.equal(keys[0],keys[1]);assert.notEqual(keys[1],keys[2]);
});
test('full canonical export is cached in memory, preserves full states, and is excluded from browser storage',async()=>{
 const storage=memory(),t=transport(),s=await ready(t,{storage});const a=await s.exportRun(),b=await s.exportRun();assert.equal(t.calls.filter(c=>c.path.endsWith('/export')).length,1);assert.equal(a,b);assert.equal(a.monthlyStates[0].canonical,'complete world');assert.equal(a.monthlyBuildingTotals[0].completed,3);assert.ok(!JSON.stringify(s.serialize()).includes('complete world'));assert.ok(!storage.getItem('nm-v3-session-v1').includes('complete world'));await s.exportRun({refresh:true});assert.equal(t.calls.filter(c=>c.path.endsWith('/export')).length,2);
});
test('concurrent full-export requests share one in-flight GET',async()=>{
 let release;const t=transport(path=>path.endsWith('/export')?new Promise(resolve=>release=resolve):undefined),s=await ready(t),a=s.exportRun(),b=s.exportRun();assert.equal(t.calls.filter(c=>c.path.endsWith('/export')).length,1);release(fullExport());assert.equal(await a,await b);
});
test('invalid or failed exports never become cached and a subsequent retry can succeed',async()=>{
 let bad=true;const t=transport(path=>path.endsWith('/export')?(bad?{schemaVersion:1,run:{...run,simulationId:'wrong'},monthlyStates:[],monthlyBuildingTotals:[]}:fullExport()):undefined),s=await ready(t);await assert.rejects(s.exportRun(),/full canonical/);assert.equal(s.exportCache,null);bad=false;await s.exportRun();assert.equal(t.calls.filter(c=>c.path.endsWith('/export')).length,2);
});
test('reset discards late export and does not overwrite a new draft with stale run state',async()=>{
 let release;const t=transport(path=>path.endsWith('/export')?new Promise(resolve=>release=resolve):undefined),s=await ready(t),pending=s.exportRun();s.reset();release(fullExport());await assert.rejects(pending,/stale export/);assert.equal(s.state,'draft');assert.equal(s.exportCache,null);
});
test('storage failure does not fail a backend operation and malformed existing data remain untouched',async()=>{
 const broken={getItem:()=>null,setItem:()=>{throw new Error('Quota exceeded.');}},s=new V3Session(transport(),opts({storage:broken}));await s.initialize(setup,file);assert.equal(s.state,'review');assert.match(s.storageError,/could not be saved/);
 const storage=memory();storage.setItem('nm-v3-session-v1','{broken original');const restored=new V3Session(transport(),opts({storage}));assert.equal(restored.state,'draft');assert.equal(restored.storageBlocked,true);await restored.initialize(setup,file);assert.equal(storage.getItem('nm-v3-session-v1'),'{broken original');restored.reset();assert.equal(restored.storageBlocked,false);assert.equal(JSON.parse(storage.getItem('nm-v3-session-v1')).state,'draft');
});
test('onState and progress callbacks get detached snapshots and callback errors cannot fail a run',async()=>{
 const states=[],t=transport(path=>path==='/simulations'?{jobId:'job_callback',status:'queued'}:path==='/jobs/job_callback'?{jobId:'job_callback',status:'complete',result:structuredClone(run)}:undefined),s=await confirmed(t,{onState:snapshot=>{states.push(snapshot.state);snapshot.keys.simulate='tampered';throw new Error('View failed');},onProgress:event=>{event.progress.completedMonths=999;throw new Error('Progress view failed');}});await s.simulate();assert.equal(s.state,'ready');assert.ok(states.includes('running'));assert.notEqual(s.keys.simulate,'tampered');assert.notEqual(s.progress.completedMonths,999);
});
test('restore validation rejects corrupt state, IDs and history without mutating an existing valid session',async()=>{
 const s=await ready(),original=s.serialize();for(const mutate of [d=>d.schema='other',d=>d.state='cancelled',d=>d.keys.simulate='unsafe/path',d=>d.review.initializationId='unsafe/path',d=>d.run.snapshots[1].date='2026-08-01',d=>{d.state='running';d.pending=null;},d=>{d.pending={name:'simulate',phase:'polling',jobId:'../bad'};},d=>d.setup.bounds.west=115]){const raw=structuredClone(original);mutate(raw);assert.throws(()=>s.restoreSnapshot(raw));assert.deepEqual(s.serialize(),original);}
});
test('manual serialization and restore remain usable when no storage adapter is supplied',async()=>{
 const s=await ready(),snapshot=JSON.parse(JSON.stringify(s.serialize())),next=new V3Session(transport(),opts());next.restoreSnapshot(snapshot);assert.equal(next.state,'ready');assert.deepEqual(next.run,run);snapshot.keys.simulate='caller-changed';assert.notEqual(next.keys.simulate,'caller-changed');
});
test('HTTP error status and recoverable flags survive transport error handling',async()=>{
 const t=new HttpTransport(async()=>new Response(JSON.stringify({error:'Restart required.',recoverable:true}),{status:503,headers:{'Content-Type':'application/json'}}));await assert.rejects(t.request('/simulations',{}),error=>error.httpStatus===503&&error.recoverable===true&&/Restart/.test(error.message));
});
test('invalid polling configuration and exporting before completion are rejected',async()=>{
 for(const options of [{pollLimit:0},{pollLimit:.5},{pollInterval:-1},{pollInterval:NaN}])assert.throws(()=>new V3Session(transport(),opts(options)));const s=new V3Session(transport(),opts());await assert.rejects(s.exportRun(),/Complete a simulation/);await assert.rejects(s.resume(),/No pending/);
});
