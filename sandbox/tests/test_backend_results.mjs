import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeBackendExport,buildBackendCharts,buildBackendInterpretation,renderBackendResults} from '../web/backend-results.js';
import {backendDashboard} from '../web/analysis-dashboard-model.js';

const backend=fileURLToPath(new URL('../../',import.meta.url));
const python=process.env.PYTHON??'python3';
// Real backend service, isolated temporary storage, OfflineProvider only. No HTTP or live provider is used.
const generated=spawnSync(python,['-B','-c',String.raw`
import json,tempfile,time
from backend.service import NarrativeService
from backend.scenario import northern_metropolis_scenario
scenario={'groupSize':10,'groupWorkers':6,'towerGroupSlots':2,'grid':{'width':3,'height':3},'scale':northern_metropolis_scenario()['scale'],'buildings':[{'id':'R1','type':'residential','x':0,'y':0,'startMonth':1,'completionMonth':2},{'id':'B1','type':'business','x':1,'y':0,'startMonth':1,'completionMonth':1},{'id':'S1','type':'station','x':2,'y':0,'startMonth':3,'completionMonth':3}]}
with tempfile.TemporaryDirectory() as directory:
 service=NarrativeService(directory,scenario=scenario,today='2026-10-16')
 try:
  setup={'bounds':{'west':114,'south':22.4,'east':114.2,'north':22.6},'start':'2026-07-01','end':'2026-09-01','step':'quarter','policyScope':{'policyId':'context-only-policy','tags':['housing-affordability']}}
  review=service.initialize(setup,b'%PDF-1.4\nOffline fixture','fixture.pdf','init')
  service.confirm(review['initializationId'],{'reviewVersion':review['reviewVersion']},'confirm')
  job=service.simulate({'initializationId':review['initializationId'],'reviewVersion':review['reviewVersion']},'simulate')
  deadline=time.monotonic()+10
  while job['status'] in ('queued','running') and time.monotonic()<deadline:
   time.sleep(.005);job=service.job(job['jobId'])
  if job['status']!='complete':raise RuntimeError(str(job))
  print(json.dumps(service.export(job['result']['simulationId']),ensure_ascii=False,allow_nan=False))
 finally:service.close()
`],{cwd:backend,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
assert.equal(generated.status,0,generated.stderr);const fixture=JSON.parse(generated.stdout),clone=()=>structuredClone(fixture);
const date0='2026-07-01',date1='2026-08-01',date2='2026-09-01';

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes={};this.dataset={};this.handlers={};this.className='';this.style={};this.value='';this.open=false;this._text='';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set innerHTML(_){throw new Error('Returned text cannot become HTML.');}
 append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}prepend(...nodes){for(const n of nodes)n.parentNode=this;this.children=[...nodes,...this.children];}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 get firstChild(){return this.children[0]??null;}setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=String(v);}getAttribute(k){return this.attributes[k]??null;}
 addEventListener(k,f){(this.handlers[k]??=[]).push(f);}dispatch(k){for(const f of this.handlers[k]??[])f({target:this});}
 matches(s){if(s.startsWith('.'))return this.className.split(/\s+/).includes(s.slice(1));if(s.startsWith('['))return this.getAttribute(s.slice(1,-1))!==null;return this.tagName===s.toUpperCase();}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}querySelector(s){return this.querySelectorAll(s)[0]??null;}
}
function dom(task){const before=globalThis.document;globalThis.document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};try{return task(new Element('div'));}finally{globalThis.document=before;}}
const section=(brief,id)=>brief.sections.find(s=>s.id===id).items.join(' ');
const plot=(root,id)=>root.querySelectorAll('article').find(e=>e.dataset.chartId===id).querySelectorAll('svg').find(e=>e.className==='policy-data-chart');

test('actual service.export canonical shape keeps intermediate monthly states despite sparse quarter snapshots',()=>{
 assert.equal(fixture.run.snapshots.length,1);const normalized=normalizeBackendExport(fixture);assert.deepEqual(normalized.dates,[date0,date1,date2]);assert.equal(normalized.byDate.get(date1).sourceDate,date1);assert.equal(normalized.schema,'nm-canonical-backend-results-v1');assert.equal(normalizeBackendExport(normalized),normalized);
});

