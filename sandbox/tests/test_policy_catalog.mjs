import test from 'node:test';
import assert from 'node:assert/strict';
import {AREAS,POLICIES,getArea,getPolicy,matchingPolicies,matchingTags,assertPolicyScope} from '../web/policy-catalog.js';
import {POLICY_TAGS} from '../web/analysis-scope.js';
import {emptyTopicLedger,applyTopicRevision,buildTopicStudy,restoreTopicLedger} from '../web/topic-model.js';
import {TOPIC_STORAGE_KEY,emptyTopicStore,addTopicCase,restoreTopicStore} from '../web/topic-store.js';
import {DEFAULTS} from '../web/port-model.js';
import {emptyLedger,applyRevision,buildPolicyStudy,restoreLedger} from '../web/policy-ledger.js';
import {CompactAnalysisUI} from '../web/analysis-compact.js';
import {validateSetup} from '../web/v3-contract.js';
import {TopicStudiesUI} from '../web/topic-ui.js';

const stamp='2026-10-15T04:00:00Z';
const housing=getPolicy('kwu-tung-housing');
const school=getPolicy('hung-shui-kiu-school');
const applyTopic=p=>applyTopicRevision(emptyTopicLedger(p.id),p.defaults,p.defaults.start,'Explicit hypothetical test scenario.',stamp);

test('catalogue has unique regions and concrete policies with valid, known tag IDs',()=>{
 assert.equal(new Set(AREAS.map(a=>a.id)).size,AREAS.length);
 assert.equal(new Set(POLICIES.map(p=>p.id)).size,POLICIES.length);
 const tags=new Set(POLICY_TAGS.map(t=>t.id));
 for(const p of POLICIES){
  assert.equal(getArea(p.areaId).id,p.areaId);
  assert.ok(p.tags.length>0);assert.equal(new Set(p.tags).size,p.tags.length);
  assert.ok(p.tags.every(t=>tags.has(t)));assert.ok(p.tags.includes(p.primaryTag));
  assert.ok(p.description);assert.ok(p.limits);
 }
});

test('each study region exposes only its matching concrete policy',()=>{
 assert.deepEqual(matchingPolicies('huanggang').map(p=>p.id),['huanggang-opening']);
 assert.deepEqual(matchingPolicies('kwu-tung-north').map(p=>p.id),['kwu-tung-housing']);
 assert.deepEqual(matchingPolicies('hung-shui-kiu').map(p=>p.id),['hung-shui-kiu-school']);
});

test('available tags are derived from area catalogue entries, without leaking unrelated topics',()=>{
 assert.deepEqual(matchingTags('huanggang'),['border-access','transport-capacity','information-reach']);
 assert.deepEqual(matchingTags('kwu-tung-north'),['housing-affordability']);
 assert.deepEqual(matchingTags('hung-shui-kiu'),['public-services']);
});

test('multi-tag matching is an AND intersection, never broadens into other regions',()=>{
 assert.deepEqual(matchingPolicies('huanggang',['border-access','information-reach']).map(p=>p.id),['huanggang-opening']);
 assert.deepEqual(matchingPolicies('huanggang',['border-access','housing-affordability']),[]);
 assert.deepEqual(matchingPolicies('kwu-tung-north',['public-services']),[]);
 assert.deepEqual(matchingPolicies('hung-shui-kiu',['housing-affordability']),[]);
 assert.deepEqual(matchingPolicies('kwu-tung-north',['unknown']),[]);
});

test('policy scope rejects missing tags, wrong location and cross-topic policy selections',()=>{
 for(const p of POLICIES)assert.equal(assertPolicyScope(p.id,p.areaId,[p.primaryTag]),p);
 assert.throws(()=>assertPolicyScope(housing.id,'hung-shui-kiu',['housing-affordability']),/matching/);
 assert.throws(()=>assertPolicyScope(school.id,school.areaId,['housing-affordability']),/matching/);
 assert.throws(()=>assertPolicyScope('huanggang-opening','huanggang',[]),/matching/);
 assert.throws(()=>assertPolicyScope('unknown','huanggang',['border-access']),/Unknown/);
 assert.throws(()=>matchingPolicies('unknown'),/Unknown/);
});

test('catalogue and nested defaults cannot be mutated by form drafts',()=>{
 for(const p of POLICIES){assert.ok(Object.isFrozen(p));assert.ok(Object.isFrozen(p.tags));}
 assert.ok(Object.isFrozen(housing.defaults));
 assert.throws(()=>{housing.defaults.added=999;},TypeError);
 assert.throws(()=>{school.tags.push('housing-affordability');},TypeError);
});

