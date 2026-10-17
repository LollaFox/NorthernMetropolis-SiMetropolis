import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getPolicy} from '../web/policy-catalog.js';
import {emptyTopicLedger,applyTopicRevision,buildTopicStudy} from '../web/topic-model.js';
import {DEFAULTS} from '../web/port-model.js';
import {emptyLedger,applyRevision,buildPolicyStudy} from '../web/policy-ledger.js';
import {topicDashboard,portDashboard,apiDashboard} from '../web/analysis-dashboard-model.js';
import {reviewClaims,renderEvidenceBrief} from '../web/evidence-gate.js';
import {AnalysisDashboard} from '../web/analysis-dashboard.js';
import {renderDashboardChart} from '../web/dashboard-chart.js';
import {seriesStyle} from '../web/policy-charts.js';
import {CompactAnalysisUI} from '../web/analysis-compact.js';
const stamp='2026-10-16T08:00:00Z';
function topic(id){const policy=getPolicy(id),ledger=applyTopicRevision(emptyTopicLedger(id),policy.defaults,policy.defaults.start,'Test scenario',stamp);return {policy,ledger,study:buildTopicStudy(ledger)};}
const metric=(p,id)=>p.metrics.find(m=>m.id===id);
const port=()=>buildPolicyStudy(applyRevision(emptyLedger(),{...DEFAULTS,capacity:20500},0,'Test scenario',stamp));

test('housing headline metrics follow the actual commissioning month and household/unit distinction',()=>{
 const t=topic('kwu-tung-housing'),before=topicDashboard({...t,monthIndex:0}),p=topicDashboard({...t,monthIndex:6});assert.equal(p.date,'2027-02-01');assert.equal(metric(p,'demand').value,12240);assert.equal(metric(p,'demand').unit,'households');assert.equal(metric(p,'supply').value,11400);assert.equal(metric(p,'supply').unit,'housing units');assert.equal(metric(p,'gap').value,840);assert.equal(metric(p,'delivered').value,400);assert.equal(metric(before,'delivered').value,0);assert.equal(metric(before,'supply').delta,null);assert.match(p.basis,/Hypothetical/);
});
test('school headlines show pupils and places, and a zero gap remains a genuine zero',()=>{
 const p=topicDashboard({...topic('hung-shui-kiu-school'),monthIndex:13});assert.equal(metric(p,'demand').value,3730);assert.equal(metric(p,'demand').unit,'pupils');assert.equal(metric(p,'supply').value,3900);assert.equal(metric(p,'supply').unit,'school places');assert.equal(metric(p,'gap').value,0);assert.equal(metric(p,'delivered').value,900);
});
test('later housing adjustments do not rewrite earlier headline values or their evidence revision',()=>{
 const t=topic('kwu-tung-housing'),before=topicDashboard({...t,monthIndex:6}),ledger=applyTopicRevision(t.ledger,{...t.policy.defaults,added:9000,commission:'2027-06-01'},'2027-05-01','Future adjustment',stamp),after=topicDashboard({...t,study:buildTopicStudy(ledger),monthIndex:6});assert.deepEqual(before.metrics,after.metrics);assert.deepEqual(before.evidence,after.evidence);assert.throws(()=>topicDashboard({...t,monthIndex:99}));
});
test('passenger dashboard keeps selected-purpose trips separate from shared unserved additions',()=>{
 const study=port(),p=portDashboard({study,monthIndex:1,cohortId:'commuters'}),g=study.months[1].groups.find(g=>g.id==='commuters');assert.equal(p.date,'2026-09-01');assert.equal(metric(p,'baseline').value,g.baseline);assert.equal(metric(p,'trips').value,g.policy);assert.equal(metric(p,'trips').delta,g.policy-study.months[0].groups.find(g=>g.id==='commuters').policy);assert.equal(metric(p,'unserved').value,study.months[1].unserved);assert.match(metric(p,'unserved').label,/all passengers/);assert.ok(p.metrics.every(m=>m.unit==='trips/day'));assert.match(p.evidence.limits,/not unique people, net migration/);assert.throws(()=>portDashboard({study,monthIndex:0,cohortId:'unknown'}));
});
test('snapshot-only results never sum unresolved zone overlaps or invent policy-created jobs',()=>{
 const frame={date:'2026-09-01',provenance:'synthetic-contract-fixture',zones:[{name:'A',population:100,jobs:[{count:10}]},{name:'Overlap',population:100,jobs:[]}]},before=JSON.stringify(frame),p=apiDashboard({frame,setup:{}});assert.equal(metric(p,'zones').value,2);assert.equal(metric(p,'population').value,null);assert.equal(metric(p,'jobs').value,null);assert.ok(p.metrics.every(m=>m.delta===null));assert.match(p.basis,/Synthetic/);assert.equal(JSON.stringify(frame),before);
});