test('scale is development clusters and housing capacity is resident places, never reference targets or dwelling units',()=>{
 const n=normalizeBackendExport(fixture),day=n.byDate.get(date1);assert.equal(n.objectUnit,'development_cluster');assert.equal(n.objectLabel,'development clusters');assert.equal(n.scale.referenceHousingCapacity,2500000);assert.equal(day.totals.housingCapacity,20);assert.equal(day.totals.actualResidents,20);assert.equal(n.byDate.get(date0).totals.housingCapacity,0);assert.equal(n.byDate.get(date0).totals.plannedHousingCapacity,20);
 const charts=buildBackendCharts(n,date1);assert.match(charts.cards[0].unit,/resident places/);assert.match(charts.cards[0].description,/not a dwelling unit/);assert.match(buildBackendInterpretation(n,date1).summary,/20 available resident places/);
});

test('offered, filled and vacant jobs remain distinct from residents and complete object count',()=>{
 const day=normalizeBackendExport(fixture).byDate.get(date1);assert.equal(day.totals.offeredJobs,50);assert.equal(day.totals.filledJobs,12);assert.equal(day.totals.vacancies,38);
 const jobs=buildBackendCharts(fixture,date1).cards.find(c=>c.id==='backend-jobs');assert.deepEqual(jobs.series.map(s=>s.id),['offered','filled','vacancies']);assert.equal(jobs.series[0].values[1],50);assert.equal(jobs.series[1].values[1],12);assert.equal(jobs.series[2].values[1],38);
});

test('totals join by persistent id and date even when records and display names are rearranged',()=>{
 const data=clone();data.monthlyStates.reverse();data.monthlyBuildingTotals.reverse();for(const month of data.monthlyBuildingTotals){month.buildings.reverse();for(const row of month.buildings)row.name='Zone renamed to R999';}
 const n=normalizeBackendExport(data);assert.equal(n.objectsByDate.get(date1).get('R1').actualResidents,20);assert.equal(n.objectsByDate.get(date1).get('B1').offeredJobs,50);assert.equal(n.objectsByDate.get(date0).get('R1').housingCapacity,0);
});

test('duplicate dates, duplicate ids, missing identities and conflicting canonical coordinates are rejected',()=>{
 const edits=[d=>d.monthlyStates.push(d.monthlyStates[0]),d=>d.monthlyBuildingTotals[0].buildings.push(d.monthlyBuildingTotals[0].buildings[0]),d=>d.monthlyBuildingTotals[0].buildings.pop(),d=>d.monthlyBuildingTotals[0].buildings[0].x+=1,d=>d.monthlyBuildingTotals[0].date='2020-01-01',d=>d.run.snapshots.push(d.run.snapshots[0])];
 for(const edit of edits){const data=clone();edit(data);assert.throws(()=>normalizeBackendExport(data));}
});

test('persistent object type or location cannot silently change between months',()=>{
 const data=clone();const b=data.monthlyStates[1].buildings.find(b=>b.id==='R1'),t=data.monthlyBuildingTotals[1].buildings.find(b=>b.id==='R1');b.x=2;t.x=2;assert.throws(()=>normalizeBackendExport(data),/changed identity/);
});

test('missing numeric fields remain null in totals and trend series instead of becoming zero',()=>{
 const data=clone();delete data.monthlyBuildingTotals[1].buildings.find(b=>b.id==='B1').filledJobs;delete data.monthlyStates[1].metrics.population;
 const n=normalizeBackendExport(data);assert.equal(n.byDate.get(date1).totals.filledJobs,null);assert.equal(n.byDate.get(date1).metrics.population,null);assert.equal(buildBackendCharts(n,date1).cards.find(c=>c.id==='backend-jobs').series[1].values[1],null);
 assert.match(buildBackendInterpretation(n,date1).summary,/Not provided filled/);
});

test('invalid counts and contradictory job or residence arithmetic are rejected',()=>{
 for(const [field,value] of [['housingCapacity',-1],['filledJobs',NaN],['vacancies',1],['actualResidents',100]]){const data=clone(),entry=data.monthlyBuildingTotals[1].buildings.find(b=>b.id==='R1');entry[field]=value;assert.throws(()=>normalizeBackendExport(data));}
});

test('construction stages use saved monthly status rather than metrics or future completion',()=>{
 const n=normalizeBackendExport(fixture);assert.deepEqual(n.byDate.get(date0).stages,{planned:1,construction:1,complete:1});assert.deepEqual(n.byDate.get(date2).stages,{planned:0,construction:0,complete:3});
 const charts=buildBackendCharts(n,date0),stages=charts.cards.find(c=>c.id==='backend-construction');assert.equal(stages.unit,'development clusters');assert.deepEqual(stages.series.map(s=>s.values[0]),[1,1,1]);assert.match(buildBackendInterpretation(n,date0).sections.find(s=>s.id==='mechanism').items[0],/1 planned, 1 under construction and 1 complete/);
});

