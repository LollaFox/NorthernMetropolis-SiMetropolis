import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backendPlan,portPlan,topicPlan,selectedPlanLayer} from '../web/plan-analysis-model.js';
import {CHANGE_SYMBOLS,deltaSymbol,createChangeSymbol} from '../web/change-symbols.js';
import {renderPlanMap,planProjection} from '../web/plan-map.js';
import {PlanAnalysis} from '../web/plan-analysis.js';
import {AnalysisDashboard} from '../web/analysis-dashboard.js';
import {normalizeBackendExport} from '../web/backend-results.js';
import {runStudy} from '../web/port-model.js';
import {getPolicy} from '../web/policy-catalog.js';
import {emptyTopicLedger,applyTopicRevision,buildTopicStudy} from '../web/topic-model.js';
const dates=['2026-08-01','2026-09-01','2026-10-01'];
function sample(){
 const b=(id,type,x,y,status)=>({id,type,x,y,status,startMonth:1,completionMonth:3});
 const states=[
  [b('R1','residential',0,0,'planned'),b('B1','business',2,1,'complete'),b('S1','station',3,0,'planned'),b('P1','park',1,3,'complete')],
  [b('R1','residential',0,0,'construction'),b('B1','business',2,1,'complete'),b('S1','station',3,0,'complete')],
  [b('R1','residential',0,0,'complete'),b('B1','business',2,1,'complete'),b('S1','station',3,0,'complete'),b('R2','residential',10,10,'complete')]
 ];
 return {schemaVersion:1,run:{simulationId:'plan-test',snapshots:dates.map((date,i)=>({id:'s'+i,date}))},scale:{unit:'development_cluster'},monthlyStates:states.map((buildings,i)=>({month:dates[i],buildings,metrics:{}})),monthlyBuildingTotals:states.map((buildings,i)=>({date:dates[i],buildings:buildings.map(b=>({id:b.id,type:b.type,x:b.x,y:b.y,housingCapacity:b.type==='residential'&&i===2?20:0,plannedHousingCapacity:b.type==='residential'?20:0,actualResidents:b.type==='residential'&&i===2?10:0,offeredJobs:b.type==='business'?10:0,filledJobs:b.type==='business'?[5,8,7][i]:0,vacancies:b.type==='business'?[5,2,3][i]:0}))}))};
}
const layer=(p,id)=>selectedPlanLayer(p,id);
function topic(id){const p=getPolicy(id),ledger=applyTopicRevision(emptyTopicLedger(id),p.defaults,p.defaults.start,'Test assumptions','2026-10-17T00:00:00Z');return {p,study:buildTopicStudy(ledger)};}

