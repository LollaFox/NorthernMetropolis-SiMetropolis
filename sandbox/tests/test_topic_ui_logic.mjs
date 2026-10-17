import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicStudiesUI } from '../web/topic-ui.js';
import { CompactAnalysisUI } from '../web/analysis-compact.js';
import { PortStudyUI } from '../web/port-study.js';
import { getPolicy } from '../web/policy-catalog.js';

// Business-flow tests only. Rendering, network and GPU construction are excluded.
// The actual topic calculations, scenario history, main button handlers and export
// handlers are executed; the presentation callbacks merely count their calls.
class Element {
  constructor(tag='div', document) {
    this.tagName=tag.toUpperCase();this.document=document;this.children=[];
    this.listeners={};this.dataset={};this.attributes={};this.value='';this.style={};
    const values=new Set();this.classList={add:(...names)=>names.forEach(n=>values.add(n)),remove:(...names)=>names.forEach(n=>values.delete(n)),
      contains:n=>values.has(n),toggle:(name,force)=>{const next=force===undefined?!values.has(name):force;if(next)values.add(name);else values.delete(name);return next;}};
  }
  addEventListener(name,callback){(this.listeners[name]??=[]).push(callback);}
  async fire(name,values={}){for(const callback of this.listeners[name]??[])await callback({target:this,preventDefault(){},...values});}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  after(...children){this.afterChildren=children;}
  click(){if(this.tagName==='A')this.document.downloads.push(this);return this.fire('click');}
  close(){this.open=false;}
  showModal(){this.open=true;}
  querySelectorAll(){return [];}
}
function installEnvironment(context){
  const elements=new Map(),downloads=[],storage=new Map();
  const dom={downloads,createElement:tag=>new Element(tag,dom),createElementNS:(_,tag)=>new Element(tag,dom),
    getElementById:id=>{if(!elements.has(id))elements.set(id,new Element('div',dom));return elements.get(id);},
    querySelectorAll:()=>[],addEventListener(){},body:new Element('body',null)};
  const replaceGlobal=(key,value)=>{const original=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    context.after(()=>original?Object.defineProperty(globalThis,key,original):delete globalThis[key]);};
  replaceGlobal('document',dom);
  replaceGlobal('localStorage',{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)});
  replaceGlobal('matchMedia',()=>({matches:true}));
  const blobs=[];
  context.mock.method(URL,'createObjectURL',blob=>{blobs.push(blob);return `blob:test-${blobs.length}`;});
  context.mock.method(URL,'revokeObjectURL',()=>{});
  context.mock.method(globalThis,'setTimeout',callback=>{callback();return 0;});
  return {dom,elements,downloads,storage,blobs,$:id=>dom.getElementById(id)};
}
function controller(context,policyId='kwu-tung-housing'){
  const environment=installEnvironment(context),calls={render:0,tabs:[],status:[],open:0,update:0,focus:[],portVisibility:[],portRuns:0};
  const compact=Object.create(CompactAnalysisUI.prototype),policy=getPolicy(policyId);
  Object.assign(compact,{engine:'rules',busy:false,selected:[policy.primaryTag],policyId:policy.id,areaId:policy.areaId,
    city:{focusDistrict:id=>calls.focus.push(id),showPortStudy:value=>calls.portVisibility.push(value),setPortMotion(){}},
    port:{stop(){},month:0,ledger:{revisions:[]}},
    update:()=>calls.update++,status:(message,error=false)=>calls.status.push({message,error}),openPanel:()=>calls.open++,
    runRules:()=>calls.portRuns++,picker:{set(){}},config:{backendConfigured:false}});
  const topics=new TopicStudiesUI(compact);compact.topics=topics;
  topics.overlay={show(){},hide(){}};
  topics.render=()=>calls.render++;
  topics.showTab=tab=>calls.tabs.push(tab);
  topics.activate(policy);
  return {compact,topics,calls,policy,...environment};
}
const copy=value=>JSON.parse(JSON.stringify(value));
const byDate=(study,date)=>study.months.find(month=>month.date===date);

