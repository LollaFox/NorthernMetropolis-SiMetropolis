import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BackendWorkspace} from '../web/backend-workspace.js';
import {CompactAnalysisUI} from '../web/analysis-compact.js';
import {normalizeBackendExport} from '../web/backend-results.js';

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.handlers={};this.className='';this._text='';this.value='';this.disabled=false;this.open=false;this.files=[];}
 get classList(){return{add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(n=>!names.includes(n)).join(' ');},contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,on)=>{const set=on??!this.classList.contains(name);this.classList[set?'add':'remove'](name);return set;}};}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set innerText(v){this.textContent=v;}set innerHTML(_){throw new Error('No HTML injection');}
 append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}prepend(...nodes){for(const n of nodes)n.parentNode=this;this.children=[...nodes,...this.children];}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 get firstChild(){return this.children[0]??null;}setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=String(v);}getAttribute(k){return this.attributes[k]??null;}
 addEventListener(k,f){(this.handlers[k]??=[]).push(f);}dispatch(k){return (this.handlers[k]??[]).map(f=>f({target:this}));}click(){return this.dispatch('click');}showModal(){this.open=true;}close(){this.open=false;}
 matches(s){if(s.startsWith('.'))return this.classList.contains(s.slice(1));if(s.startsWith('['))return this.getAttribute(s.slice(1,-1))!==null;return this.tagName===s.toUpperCase();}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}querySelector(s){return this.querySelectorAll(s)[0]??null;}
}
function doc(){const nodes=[],d={nodes,createElement(tag){const e=new Element(tag);nodes.push(e);return e;},getElementById:id=>nodes.find(e=>e.id===id),querySelector:s=>nodes.find(e=>e.matches(s)),querySelectorAll:s=>nodes.filter(e=>e.matches(s))};d.createElementNS=(_,tag)=>d.createElement(tag);d.body=d.createElement('body');d.field=(id,tag='div')=>{const e=d.createElement(tag);e.id=id;return e;};for(const {1:id} of readFileSync(new URL('../web/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g))d.field(id);d.getElementById('port-heading').append(d.createElement('h1'),d.createElement('small'));d.createElement('div').className='port-flow-key';return d;}
const dates=['2026-07-01','2026-08-01','2026-09-01'];
function exported(id='sim_a'){
 const buildings=[{id:'R1',type:'residential',x:0,y:0,startMonth:1,completionMonth:2},{id:'B1',type:'business',x:1,y:0,startMonth:1,completionMonth:1}];
 return{schemaVersion:1,run:{simulationId:id,provenance:'synthetic-narrative-city-scenario',snapshots:dates.map((date,i)=>({id:'frame_'+i,date})),providerMetrics:{summary:{provider:'offline-fixture',sourceType:'deterministic_fixture_not_ai',callCount:4,attemptCount:4,successfulCalls:4,usageAvailable:false}}},setup:{policyScope:{policyId:'context-only'}},scale:{unit:'development_cluster',label:'Synthetic test clusters'},monthlyStates:dates.map((month,i)=>({month,buildings:buildings.map(b=>({...b,status:b.id==='B1'||i>0?'complete':'construction',completedAt:b.id==='B1'?dates[0]:i>0?dates[1]:null})),metrics:{population:i?10:0,meanSatisfaction:i?50:null}})),monthlyBuildingTotals:dates.map((date,i)=>({date,buildings:buildings.map(b=>({...b,housingCapacity:b.id==='R1'&&i>0?20:0,plannedHousingCapacity:b.id==='R1'?20:0,actualResidents:b.id==='R1'&&i>0?10:0,offeredJobs:b.id==='B1'?30:0,filledJobs:b.id==='B1'&&i>0?6:0,vacancies:b.id==='B1'?(i?24:30):0}))}))};
}
function envelope(id='sim_a',date=dates[0]){return{id,playing:false,world:{version:'narrative-display-1',sourceDate:date},timeline:dates.map((date,i)=>({month:300+i,date})),branches:[{id:'sim_a',label:'Saved A'},{id:'sim_b',label:'Saved B'}]};}
async function fixture(task){const before=globalThis.document,beforeStorage=globalThis.localStorage,d=doc();globalThis.document=d;const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};const events=[],o={config:{backendConfigured:true,transport:'local-narrative-scenario'},busy:false,engine:'rules',policyId:'huanggang-opening',selected:['border-access'],session:null,city:{canvas:{dataset:{}},showPortStudy(v){this.portShown=v;}},port:{tab:'policy'},update(){this.backend?.update();},status(text,error){events.push({text,error});},restoreRules(){this.backend?.leave();this.apiResults=false;this.backendReplay=false;},showApiResults(){this.apiResults=true;},openPanel(){this.panel=true;},configure(){this.configured=true;},selectPolicy(id){this.policyId=id;},fillApiMonths(){this.filled=true;},async loadFrame(index){this.loaded=index;},renderReview(){this.reviewed=true;}};let state=envelope();const requests=[],host={getState:()=>state,applyState(value){state=value;},async request(path,body){requests.push({path,body});if(path==='/api/state')return structuredClone(state);if(path==='/api/switch'){state=envelope(body.id);return structuredClone(state);}if(path==='/api/control'){state.playing=body.playing;return structuredClone(state);}if(path==='/api/seek'){state.playing=false;state.world.sourceDate=dates[body.month-300];return structuredClone(state);}throw new Error('Unexpected overview request '+path);}};const w=new BackendWorkspace(o,host);o.backend=w;w.loadExport=async id=>normalizeBackendExport(exported(id));try{return await task({d,o,w,memory,requests,events,host,getState:()=>state,setState:s=>{state=s;}});}finally{globalThis.document=before;globalThis.localStorage=beforeStorage;}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('newly opened history defaults to the first saved simulation month, not the latest',async()=>fixture(async({w,d,requests,setState})=>{
 setState(envelope('sim_a',dates[2]));await w.openSaved();assert.equal(w.date,dates[0]);assert.ok(requests.some(r=>r.path==='/api/seek'&&r.body.month===300));assert.equal(d.getElementById('backend-month-position').textContent,'1 / 3');assert.equal(d.getElementById('backend-month-prev').disabled,true);assert.equal(d.getElementById('backend-month-next').disabled,false);
}));

test('arrow buttons move exactly one saved month and keep map, chart and selector dates aligned',async()=>fixture(async({w,o,d,requests})=>{
 await w.openSaved();const count=requests.length;await w.stepMonth(1);assert.equal(w.date,dates[1]);assert.equal(o.city.canvas.dataset.backendDate,dates[1]);assert.equal(d.getElementById('backend-month-position').textContent,'2 / 3');assert.equal(d.getElementById('compact-api-results').firstChild.dataset.backendDate,dates[1]);
 await w.stepMonth(-1);assert.equal(w.date,dates[0]);assert.deepEqual(requests.slice(count).map(r=>r.body),[{month:301},{month:300}]);
}));

test('arrows stop at saved-history bounds without another request',async()=>fixture(async({w,d,requests})=>{
 await w.openSaved();let count=requests.length;await w.stepMonth(-1);assert.equal(requests.length,count);
 await w.selectMonth(2);count=requests.length;await w.stepMonth(1);assert.equal(requests.length,count);assert.equal(d.getElementById('backend-month-next').disabled,true);assert.equal(d.getElementById('backend-month-prev').disabled,false);
}));

test('play and pause use only replay control; overview polling advances the visible month',async()=>fixture(async({w,d,requests,setState})=>{
 await w.openSaved();const count=requests.length;await w.togglePlayback();assert.equal(w.state.playing,true);assert.equal(d.getElementById('backend-month-play').textContent,'Ⅱ');
 const next=envelope('sim_a',dates[1]);next.playing=true;setState(next);w.syncOverview(next);assert.equal(w.date,dates[1]);assert.equal(d.getElementById('backend-month-position').textContent,'2 / 3');
 await w.togglePlayback();assert.equal(w.state.playing,false);assert.deepEqual(requests.slice(count).map(r=>r.path),['/api/control','/api/control']);
}));

test('Play at the final month rewinds to the first saved frame before replaying',async()=>fixture(async({w,requests})=>{
 await w.openSaved('sim_a',dates[2]);const count=requests.length;await w.togglePlayback();assert.equal(w.date,dates[0]);assert.equal(w.state.playing,true);assert.deepEqual(requests.slice(count).map(r=>r.path),['/api/seek','/api/control']);assert.equal(requests[count].body.month,300);
}));

test('manual month selection during playback pauses at that exact saved frame',async()=>fixture(async({w,requests})=>{
 await w.openSaved();await w.togglePlayback();const count=requests.length;await w.stepMonth(1);assert.equal(w.date,dates[1]);assert.equal(w.state.playing,false);assert.deepEqual(requests.slice(count),[{path:'/api/seek',body:{month:301}}]);
}));

test('single saved month has no enabled playback or navigation',async()=>fixture(async({w,d,requests,setState})=>{
 const raw=exported();raw.monthlyStates=raw.monthlyStates.slice(0,1);raw.monthlyBuildingTotals=raw.monthlyBuildingTotals.slice(0,1);raw.run.snapshots=raw.run.snapshots.slice(0,1);w.loadExport=async()=>normalizeBackendExport(raw);const state=envelope();state.timeline=state.timeline.slice(0,1);setState(state);
 await w.openSaved();const count=requests.length;await w.togglePlayback();assert.equal(requests.length,count);for(const name of ['prev','next','play'])assert.equal(d.getElementById('backend-month-'+name).disabled,true);
}));

test('a failed seek retains the previous month and releases playback controls',async()=>fixture(async({w,o,d,host})=>{
 await w.openSaved();host.request=async()=>{throw new Error('Saved month unavailable');};await assert.rejects(w.seekIndex(1),/unavailable/);assert.equal(w.date,dates[0]);assert.equal(d.getElementById('analysis-month').value,0);assert.equal(o.busy,false);assert.equal(d.getElementById('backend-month-next').disabled,false);
}));

test('leaving an actively playing run pauses it without submitting another analysis',async()=>fixture(async({w,o,requests})=>{
 await w.openSaved();await w.togglePlayback();const count=requests.length;o.restoreRules();await tick();assert.equal(w.state.playing,false);assert.deepEqual(requests.slice(count),[{path:'/api/control',body:{playing:false}}]);
}));

test('completed Start analysis opens the first month in the original 3D city without fetching a raster snapshot',async()=>fixture(async({w,o,requests})=>{
 o.engine='backend';o.pendingTags=['housing-affordability'];o.session={run:{simulationId:'sim_a'},async simulate(){this.state='ready';}};o.port.stop=()=>{};
 await CompactAnalysisUI.prototype.runApi.call(o);assert.equal(o.backendReplay,true);assert.equal(w.date,dates[0]);assert.equal(o.busy,false);assert.equal(o.loaded,undefined);assert.equal(o.filled,undefined);assert.ok(requests.every(r=>!r.path.includes('/snapshots/')));
}));

test('a restored confirmed session can finish without an in-memory pending tag draft',async()=>fixture(async({w,o})=>{
 o.engine='backend';o.pendingTags=null;o.session={setup:{policyScope:{tags:['housing-affordability']}},run:{simulationId:'sim_a'},async simulate(){this.state='ready';}};o.port.stop=()=>{};
 await CompactAnalysisUI.prototype.runApi.call(o);assert.deepEqual(o.resultTags,['housing-affordability']);assert.equal(w.date,dates[0]);assert.equal(o.backendReplay,true);
}));

test('fresh backend connection retains the policy-specific local mode and does not post work',async()=>fixture(async({w,o,d,requests})=>{
 assert.equal(requests.length,0);w.configure();assert.equal(o.engine,'rules');assert.equal(o.session.state,'draft');assert.equal(d.getElementById('analysis-start-date').value,'');assert.equal(d.getElementById('backend-local-demos').classList.contains('hidden'),false);assert.equal(requests.length,0);
}));

test('a new server launch forgets the previous page session and keeps later refreshes',async()=>fixture(async({w,o,memory})=>{
 memory.set('nm-product-launch','old-launch');memory.set('nm-integrated-backend-session-v1','{"schema":"nm-v3-session-v1","state":"ready"}');o.config.launchId='new-launch';o.savedSetup={start:'2025-01-01'};o.deepseekApiKey='page-key';w.configure();assert.equal(memory.get('nm-integrated-backend-session-v1'),undefined);assert.equal(o.savedSetup,null);assert.equal(o.deepseekApiKey,null);assert.equal(o.session.state,'draft');w.configure();assert.equal(o.session.state,'draft');
}));

test('connecting a backend with a stored running operation preserves its API mode and job identity',async()=>fixture(async({w,o,memory,requests})=>{
 o.update=()=>CompactAnalysisUI.prototype.update.call(o);
 const setup={bounds:{west:114,south:22.4,east:114.2,north:22.6},start:dates[0],end:dates[2],step:'month',policyScope:{policyId:'huanggang-opening',tags:['border-access']}};
 memory.set('nm-integrated-backend-session-v1',JSON.stringify({schema:'nm-v3-session-v1',state:'running',setup,review:{initializationId:'init_saved',reviewVersion:'review_saved',items:[]},run:null,keys:{simulate:'key_saved'},lastFingerprint:null,pending:{name:'simulate',phase:'polling',jobId:'job_saved',recoverable:false},job:{jobId:'job_saved',status:'running'}}));w.configure();assert.equal(o.engine,'backend');assert.equal(o.session.pending.jobId,'job_saved');assert.equal(globalThis.document.getElementById('analysis-start').textContent,'Resume analysis ↗');assert.equal(requests.length,0);
}));

test('a completed stored operation does not force a fresh sandbox away from its selected policy model',async()=>fixture(async({w,o,memory,requests})=>{
 const setup={bounds:{west:114,south:22.4,east:114.2,north:22.6},start:dates[0],end:dates[2],step:'month',policyScope:{policyId:'huanggang-opening',tags:['border-access']}};
 memory.set('nm-integrated-backend-session-v1',JSON.stringify({schema:'nm-v3-session-v1',state:'ready',setup,review:{initializationId:'init_saved',reviewVersion:'review_saved',items:[]},run:{simulationId:'sim_a',snapshots:dates.map((date,i)=>({id:'frame_'+i,date}))},keys:{simulate:'key_saved'},lastFingerprint:null,pending:null}));w.configure();assert.equal(o.engine,'rules');assert.equal(o.session.run.simulationId,'sim_a');assert.equal(requests.length,0);
}));

test('openSaved can select a precise saved date using its actual overview month value',async()=>fixture(async({w,o,d,requests,getState})=>{
 await w.openSaved('sim_a',dates[2]);assert.equal(w.date,dates[2]);assert.equal(w.current.simulationId,'sim_a');assert.equal(o.backendReplay,true);assert.equal(o.apiResults,true);assert.equal(getState().world.sourceDate,dates[2]);assert.deepEqual(requests.map(r=>r.path),['/api/state','/api/seek']);assert.deepEqual(requests[1].body,{month:302});assert.equal(d.getElementById('analysis-month').value,2);assert.equal(o.city.canvas.dataset.backendDate,dates[2]);assert.match(d.getElementById('compact-api-results').textContent,/Canonical backend results/);
}));

test('changing a saved month and saved run updates canonical id/date without model initialization or simulation',async()=>fixture(async({w,o,requests})=>{
 await w.openSaved('sim_b',dates[1]);assert.equal(w.simulationId,'sim_b');assert.equal(w.date,dates[1]);assert.equal(o.city.canvas.dataset.backendSimulation,'sim_b');assert.ok(requests.some(r=>r.path==='/api/switch'&&r.body.id==='sim_b'));
 const count=requests.length;w.selectMonth(0);await tick();assert.equal(w.date,dates[0]);assert.ok(requests.slice(count).every(r=>['/api/state','/api/seek'].includes(r.path)));assert.ok(!requests.some(r=>r.path.includes('simulations')||r.path.includes('initializations')));
}));

test('loading saved replay preserves a separately recoverable pending API task',async()=>fixture(async({w,o})=>{
 const pending={name:'simulate',phase:'polling',jobId:'job_existing'};let reset=0;o.session={pending,reset(){reset++;}};
 await w.openSaved();assert.equal(o.session.pending,pending);assert.equal(reset,0);
}));

test('canonical object selection and map inspection use persistent id and exact sourceDate',async()=>fixture(async({w,o,d,host})=>{
 await w.openSaved('sim_a',dates[1]);const select=d.getElementById('compact-api-results').querySelector('[data-backend-object]');select.value='R1';select.dispatch('change');assert.equal(w.selectedObjectId,'R1');
 host.getState=()=>envelope('sim_b',dates[0]);await w.inspect('B1');assert.equal(w.simulationId,'sim_b');assert.equal(w.date,dates[0]);assert.equal(d.getElementById('compact-api-results').querySelector('[data-backend-object]').value,'B1');assert.equal(o.city.canvas.dataset.backendSimulation,'sim_b');
}));

test('canonical date selector replays intermediate settlement dates rather than treating ISO date as an index',async()=>fixture(async({w,d})=>{
 await w.openSaved();const select=d.getElementById('compact-api-results').querySelector('[data-backend-date]');select.value=dates[1];select.dispatch('change');await tick();assert.equal(w.date,dates[1]);assert.equal(d.getElementById('compact-api-results').firstChild.dataset.backendDate,dates[1]);
}));

test('saved replay failure releases busy state and reports the actual error',async()=>fixture(async({w,o,events})=>{
 w.loadExport=async()=>{throw new Error('Canonical export unavailable');};await assert.rejects(w.openSaved(),/Canonical export unavailable/);assert.equal(o.busy,false);assert.ok(events.some(e=>e.error&&e.text==='Canonical export unavailable'));
}));

test('loadExport coalesces concurrent GETs, validates returned run identity and evicts failed cache entries',async()=>fixture(async({w,o})=>{
 const before=globalThis.fetch;let calls=0,wrong=false,fail=false;delete w.loadExport;
 try{globalThis.fetch=async()=>{calls++;if(fail)throw new Error('Temporary failure');return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>exported(wrong?'sim_b':'sim_a')};};
  const [a,b]=await Promise.all([w.loadExport('sim_a'),w.loadExport('sim_a')]);assert.equal(calls,1);assert.equal(a,b);await w.loadExport('sim_a');assert.equal(calls,1);
  w.cache.clear();wrong=true;await assert.rejects(w.loadExport('sim_a'),/simulation|identity|match/i);assert.equal(w.cache.has('sim_a'),false);
  wrong=false;fail=true;await assert.rejects(w.loadExport('sim_a'),/Temporary/);assert.equal(w.cache.has('sim_a'),false);fail=false;await w.loadExport('sim_a');assert.equal(calls,4);
 }finally{globalThis.fetch=before;}
}));

test('leaving during a delayed saved replay prevents stale display and seek mutations',async()=>fixture(async({w,o,requests})=>{
 let release;w.loadExport=()=>new Promise(resolve=>release=resolve);const pending=w.openSaved();await tick();o.restoreRules();o.engine='rules';release(normalizeBackendExport(exported('sim_a')));await pending;
 assert.equal(o.engine,'rules');assert.equal(o.backendReplay,false);assert.equal(o.apiResults,false);assert.ok(!requests.some(r=>r.path==='/api/seek'));
}));

test('local demo button leaves backend replay and stops only waiting without posting a cancellation',async()=>fixture(async({w,o,d,requests})=>{
 let stopped=0;o.session={stopWaiting(){stopped++;}};await w.openSaved();d.getElementById('backend-local-demos').click();assert.equal(stopped,1);assert.equal(o.engine,'rules');assert.equal(o.backendReplay,false);assert.equal(o.city.canvas.dataset.backendSimulation,undefined);assert.equal(o.city.canvas.dataset.backendDate,undefined);assert.ok(!requests.some(r=>/cancel|simulations|initializations/.test(r.path)));
}));

test('overview playback or timeline seek keeps the canonical panel on the same source month without requests',async()=>fixture(async({w,o,d,requests})=>{
 await w.openSaved();const count=requests.length;w.syncOverview(envelope('sim_a',dates[0]));
 assert.equal(w.date,dates[0]);assert.equal(d.getElementById('analysis-month').value,0);assert.equal(o.city.canvas.dataset.backendDate,dates[0]);assert.equal(requests.length,count);
 assert.equal(d.getElementById('compact-api-results').firstChild.dataset.backendDate,dates[0]);
}));

test('overview polling does not reopen a saved city while a local demo is active',async()=>fixture(async({w,o,requests})=>{
 await w.openSaved();o.restoreRules();const count=requests.length;w.syncOverview(envelope('sim_b',dates[1]));await tick();
 assert.equal(o.backendReplay,false);assert.equal(requests.length,count);
}));

test('Saved city reopens the existing analysis shell after the user closes it',async()=>fixture(async({w,o})=>{
 let opened=0;o.port.active=false;o.port.open=async()=>{opened++;o.port.active=true;};
 await w.openSaved();assert.equal(opened,1);assert.equal(o.port.active,true);assert.equal(o.panel,true);assert.equal(o.city.portShown,false);
 await w.openSaved();assert.equal(opened,1);
}));

test('new Team API setup is an explicit new session and does not post until user initialization',async()=>fixture(async({w,o,requests})=>{
 let reset=0;o.session={reset(){reset++;}};o.backendReplay=true;w.newAnalysis();assert.equal(reset,1);assert.equal(o.engine,'backend');assert.equal(o.backendReplay,false);assert.equal(o.session.state,'draft');assert.equal(o.configured,true);assert.equal(requests.length,0);
}));

test('restored pending simulation resumes its saved job by GET without duplicate POST or a new operation key',async()=>fixture(async({w,o,memory})=>{
 const setup={bounds:{west:114,south:22.4,east:114.2,north:22.6},start:dates[0],end:dates[2],step:'month',policyScope:{policyId:'housing'}};
 memory.set('nm-integrated-backend-session-v1',JSON.stringify({schema:'nm-v3-session-v1',state:'running',busy:true,setup,review:{initializationId:'init_saved',reviewVersion:'review_saved',items:[]},run:null,keys:{simulate:'key_existing'},lastFingerprint:null,pending:{name:'simulate',phase:'polling',jobId:'job_existing',recoverable:false},job:{jobId:'job_existing',status:'running'}}));
 const calls=[],transport={async request(path,body,signal,key){calls.push({path,body,key});return{jobId:'job_existing',status:'complete',result:{simulationId:'sim_a',snapshots:dates.map((date,i)=>({id:'frame_'+i,date}))}};}};
 o.session=w.createSession(transport);assert.equal(o.session.pending.jobId,'job_existing');await w.resume();assert.deepEqual(calls.map(c=>c.path),['/jobs/job_existing']);assert.equal(calls[0].body,undefined);assert.equal(o.session.keys.simulate,'key_existing');assert.equal(o.session.state,'ready');assert.equal(o.backendReplay,true);assert.equal(w.date,dates[0]);assert.equal(o.loaded,undefined);assert.equal(o.busy,false);
}));

test('workspace resume returns initialization review to the confirmation dialog without simulating',async()=>fixture(async({w,o,d})=>{
 let resumed=0,loaded=0;o.session={pending:{name:'initialize'},state:'initializing',async resume(){resumed++;this.state='review';this.pending=null;},review:{items:[]}};o.loadFrame=async()=>{loaded++;};await w.resume();assert.equal(resumed,1);assert.equal(o.reviewed,true);assert.equal(d.getElementById('analysis-review-dialog').open,true);assert.equal(loaded,0);
}));

test('primary Start routes replay to new setup and pending backend work to resume, preserving fixture behavior',async()=>fixture(async({o})=>{
 let fresh=0,resume=0,shown=0;const c={busy:false,backendReplay:true,backend:{newAnalysis(){fresh++;},async resume(){resume++;}}};await CompactAnalysisUI.prototype.start.call(c);assert.equal(fresh,1);
 c.backendReplay=false;c.engine='backend';c.session={pending:{jobId:'saved'}};await CompactAnalysisUI.prototype.start.call(c);assert.equal(resume,1);
 const scope={tags:['border-access']};Object.assign(c,{engine:'fixture',policyId:'huanggang-opening',areaId:'huanggang',selected:['border-access'],session:{state:'ready',setup:{policyScope:scope}},setup:()=>({policyScope:scope}),showApiResults(){shown++;},status(){},update(){}});
 globalThis.document.getElementById('analysis-plan').files=[new File(['%PDF-1.4'],'test.pdf')];await CompactAnalysisUI.prototype.start.call(c);assert.equal(shown,1);
}));
