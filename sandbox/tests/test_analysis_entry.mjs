import test from 'node:test';
import assert from 'node:assert/strict';
import {POLICY_TAGS,validateTags,scopeMetadata} from '../web/analysis-scope.js';
import {assertPolicyScope} from '../web/policy-catalog.js';
import {CompactAnalysisUI} from '../web/analysis-compact.js';
import {emptyLedger,buildPolicyStudy} from '../web/policy-ledger.js';
import {DEFAULTS} from '../web/port-model.js';
const fields={};globalThis.document={getElementById:id=>fields[id]};
function input(values=DEFAULTS,effective=0,reason=''){
 for(const [id,key] of [['port-year','year'],['port-timing','timing'],['port-base','baseline'],['port-reach','reach'],['port-clearance','clearance'],['port-cap','capacity']])fields[id]={value:String(values[key])};
 fields['policy-effective']={value:String(effective)};fields['policy-reason']={value:reason};
 fields['analysis-tags']={open:true};fields['analysis-review-dialog']={showModal(){this.open=true;}};fields['analysis-plan']={files:[new File(['%PDF-1.4'],'test.pdf')]};
}
function rulesFixture(){
 input();const c={engine:'rules',busy:false,selected:['border-access','information-reach'],restoreRules(){this.apiResults=false;},status(){},update(){},openPanel(){this.panelOpened=true;}};
 const port={ledger:emptyLedger(),month:0,caseId:'case-1',draftDirty:false,cases:[{id:'case-1'}],saveCases(){this.saved=true;},prepareForm(){},render(){this.rendered=true;},showTab(tab){this.tab=tab;}};port.study=buildPolicyStudy(port.ledger);c.port=port;return c;
}
test('empty/duplicate/unknown tag selection rejected; supported North Metropolis tags accepted',()=>{
 assert.equal(validateTags(['border-access','information-reach']).length,2);
 for(const ids of [[],['border-access','border-access'],['unknown']])assert.throws(()=>validateTags(ids));
 assert.equal(POLICY_TAGS.length,5);
});
test('housing/services tags are valid but must route to their matching concrete policy',()=>{
 assert.equal(validateTags(['housing-affordability'],'rules').length,1);
 assert.throws(()=>assertPolicyScope('huanggang-opening','huanggang',['housing-affordability']),/matching/);
 assert.deepEqual(scopeMetadata(['housing-affordability'],'backend').tags,['housing-affordability']);
});
test('primary Start analysis creates a policy revision and stores selected scope without a second apply button',()=>{
 const c=rulesFixture();CompactAnalysisUI.prototype.runRules.call(c);
 assert.equal(c.port.ledger.revisions.length,1);assert.match(c.port.ledger.revisions[0].reason,/Port opening, Information reach/);
 assert.deepEqual(c.port.cases[0].analysisTags,c.selected);assert.equal(c.port.tab,'results');assert.equal(c.port.saved,true);assert.equal(c.panelOpened,true);
});
test('repeated analysis with unchanged inputs does not invent policy revisions',()=>{
 const c=rulesFixture();CompactAnalysisUI.prototype.runRules.call(c);CompactAnalysisUI.prototype.runRules.call(c);assert.equal(c.port.ledger.revisions.length,1);
});
test('September adjustment preserves August results and takes the selected effective month',()=>{
 const c=rulesFixture();CompactAnalysisUI.prototype.runRules.call(c);const august=JSON.stringify(c.port.study.months[0]);
 input({...DEFAULTS,reach:95},1,'Increase information reach from September.');c.port.draftDirty=true;CompactAnalysisUI.prototype.runRules.call(c);
 assert.equal(c.port.month,1);assert.equal(c.port.ledger.revisions.length,2);assert.equal(JSON.stringify(c.port.study.months[0]),august);assert.ok(c.port.study.months[1].extra>c.port.study.months[0].extra);
});
test('primary action rejects an unsupported selection before modifying any rule history',async()=>{
 const c=rulesFixture();c.policyId='huanggang-opening';c.areaId='huanggang';c.selected=['housing-affordability'];let message='';c.status=s=>message=s;
 await CompactAnalysisUI.prototype.start.call(c);assert.match(message,/matching/);assert.equal(c.port.ledger.revisions.length,0);assert.equal(c.busy,false);
});
test('completed API run can be viewed again without sending another simulation request',async()=>{
 input();let shown=0;const scope=scopeMetadata(['border-access'],'fixture');
 const c={busy:false,engine:'fixture',policyId:'huanggang-opening',areaId:'huanggang',selected:['border-access'],config:{},session:{state:'ready',setup:{policyScope:scope}},setup:()=>({policyScope:scope}),showApiResults(){shown++;},status(){},update(){}};
 await CompactAnalysisUI.prototype.start.call(c);assert.equal(shown,1);
});
test('changed tags initialize a new API scope and require review before simulation',async()=>{
 input();const received=[];const oldScope=scopeMetadata(['border-access'],'fixture');const nextScope=scopeMetadata(['information-reach'],'fixture');
 const session={state:'ready',setup:{policyScope:oldScope},reset(){this.state='draft';this.setup=null;},async initialize(setup){received.push(setup);this.setup=setup;this.state='review';},async simulate(){throw new Error('Must not simulate before confirmation');}};
 const c={busy:false,engine:'fixture',policyId:'huanggang-opening',areaId:'huanggang',selected:['information-reach'],config:{},session,setup:()=>({policyScope:nextScope}),renderReview(){this.reviewed=true;},status(){},update(){}};
 await CompactAnalysisUI.prototype.start.call(c);assert.deepEqual(received[0].policyScope.tags,['information-reach']);assert.equal(session.state,'review');assert.equal(c.reviewed,true);assert.equal(fields['analysis-review-dialog'].open,true);assert.equal(c.busy,false);
});
test('API map restores its hidden original scene on returning to the existing rule view',async()=>{
 const THREE=await import('../web/vendor/three.module.js');const {V3Map}=await import('../web/v3-map.js');const scene=new THREE.Scene(),context=new THREE.Group();scene.add(context,new THREE.AmbientLight());
 const city={scene,portFlows:{group:new THREE.Group()},canvas:{dataset:{},setAttribute(){},removeAttribute(){}},renderer:{shadowMap:{}},resetCamera(){this.reset=true;}};
 const map=new V3Map(city);assert.equal(city.externalMapActive,true);assert.equal(context.parent.visible,false);map.restore();assert.equal(context.parent,scene);assert.equal(city.externalMapActive,false);assert.equal(map.root.parent,null);
});
test('starting analysis from an older saved month reviews it without backdating a later policy',()=>{
 const c=rulesFixture();CompactAnalysisUI.prototype.runRules.call(c);
 input({...DEFAULTS,reach:95},1,'September adjustment');c.port.draftDirty=true;CompactAnalysisUI.prototype.runRules.call(c);
 const before=JSON.stringify(c.port.ledger);input(DEFAULTS,0);c.port.month=0;c.port.draftDirty=false;
 CompactAnalysisUI.prototype.runRules.call(c);assert.equal(JSON.stringify(c.port.ledger),before);assert.equal(c.port.month,0);assert.equal(c.port.tab,'results');
});
