import test from 'node:test';
import assert from 'node:assert/strict';
import {describeAnalysisCapability,needsScriptAcknowledgement,renderCapabilityBrief} from '../web/analysis-capability.js';
import {getPolicy} from '../web/policy-catalog.js';
import {POLICY_TAGS} from '../web/analysis-scope.js';
import {CompactAnalysisUI} from '../web/analysis-compact.js';

for(const [id,units,limit] of [['huanggang-opening',/trips\/day/,/Housing/],['kwu-tung-housing',/Households and housing units/,/affordability/],['hung-shui-kiu-school',/Pupils and school places/,/Healthcare/]])test(`${id}: local capability explains its actual mechanism, units and missing outcomes`,()=>{
 const p=describeAnalysisCapability({policy:getPolicy(id),engine:'rules',backendActive:true});assert.equal(p.support,'local');assert.equal(p.status,'Local model ready');assert.match(p.units,units);assert.match(p.limits,limit);assert.match(p.basis,/assumed/);
});
test('more precise labels preserve IDs already used by stored studies',()=>{
 assert.equal(POLICY_TAGS.find(t=>t.id==='housing-affordability').label,'Housing supply');assert.equal(POLICY_TAGS.find(t=>t.id==='public-services').label,'School places');assert.deepEqual(getPolicy('kwu-tung-housing').tags,['housing-affordability']);
});
test('fixed-script mode never implies that the selected school policy drives construction',()=>{
 for(const presetAcknowledged of [false,true]){const p=describeAnalysisCapability({policy:getPolicy('hung-shui-kiu-school'),engine:'backend',backendActive:true,presetAcknowledged});assert.equal(p.support,'script');assert.match(p.basis,/context only/);assert.match(p.source,/not interpreted/);assert.match(p.limits,/does not change/);assert.doesNotMatch(p.status,/ready|verified/i);}
});
test('test snapshots and unknown external APIs are not labelled as validated policy adapters',()=>{
 const policy=getPolicy('kwu-tung-housing');assert.equal(describeAnalysisCapability({policy,engine:'fixture'}).support,'test');assert.equal(describeAnalysisCapability({policy,engine:'backend'}).support,'unknown');assert.equal(describeAnalysisCapability({policy:{model:'unsupported',label:'New policy'},engine:'rules'}).support,'unavailable');assert.equal(describeAnalysisCapability({engine:'rules'}).support,'unselected');
});
test('only a fresh scripted run requires the extra purpose choice; recovery and saved results remain available',()=>{
 const base={engine:'backend',backendActive:true,presetAcknowledged:false};assert.equal(needsScriptAcknowledgement(base),true);assert.equal(needsScriptAcknowledgement({...base,session:{state:'draft'}}),true);
 for(const state of ['review','confirmed','running','ready'])assert.equal(needsScriptAcknowledgement({...base,session:{state}}),false);
 assert.equal(needsScriptAcknowledgement({...base,session:{state:'draft',pending:{name:'initialize'}}}),false);assert.equal(needsScriptAcknowledgement({...base,presetAcknowledged:true}),false);assert.equal(needsScriptAcknowledgement({...base,engine:'rules'}),false);assert.equal(needsScriptAcknowledgement({...base,backendActive:false}),false);
});

