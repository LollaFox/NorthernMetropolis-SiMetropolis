import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {POLICY_ICONS,VISUAL_ROLES,createPolicyIcon,renderVisualLibrary} from '../web/policy-visuals.js';
import {chartDomain,renderPolicyCharts} from '../web/policy-charts.js';
import {buildPortCharts,buildTopicCharts,buildApiCharts} from '../web/policy-chart-model.js';
import {CompactAnalysisUI} from '../web/analysis-compact.js';
import {TopicStudiesUI} from '../web/topic-ui.js';
import {PortStudyUI} from '../web/port-study.js';
import {DEFAULTS} from '../web/port-model.js';
import {emptyLedger,applyRevision,buildPolicyStudy} from '../web/policy-ledger.js';
import {getPolicy} from '../web/policy-catalog.js';
import {emptyTopicLedger,applyTopicRevision,buildTopicStudy} from '../web/topic-model.js';
import {emptyTopicStore,addTopicCase} from '../web/topic-store.js';

// Event/DOM contract adapter. No browser, GPU or CSS-layout assertion is made by these tests.
class Element {
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.handlers={};this.value='';this.checked=false;this.disabled=false;this.open=false;this.className='';this.style={};this._text='';}
 get classList(){return {add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(n=>!names.includes(n)).join(' ');},contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,on)=>{const yes=on??!this.classList.contains(name);this.classList[yes?'add':'remove'](name);return yes;}};}
 set textContent(text){this._text=String(text);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set innerText(text){this.textContent=text;}set innerHTML(_){throw new Error('Use textContent for returned labels.');}
 append(...nodes){for(const n of nodes){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(c=>c!==n);n.parentNode=this;this.children.push(n);}}
 prepend(...nodes){this.append(...nodes);this.children=[...nodes,...this.children.filter(n=>!nodes.includes(n))];}
 replaceChildren(...nodes){for(const c of this.children)c.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
 insertBefore(node,before){const i=this.children.indexOf(before);if(i<0)this.append(node);else{node.parentNode=this;this.children.splice(i,0,node);}}
 get firstChild(){return this.children[0]??null;}
 setAttribute(key,value){this.attributes[key]=String(value);if(key==='class')this.className=String(value);}getAttribute(key){return this.attributes[key]??null;}
 addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}dispatch(name){for(const fn of this.handlers[name]??[])fn({target:this});}click(){this.dispatch('click');}
 matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector.startsWith('#'))return this.id===selector.slice(1);return this.tagName===selector.toUpperCase();}
 querySelectorAll(selector){return this.children.flatMap(c=>[...(c.matches(selector)?[c]:[]),...c.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 cloneNode(deep=false){const e=new Element(this.tagName,this.ownerDocument);Object.assign(e,{className:this.className,_text:this._text,attributes:{...this.attributes},dataset:{...this.dataset}});if(deep)e.append(...this.children.map(c=>c.cloneNode(true)));return e;}
}
function dom(){
 const doc={nodes:[],createElement(tag){const e=new Element(tag,this);this.nodes.push(e);return e;},getElementById(id){return this.nodes.find(e=>e.id===id)??null;},querySelector(s){return this.nodes.find(e=>e.matches(s))??null;},querySelectorAll(s){return this.nodes.filter(e=>e.matches(s));},addEventListener(){}};
 doc.body=doc.createElement('body');doc.createElementNS=(_,tag)=>doc.createElement(tag);doc.field=(id,tag='div')=>{const e=doc.createElement(tag);e.id=id;return e;};return doc;
}
function withDOM(task){const before=globalThis.document,doc=dom();globalThis.document=doc;try{return task(doc);}finally{globalThis.document=before;}}
async function withAsyncDOM(task){const before=globalThis.document,doc=dom();globalThis.document=doc;try{return await task(doc);}finally{globalThis.document=before;}}
const spec=cards=>({schema:'nm-policy-charts-v1',title:'Automatic chart test',basis:'Explicit synthetic test',cards,unavailable:[]});
const card=(kind='line',values=[0,null,10])=>({id:'test',title:'Test counts',icon:'housing',kind,unit:'usable housing units',description:'Known quantities and explicit missing data.',labels:['2026-08-01','2026-09-01','2026-10-01'],series:[{id:'baseline',label:'Baseline',role:'baseline',values}],selectedIndex:0});
const plot=root=>root.querySelectorAll('svg').find(e=>e.classList.contains('policy-data-chart'));
const chart=root=>root.querySelectorAll('article').filter(e=>e.classList.contains('policy-chart-card'));
const stamp='2026-10-15T09:00:00Z';
async function download(action){const create=URL.createObjectURL,revoke=URL.revokeObjectURL,timer=globalThis.setTimeout;let blob;try{URL.createObjectURL=value=>{blob=value;return 'blob:chart-test';};URL.revokeObjectURL=()=>{};globalThis.setTimeout=()=>0;action();}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=timer;}assert.ok(blob instanceof Blob);return {blob,text:await blob.text()};}

test('semantic library contains distinct policy topics and freezes its shared definitions',()=>{
 assert.equal(Object.keys(POLICY_ICONS).length,15);assert.ok(Object.isFrozen(POLICY_ICONS));
 for(const key of ['housing','education','population','migration','transport','rail','road','construction','healthcare'])assert.ok(POLICY_ICONS[key]?.paths.length);
 assert.notDeepEqual(POLICY_ICONS.housing.paths,POLICY_ICONS.education.paths);assert.match(POLICY_ICONS.population.meaning,/not trips or migration/);assert.match(POLICY_ICONS.housing.meaning,/not buildings/);
 assert.ok(VISUAL_ROLES.baseline.dash);assert.equal(VISUAL_ROLES.policy.dash,'');
});

test('icons retain accessible names when standalone and stay out of the focus order when decorative',()=>withDOM(()=>{
 const decorative=createPolicyIcon('housing');assert.equal(decorative.getAttribute('aria-hidden'),'true');assert.equal(decorative.getAttribute('focusable'),'false');
 const named=createPolicyIcon('education',{decorative:false,size:30});assert.equal(named.getAttribute('role'),'img');assert.equal(named.getAttribute('aria-label'),'School places');assert.equal(named.querySelector('title').textContent,'School places');assert.equal(named.getAttribute('width'),'30');
 const unknown=createPolicyIcon('missing',{decorative:false});assert.equal(unknown.getAttribute('aria-label'),'Information reach');
}));

test('visual-key fold lists all symbols with text meanings and does not assert unavailable data',()=>withDOM(doc=>{
 const root=doc.createElement('div'),fold=renderVisualLibrary(root);assert.equal(fold.tagName,'DETAILS');assert.equal(fold.open,false);assert.match(fold.querySelector('summary').textContent,/15 symbols/);
 assert.equal(fold.querySelectorAll('svg').length,15);assert.equal(fold.querySelectorAll('strong').length,15);assert.match(fold.textContent,/Data availability decides/);assert.match(fold.textContent,/road icon alone does not establish/);
}));

test('line charts expose semantic title, description, numeric axis and units outside colour',()=>withDOM(doc=>{
 const root=renderPolicyCharts(doc.createElement('div'),spec([card()])),svg=plot(root);
 assert.equal(svg.getAttribute('role'),'img');assert.match(svg.getAttribute('aria-label'),/usable housing units.*axis 0 to 10/);assert.equal(svg.querySelector('title').textContent,'Test counts');assert.match(svg.querySelector('desc').textContent,/Null values leave gaps/);
 assert.equal(svg.getAttribute('data-y-min'),'0');assert.equal(svg.getAttribute('data-y-max'),'10');assert.match(root.querySelector('caption').textContent,/usable housing units/);assert.match(root.textContent,/Baseline/);
}));

test('line chart gaps stay missing while measured zero remains on the common scale',()=>withDOM(doc=>{
 const root=renderPolicyCharts(doc.createElement('div'),spec([card()])),svg=plot(root),path=svg.querySelectorAll('path').find(e=>e.getAttribute('data-series')==='baseline');
 assert.equal((path.getAttribute('d').match(/M/g)??[]).length,2);assert.equal((path.getAttribute('d').match(/L/g)??[]).length,0);
 assert.deepEqual(svg.querySelectorAll('circle').map(e=>e.getAttribute('data-value')),['0','10']);assert.deepEqual(root.querySelectorAll('td').map(e=>e.textContent),['0','Not provided','10']);
}));

test('same-role line series use distinct dash and marker patterns alongside their text labels',()=>withDOM(doc=>{
 const c={...card('line',[2,4,6]),unit:'persons',series:[{id:'inflow',label:'Residential inflow',role:'context',values:[2,4,6]},{id:'outflow',label:'Residential outflow',role:'context',values:[1,3,5]}]},root=renderPolicyCharts(doc.createElement('div'),spec([c])),svg=plot(root);
 const paths=svg.querySelectorAll('path').filter(e=>e.getAttribute('data-series')!==null);assert.equal(paths.length,2);assert.notEqual(paths[0].getAttribute('stroke-dasharray'),paths[1].getAttribute('stroke-dasharray'));
 assert.equal(svg.querySelectorAll('circle').length,3);assert.equal(svg.querySelectorAll('rect').filter(e=>e.getAttribute('data-value')!==null).length,3);assert.match(root.querySelector('.policy-chart-legend').textContent,/Residential inflow.*Residential outflow/);
}));

test('all-zero series retain a finite zero-based axis and never create a positive bar from padding',()=>withDOM(doc=>{
 for(const kind of ['line','bar','stack']){
  const root=renderPolicyCharts(doc.createElement('div'),spec([card(kind,[0,0,0])])),svg=plot(root);assert.equal(svg.getAttribute('data-y-min'),'0');assert.equal(svg.getAttribute('data-y-max'),'1');
  assert.ok(!svg.textContent.includes('NaN'));for(const rect of svg.querySelectorAll('rect').filter(e=>e.getAttribute('data-value')==='0'))assert.equal(rect.getAttribute('width'),'0');
  assert.deepEqual(root.querySelectorAll('td').map(e=>e.textContent),['0','0','0']);
 }
}));

test('changing selected month preserves the whole-study common axis and changes only the marker/current values',()=>withDOM(doc=>{
 const c=card('line',[0,5,100]),holder=doc.createElement('div');renderPolicyCharts(holder,spec([c]));const first=plot(holder);const firstMax=first.getAttribute('data-y-max');
 renderPolicyCharts(holder,spec([{...c,selectedIndex:2}]));const second=plot(holder);assert.equal(second.getAttribute('data-y-max'),firstMax);assert.equal(firstMax,'100');
 const marker=second.querySelectorAll('line').find(e=>e.getAttribute('data-selected-index')!==null);assert.equal(marker.getAttribute('data-selected-index'),'2');assert.match(holder.querySelector('.chart-current-values').textContent,/100/);
}));

test('bar charts keep zero width at zero and explicitly label missing values',()=>withDOM(doc=>{
 const root=renderPolicyCharts(doc.createElement('div'),spec([card('bar',[0,null,10])])),svg=plot(root),rects=svg.querySelectorAll('rect');
 assert.equal(rects.length,2);assert.equal(rects.find(e=>e.getAttribute('data-value')==='0').getAttribute('width'),'0');assert.match(svg.textContent,/Not provided/);assert.ok(!svg.textContent.includes('NaN'));
}));

test('partial stacks never overflow their common axis or present missing total as known',()=>withDOM(doc=>{
 const c={...card('stack',[100]),labels:['Current month'],selectedIndex:undefined,series:[{id:'known',label:'Known delivered',role:'policy',values:[100]},{id:'missing',label:'Unknown remainder',role:'context',values:[null]}]};
 const root=renderPolicyCharts(doc.createElement('div'),spec([c])),svg=plot(root),domain=chartDomain(c);assert.ok(domain.max>=100);assert.match(svg.textContent,/Unknown|Not provided/);
 for(const rect of svg.querySelectorAll('rect'))assert.ok(Number(rect.getAttribute('width'))<=252,'Known partial stack must not extend beyond its plot.');
}));

test('negative raw values span zero without converting them to missing or percentages',()=>withDOM(doc=>{
 const c={...card('bar',[-5,0,10]),unit:'raw congestion index'},root=renderPolicyCharts(doc.createElement('div'),spec([c])),svg=plot(root);
 assert.equal(svg.getAttribute('data-y-min'),'-5');assert.equal(svg.getAttribute('data-y-max'),'10');assert.deepEqual(root.querySelectorAll('td').map(e=>e.textContent),['-5','0','10']);assert.match(root.textContent,/raw congestion index/);
 assert.ok(svg.querySelectorAll('rect').every(e=>Number(e.getAttribute('width'))>=0));
}));

test('limited bar preview still uses every observation for its common scale and full table',()=>withDOM(doc=>{
 const c={...card('bar'),labels:Array.from({length:12},(_,i)=>'Zone '+i),series:[{id:'all',label:'Counts',role:'context',values:[1,2,3,4,5,6,7,8,9,10,11,1000]}]},root=renderPolicyCharts(doc.createElement('div'),spec([c]));
 assert.equal(plot(root).getAttribute('data-y-max'),'1000');assert.equal(plot(root).querySelectorAll('rect').length,10);assert.equal(root.querySelector('tbody').children.length,12);assert.match(root.textContent,/first 10 of 12/);
}));

test('missing data produces an explanation and required fields instead of invented charts',()=>withDOM(doc=>{
 const data={...spec([]),unavailable:[{icon:'migration',title:'Residential migration unavailable',reason:'No incoming or outgoing residents supplied.',requiredFields:['records[].inflow','records[].outflow']}]},holder=doc.createElement('div');
 renderPolicyCharts(holder,spec([card()]));renderPolicyCharts(holder,data);assert.equal(chart(holder).length,0);assert.match(holder.textContent,/No supported numeric series/);assert.match(holder.textContent,/records\[\]\.inflow/);assert.equal(holder.children.length,1);
}));

test('chart labels are text and invalid numeric values are rejected before any misleading plot is created',()=>withDOM(doc=>{
 const c={...card(),title:'<img src=x onerror=alert(1)>',labels:['<script>x</script>','B','C']},root=renderPolicyCharts(doc.createElement('div'),spec([c]));assert.equal(root.querySelectorAll('img').length,0);assert.equal(root.querySelectorAll('script').length,0);assert.match(root.textContent,/<img src=x/);
 for(const values of [[NaN,1,2],[Infinity,1,2],[undefined,1,2]])assert.throws(()=>chartDomain(card('line',values)),/finite|unavailable/);
}));

test('save SVG exports a standalone labelled vector with the same domain and quantity data',async()=>withAsyncDOM(async doc=>{
 const previousSerializer=globalThis.XMLSerializer;const escape=t=>t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 try{globalThis.XMLSerializer=class{serializeToString(e){return `<${e.tagName.toLowerCase()} ${Object.entries(e.attributes).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}>${escape(e._text)}${e.children.map(c=>this.serializeToString(c)).join('')}</${e.tagName.toLowerCase()}>`;}};
  const root=renderPolicyCharts(doc.createElement('div'),spec([card()])),save=root.querySelectorAll('button').find(e=>e.textContent==='Save SVG ↓');const {blob,text}=await download(()=>save.click());assert.equal(blob.type,'image/svg+xml');assert.match(text,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);assert.match(text,/data-y-max="10"/);assert.match(text,/data-value="0"/);assert.match(text,/<text[^>]*>Test counts<\/text>/);assert.match(text,/<text[^>]*>usable housing units<\/text>/);assert.match(text,/<text[^>]*>Baseline<\/text>/);assert.match(text,/<text[^>]*>Explicit synthetic test<\/text>/);
 }finally{globalThis.XMLSerializer=previousSerializer;}
}));

test('port Impact automatically renders current-month/cohort charts alongside matching readout',()=>withDOM(doc=>{
 for(const id of ['analysis-month','analysis-panel-source','analysis-rule-focus','port-results','port-interpretation','port-visuals','port-cohort'])doc.field(id);
 let ledger=applyRevision(emptyLedger(),DEFAULTS,0,'August policy.',stamp);ledger=applyRevision(ledger,{...DEFAULTS,reach:95},1,'September only.',stamp);
 const c=Object.create(CompactAnalysisUI.prototype);Object.assign(c,{engine:'rules',policyId:'huanggang-opening',areaId:'huanggang',apiResults:false,selected:['border-access'],lastCaseId:'case-1',update(){},port:{ledger,study:buildPolicyStudy(ledger),month:0,caseId:'case-1',cases:[{id:'case-1',analysisTags:['border-access']}]}});
 doc.getElementById('port-cohort').value='all';c.onRuleRender(c.port.study.months[0]);let root=doc.getElementById('port-visuals');
 assert.equal(chart(root).length,3);assert.match(root.textContent,/All passengers/);assert.match(root.textContent,/August 2026/);assert.match(doc.getElementById('port-interpretation').textContent,/August 2026/);
 const allDomain=plot(chart(root)[0]).getAttribute('data-y-max');c.port.month=1;doc.getElementById('port-cohort').value='commuters';c.onRuleRender(c.port.study.months[1]);
 assert.equal(root.children.length,1);assert.equal(chart(root).length,3);assert.match(root.textContent,/Commuters/);assert.match(root.textContent,/September 2026/);assert.match(doc.getElementById('port-interpretation').textContent,/Commuter trips/);
 assert.ok(Number(plot(chart(root)[0]).getAttribute('data-y-max'))<Number(allDomain));
 const capacity=chart(root).find(e=>e.dataset.chartId==='port-capacity');assert.match(capacity.textContent,/All-passenger capacity constraint/);assert.match(capacity.textContent,/regardless of the selected commuters/);
 c.port.month=0;c.onRuleRender(c.port.study.months[0]);assert.match(chart(root).find(e=>e.dataset.chartId==='port-directions').textContent,/August 2026/);assert.doesNotMatch(chart(root).find(e=>e.dataset.chartId==='port-directions').textContent,/September/);
}));

test('housing and education put automatic charts before interpretation and update selected month without duplicates',()=>withDOM(doc=>{
 doc.field('topic-results');
 for(const id of ['kwu-tung-housing','hung-shui-kiu-school']){
  const policy=getPolicy(id),ui=Object.create(TopicStudiesUI.prototype);ui.store=addTopicCase(emptyTopicStore(),id);ui.activeId=ui.store.activeByPolicy[id];
  ui.record.ledger=applyTopicRevision(emptyTopicLedger(id),policy.defaults,policy.defaults.start,'Test only.',stamp);ui.study=buildTopicStudy(ui.record.ledger);ui.selectMonth=()=>{};
  ui.renderResults(ui.study.months[0]);const holder=doc.getElementById('topic-results');assert.ok(holder.firstChild.querySelector('.policy-visual-analysis'));assert.equal(chart(holder).length,3);
  const beforeDomain=plot(chart(holder)[0]).getAttribute('data-y-max');ui.record.month=ui.study.months.findIndex(m=>m.date===policy.defaults.commission);ui.renderResults(ui.study.months[ui.record.month]);
  assert.equal(holder.querySelectorAll('.policy-visual-analysis').length,1);assert.equal(holder.querySelectorAll('.policy-readout').length,1);assert.equal(plot(chart(holder)[0]).getAttribute('data-y-max'),beforeDomain);
  assert.match(chart(holder).find(e=>e.dataset.chartId==='topic-commissioning').textContent,new RegExp(policy.defaults.commission));
  const current=plot(chart(holder)[0]).querySelectorAll('line').find(e=>e.getAttribute('data-selected-index')!==null);assert.equal(current.getAttribute('data-selected-index'),String(ui.record.month));
 }
}));

test('unapplied topic result does not display calculated policy charts or create fictional capacity',()=>withDOM(doc=>{
 doc.field('topic-results');const policy=getPolicy('kwu-tung-housing'),ui=Object.create(TopicStudiesUI.prototype);ui.store=addTopicCase(emptyTopicStore(),policy.id);ui.activeId=ui.store.activeByPolicy[policy.id];ui.study=buildTopicStudy(ui.record.ledger);
 ui.renderResults(ui.study.months[0]);assert.equal(chart(doc.getElementById('topic-results')).length,0);assert.match(doc.getElementById('topic-results').textContent,/Start analysis/);
}));

function apiOwner(doc){
 for(const id of ['analysis-month','compact-api-results','port-scenario-note','analysis-entry-status','analysis-start'])doc.field(id);doc.field('port-heading').append(doc.createElement('small'));doc.createElement('div').className='port-flow-key';
 const c=Object.create(CompactAnalysisUI.prototype);Object.assign(c,{engine:'fixture',policyId:'kwu-tung-housing',areaId:'kwu-tung-north',apiResults:true,resultTags:['housing-affordability'],frameGeneration:0,apiMap:{clear(){},show(){}},city:{showPortStudy(){}}});return c;
}
const apiFrame=date=>({date,zones:[{name:'Zone A',population:0,satisfaction:null,jobs:[{type:'office',count:10}]},{name:'Zone B',population:100,satisfaction:0,jobs:[]}],grid:{cellSizeM:10},roads:[{congestion:[0,null,-2]}],mtr:[],pollution:[],powerLines:[]});

test('API result automatically shows returned-field charts before readout without inferring housing or migration',async()=>withAsyncDOM(async doc=>{
 const c=apiOwner(doc),frames=[apiFrame('2026-08-01'),apiFrame('2026-09-01')];
 c.session={setup:{policyScope:{policyId:c.policyId,areaId:c.areaId,tags:c.resultTags}},run:{snapshots:frames.map(f=>({date:f.date}))},snapshot:async i=>frames[i]};
 await c.loadFrame(0);const holder=doc.getElementById('compact-api-results');assert.ok(holder.firstChild.querySelector('.policy-visual-analysis'));assert.equal(chart(holder).length,3);assert.match(holder.textContent,/Synthetic API fixture/);assert.match(holder.textContent,/Residential migration unavailable/);assert.match(holder.textContent,/Transport construction unavailable/);
 assert.deepEqual(chart(holder).map(e=>e.dataset.chartId),['api-population','api-jobs','api-congestion']);
 await c.loadFrame(1);assert.equal(holder.querySelectorAll('.policy-visual-analysis').length,1);assert.match(holder.textContent,/2026-09-01/);assert.doesNotMatch(holder.textContent,/2026-08-01/);assert.equal(c.currentFrame.date,'2026-09-01');
}));

test('delayed old API snapshot cannot replace newly selected chart date or readout',async()=>withAsyncDOM(async doc=>{
 const c=apiOwner(doc),old=apiFrame('2026-08-01'),latest=apiFrame('2026-09-01');let resolveOld;
 c.session={setup:{policyScope:{policyId:c.policyId,areaId:c.areaId,tags:c.resultTags}},run:{snapshots:[{date:old.date},{date:latest.date}]},snapshot:i=>i===0?new Promise(resolve=>resolveOld=resolve):Promise.resolve(latest)};
 const pending=c.loadFrame(0);await c.loadFrame(1);resolveOld(old);await pending;
 assert.match(doc.getElementById('compact-api-results').textContent,/2026-09-01/);assert.doesNotMatch(doc.getElementById('compact-api-results').textContent,/2026-08-01/);assert.equal(c.currentFrame.date,latest.date);
}));

test('topic export contains exact chart spec for the selected scope and month shown in its interpretation',async()=>withAsyncDOM(async()=>{
 for(const id of ['kwu-tung-housing','hung-shui-kiu-school']){
  const policy=getPolicy(id),ui=Object.create(TopicStudiesUI.prototype);ui.store=addTopicCase(emptyTopicStore(),id);ui.activeId=ui.store.activeByPolicy[id];ui.record.ledger=applyTopicRevision(emptyTopicLedger(id),policy.defaults,policy.defaults.start,'Export test.',stamp);ui.study=buildTopicStudy(ui.record.ledger);ui.record.month=2;
  const data=JSON.parse((await download(()=>ui.export())).text);assert.deepEqual(data.charts,buildTopicCharts({policy,study:ui.study,monthIndex:2}));assert.match(data.interpretation.title,new RegExp(data.viewMonth));assert.equal(data.charts.cards[0].selectedIndex,2);
 }
}));

test('port export uses the same historical month and cohort for chart spec and interpretation',async()=>withAsyncDOM(async doc=>{
 const beforeStorage=globalThis.localStorage,beforeMedia=globalThis.matchMedia;
 try{
  globalThis.localStorage={getItem:()=>null};globalThis.matchMedia=()=>({matches:false});const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');for(const match of html.matchAll(/id="([^"]+)"/g))if(!doc.getElementById(match[1]))doc.field(match[1]);
  const port=new PortStudyUI({setPortMotion(){}},{});let ledger=applyRevision(emptyLedger(),DEFAULTS,0,'August.',stamp);ledger=applyRevision(ledger,{...DEFAULTS,reach:95},1,'September.',stamp);port.ledger=ledger;port.study=buildPolicyStudy(ledger);port.month=0;doc.getElementById('port-cohort').value='business';doc.getElementById('port-mode').value='policy';
  const data=JSON.parse((await download(()=>doc.getElementById('port-export').click())).text);assert.deepEqual(data.charts,buildPortCharts({study:port.study,monthIndex:0,cohortId:'business'}));assert.match(data.charts.title,/business passengers/);assert.match(data.interpretation.summary,/Business passenger trips/);assert.equal(data.view.month,0);assert.equal(data.view.cohort,'business');
 }finally{globalThis.localStorage=beforeStorage;globalThis.matchMedia=beforeMedia;}
}));

test('API export chart spec follows confirmed scope and current snapshot; no frame leaves charts null',async()=>withAsyncDOM(async doc=>{
 const c=apiOwner(doc);c.selected=['public-services'];c.session={setup:{policyScope:{policyId:c.policyId,areaId:c.areaId,tags:c.resultTags}},review:{},run:{}};c.currentFrame=apiFrame('2026-09-01');
 const data=JSON.parse((await download(()=>c.exportAPI())).text);assert.deepEqual(data.charts,buildApiCharts({frame:c.currentFrame,setup:c.session.setup,synthetic:true}));assert.match(data.charts.title,/2026-09-01/);assert.match(data.interpretation.title,/2026-09-01/);assert.equal(data.setup.policyScope.policyId,'kwu-tung-housing');assert.deepEqual(data.policyTags,['housing-affordability']);
 c.currentFrame=null;assert.equal(JSON.parse((await download(()=>c.exportAPI())).text).charts,null);
}));