test('synthetic satisfaction preserves null and valid zero; unsupported climate, power and transport are unavailable',()=>{
 const data=clone();data.monthlyStates[1].metrics.meanSatisfaction=0;const charts=buildBackendCharts(data,date1),satisfaction=charts.cards.find(c=>c.id==='backend-satisfaction');assert.equal(satisfaction.series[0].values[0],null);assert.equal(satisfaction.series[0].values[1],0);assert.equal(satisfaction.unit,'synthetic index (0–100)');assert.match(charts.unavailable[0].reason,/not displayed as zero/);
 for(const state of data.monthlyStates)delete state.metrics.meanSatisfaction;assert.ok(!buildBackendCharts(data,date1).cards.some(c=>c.id==='backend-satisfaction'));
});

test('current-month interpretation does not use future completion counts or imply real policy causation',()=>{
 const brief=buildBackendInterpretation(fixture,date0);assert.match(brief.summary,/0 available resident places/);assert.match(section(brief,'scope'),/request context/);assert.match(section(brief,'comparison'),/No matched no-policy/);assert.match(brief.basis,/not measured/);
});

test('provider success is reported separately from job completion and unavailable tokens never become measured zero',()=>{
 const data=clone();Object.assign(data.run.providerMetrics.summary,{successfulCalls:3,callCount:5,attemptCount:7,statuses:{ok:3,error:4},usageAvailable:false});
 const limits=section(buildBackendInterpretation(data,date1),'limits');assert.match(limits,/Calls 5, attempts 7, successful calls 3/);assert.match(limits,/error 4/);assert.match(limits,/does not mean every provider attempt succeeded/);assert.match(limits,/Token usage is unavailable/);assert.match(limits,/deterministic_fixture_not_ai/);
});

test('renderer chooses requested persistent id, shows canonical quantities and emits id/date callbacks',()=>dom(holder=>{
 const dates=[],objects=[];renderBackendResults(holder,fixture,date1,{selectedObjectId:'B1',onDate:d=>dates.push(d),onObject:(id,item,date)=>objects.push({id,item,date})});
 const root=holder.firstChild,select=root.querySelector('[data-backend-object]');assert.equal(select.value,'B1');assert.match(root.querySelector('.policy-record').textContent,/Offered jobs: 50/);assert.match(root.textContent,/resident places are not dwelling units/);
 select.value='R1';select.dispatch('change');assert.equal(objects[0].id,'R1');assert.equal(objects[0].item.housingCapacity,20);assert.equal(objects[0].date,date1);assert.match(root.querySelector('.policy-record').textContent,/Actual residents: 20/);
 const dateSelect=root.querySelector('[data-backend-date]');dateSelect.value=date2;dateSelect.dispatch('change');assert.deepEqual(dates,[date2]);assert.equal(root.querySelectorAll('select').some(s=>s.getAttribute('id')!==null),false);
}));

test('unknown selected object id is not silently replaced with a different object',()=>dom(holder=>{
 renderBackendResults(holder,fixture,date1,{selectedObjectId:'missing-R999'});assert.equal(holder.querySelector('[data-backend-object]').value,'');assert.match(holder.querySelector('.policy-record').textContent,/No object with this persistent id/);
}));

test('render accepts normalized export and rerenders real date when no external callback is provided',()=>dom(holder=>{
 const n=normalizeBackendExport(fixture);renderBackendResults(holder,n,date0,{selectedObjectId:'R1'});const max=plot(holder,'backend-residents-capacity').getAttribute('data-y-max');
 const select=holder.querySelector('[data-backend-date]');select.value=date1;select.dispatch('change');assert.equal(holder.firstChild.dataset.backendDate,date1);assert.equal(holder.querySelector('[data-backend-object]').value,'R1');assert.match(holder.querySelector('.policy-record').textContent,/Available resident places: 20/);assert.equal(plot(holder,'backend-residents-capacity').getAttribute('data-y-max'),max);assert.equal(holder.children.length,1);
}));

test('object narratives render as literal text and unavailable object fields remain visibly unavailable',()=>dom(holder=>{
 const data=clone();data.monthlyStates[1].buildings.find(b=>b.id==='R1').narrative='<img src=x onerror=alert(1)>';delete data.monthlyBuildingTotals[1].buildings.find(b=>b.id==='R1').actualResidents;
 renderBackendResults(holder,data,date1,{selectedObjectId:'R1'});const details=holder.querySelector('.policy-record');assert.match(details.textContent,/<img src=x/);assert.equal(details.querySelectorAll('img').length,0);assert.match(details.textContent,/Actual residents: Not provided/);
}));