const facts=[{field:'actualResidents',value:20,objectId:'R1',date:'2026-08-01'}],context={facts,date:'2026-08-01',objectIds:['R1']};
test('presentation review excludes empty, duplicate, other-month and out-of-scope content',()=>{
 const r=reviewClaims(['','Repeated claim.','REPEATED CLAIM!',{text:'Past month',date:'2026-07-01'},{text:'Wrong object',objectId:'R2'}],context);assert.deepEqual(r.reviewed.map(c=>c.status),['excluded','withheld','excluded','excluded','excluded']);assert.match(r.reviewed[3].reason,/Different result month/);assert.match(r.reviewed[4].reason,/outside/);
});
test('confidence and self-provided citations do not establish real policy causality',()=>{
 const r=reviewClaims([{text:'Definitely improves real livelihoods',kind:'causal',confidence:1,citations:['Official-looking source']},{text:'A measured real-world benefit',kind:'real_world_effect'},{text:'A free-form prosperity claim'}],context);assert.deepEqual(r.reviewed.map(c=>c.status),['unsupported','unsupported','withheld']);assert.equal(r.independentValidation,false);assert.ok(r.reviewed.every(c=>!c.publishRawText));
});
test('matching numeric facts do not approve smuggled causal prose, while mismatches and missing fields are identified',()=>{
 const base={text:'20 residents, therefore this policy guarantees prosperity',kind:'state',field:'actualResidents',objectId:'R1',date:context.date,value:20},r=reviewClaims([base,{...base,text:'Wrong quantity',value:21},{...base,text:'Missing field',field:'income'},{...base,text:'Non-finite',value:NaN}],context);assert.deepEqual(r.reviewed.map(c=>c.status),['model_record','excluded','unsupported','excluded']);assert.ok(r.reviewed.every(c=>c.publishRawText===false));assert.equal(r.withheld,4);
});
test('assumptions remain assumptions and content review leaves its input untouched',()=>{
 const input=[{text:'Assume 70% reach',kind:'assumption'}],before=JSON.stringify(input),r=reviewClaims(input,context);assert.equal(r.reviewed[0].status,'assumption');assert.equal(JSON.stringify(input),before);
});

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.handlers={};this.style={setProperty:(k,v)=>{this.style[k]=v;}};this.className='';this._text='';this.value='';this.clientWidth=560;this.open=false;}
 get classList(){return{contains:n=>this.className.split(/\s+/).includes(n),add:n=>{if(!this.classList.contains(n))this.className+=' '+n;},remove:n=>{this.className=this.className.split(/\s+/).filter(c=>c!==n).join(' ');},toggle:(n,on)=>{const v=on??!this.classList.contains(n);this.classList[v?'add':'remove'](n);return v;}};}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set innerHTML(_){throw new Error('No HTML execution');}
 append(...n){this.children.push(...n);}replaceChildren(...n){this._text='';this.children=[...n];}get firstChild(){return this.children[0]??null;}
 setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=String(v);}getAttribute(k){return this.attributes[k]??null;}
 addEventListener(k,f){(this.handlers[k]??=[]).push(f);}dispatch(k){for(const f of this.handlers[k]??[])f({target:this});}
 matches(s){if(s.startsWith('.'))return this.classList.contains(s.slice(1));if(s.startsWith('[')){const m=s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return m&&this.getAttribute(m[1])!==null&&(m[2]===undefined||this.getAttribute(m[1])===m[2]);}return this.tagName===s.toUpperCase();}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}querySelector(s){return this.querySelectorAll(s)[0]??null;}
}
function dom(task){const previous=globalThis.document,nodes=new Map(),doc={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),getElementById:id=>nodes.get(id)};doc.body=new Element('body');for(const match of readFileSync(new URL('../web/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g))nodes.set(match[1],new Element('div'));globalThis.document=doc;try{return task(doc,id=>nodes.get(id));}finally{globalThis.document=previous;}}
const plotCard=(patch={})=>({id:'test',title:'Actual supplied series',unit:'persons',description:'Explicit test series',kind:'line',labels:['2026-08-01','2026-09-01','2026-10-01'],selectedIndex:0,series:[{id:'a',label:'First',role:'context',values:[-10,null,20]},{id:'b',label:'Second',role:'context',values:[0,5,10]}],...patch});
test('compact line chart retains negative scale, null gaps and month marker without connecting missing values',()=>dom(doc=>{
 const root=new Element('div'),c=plotCard(),svg=renderDashboardChart(root,c);assert.equal(svg.getAttribute('data-y-min'),'-10');assert.equal(svg.getAttribute('data-y-max'),'20');assert.equal(svg.querySelector('[data-selected-index]').getAttribute('data-selected-index'),'0');const path=svg.querySelector('[data-series="a"]');assert.equal((path.getAttribute('d').match(/M/g)??[]).length,2);assert.ok(!path.getAttribute('d').includes('NaN'));assert.equal(svg.querySelector('[data-series="b"]').getAttribute('stroke-dasharray'),seriesStyle(c,c.series[1]).dash);
}));
test('compact zero bars have zero width and missing bars are explicit instead of positive symbols',()=>dom(doc=>{
 const root=new Element('div'),c=plotCard({kind:'bar',labels:['Zero','Missing','Negative'],selectedIndex:undefined,series:[{id:'a',label:'Count',role:'context',values:[0,null,-10]}]}),svg=renderDashboardChart(root,c),bars=svg.querySelectorAll('rect');assert.equal(bars.length,2);assert.equal(bars[0].getAttribute('width'),'0');assert.ok(Number(bars[1].getAttribute('width'))>0);assert.match(svg.textContent,/Not provided/);
}));
test('evidence brief renders a compact template, hides source wording and keeps review details collapsed',()=>dom(doc=>{
 const root=new Element('div'),review=reviewClaims([{text:'<img src=x> Unsupported prosperity'}],context);renderEvidenceBrief(root,{status:'MODEL ONLY',title:'Evidence',mechanism:'Numeric settlement',supports:'Saved fields',limits:'No causal validation',assumptions:['Explicit assumption'],review});assert.match(root.textContent,/MechanismWhat this supports|Numeric settlement/);assert.match(root.textContent,/1 narrative item/);assert.doesNotMatch(root.textContent,/Unsupported prosperity|<img/);assert.equal(root.querySelector('details').open,false);assert.match(root.textContent,/does not independently verify/);
}));
function owner(){const t=topic('kwu-tung-housing');return{engine:'rules',busy:false,backendReplay:false,apiResults:false,localTopic:true,currentPolicy:t.policy,topics:{hasResult:true,study:t.study,record:{month:0}},port:{ledger:{revisions:[{}]},study:port(),month:0}};}
test('dashboard switches between input and results without fabricating a result for a draft',()=>dom((doc,$)=>{
 const o=owner(),d=new AnalysisDashboard(o);doc.body.dataset.workspace='analysis';d.update();assert.equal($('analysis-dashboard').classList.contains('hidden'),true);doc.body.dataset.workspace='history';o.topics.hasResult=false;d.update();assert.equal($('analysis-dashboard').classList.contains('hidden'),true);o.topics.hasResult=true;d.update();assert.equal($('analysis-dashboard').classList.contains('hidden'),false);assert.equal($('dashboard-metrics').children.length,4);doc.body.dataset.workspace='analysis';d.update();assert.equal(doc.body.classList.contains('analysis-dashboard-active'),false);
}));
test('month navigation changes headline quantities, chart marker and evidence but preserves the full-period scale and selected chart',()=>dom((doc,$)=>{
 const o=owner(),d=new AnalysisDashboard(o);doc.body.dataset.workspace='history';d.update();const axis=$('dashboard-chart').firstChild.getAttribute('data-y-max');assert.equal($('dashboard-date').textContent,'2026-08-01');assert.equal($('dashboard-metrics').children.find(c=>c.dataset.metric==='delivered').querySelector('strong').textContent,'0');$('dashboard-chart-select').value='topic-unmet-demand';$('dashboard-chart-select').dispatch('change');o.topics.record.month=6;d.update();assert.equal($('dashboard-date').textContent,'2027-02-01');assert.equal($('dashboard-metrics').children.find(c=>c.dataset.metric==='delivered').querySelector('strong').textContent,'400');assert.equal($('dashboard-chart-select').value,'topic-unmet-demand');assert.equal($('dashboard-chart').firstChild.querySelector('[data-selected-index]').getAttribute('data-selected-index'),'6');$('dashboard-chart-select').value='topic-supply-demand';$('dashboard-chart-select').dispatch('change');assert.equal($('dashboard-chart').firstChild.getAttribute('data-y-max'),axis);assert.match($('analysis-evidence').textContent,/Effective revision/);
}));
test('missing dashboard headline remains an em dash while data table retains every observation and exact value',()=>dom((doc,$)=>{
 const d=new AnalysisDashboard(owner()),packet=apiDashboard({frame:{date:'2026-09-01',zones:Array.from({length:12},(_,i)=>({name:'Zone '+i,population:i===2?null:i,jobs:[]}))},setup:{}});d.show(packet);const population=$('dashboard-metrics').children.find(c=>c.dataset.metric==='population');assert.equal(population.querySelector('strong').textContent,'—');assert.equal($('dashboard-chart-table').querySelector('tbody').children.length,12);assert.match($('dashboard-chart-table').textContent,/Not provided/);assert.match($('dashboard-chart-preview').textContent,/5 of 12/);assert.match($('dashboard-chart-table').textContent,/Zone 11/);
}));
test('busy state drives presentation hints and never mutates model months or claimed output',()=>dom((doc,$)=>{
 const o=owner(),before=JSON.stringify(o.topics.study),d=new AnalysisDashboard(o);doc.body.dataset.workspace='history';o.busy=true;d.update();assert.equal(doc.body.dataset.analysisBusy,'true');assert.equal(JSON.stringify(o.topics.study),before);assert.match($('dashboard-basis').textContent,/Hypothetical/);
}));
test('dock resize reserves measured clearance for evidence without changing any model values',()=>dom((doc,$)=>{
 const before=globalThis.ResizeObserver,previousWindow=globalThis.window,observers=[];globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}};globalThis.window={innerHeight:800};doc.documentElement=new Element('html');$('port-deck').getBoundingClientRect=()=>({height:286,top:480});try{const o=owner(),saved=JSON.stringify(o.topics.study);new AnalysisDashboard(o);CompactAnalysisUI.prototype.observeLayout.call(o);const docks=observers.filter(v=>v.target===$('port-deck'));assert.equal(docks.length,1);docks[0].callback();assert.equal(doc.documentElement.style['--analysis-panel-bottom'],'332px');assert.equal(JSON.stringify(o.topics.study),saved);}finally{globalThis.ResizeObserver=before;globalThis.window=previousWindow;}
}));