class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.className='';this.attributes={};this.value='';this.checked=false;this.open=false;this._text='';this.files=[];}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set innerHTML(_){throw new Error('Unsafe HTML');}
 append(...n){this.children.push(...n);}replaceChildren(...n){this._text='';this.children=[...n];}setAttribute(k,v){this.attributes[k]=String(v);}
 get classList(){return{add:n=>{this.className+=' '+n;},toggle:(n,on)=>{this.className=on?n:'';}};}
 querySelector(){return this.children[0]??null;}showModal(){this.open=true;}close(){this.open=false;}
}
async function dom(task){const before=globalThis.document,fields=new Map();const d={createElement:tag=>new Element(tag),getElementById:id=>fields.get(id),querySelector:()=>new Element()};for(const id of ['analysis-engine','analysis-preset-ack','analysis-config-status','analysis-config-dialog','analysis-review-dialog','port-heading','port-scenario-note'])fields.set(id,new Element());fields.get('port-heading').append(new Element('small'));globalThis.document=d;try{return await task(d,id=>fields.get(id));}finally{globalThis.document=before;}}
const scope={tags:['border-access']};
function owner(){return {busy:false,engine:'backend',policyId:'huanggang-opening',areaId:'huanggang',selected:['border-access'],presetAcknowledged:false,backend:{active:true},config:{backendConfigured:true},session:{state:'draft'},setup:()=>({policyScope:scope}),configure(){this.configured=true;},status(){},update(){}};}
test('Start on an unmapped fresh backend policy opens configuration without initializing or changing the session',async()=>dom(async(d,$)=>{
 const c=owner(),session=c.session;session.initialize=async()=>{throw new Error('Unexpected API write');};await CompactAnalysisUI.prototype.start.call(c);assert.equal(c.configured,true);assert.equal(c.session,session);assert.match($('analysis-config-status').textContent,/not connected/);
}));
test('saving backend settings without script acknowledgement leaves the current run untouched',async()=>dom(async(d,$)=>{
 $('analysis-engine').value='backend';const c=owner(),session=c.session;session.reset=()=>{throw new Error('Must not reset');};CompactAnalysisUI.prototype.saveConfiguration.call(c);assert.equal(c.session,session);assert.match($('analysis-config-status').textContent,/acknowledge/);
}));
test('explicit script acknowledgement saves a draft without submitting any simulation',async()=>dom(async(d,$)=>{
 $('analysis-engine').value='backend';$('analysis-preset-ack').checked=true;let resets=0,created=0;const c=owner();Object.assign(c,{currentPolicy:getPolicy(c.policyId),session:{state:'draft',reset(){resets++;}},setup:()=>({bounds:{west:114,south:22.45,east:114.15,north:22.6},start:'2026-08-01',end:'2026-10-01',step:'month'}),port:{render(){},showTab(){}},city:{showPortStudy(){}},drawTags(){},onOpen(){}});c.backend.createSession=()=>{created++;return{state:'draft'};};CompactAnalysisUI.prototype.saveConfiguration.call(c);assert.equal(c.presetAcknowledged,true);assert.equal(c.session.state,'draft');assert.equal(created,1);assert.equal(resets,1);assert.equal($('analysis-config-dialog').open,false);
}));
test('an existing initialization review opens without asking for its PDF again or posting work',async()=>dom(async(d,$)=>{
 const c=owner();let reviewed=0;c.session={state:'review',setup:{policyScope:scope}};c.renderReview=()=>reviewed++;await CompactAnalysisUI.prototype.start.call(c);assert.equal(reviewed,1);assert.equal($('analysis-review-dialog').open,true);assert.equal(c.configured,undefined);
}));
test('an already completed script can be viewed without another PDF or new simulation',async()=>dom(async()=>{
 const c=owner(),seen=[];c.session={state:'ready',setup:{policyScope:scope},run:{simulationId:'sim_saved'}};c.backend.openSaved=async id=>seen.push(id);await CompactAnalysisUI.prototype.start.call(c);assert.deepEqual(seen,['sim_saved']);assert.equal(c.configured,undefined);
}));
test('a pending operation keeps its recovery route instead of demanding another purpose choice',async()=>dom(async()=>{
 const c=owner();let resumed=0;c.session={state:'running',pending:{jobId:'job_saved'}};c.backend.resume=async()=>resumed++;await CompactAnalysisUI.prototype.start.call(c);assert.equal(resumed,1);assert.equal(c.configured,undefined);
}));
test('scope details preserve the expanded state across refreshes and never interpret text as markup',async()=>dom(async(d)=>{
 const root=new Element('details');root.open=true;const p=describeAnalysisCapability({policy:{...getPolicy('kwu-tung-housing'),label:'<img src=x>'},engine:'rules'});renderCapabilityBrief(root,p);const first=root.children[0];assert.match(root.textContent,/<img src=x>/);assert.equal(root.open,true);renderCapabilityBrief(root,p);assert.equal(root.children[0],first);renderCapabilityBrief(root,{...p,status:'Updated state'});assert.equal(root.open,true);assert.match(root.textContent,/Updated state/);
}));