test('saved plans join exact canonical object coordinates, units and states without modifying the export',()=>{
 const raw=sample(),before=JSON.stringify(raw),p=backendPlan(raw,dates[2]);assert.equal(JSON.stringify(raw),before);assert.equal(p.date,dates[2]);assert.equal(p.previousDate,dates[1]);assert.equal(layer(p,'housing').unit,'resident places');assert.equal(layer(p,'residents').features.find(f=>f.id==='R1').value,10);assert.equal(layer(p,'housing').features.find(f=>f.id==='R1').x,0);assert.match(p.spatialBasis,/not a geographic/);assert.match(p.unavailable,/heights.*POI/);assert.match(p.comparison,/not policy causal/);
});
test('first saved month has no fabricated month differences or added-object claims',()=>{
 const p=backendPlan(sample(),dates[0]);assert.equal(p.previousDate,null);assert.ok(layer(p,'construction').features.every(f=>f.change==='unavailable'));assert.ok(layer(p,'residents').features.every(f=>f.delta===null));
});
test('construction marks distinguish started, completed, newly present and removed objects',()=>{
 const second=backendPlan(sample(),dates[1]),last=backendPlan(sample(),dates[2]);const feature=(p,id)=>layer(p,'construction').features.find(f=>f.id===id);
 assert.equal(feature(second,'R1').change,'started');assert.equal(feature(second,'S1').change,'completed');assert.equal(feature(second,'P1').change,'removed');assert.equal(feature(second,'P1').current,false);assert.equal(feature(last,'R1').change,'completed');assert.equal(feature(last,'R2').change,'added');
});
test('metric change is signed; new object stock uses prior absence while first month is not compared',()=>{
 const p=backendPlan(sample(),dates[2]);assert.equal(layer(p,'jobs').features[0].delta,-1);assert.equal(layer(p,'jobs').features[0].change,'decrease');assert.equal(layer(p,'residents').features.find(f=>f.id==='R2').delta,10);
});
test('missing quantities stay missing and true zero remains a valid comparable value',()=>{
 const raw=sample();raw.monthlyBuildingTotals[2].buildings.find(b=>b.id==='R1').actualResidents=null;const p=backendPlan(raw,dates[2]);assert.equal(layer(p,'residents').features[0].value,null);assert.equal(layer(p,'residents').features[0].delta,null);assert.equal(layer(backendPlan(raw,dates[1]),'residents').features[0].value,0);assert.equal(layer(backendPlan(raw,dates[1]),'residents').features[0].change,'unchanged');
});
test('plan extent and quantity maximum are fixed over all saved dates, including later objects',()=>{
 const n=normalizeBackendExport(sample()),first=backendPlan(n,dates[0]),last=backendPlan(n,dates[2]);assert.deepEqual(first.bounds,last.bounds);assert.equal(first.bounds.maxX,10);for(const id of ['residents','housing','jobs'])assert.equal(layer(first,id).scaleMax,layer(last,id).scaleMax);assert.deepEqual(planProjection(first.bounds).point({x:2,y:1}),planProjection(last.bounds).point({x:2,y:1}));
});
test('station layer contains only supplied station objects, not invented rail alignments',()=>{
 const p=backendPlan(sample(),dates[1]);assert.deepEqual(layer(p,'stations').features.map(f=>f.id),['S1']);assert.equal(layer(p,'stations').kind,'status');assert.match(layer(p,'stations').summary,/no railway alignment/);assert.ok(!p.layers.some(l=>/heat|height|road/.test(l.id)));
});
test('an exact saved month is required and invalid canonical identities are rejected',()=>{
 assert.throws(()=>backendPlan(sample(),'2026-08-15'),/exact saved/);const raw=sample();raw.monthlyBuildingTotals[1].buildings[0].x=200;assert.throws(()=>backendPlan(raw,dates[1]),/identity/);
});
test('port maps reuse modeled district links and the same full-study flow scale for every group and layer',()=>{
 const s=runStudy(),p=portPlan(s,0),next=portPlan(s,2),group=portPlan(s,2,'commuters');assert.equal(p.layers.length,2);assert.equal(p.date,dates[0]);assert.equal(p.layers[0].features.length,4);assert.equal(p.layers[0].scaleMax,p.layers[1].scaleMax);assert.equal(p.layers[0].scaleMax,next.layers[1].scaleMax);assert.equal(p.layers[0].scaleMax,group.layers[0].scaleMax);assert.equal(next.layers[1].features.reduce((a,b)=>a+b.value,0),s.months[2].extra);assert.match(p.spatialBasis,/not measured routes/);assert.match(p.comparison,/Two-way/);assert.throws(()=>portPlan(s,0,'unknown'),/Unknown passenger/);
});
for(const id of ['kwu-tung-housing','hung-shui-kiu-school'])test(id+': capacity plans use one area marker with fixed scale and truthful units',()=>{
 const {p,study}=topic(id),first=topicPlan(p,study,0),last=topicPlan(p,study,study.months.length-1);assert.equal(first.layers[0].features.length,1);assert.equal(first.layers[0].features[0].value,0);assert.equal(first.layers[0].features[0].delta,null);assert.equal(last.layers[0].features[0].value,study.months.at(-1).delivered);assert.equal(first.layers[0].scaleMax,last.layers[0].scaleMax);assert.equal(last.layers[0].unit,p.model==='housing'?'housing units':'school places');assert.match(first.spatialBasis,/no building footprints/);assert.equal(first.context.length,0);
});
test('a plan cannot present another policy snapshot under a selected topic title',()=>{
 const {study}=topic('kwu-tung-housing');assert.throws(()=>topicPlan(getPolicy('hung-shui-kiu-school'),study,0),/matching policy/);
});
test('change symbols are frozen, semantically different and do not treat missing or zero as increase',()=>{
 assert.equal(Object.keys(CHANGE_SYMBOLS).length,8);assert.ok(Object.isFrozen(CHANGE_SYMBOLS.completed));assert.notDeepEqual(CHANGE_SYMBOLS.added.paths,CHANGE_SYMBOLS.completed.paths);assert.equal(deltaSymbol(null),'unavailable');assert.equal(deltaSymbol(NaN),'unavailable');assert.equal(deltaSymbol(0),'unchanged');assert.equal(deltaSymbol(-1),'decrease');assert.equal(deltaSymbol(5),'increase');
});