test('dashboard uses current canonical residents, person capacity, filled jobs and completed objects with explicit units',()=>{
 const p=backendDashboard(fixture,date1);assert.deepEqual(p.metrics.map(m=>[m.id,m.value,m.unit]),[['residents',20,'persons'],['places',20,'resident places'],['jobs',12,'jobs'],['construction',2,'development clusters']]);
 assert.deepEqual(p.metrics.map(m=>m.delta),[20,20,12,1]);assert.match(p.comparison,/not a policy-effect estimate/);assert.match(p.basis,/synthetic/);
});
test('dashboard first month has no invented prior change, and a later missing field stays missing',()=>{
 assert.ok(backendDashboard(fixture,date0).metrics.every(m=>m.delta===null));const data=clone();delete data.monthlyBuildingTotals[1].buildings.find(b=>b.id==='B1').filledJobs;
 assert.equal(backendDashboard(data,date1).metrics.find(m=>m.id==='jobs').value,null);assert.equal(backendDashboard(data,date2).metrics.find(m=>m.id==='jobs').delta,null);assert.throws(()=>backendDashboard(data,'2026-10-01'));
});
test('dashboard construction chart uses every saved month and only moves the current-month marker',()=>{
 const first=backendDashboard(fixture,date0).charts.find(c=>c.id==='backend-construction'),last=backendDashboard(fixture,date2).charts.find(c=>c.id==='backend-construction');
 assert.equal(first.kind,'line');assert.deepEqual(first.labels,[date0,date1,date2]);assert.deepEqual(first.series.map(s=>s.values),[[1,1,0],[1,0,0],[1,2,3]]);assert.deepEqual(first.series,last.series);assert.equal(first.selectedIndex,0);assert.equal(last.selectedIndex,2);
});
test('unsupported source narrative cannot become a dashboard finding or rewrite canonical exports',()=>{
 const data=clone();data.monthlyStates[1].buildings[0].narrative='This policy certainly creates prosperity; confidence 99%.';const before=JSON.stringify(data),p=backendDashboard(data,date1);
 assert.ok(p.evidence.review.reviewed.some(r=>r.text.includes('certainly')&&r.status==='withheld'));assert.ok(p.evidence.review.reviewed.every(r=>r.publishRawText===false));assert.equal(p.evidence.review.independentValidation,false);assert.equal(JSON.stringify(data),before);
});
test('compact evidence removes duplicated totals, charts, dates and raw narrative while keeping selected business details',()=>dom(holder=>{
 const data=clone();data.monthlyStates[1].buildings.find(b=>b.id==='B1').narrative='Unsupported prosperity claim';const packet=backendDashboard(data,date1);
 renderBackendResults(holder,data,date1,{compact:true,evidence:packet.evidence,selectedObjectId:'B1'});
 assert.equal(holder.querySelector('.port-metrics'),null);assert.equal(holder.querySelector('svg')?.className==='policy-data-chart',false);assert.equal(holder.querySelector('[data-backend-date]'),null);assert.doesNotMatch(holder.textContent,/Unsupported prosperity claim/);
 assert.match(holder.textContent,/Mechanism/);assert.match(holder.querySelector('.policy-record').textContent,/Offered jobs: 50/);assert.match(holder.querySelector('.policy-record').textContent,/Filled jobs: 12/);assert.doesNotMatch(holder.querySelector('.policy-record').textContent,/Actual residents/);assert.match(holder.textContent,/Call success is not a measure of policy accuracy/);
}));
test('compact station details do not manufacture housing or jobs indicators',()=>dom(holder=>{
 const packet=backendDashboard(fixture,date2);renderBackendResults(holder,fixture,date2,{compact:true,evidence:packet.evidence,selectedObjectId:'S1'});const text=holder.querySelector('.policy-record').textContent;
 assert.match(text,/station/);assert.match(text,/Scheduled start step/);assert.doesNotMatch(text,/Available resident places|Actual residents|Offered jobs|Filled jobs/);
}));
test('compact selected-object changes remain joined by stable id and selected date',()=>dom(holder=>{
 const seen=[],p=backendDashboard(fixture,date1);renderBackendResults(holder,fixture,date1,{compact:true,evidence:p.evidence,onObject:(id,item,date)=>seen.push([id,item.housingCapacity,date])});const s=holder.querySelector('[data-backend-object]');s.value='R1';s.dispatch('change');assert.deepEqual(seen,[['R1',20,date1]]);assert.match(holder.querySelector('.policy-record').textContent,/Actual residents: 20/);
}));