test('port and topic policies cannot enter the wrong ledger or restore schema',()=>{
 assert.throws(()=>emptyTopicLedger('huanggang-opening'),/topic/);
 assert.throws(()=>restoreTopicLedger(emptyLedger()),/Unsupported/);
 assert.throws(()=>restoreLedger(emptyTopicLedger(housing.id)),/unsupported/i);
});

test('three representative studies retain distinct models, area scope and measurement units',()=>{
 const port=buildPolicyStudy(applyRevision(emptyLedger(),DEFAULTS,0,'Existing port test case.',stamp));
 const hs=buildTopicStudy(applyTopic(housing));const ss=buildTopicStudy(applyTopic(school));
 assert.equal(port.ledger.schema,'huanggang-policy-ledger-v1');
 assert.equal(hs.policyId,housing.id);assert.equal(hs.areaId,'kwu-tung-north');assert.equal(hs.model,'housing');
 assert.equal(ss.policyId,school.id);assert.equal(ss.areaId,'hung-shui-kiu');assert.equal(ss.model,'education');
 assert.equal(hs.units.supply,'usable housing units');assert.equal(ss.units.supply,'school places');
 assert.ok(hs.months.every(m=>m.policyId===housing.id&&m.model==='housing'&&!('extra' in m)));
 assert.ok(ss.months.every(m=>m.policyId===school.id&&m.model==='education'&&!('groups' in m)));
 assert.ok(port.months.every(m=>Array.isArray(m.groups)&&!('policyGap' in m)));
});

test('each additional-capacity model explicitly declares assumptions and unsupported outputs',()=>{
 for(const p of [housing,school]){
  const study=buildTopicStudy(applyTopic(p));
  assert.equal(study.provenance,'hypothetical-local-rule-model');
  assert.ok(study.months[0].trace.some(t=>/explicit test assumptions/.test(t.detail)));
  assert.ok(study.limits.length>40);assert.ok(study.unavailable.length>0);
 }
 assert.ok(buildTopicStudy(applyTopic(housing)).unavailable.includes('affordability'));
 assert.ok(buildTopicStudy(applyTopic(school)).unavailable.includes('waiting time'));
});

test('creating housing and school scenarios retains separate active cases and never edits port history',()=>{
 const originalPort=applyRevision(emptyLedger(),DEFAULTS,0,'Retain the existing Huanggang case.',stamp);
 const before=JSON.stringify(originalPort);
 let store=addTopicCase(emptyTopicStore(),housing.id);const housingId=store.activeByPolicy[housing.id];
 store.cases.find(c=>c.id===housingId).ledger=applyTopic(housing);
 store=addTopicCase(store,school.id);const schoolId=store.activeByPolicy[school.id];
 store.cases.find(c=>c.id===schoolId).ledger=applyTopic(school);
 store=addTopicCase(store,housing.id);
 assert.equal(store.cases.length,3);assert.notEqual(store.activeByPolicy[housing.id],housingId);
 assert.equal(store.activeByPolicy[school.id],schoolId);
 assert.equal(store.cases.find(c=>c.id===housingId).ledger.revisions.length,1);
 assert.equal(JSON.stringify(originalPort),before);
 assert.notEqual(TOPIC_STORAGE_KEY,'huanggang-policy-workspace-cases-v1');
 assert.notEqual(TOPIC_STORAGE_KEY,'huanggang-policy-workspace-v1');
});

test('restoring topic scenarios cannot bind a school case as the active housing case',()=>{
 let store=addTopicCase(addTopicCase(emptyTopicStore(),housing.id),school.id);
 const schoolId=store.activeByPolicy[school.id];
 store.activeByPolicy[housing.id]=schoolId;
 const restored=restoreTopicStore(JSON.parse(JSON.stringify(store)));
 assert.notEqual(restored.activeByPolicy[housing.id],schoolId);
 assert.equal(restored.cases.find(c=>c.id===restored.activeByPolicy[housing.id]).ledger.policyId,housing.id);
 assert.equal(restored.activeByPolicy[school.id],schoolId);
});

test('topic case round-trip preserves applied scenario values and monthly model results',()=>{
 let store=addTopicCase(addTopicCase(emptyTopicStore(),housing.id),school.id);
 for(const c of store.cases)c.ledger=applyTopic(getPolicy(c.ledger.policyId));
 const restored=restoreTopicStore(JSON.parse(JSON.stringify(store)));
 for(let i=0;i<store.cases.length;i++)assert.deepEqual(buildTopicStudy(restored.cases[i].ledger),buildTopicStudy(store.cases[i].ledger));
});