class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.handlers={};this.style={};this.className='';this._text='';this.open=false;this.disabled=false;this.value='all';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set innerHTML(_){throw new Error('Unsafe markup');}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=String(v);}getAttribute(k){return this.attributes[k]??null;}
 get classList(){return {contains:k=>this.className.split(/\s+/).includes(k),add:k=>{if(!this.classList.contains(k))this.className+=' '+k;},remove:k=>{this.className=this.className.split(/\s+/).filter(c=>c!==k).join(' ');},toggle:(k,on)=>{this.classList[on?'add':'remove'](k);}};}
 addEventListener(k,f){(this.handlers[k]??=[]).push(f);}dispatch(k,props={}){for(const f of this.handlers[k]??[])f({target:this,...props});}focus(){this.focused=true;}scrollIntoView(){this.scrolled=true;}
 matches(s){if(s.startsWith('.'))return this.classList.contains(s.slice(1));if(s.startsWith('['))return this.getAttribute(s.slice(1,-1))!==null;return this.tagName===s.toUpperCase();}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}querySelector(s){return this.querySelectorAll(s)[0]??null;}
}
function dom(task){const before=globalThis.document,ids=new Map();const d={body:new Element('body'),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),getElementById:id=>ids.get(id),addEventListener(k,f){(this.handlers[k]??=[]).push(f);},handlers:{}};for(const id of readFileSync(new URL('../web/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g))ids.set(id[1],new Element());globalThis.document=d;try{return task(d,id=>ids.get(id));}finally{globalThis.document=before;}}
function owner(){return {engine:'backend',backendReplay:true,backend:{current:normalizeBackendExport(sample()),date:dates[0]},busy:false,onOpen(){this.evidenceClosed=true;},navigation:{closeMenus(){}},port:{ledger:{revisions:[]}}};}

test('standalone change marks have accessible meaning and unknown keys fall back safely',()=>dom(()=>{
 const a=createChangeSymbol('completed');assert.equal(a.getAttribute('aria-label'),'Completed');assert.match(a.querySelector('title').textContent,/prior saved month/);assert.equal(createChangeSymbol('unknown').getAttribute('aria-label'),'Not comparable');assert.equal(createChangeSymbol('added',{decorative:true}).getAttribute('aria-hidden'),'true');
}));
test('SVG plans expose exact values, unit and date; keyboard selection shares the same marker action',()=>dom(d=>{
 const p=backendPlan(sample(),dates[2]),root=d.createElement('div'),seen=[];renderPlanMap(root,p,'housing',{onSelect:f=>seen.push(f.id)});const svg=root.querySelector('svg');assert.equal(svg.getAttribute('role'),'group');assert.match(svg.getAttribute('aria-label'),/2026-10-01/);const marker=root.querySelectorAll('[data-plan-feature]')[0];assert.match(marker.getAttribute('aria-label'),/20 resident places/);let prevented=false;marker.dispatch('keydown',{key:'Enter',preventDefault(){prevented=true;}});marker.dispatch('click');assert.equal(prevented,true);assert.deepEqual(seen,['R1','R1']);
}));
test('missing and zero marks look different; no missing value is plotted as a zero count',()=>dom(d=>{
 const raw=sample();raw.monthlyBuildingTotals[2].buildings[0].actualResidents=null;const p=backendPlan(raw,dates[2]),root=d.createElement('div');renderPlanMap(root,p,'residents');const f=root.querySelectorAll('[data-plan-feature]')[0];assert.match(f.textContent,/Not supplied/);assert.equal(f.querySelector('circle').getAttribute('stroke-dasharray'),'2 2');renderPlanMap(root,backendPlan(sample(),dates[1]),'residents');assert.equal(root.querySelectorAll('[data-plan-feature]')[0].querySelector('circle').getAttribute('r'),'2');
}));
test('plan renderer uses literal text for returned IDs and never inserts executable HTML',()=>dom(d=>{
 const raw=sample();for(const state of raw.monthlyStates)for(const b of state.buildings)if(b.id==='R1')b.id='<img src=x onerror=alert(1)>';for(const totals of raw.monthlyBuildingTotals)for(const b of totals.buildings)if(b.id==='R1')b.id='<img src=x onerror=alert(1)>';const root=d.createElement('div');renderPlanMap(root,backendPlan(raw,dates[2]),'construction');assert.match(root.textContent,/<img src=x/);assert.equal(root.querySelector('img'),null);
}));
test('opening the left 2D analysis displays compact topic buttons and keeps map selection independent of calculations',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const o=owner(),before=JSON.stringify(o.backend.current.raw),ui=new PlanAnalysis(o);ui.update();ui.toggle();assert.equal(ui.open,true);assert.equal(o.evidenceClosed,true);assert.equal($('plan-analysis-toggle').getAttribute('aria-expanded'),'true');assert.equal($('plan-analysis-layers').children.length,5);assert.equal($('plan-analysis-layers').querySelectorAll('.plan-map').length,0);assert.ok($('plan-analysis-layers').children.every(b=>typeof b.title==='string'&&b.title.includes(' · ')));assert.equal($('plan-analysis-title').textContent,'2D analysis');assert.match($('plan-analysis-context').textContent,/SAVED CITY/);ui.selectLayer('housing');const marker=$('plan-analysis-map').querySelectorAll('[data-plan-feature]')[0];marker.dispatch('click');assert.match($('plan-analysis-selection').textContent,/0 resident places/);assert.equal(JSON.stringify(o.backend.current.raw),before);
}));
test('switching saved month preserves selected plan theme and updates values, date and prior comparison',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const o=owner(),ui=new PlanAnalysis(o);ui.update();ui.toggle();ui.selectLayer('housing');o.backend.date=dates[2];ui.update();assert.equal($('plan-analysis-date').textContent,dates[2]);assert.match($('plan-analysis-map-title').textContent,/Housing capacity/);assert.match($('plan-analysis-comparison').textContent,/2026-09-01/);assert.match($('plan-analysis-map').textContent,/20 resident places/);assert.equal($('plan-analysis-layers').children.find(b=>b.dataset.layer==='housing').getAttribute('aria-pressed'),'true');
}));
test('returning to the input workspace hides and closes the result-only plan drawer',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const ui=new PlanAnalysis(owner());ui.update();ui.toggle();d.body.dataset.workspace='analysis';ui.update();assert.equal(ui.open,false);assert.equal($('plan-analysis-tools').classList.contains('hidden'),true);assert.equal($('plan-analysis-panel').classList.contains('hidden'),true);assert.equal(d.body.classList.contains('plan-analysis-open'),false);
}));
test('unsupported API results clear the previous map and never borrow another source spatial data',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const o=owner(),ui=new PlanAnalysis(o);ui.update();ui.toggle();o.backendReplay=false;o.engine='fixture';ui.update();assert.equal(ui.packet,null);assert.equal($('plan-analysis-map').querySelector('svg'),null);assert.equal($('plan-analysis-map-title').textContent,'');assert.match($('plan-analysis-map').textContent,/no supported spatial plan/);assert.equal($('plan-analysis-layers').children.length,0);
}));
test('malformed saved geometry shows an explicit unavailable message instead of a stale plan',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const o=owner(),ui=new PlanAnalysis(o);ui.update();o.backend.date='not-a-saved-date';ui.update();assert.match($('plan-analysis-map').textContent,/Plan view unavailable/);assert.equal($('plan-analysis-map').querySelector('svg'),null);
}));
test('Change symbols opens the same left panel and its library; closing restores focus',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const ui=new PlanAnalysis(owner());ui.update();ui.showSymbols();assert.equal(ui.open,true);assert.equal($('plan-symbol-details').open,true);assert.equal($('plan-symbol-library').children.length,8);assert.equal($('plan-symbol-details').scrolled,true);ui.close(true);assert.equal($('plan-analysis-toggle').focused,true);
}));
test('unchanged packets retain DOM and the symbol-library expanded state without rebuilding',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const ui=new PlanAnalysis(owner());ui.update();const svg=$('plan-analysis-map').children[0];$('plan-symbol-details').open=true;ui.update();assert.equal($('plan-analysis-map').children[0],svg);assert.equal($('plan-symbol-details').open,true);
}));
test('dashboard refresh and direct saved-month display both propagate to the plan view',()=>dom((d)=>{
 d.body.dataset.workspace='analysis';let calls=0;const o={engine:'rules',busy:false,plan:{update(){calls++;}}},dashboard=new AnalysisDashboard(o);dashboard.update();assert.equal(calls,1);dashboard.signature='["same","date",[],[]]';dashboard.show({key:'same',date:'date',metrics:[],charts:[]});assert.equal(calls,2);
}));

