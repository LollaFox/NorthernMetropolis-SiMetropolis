import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CompactAnalysisUI} from '../web/analysis-compact.js';
import {TopicStudiesUI} from '../web/topic-ui.js';
import {PortStudyUI} from '../web/port-study.js';
import {renderInterpretation} from '../web/policy-readout.js';
import {POLICY_TAGS} from '../web/analysis-scope.js';
import {getPolicy} from '../web/policy-catalog.js';
import {DEFAULTS} from '../web/port-model.js';
import {emptyLedger,applyRevision,buildPolicyStudy} from '../web/policy-ledger.js';
import {emptyTopicLedger,applyTopicRevision,buildTopicStudy} from '../web/topic-model.js';
import {emptyTopicStore,addTopicCase} from '../web/topic-store.js';

// Minimal DOM contract for event/render tests. It does not emulate CSS layout, browser defaults or a GPU.
class Element {
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.handlers={};this.value='';this.checked=false;this.disabled=false;this.open=false;this.className='';this._text='';}
 get classList(){return {add:(...names)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));names.forEach(n=>s.add(n));this.className=[...s].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(n=>!names.includes(n)).join(' ');},contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,on)=>{const yes=on??!this.classList.contains(name);this.classList[yes?'add':'remove'](name);return yes;}};}
 set textContent(text){this._text=String(text);this.children=[];} get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set innerText(text){this.textContent=text;} get innerText(){return this.textContent;}
 set innerHTML(_){throw new Error('HTML injection is forbidden in this renderer.');}
 append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(c=>c!==node);node.parentNode=this;this.children.push(node);}}
 prepend(...nodes){this.append(...nodes);this.children=[...nodes,...this.children.filter(n=>!nodes.includes(n))];}
 replaceChildren(...nodes){for(const c of this.children)c.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
 insertBefore(node,before){const index=this.children.indexOf(before);if(index<0)this.append(node);else{node.parentNode=this;this.children.splice(index,0,node);}}
 get firstChild(){return this.children[0]??null;}
 setAttribute(key,value){this.attributes[key]=String(value);} getAttribute(key){return this.attributes[key]??null;}
 addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}
 dispatch(name){for(const fn of this.handlers[name]??[])fn({target:this});}
 click(){this.dispatch('click');}
 matches(selector){if(selector==='input:checked')return this.tagName==='INPUT'&&this.checked;if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector.startsWith('#'))return this.id===selector.slice(1);return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return this.children.flatMap(c=>[...(c.matches(selector)?[c]:[]),...c.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
function dom(){
 const doc={nodes:[],createElement(tag){const e=new Element(tag,this);this.nodes.push(e);return e;},getElementById(id){return this.nodes.find(e=>e.id===id)??null;},querySelector(selector){return this.nodes.find(e=>e.matches(selector))??null;},querySelectorAll(selector){return this.nodes.filter(e=>e.matches(selector));}};
 doc.body=doc.createElement('body');doc.createElementNS=(_,tag)=>doc.createElement(tag);
 doc.field=(id,tag='div')=>{const e=doc.createElement(tag);e.id=id;return e;};
 return doc;
}
function withDOM(task){const before=globalThis.document;const doc=dom();globalThis.document=doc;try{return task(doc);}finally{globalThis.document=before;}}
async function withAsyncDOM(task){const before=globalThis.document;const doc=dom();globalThis.document=doc;try{return await task(doc);}finally{globalThis.document=before;}}
function owner(doc){
 for(const id of ['analysis-tag-list','analysis-tag-summary','analysis-area','analysis-policy','analysis-start','analysis-settings','analysis-month','analysis-confirm-run','analysis-review-ack','port-export','analysis-entry-status','port-panel','port-expand','port-scenario-note','compact-api-results'])doc.field(id);
 const heading=doc.field('port-heading');heading.append(doc.createElement('small'));
 const legend=doc.createElement('div');legend.className='port-flow-key';
 const c=Object.create(CompactAnalysisUI.prototype);Object.assign(c,{engine:'rules',policyId:'huanggang-opening',areaId:'huanggang',selected:['border-access'],busy:false,frameGeneration:0,apiResults:false,session:null,
  port:{ledger:emptyLedger(),stop(){this.stopped=true;}},topics:{leave(){this.left=true;}},city:{showPortStudy(value){this.visible=value;}}});
 return c;
}
const stamp='2026-10-15T08:00:00Z';
const sectionText=(root,id)=>root.querySelectorAll('details').find(e=>e.dataset.section===id)?.textContent??'';
async function download(action){
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,timer=globalThis.setTimeout;let blob;
 try{URL.createObjectURL=value=>{blob=value;return 'blob:readout-test';};URL.revokeObjectURL=()=>{};globalThis.setTimeout=()=>0;action();}
 finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=timer;}
 assert.ok(blob instanceof Blob,'Export must create a downloadable JSON artifact.');return JSON.parse(await blob.text());
}

test('policy tags are an always-present fieldset with a legend, separate from result month',()=>{
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 assert.match(html,/<fieldset\b[^>]*id="analysis-tags"[^>]*>[\s\S]*?<legend>[\s\S]*?POLICY TAGS/);
 assert.doesNotMatch(html,/<details\b[^>]*id="analysis-tags"/);
 assert.match(html,/id="analysis-tag-list"/);assert.match(html,/aria-label="Result month"/);
});

test('all five tag chips remain visible and native checkboxes expose concrete area hints',()=>withDOM(doc=>{
 const c=owner(doc);c.drawTags();const holder=doc.getElementById('analysis-tag-list'),inputs=holder.querySelectorAll('input');
 assert.equal(inputs.length,5);assert.deepEqual(inputs.map(i=>i.value),POLICY_TAGS.map(t=>t.id));
 assert.ok(inputs.every(i=>i.type==='checkbox'&&i.parentNode.tagName==='LABEL'));
 assert.equal(inputs.filter(i=>!i.disabled).length,3);
 const housing=inputs.find(i=>i.value==='housing-affordability'),services=inputs.find(i=>i.value==='public-services');
 assert.match(housing.parentNode.title,/Kwu Tung North/);assert.match(services.parentNode.title,/Hung Shui Kiu/);
 assert.match(housing.getAttribute('aria-label'),/Housing.*Kwu Tung North/);
 assert.equal(doc.getElementById('analysis-tag-summary').textContent,'1 selected');
}));

test('housing and school areas enable only their relevant tag without hiding other topics',()=>withDOM(doc=>{
 const c=owner(doc);
 for(const [area,tag] of [['kwu-tung-north','housing-affordability'],['hung-shui-kiu','public-services']]){
  c.areaId=area;c.selected=[tag];c.drawTags();const inputs=doc.getElementById('analysis-tag-list').querySelectorAll('input');
  assert.equal(inputs.length,5);assert.deepEqual(inputs.filter(i=>!i.disabled).map(i=>i.value),[tag]);
  assert.equal(inputs.find(i=>i.value===tag).checked,true);
 }
}));

test('unchecking the final tag clears scope without automatically restoring a primary tag',()=>withDOM(doc=>{
 const c=owner(doc);let reset=0,restored=0;c.session={reset(){reset++;}};c.apiMap={restore(){restored++;}};c.apiResults=true;c.currentFrame={date:'2026-08-01'};
 c.drawTags();const checkbox=doc.getElementById('analysis-tag-list').querySelector('input');checkbox.checked=false;checkbox.dispatch('change');
 assert.deepEqual(c.selected,[]);assert.equal(c.policyId,'');assert.equal(c.session,null);assert.equal(c.apiResults,false);assert.equal(c.currentFrame,null);
 assert.equal(reset,1);assert.equal(restored,1);assert.equal(c.city.visible,false);assert.ok(c.frameGeneration>0);
 assert.equal(doc.getElementById('analysis-start').disabled,true);assert.equal(doc.getElementById('analysis-settings').disabled,true);
 assert.equal(doc.getElementById('analysis-month').disabled,true);assert.equal(doc.getElementById('port-export').disabled,true);
 assert.equal(doc.getElementById('analysis-tag-summary').textContent,'Select at least one');
}));

test('choosing a tag after clearing selects a matching concrete policy instead of a stale API scope',()=>withDOM(doc=>{
 const c=owner(doc);c.selected=[];c.policyId='';c.selectPolicy=id=>{c.policyId=id;};c.drawTags();
 const checkbox=doc.getElementById('analysis-tag-list').querySelectorAll('input').find(i=>i.value==='information-reach');checkbox.checked=true;checkbox.dispatch('change');
 assert.deepEqual(c.selected,['information-reach']);assert.equal(c.policyId,'huanggang-opening');assert.equal(doc.getElementById('analysis-start').disabled,false);
}));

test('busy state locks area, concrete policy, tags and primary actions, then restores area compatibility',()=>withDOM(doc=>{
 const c=owner(doc);c.drawTags();c.busy=true;c.update();
 for(const id of ['analysis-area','analysis-policy','analysis-start','analysis-settings','port-export'])assert.equal(doc.getElementById(id).disabled,true,id);
 assert.ok(doc.getElementById('analysis-tag-list').querySelectorAll('input').every(i=>i.disabled));
 c.busy=false;c.update();assert.equal(doc.getElementById('analysis-area').disabled,false);assert.equal(doc.getElementById('analysis-policy').disabled,false);
 assert.equal(doc.getElementById('analysis-tag-list').querySelectorAll('input').filter(i=>!i.disabled).length,3);
}));

test('Start rejects missing concrete policy and empty tags in every engine without invoking a model',async()=>withAsyncDOM(async doc=>{
 const c=owner(doc);let runs=0;c.runRules=()=>{runs++;};c.topics.run=()=>{runs++;};c.setup=()=>{runs++;throw new Error('Should not initialize');};c.update=()=>{};
 for(const engine of ['rules','fixture','backend']){
  c.engine=engine;c.policyId='';c.selected=['border-access'];await c.start();assert.match(doc.getElementById('analysis-entry-status').textContent,/Unknown policy/);
  c.policyId='huanggang-opening';c.selected=[];await c.start();assert.match(doc.getElementById('analysis-entry-status').textContent,/at least one/);
 }
 assert.equal(runs,0);assert.equal(c.port.ledger.revisions.length,0);
}));

test('standard readout renders six semantic sections and supports expand/collapse with accurate state',()=>withDOM(doc=>{
 const holder=doc.createElement('div');const ids=['scope','comparison','mechanism','timing','limits','next'];
 const card=renderInterpretation(holder,{schema:'nm-policy-interpretation-v1',title:'Policy result',basis:'Assumed inputs',summary:'Current result',sections:ids.map(id=>({id,title:id,items:['One fact']}))});
 assert.equal(holder.children.length,1);assert.equal(card.getAttribute('aria-label'),'Standardized policy interpretation');
 assert.deepEqual(card.querySelectorAll('details').map(e=>e.dataset.section),ids);
 assert.deepEqual(card.querySelectorAll('details').filter(e=>e.open).map(e=>e.dataset.section),['comparison','mechanism','timing']);
 const toggle=card.querySelector('button');assert.equal(toggle.getAttribute('aria-expanded'),'false');toggle.dispatch('click');
 assert.ok(card.querySelectorAll('details').every(e=>e.open));assert.equal(toggle.textContent,'Collapse all');assert.equal(toggle.getAttribute('aria-expanded'),'true');
 toggle.dispatch('click');assert.ok(card.querySelectorAll('details').every(e=>!e.open));assert.equal(toggle.textContent,'Expand all');
}));

test('readout uses text nodes for source content and replaces the previous month without accumulation',()=>withDOM(doc=>{
 const holder=doc.createElement('div'),attack='<img src=x onerror=alert(1)>';
 const brief={schema:'nm-policy-interpretation-v1',title:attack,basis:attack,summary:attack,sections:[{id:'scope',title:attack,items:[attack]}]};
 renderInterpretation(holder,brief);assert.match(holder.textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(holder.querySelectorAll('img').length,0);
 renderInterpretation(holder,{...brief,title:'Next month',summary:'Updated',sections:[]});
 assert.equal(holder.children.length,1);assert.match(holder.textContent,/Next month/);assert.doesNotMatch(holder.textContent,/POLICY INTERPRETATION.*POLICY INTERPRETATION/);
}));

test('manual section toggles resynchronize the readout expand-all control',()=>withDOM(doc=>{
 const card=renderInterpretation(doc.createElement('div'),{schema:'test',title:'T',basis:'B',summary:'S',sections:['scope','limits'].map(id=>({id,title:id,items:[]}))});
 for(const d of card.querySelectorAll('details')){d.open=true;d.dispatch('toggle');}
 assert.equal(card.querySelector('button').textContent,'Collapse all');
 card.querySelector('details').open=false;card.querySelector('details').dispatch('toggle');assert.equal(card.querySelector('button').textContent,'Expand all');
}));

test('port integration interprets the currently selected month and cohort, preserving older policy versions',()=>withDOM(doc=>{
 const c=owner(doc);for(const id of ['analysis-panel-source','analysis-rule-focus','port-results','port-interpretation','port-visuals','port-cohort'])doc.field(id);
 let ledger=applyRevision(emptyLedger(),DEFAULTS,0,'Original August.',stamp);ledger=applyRevision(ledger,{...DEFAULTS,reach:95},1,'September revision.',stamp);
 c.port={...c.port,ledger,study:buildPolicyStudy(ledger),month:0,caseId:'case-1',cases:[{id:'case-1',analysisTags:['border-access','information-reach']}]};c.lastCaseId='case-1';
 doc.getElementById('port-cohort').value='all';c.onRuleRender(c.port.study.months[0]);let root=doc.getElementById('port-interpretation');
 assert.match(root.textContent,/August 2026/);assert.match(sectionText(root,'timing'),/HG-001/);assert.doesNotMatch(root.textContent,/HG-002/);
 c.port.month=1;doc.getElementById('port-cohort').value='commuters';c.onRuleRender(c.port.study.months[1]);
 assert.match(root.textContent,/September 2026/);assert.match(root.textContent,/Commuter trips/);assert.match(sectionText(root,'timing'),/HG-002/);
 assert.equal(root.children.length,1);assert.match(sectionText(root,'comparison'),/All passengers/);
 c.port.month=0;doc.getElementById('port-cohort').value='visitors';c.onRuleRender(c.port.study.months[0]);
 assert.match(root.textContent,/Family and visitor trips/);assert.doesNotMatch(root.textContent,/HG-002/);
}));

test('housing and education result integration update the same readout when viewing a later commissioning month',()=>withDOM(doc=>{
 doc.field('topic-results');
 for(const id of ['kwu-tung-housing','hung-shui-kiu-school']){
  const policy=getPolicy(id),ui=Object.create(TopicStudiesUI.prototype);ui.store=addTopicCase(emptyTopicStore(),id);ui.activeId=ui.store.activeByPolicy[id];
  ui.record.ledger=applyTopicRevision(emptyTopicLedger(id),policy.defaults,policy.defaults.start,'Test only.',stamp);ui.study=buildTopicStudy(ui.record.ledger);ui.chart=()=>doc.createElement('div');ui.selectMonth=()=>{};
  ui.renderResults(ui.study.months[0]);const holder=doc.getElementById('topic-results');assert.match(sectionText(holder,'mechanism'),/commissioning starts/);
  ui.record.month=ui.study.months.findIndex(m=>m.date===policy.defaults.commission);ui.renderResults(ui.study.months[ui.record.month]);
  assert.match(holder.textContent,new RegExp(policy.defaults.commission));assert.equal(holder.querySelectorAll('article').filter(e=>e.className==='policy-readout').length,1);
  assert.match(sectionText(holder,'mechanism'),id==='kwu-tung-housing'?/usable housing units/:/school places/);
 }
}));

test('API integration renders only the latest returned snapshot and keeps synthetic provenance visible',async()=>withAsyncDOM(async doc=>{
 const c=owner(doc);c.engine='fixture';c.resultTags=['housing-affordability'];c.frameGeneration=0;c.apiMap={clear(){},show(){}};
 const make=date=>({date,zones:[{name:'Returned zone',population:1200,satisfaction:null,jobs:[]}],grid:{cellSizeM:10},roads:[],mtr:[],pollution:[],powerLines:[]});
 const frames=[make('2026-08-01'),make('2026-09-01')];c.session={setup:{policyScope:{policyId:'kwu-tung-housing',areaId:'kwu-tung-north',tags:c.resultTags}},run:{snapshots:frames.map((f,i)=>({id:'s'+i,date:f.date}))},snapshot:async index=>frames[index]};
 await c.loadFrame(0);let holder=doc.getElementById('compact-api-results');assert.match(holder.textContent,/Synthetic API fixture/);assert.match(holder.textContent,/No no-policy baseline/);
 await c.loadFrame(1);assert.match(holder.textContent,/2026-09-01/);assert.doesNotMatch(holder.textContent,/2026-08-01/);assert.equal(holder.querySelectorAll('article').filter(e=>e.className==='policy-readout').length,1);
 assert.doesNotMatch(holder.textContent,/commissioned additions: 1,600/i);
}));

test('a delayed old API frame cannot replace the interpretation after a newer month has loaded',async()=>withAsyncDOM(async doc=>{
 const c=owner(doc);c.engine='fixture';c.resultTags=['border-access'];c.apiMap={clear(){},show(){}};let release;
 const make=date=>({date,zones:[],grid:{cellSizeM:10},roads:[],mtr:[],pollution:[],powerLines:[]});const old=make('2026-08-01'),latest=make('2026-09-01');
 c.session={setup:{policyScope:{policyId:'huanggang-opening',areaId:'huanggang',tags:c.resultTags}},run:{snapshots:[{date:old.date},{date:latest.date}]},snapshot:index=>index===0?new Promise(resolve=>release=resolve):Promise.resolve(latest)};
 const pending=c.loadFrame(0);await c.loadFrame(1);release(old);await pending;
 assert.equal(c.currentFrame.date,latest.date);assert.match(doc.getElementById('compact-api-results').textContent,/2026-09-01/);assert.doesNotMatch(doc.getElementById('compact-api-results').textContent,/2026-08-01/);
}));

test('topic export interpretation agrees with its selected policy and viewing month',async()=>withAsyncDOM(async()=>{
 for(const id of ['kwu-tung-housing','hung-shui-kiu-school']){
  const policy=getPolicy(id),ui=Object.create(TopicStudiesUI.prototype);ui.store=addTopicCase(emptyTopicStore(),id);ui.activeId=ui.store.activeByPolicy[id];
  ui.record.ledger=applyTopicRevision(emptyTopicLedger(id),policy.defaults,policy.defaults.start,'Export scenario.',stamp);ui.study=buildTopicStudy(ui.record.ledger);ui.record.month=ui.study.months.findIndex(m=>m.date===policy.defaults.commission);
  const data=await download(()=>ui.export());assert.equal(data.policyId,id);assert.equal(data.areaId,policy.areaId);assert.equal(data.viewMonth,policy.defaults.commission);
  assert.match(data.interpretation.title,new RegExp(data.viewMonth));assert.match(data.interpretation.sections.find(s=>s.id==='scope').items.join(' '),new RegExp(policy.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 }
}));

test('port export includes interpretation for the selected cohort and historical month, not the latest revision',async()=>withAsyncDOM(async doc=>{
 const beforeStorage=globalThis.localStorage,beforeMedia=globalThis.matchMedia;
 try{
  globalThis.localStorage={getItem:()=>null};globalThis.matchMedia=()=>({matches:false});doc.addEventListener=()=>{};
  const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');for(const match of html.matchAll(/id="([^"]+)"/g))if(!doc.getElementById(match[1]))doc.field(match[1]);
  const port=new PortStudyUI({setPortMotion(){}},{});let ledger=applyRevision(emptyLedger(),DEFAULTS,0,'August export.',stamp);ledger=applyRevision(ledger,{...DEFAULTS,reach:95},1,'Future revision.',stamp);
  port.ledger=ledger;port.study=buildPolicyStudy(ledger);port.month=0;port.cases[0].analysisTags=['border-access'];doc.getElementById('port-cohort').value='business';doc.getElementById('port-mode').value='delta';
  const data=await download(()=>doc.getElementById('port-export').click());assert.equal(data.view.month,0);assert.equal(data.view.cohort,'business');assert.deepEqual(data.policyTags,['border-access']);
  assert.match(data.interpretation.summary,/Business passenger trips/);assert.match(data.interpretation.title,/August 2026/);assert.doesNotMatch(JSON.stringify(data.interpretation),/HG-002/);
 }finally{globalThis.localStorage=beforeStorage;globalThis.matchMedia=beforeMedia;}
}));

test('API export uses the confirmed run scope, preserves snapshot date and leaves unavailable interpretation null',async()=>withAsyncDOM(async doc=>{
 const c=owner(doc);c.engine='fixture';c.selected=['public-services'];c.session={setup:{policyScope:{policyId:'kwu-tung-housing',areaId:'kwu-tung-north',tags:['housing-affordability']}},review:{},run:{}};
 c.currentFrame={date:'2026-09-01',zones:[],grid:{cellSizeM:10},roads:[],mtr:[],pollution:[],powerLines:[]};
 const data=await download(()=>c.exportAPI());assert.equal(data.currentSnapshot.date,'2026-09-01');assert.deepEqual(data.policyTags,['housing-affordability']);
 assert.match(data.interpretation.title,/2026-09-01/);assert.match(data.interpretation.basis,/Synthetic/);assert.match(data.interpretation.sections.find(s=>s.id==='scope').items.join(' '),/kwu-tung-housing/);assert.doesNotMatch(JSON.stringify(data.interpretation),/public-services/);
 c.currentFrame=null;const noFrame=await download(()=>c.exportAPI());assert.equal(noFrame.currentSnapshot,null);assert.equal(noFrame.interpretation,null);
}));

test('layout observer moves the analysis panel above the actual wrapped bottom deck',()=>withDOM(doc=>{
 const previousObserver=globalThis.ResizeObserver,previousWindow=globalThis.window;let callback,observed;const writes=[];let top=540;
 try{
  globalThis.window={innerHeight:800};globalThis.ResizeObserver=class{constructor(fn){callback=fn;}observe(value){observed=value;}};
  const deck=doc.field('port-deck');deck.getBoundingClientRect=()=>({top,height:800-top});doc.documentElement={style:{setProperty:(...args)=>writes.push(args)}};
  const c={};CompactAnalysisUI.prototype.observeLayout.call(c);assert.equal(observed,deck);callback();
  assert.deepEqual(writes.at(-1),['--analysis-panel-bottom','272px']);top=500;callback();assert.deepEqual(writes.at(-1),['--analysis-panel-bottom','312px']);
 }finally{globalThis.ResizeObserver=previousObserver;globalThis.window=previousWindow;}
}));

test('layout observer ignores hidden or offscreen geometry and degrades safely when observation is unavailable',()=>withDOM(doc=>{
 const previousObserver=globalThis.ResizeObserver,previousWindow=globalThis.window;let callback;const writes=[];let rect={top:0,height:0};
 try{
  globalThis.window={innerHeight:800};globalThis.ResizeObserver=class{constructor(fn){callback=fn;}observe(){}};
  const deck=doc.field('port-deck');deck.getBoundingClientRect=()=>rect;doc.documentElement={style:{setProperty:(...args)=>writes.push(args)}};
  CompactAnalysisUI.prototype.observeLayout.call({});callback();assert.equal(writes.length,0);
  rect={top:850,height:180};callback();assert.equal(writes.length,0);
  globalThis.ResizeObserver=undefined;assert.doesNotThrow(()=>CompactAnalysisUI.prototype.observeLayout.call({}));assert.equal(writes.length,0);
 }finally{globalThis.ResizeObserver=previousObserver;globalThis.window=previousWindow;}
}));