for(const policyId of ['kwu-tung-housing','hung-shui-kiu-school']){
  test(`${policyId}: first analysis uses the specific capacity model and repeated analysis creates no duplicate revision`,context=>{
    const {topics,calls,policy}=controller(context,policyId);
    assert.equal(topics.hasResult,false);
    topics.run();
    assert.equal(topics.record.ledger.revisions.length,1);
    assert.equal(topics.study.model,policy.model);
    assert.equal(topics.study.areaId,policy.areaId);
    assert.equal(topics.study.provenance,'hypothetical-local-rule-model');
    assert.ok(topics.study.months.every(month=>!Object.hasOwn(month,'extra')&&!Object.hasOwn(month,'groups')));
    const original=copy(topics.record.ledger),study=copy(topics.study);
    topics.run();topics.run();
    assert.deepEqual(topics.record.ledger,original);
    assert.deepEqual(topics.study,study);
    assert.equal(calls.tabs.at(-1),'results');assert.equal(calls.portRuns,0);
  });

  test(`${policyId}: a later effective adjustment retains all earlier monthly snapshots`,context=>{
    const {topics,policy}=controller(context,policyId);
    // Use a short commissioning cycle so both delivered stock and future change
    // are exercised through the controller, rather than merely the pure model.
    const values={...policy.defaults,start:'2026-08-01',end:'2027-07-01',demand:2000,supply:1000,growth:0,
      added:900,commission:'2026-10-01',rollout:3};
    topics.drafts[topics.activeId]={values,effective:'2026-08-01',reason:'Initial explicit commissioning scenario.'};
    topics.run();const before=copy(topics.study);
    topics.drafts[topics.activeId]={values:{...values,added:1200,commission:'2027-01-01',rollout:2},
      effective:'2026-12-01',reason:'Increase later capacity without rewriting earlier months.'};
    topics.run();
    assert.equal(topics.record.ledger.revisions.length,2);
    assert.equal(topics.study.months[topics.record.month].date,'2026-12-01');
    assert.deepEqual(topics.study.months.filter(m=>m.date<'2026-12-01'),before.months.filter(m=>m.date<'2026-12-01'));
    assert.equal(byDate(topics.study,'2026-11-01').delivered,600);
    assert.equal(byDate(topics.study,'2027-02-01').delivered,1200);
    assert.equal(topics.drafts[topics.activeId],undefined);
  });

  test(`${policyId}: month selection is read-only policy browsing and retains an unapplied draft`,context=>{
    const {topics,policy}=controller(context,policyId);topics.run();
    const before=copy(topics.record.ledger),allSnapshots=copy(topics.study.months);
    const draft={values:{...policy.defaults,added:policy.defaults.added+1},effective:policy.defaults.start,reason:'Unapplied draft.'};
    topics.drafts[topics.activeId]=draft;
    for(const month of [topics.study.months.length-1,0,2,0])topics.selectMonth(month);
    assert.equal(topics.record.month,0);
    assert.deepEqual(topics.record.ledger,before);assert.deepEqual(topics.study.months,allSnapshots);
    assert.equal(topics.drafts[topics.activeId],draft);
    for(const invalid of [-1,1.5,topics.study.months.length,NaN])topics.selectMonth(invalid);
    assert.equal(topics.record.month,0);
  });

  test(`${policyId}: main Start button routes to the topic model, never the port-trip model`,async context=>{
    const {compact,topics,calls,$}=controller(context,policyId);
    CompactAnalysisUI.prototype.bind.call(compact);
    await $('analysis-start').fire('click');
    assert.equal(topics.record.ledger.revisions.length,1);assert.equal(calls.portRuns,0);
    assert.deepEqual(compact.selected,[topics.policy.primaryTag]);
    assert.ok(calls.status.some(s=>/Assumption model ready/.test(s.message)));
    $('analysis-month').value=String(topics.study.months.length-1);
    const before=copy(topics.record.ledger);await $('analysis-month').fire('change');
    assert.equal(topics.record.month,topics.study.months.length-1);
    assert.deepEqual(topics.record.ledger,before);assert.equal(calls.portRuns,0);
    await $('analysis-start').fire('click');assert.equal(topics.record.ledger.revisions.length,1);
  });
}

test('new topic scenarios are independent, and case switches restore their own month and history',context=>{
  const {topics}=controller(context);topics.run();topics.selectMonth(3);
  const firstId=topics.activeId,first=copy(topics.record);
  topics.drafts[firstId]={values:{...topics.policy.defaults,added:1700},effective:'2027-01-01',reason:'Keep this draft across case switching.'};
  topics.newCase();const secondId=topics.activeId;
  assert.notEqual(firstId,secondId);assert.equal(topics.hasResult,false);assert.equal(topics.record.month,0);
  assert.equal(topics.store.cases.find(c=>c.id===firstId).ledger.revisions.length,1);
  topics.run();topics.selectMonth(5);const second=copy(topics.record);
  topics.selectCase(firstId);assert.deepEqual(topics.record,first);assert.equal(topics.record.month,3);
  assert.equal(topics.drafts[firstId].values.added,1700);
  topics.selectCase(secondId);assert.deepEqual(topics.record,second);assert.equal(topics.record.month,5);
});

test('switching between housing and education restores each policy case and rejects a cross-policy case ID',context=>{
  const {topics,calls}=controller(context);topics.run();topics.selectMonth(4);
  const housingId=topics.activeId,housingHistory=copy(topics.record.ledger);
  topics.activate(getPolicy('hung-shui-kiu-school'));const schoolId=topics.activeId;
  assert.notEqual(schoolId,housingId);assert.equal(topics.hasResult,false);
  topics.run();topics.selectMonth(6);
  topics.selectCase(housingId);assert.equal(topics.activeId,schoolId);
  topics.activate(getPolicy('kwu-tung-housing'));
  assert.equal(topics.activeId,housingId);assert.equal(topics.record.month,4);assert.deepEqual(topics.record.ledger,housingHistory);
  topics.activate(getPolicy('hung-shui-kiu-school'));
  assert.equal(topics.activeId,schoolId);assert.equal(topics.record.month,6);
  assert.deepEqual(calls.focus,['kwu-tung','hung-shui-kiu','kwu-tung','hung-shui-kiu']);
});