test('API initialization carries concrete policy, region, model and catalogue version for all three cases',()=>{
 const before=globalThis.document;
 const fields={'analysis-start-date':{value:'2026-08-01'},'analysis-end-date':{value:'2026-10-01'},'analysis-step':{value:'month'}};
 globalThis.document={getElementById:id=>fields[id]};
 try{
  for(const policy of POLICIES){
   const owner={engine:'fixture',selected:[policy.primaryTag],policyId:policy.id,areaId:policy.areaId,currentPolicy:policy,
    bounds:()=>({west:114,south:22.45,east:114.15,north:22.6})};
   const setup=validateSetup(CompactAnalysisUI.prototype.setup.call(owner),'2026-10-15');
   assert.equal(setup.policyScope.policyId,policy.id);assert.equal(setup.policyScope.areaId,policy.areaId);
   assert.equal(setup.policyScope.model,policy.model);assert.ok(setup.policyScope.catalogVersion);
   assert.deepEqual(setup.policyScope.tags,[policy.primaryTag]);
  }
 }finally{globalThis.document=before;}
});

test('topic form draft is case-specific and Start analysis applies it once with its own study window',()=>{
 const before=globalThis.document;
 const changed={...housing.defaults,start:'2027-01-01',end:'2027-12-01',commission:'2027-07-01',added:2000};
 const fields=Object.fromEntries(Object.entries(changed).map(([key,value])=>[`topic-${key}`,{value:typeof value==='string'?value.slice(0,7):String(value)}]));
 fields['topic-effective']={value:'2027-01-01'};fields['topic-reason']={value:'Custom housing test, not an official plan.'};
 globalThis.document={getElementById:id=>fields[id]};
 try{
  const ui=Object.create(TopicStudiesUI.prototype);
  ui.store=addTopicCase(emptyTopicStore(),housing.id);ui.activeId=ui.store.activeByPolicy[housing.id];ui.drafts={};
  ui.owner={openPanel(){},status(){}};ui.save=()=>{};ui.render=()=>{};ui.showTab=()=>{};
  ui.captureDraft();assert.deepEqual(ui.drafts[ui.activeId].values,changed);assert.equal(ui.hasResult,false);
  ui.run();assert.equal(ui.record.ledger.revisions.length,1);assert.equal(ui.study.months[0].date,'2027-01-01');
  assert.equal(ui.record.ledger.revisions[0].inputs.added,2000);assert.equal(ui.drafts[ui.activeId],undefined);
  ui.run();assert.equal(ui.record.ledger.revisions.length,1);
 }finally{globalThis.document=before;}
});

test('topic UI switches only among cases of the active policy and retains its saved view month',()=>{
 const ui=Object.create(TopicStudiesUI.prototype);
 ui.store=addTopicCase(addTopicCase(addTopicCase(emptyTopicStore(),housing.id),housing.id),school.id);
 const housingCases=ui.store.cases.filter(c=>c.ledger.policyId===housing.id);
 ui.activeId=housingCases[0].id;housingCases[0].month=5;housingCases[1].month=7;
 ui.save=()=>{};ui.render=()=>{};ui.showTab=()=>{};ui.owner={update(){}};
 ui.selectCase(ui.store.activeByPolicy[school.id]);assert.equal(ui.activeId,housingCases[0].id);
 ui.selectCase(housingCases[1].id);assert.equal(ui.activeId,housingCases[1].id);assert.equal(ui.record.month,7);
 ui.selectCase(housingCases[0].id);assert.equal(ui.record.month,5);
});

test('saving API configuration leaves an existing local-topic view before showing API results',()=>{
 const before=globalThis.document;let restored=0;
 const fields={'analysis-engine':{value:'fixture'},'analysis-config-dialog':{close(){}},'analysis-config-status':{},'port-scenario-note':{},'port-heading':{querySelector:()=>({})}};
 const classes={add(){}};
 globalThis.document={getElementById:id=>fields[id],querySelector:()=>({classList:classes})};
 try{
  const ui={engine:'rules',currentPolicy:housing,policyId:housing.id,areaId:housing.areaId,localTopic:true,selected:['housing-affordability'],apiResults:false,apiMap:null,
   setup:()=>({bounds:{west:114,south:22.45,east:114.15,north:22.6},start:'2026-08-01',end:'2026-10-01',step:'month'}),
   restoreRules(){restored++;this.localTopic=false;},port:{render(){},showTab(){}},city:{showPortStudy(){}},drawTags(){},status(){},onOpen(){},update(){}};
  CompactAnalysisUI.prototype.saveConfiguration.call(ui);
  assert.equal(restored,1);assert.equal(ui.engine,'fixture');assert.equal(ui.session.state,'draft');
  assert.equal(ui.savedSetup.policyScope.policyId,housing.id);
 }finally{globalThis.document=before;}
});