test('Space within the plan panel stays local and does not trigger the city playback shortcut',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const ui=new PlanAnalysis(owner());ui.update();let stopped=false;$('plan-analysis-panel').dispatch('keydown',{key:' ',code:'Space',stopPropagation(){stopped=true;}});assert.equal(stopped,true);
}));
test('busy analysis prevents opening either plan or symbol controls',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const o=owner(),ui=new PlanAnalysis(o);o.busy=true;ui.update();ui.toggle();ui.showSymbols();assert.equal(ui.open,false);assert.equal($('plan-analysis-toggle').disabled,true);assert.equal($('plan-analysis-symbol-toggle').disabled,true);
}));
test('switching result sources keeps each theme choice separate and never carries backend units into a school map',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const o=owner(),ui=new PlanAnalysis(o);ui.update();ui.selectLayer('jobs');const {p,study}=topic('hung-shui-kiu-school');Object.assign(o,{engine:'rules',backendReplay:false,localTopic:true,currentPolicy:p,topics:{hasResult:true,study,record:{month:study.months.length-1}}});ui.update();assert.match($('plan-analysis-map-title').textContent,/school places/);assert.equal($('plan-analysis-layers').children.length,2);ui.selectLayer('gap');o.backendReplay=true;ui.update();assert.match($('plan-analysis-map-title').textContent,/Filled jobs/);
}));
test('Escape closes the plan panel and restores the entry control focus',()=>dom((d,$)=>{
 d.body.dataset.workspace='history';const ui=new PlanAnalysis(owner());ui.update();ui.toggle();for(const f of d.handlers.keydown)f({key:'Escape'});assert.equal(ui.open,false);assert.equal($('plan-analysis-toggle').focused,true);
}));