test('main Start preserves the Huanggang route and cannot analyze mismatched policy tags',async context=>{
  const {compact,calls,topics}=controller(context);topics.run();
  const history=copy(topics.record.ledger);
  compact.policyId='huanggang-opening';compact.areaId='huanggang';compact.selected=['border-access'];
  await CompactAnalysisUI.prototype.start.call(compact);assert.equal(calls.portRuns,1);
  compact.selected=['housing-affordability'];
  await CompactAnalysisUI.prototype.start.call(compact);
  assert.equal(calls.portRuns,1);assert.ok(calls.status.some(s=>s.error&&/matching/.test(s.message)));
  assert.deepEqual(topics.store.cases[0].ledger,history);
});

test('a busy main Start has no effect on any topic or port history',async context=>{
  const {compact,topics,calls}=controller(context);compact.busy=true;
  await CompactAnalysisUI.prototype.start.call(compact);
  assert.equal(topics.record.ledger.revisions.length,0);assert.equal(calls.portRuns,0);
});

test('invalid topic adjustments fail without changing applied history or deleting their draft',context=>{
  const {topics}=controller(context);topics.run();const before=copy(topics.record.ledger),study=copy(topics.study);
  const values={...topics.policy.defaults,added:-1};topics.drafts[topics.activeId]={values,effective:values.start,reason:'Invalid proposed change.'};
  assert.throws(()=>topics.run(),/Total policy additions/);
  assert.deepEqual(topics.record.ledger,before);assert.deepEqual(topics.study,study);
  assert.equal(topics.drafts[topics.activeId].values.added,-1);
});

for(const policyId of ['kwu-tung-housing','hung-shui-kiu-school'])test(`${policyId}: topic export records its concrete policy, selected month and capacity units`,async context=>{
  const {topics,policy,blobs,downloads}=controller(context,policyId);topics.run();topics.selectMonth(2);topics.export();
  assert.equal(downloads.length,1);assert.equal(blobs.length,1);
  const data=JSON.parse(await blobs[0].text());
  assert.equal(data.schema,'nm-topic-study-v1');assert.equal(data.policyId,policy.id);
  assert.equal(data.model,policy.model);assert.equal(data.areaId,policy.areaId);
  assert.equal(data.catalogPolicy.id,policy.id);assert.equal(data.viewMonth,topics.study.months[2].date);
  assert.equal(data.ledger.revisions.length,1);assert.equal(data.provenance,'hypothetical-local-rule-model');
  assert.equal(data.units.supply,policy.model==='housing'?'usable housing units':'school places');
  assert.equal(data.caseId,topics.activeId);assert.match(downloads[0].download,new RegExp('^'+policy.id+'-'));
  assert.ok(!Object.hasOwn(data,'routes')&&!Object.hasOwn(data,'currentSnapshot'));
});

test('existing Export button dispatches topics, original port and API through separate live handlers',async context=>{
  const {$,downloads,blobs}=installEnvironment(context);
  const city={setPortMotion(){}};const port=new PortStudyUI(city,{});
  let topicExports=0,apiExports=0;
  port.analysis={localTopic:true,engine:'rules',topics:{export:()=>topicExports++},exportAPI:()=>apiExports++};
  await $('port-export').fire('click');assert.equal(topicExports,1);assert.equal(apiExports,0);assert.equal(blobs.length,0);
  port.analysis.localTopic=false;port.analysis.engine='fixture';
  await $('port-export').fire('click');assert.equal(topicExports,1);assert.equal(apiExports,1);assert.equal(blobs.length,0);
  port.analysis.engine='rules';$('port-cohort').value='all';$('port-mode').value='policy';
  await $('port-export').fire('click');
  assert.equal(topicExports,1);assert.equal(apiExports,1);assert.equal(blobs.length,1);
  const data=JSON.parse(await blobs[0].text());
  assert.equal(data.ledger.schema,'huanggang-policy-ledger-v1');assert.equal(data.caseId,'case-1');
  assert.ok(Array.isArray(data.months[0].groups));assert.ok(!Object.hasOwn(data,'catalogPolicy'));
  assert.match(downloads[0].download,/^huanggang-study-/);
});

test('case toolbar dispatches a topic new case and selection without changing the original port ledger',async context=>{
  const {$}=installEnvironment(context),port=new PortStudyUI({setPortMotion(){}},{});
  const before=copy(port.ledger),calls=[];
  port.analysis={localTopic:true,topics:{newCase:()=>calls.push('new-topic'),selectCase:id=>calls.push(id)}};
  await $('policy-new-case').fire('click');$('policy-case-select').value='topic-7';await $('policy-case-select').fire('change');
  assert.deepEqual(calls,['new-topic','topic-7']);assert.deepEqual(port.ledger,before);assert.equal(port.cases.length,1);
});
