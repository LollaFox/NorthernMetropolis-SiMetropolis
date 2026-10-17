import test from 'node:test';
import assert from 'node:assert/strict';
import {getPolicy} from '../web/policy-catalog.js';
import {emptyTopicLedger,applyTopicRevision,buildTopicStudy} from '../web/topic-model.js';
import {DEFAULTS} from '../web/port-model.js';
import {emptyLedger,applyRevision,buildPolicyStudy} from '../web/policy-ledger.js';
import {buildTopicCharts,buildPortCharts,buildApiCharts,buildMigrationCharts,buildConstructionCharts} from '../web/policy-chart-model.js';

const STAMP='2026-10-15T10:00:00Z',clone=value=>JSON.parse(JSON.stringify(value));
const card=(packet,id)=>{const c=packet.cards.find(c=>c.id===id);assert.ok(c,`Card ${id} missing`);return c;};
const values=(c,id)=>{const s=c.series.find(s=>s.id===id);assert.ok(s,`Series ${id} missing`);return s.values;};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const topic=(id,patch={})=>{const policy=getPolicy(id),v={...policy.defaults,...patch},ledger=applyTopicRevision(emptyTopicLedger(id),v,v.start,'Explicit chart test',STAMP);return {policy,ledger,study:buildTopicStudy(ledger)};};
const port=(patch={},effective=0)=>buildPolicyStudy(applyRevision(emptyLedger(),{...DEFAULTS,...patch},effective,'Explicit chart test',STAMP));
const migration=()=>({schema:'nm-residential-migration-v1',status:'available',areaId:'kwu-tung-north',unit:'persons',period:'month',source:'Explicit test records',records:[{date:'2026-08-01',status:'observed',inflow:100,outflow:150},{date:'2026-09-01',status:'observed',inflow:0,outflow:0},{date:'2026-10-01',status:'modelled',inflow:20,outflow:null}]});
const construction=()=>({schema:'nm-transport-construction-v1',status:'available',areaId:'san-tin',projectId:'test-road',unit:'km',period:'month',source:'Explicit project test records',records:[{date:'2026-08-01',status:'planned',plannedKm:2.5,completedKm:0},{date:'2026-09-01',status:'under_construction',plannedKm:2.5,completedKm:1.2},{date:'2026-10-01',status:'under_construction',plannedKm:2.5,completedKm:null},{date:'2026-11-01',status:'completed',plannedKm:2.5,completedKm:2.5}]});
function check(packet){
 assert.equal(packet.schema,'nm-policy-charts-v1');assert.equal(typeof packet.title,'string');assert.equal(typeof packet.basis,'string');assert.ok(Array.isArray(packet.unavailable));
 for(const c of packet.cards){assert.ok(['line','bar','stack'].includes(c.kind));assert.ok(['housing','education','population','migration','transport','construction','capacity','jobs'].includes(c.icon));assert.equal(typeof c.unit,'string');assert.equal(typeof c.description,'string');assert.ok(c.labels.every(x=>typeof x==='string'));assert.equal(typeof c.scope,'string');
  for(const s of c.series){assert.ok(['baseline','policy','demand','unmet','context'].includes(s.role));assert.equal(s.values.length,c.labels.length);assert.ok(s.values.every(v=>v===null||(typeof v==='number'&&Number.isFinite(v))));if(c.kind==='stack')assert.ok(s.values.every(v=>v===null||v>=0));}
  if(c.selectedIndex!==undefined)assert.ok(Number.isInteger(c.selectedIndex)&&c.selectedIndex>=0&&c.selectedIndex<c.labels.length);
 }for(const u of packet.unavailable){assert.equal(typeof u.reason,'string');assert.ok(u.requiredFields.length);}
 assert.deepEqual(JSON.parse(JSON.stringify(packet)),packet);
}

test('all five builders share a finite, serializable chart specification',()=>{
 const t=topic('kwu-tung-housing');for(const p of [buildTopicCharts({...t,monthIndex:6}),buildPortCharts({study:port(),monthIndex:0}),buildApiCharts({frame:{date:'2026-08-01'}}),buildMigrationCharts(migration()),buildConstructionCharts(construction())])check(p);
});
test('housing chart reports independent February demand12240, supply11400 and gap840',()=>{
 const p=buildTopicCharts({...topic('kwu-tung-housing'),monthIndex:6}),trend=card(p,'topic-supply-demand'),gap=card(p,'topic-unmet-demand'),delivery=card(p,'topic-commissioning');
 assert.equal(trend.labels[6],'2027-02-01');assert.equal(trend.selectedIndex,6);assert.equal(values(trend,'demand')[6],12240);assert.equal(values(trend,'baseline')[6],11000);assert.equal(values(trend,'policy')[6],11400);assert.equal(values(gap,'baseline-gap')[6],1240);assert.equal(values(gap,'policy-gap')[6],840);assert.deepEqual(values(delivery,'commissioned'),[400]);assert.deepEqual(values(delivery,'remaining'),[1200]);assert.equal(delivery.selectedIndex,undefined);
});
test('education charts keep pupils and school places separate from housing units',()=>{
 const p=buildTopicCharts({...topic('hung-shui-kiu-school'),monthIndex:13}),trend=card(p,'topic-supply-demand'),gap=card(p,'topic-unmet-demand'),delivery=card(p,'topic-commissioning');
 assert.equal(trend.icon,'education');assert.equal(trend.unit,'pupils / school places');assert.equal(values(trend,'demand')[13],3730);assert.equal(values(trend,'policy')[13],3900);assert.equal(values(gap,'baseline-gap')[13],730);assert.equal(values(gap,'policy-gap')[13],0);assert.equal(delivery.unit,'school places');assert.deepEqual(values(delivery,'commissioned'),[900]);assert.doesNotMatch(JSON.stringify(p.cards),/housing units/);
});
test('scheduled topic month has literal zero delivered and actual remaining capacity',()=>{
 const p=buildTopicCharts({...topic('kwu-tung-housing'),monthIndex:0}),delivery=card(p,'topic-commissioning');assert.deepEqual(values(delivery,'commissioned'),[0]);assert.deepEqual(values(delivery,'remaining'),[1600]);assert.match(delivery.description,/scheduled from 2027-02-01/);assert.equal(values(card(p,'topic-supply-demand'),'policy')[0],11000);
});
test('unapplied topic case does not invent a future capacity allocation or positive glyph quantity',()=>{
 const policy=getPolicy('kwu-tung-housing'),study=buildTopicStudy(emptyTopicLedger(policy.id)),p=buildTopicCharts({policy,study,monthIndex:6});
 const delivery=card(p,'topic-commissioning');assert.deepEqual(values(delivery,'commissioned'),[0]);assert.deepEqual(values(delivery,'remaining'),[0]);assert.match(delivery.description,/No policy is effective/);assert.deepEqual(values(card(p,'topic-unmet-demand'),'baseline-gap'),values(card(p,'topic-unmet-demand'),'policy-gap'));
});
test('historical current-month capacity card is unchanged by a future revision',()=>{
 const t=topic('kwu-tung-housing'),before=buildTopicCharts({...t,monthIndex:6}),ledger=applyTopicRevision(t.ledger,{...t.ledger.revisions[0].inputs,added:9000,commission:'2027-06-01'},'2027-05-01','Future revision',STAMP),after=buildTopicCharts({policy:t.policy,study:buildTopicStudy(ledger),monthIndex:6});
 assert.deepEqual(card(after,'topic-commissioning'),card(before,'topic-commissioning'));assert.equal(values(card(after,'topic-supply-demand'),'policy')[6],11400);
 // 1,200 retained before May; by July two of four phases add (9,000 − 1,200) / 2 = 3,900 more.
 assert.equal(values(card(after,'topic-supply-demand'),'policy')[11],16100);assert.equal(card(after,'topic-supply-demand').selectedIndex,6);
});
test('negative monthly demand growth is zero-clamped while chart gaps and additions remain zero',()=>{
 const p=buildTopicCharts({...topic('kwu-tung-housing',{demand:10,supply:0,growth:-10,added:0}),monthIndex:1}),trend=card(p,'topic-supply-demand');
 assert.deepEqual(values(trend,'demand').slice(0,4),[10,0,0,0]);assert.equal(values(card(p,'topic-unmet-demand'),'policy-gap')[1],0);assert.deepEqual(values(card(p,'topic-commissioning'),'commissioned'),[0]);check(p);
});
test('topic chart builders reject mismatched policy or invalid month indices',()=>{
 const t=topic('kwu-tung-housing');for(const monthIndex of [-1,12,.5,undefined])assert.throws(()=>buildTopicCharts({...t,monthIndex}));assert.throws(()=>buildTopicCharts({...t,policy:getPolicy('hung-shui-kiu-school'),monthIndex:0}));
});

test('commuter monthly trend uses independent cohort totals and month marker',()=>{
 const p=buildPortCharts({study:port(),monthIndex:1,cohortId:'commuters'}),trend=card(p,'port-cohort-trend');assert.equal(trend.selectedIndex,1);assert.deepEqual(values(trend,'baseline'),[10000,10000,10000]);near(values(trend,'policy')[0],10620.666666666666);near(values(trend,'policy')[1],11086.166666666666);near(values(trend,'policy')[2],11551.666666666666);assert.equal(trend.unit,'passenger trips/day');assert.equal(trend.scope,'Commuters');
});
test('all-passenger inbound baseline and added trips use different actual direction shares',()=>{
 const p=buildPortCharts({study:port(),monthIndex:0}),direction=card(p,'port-directions');
 assert.deepEqual(direction.labels,['Inbound crossings','Outbound crossings']);near(values(direction,'baseline')[0],10100);near(values(direction,'baseline')[1],9900);near(values(direction,'additional')[0],682.7333333333333);near(values(direction,'additional')[1],656.6);
 assert.ok(Math.abs(values(direction,'additional')[0]-1339.3333333333333*.505)>1,'extra must not reuse baseline inbound share');
});
test('selected visitor direction uses visitor-specific share rather than all-passenger routes',()=>{
 const p=buildPortCharts({study:port(),monthIndex:0,cohortId:'visitors'}),direction=card(p,'port-directions');assert.deepEqual(values(direction,'baseline'),[3600,2400]);near(values(direction,'additional')[0],264.6);near(values(direction,'additional')[1],176.4);assert.equal(direction.scope,'Family and visitors');
});
test('limited all-passenger capacity is shown even when the selected chart cohort is business',()=>{
 const p=buildPortCharts({study:port({capacity:20500}),monthIndex:0,cohortId:'business'}),capacity=card(p,'port-capacity');
 assert.equal(capacity.scope,'All passengers');assert.deepEqual(capacity.labels,['Served total','Requested total','Unserved additions','Effective capacity']);near(values(capacity,'all-passenger-counts')[0],20500);near(values(capacity,'all-passenger-counts')[1],21339.333333333332);near(values(capacity,'all-passenger-counts')[2],839.3333333333333);assert.equal(values(capacity,'all-passenger-counts')[3],20500);
});
test('zero reach and zero feeder headroom preserve exact zero additional directions',()=>{
 for(const patch of [{reach:0},{capacity:20000}]){const p=buildPortCharts({study:port(patch),monthIndex:0}),direction=card(p,'port-directions');assert.deepEqual(values(direction,'additional'),[0,0]);check(p);}
});
test('no applied port policy leaves capacity missing rather than leaking latest/default policy capacity',()=>{
 const p=buildPortCharts({study:buildPolicyStudy(emptyLedger()),monthIndex:0}),capacity=card(p,'port-capacity');assert.deepEqual(values(capacity,'all-passenger-counts'),[20000,20000,0,null]);assert.deepEqual(values(card(p,'port-directions'),'additional'),[0,0]);
});
test('future port capacity revision cannot alter current capacity or direction chart',()=>{
 const ledger=applyRevision(emptyLedger(),DEFAULTS,0,'Initial',STAMP),before=buildPortCharts({study:buildPolicyStudy(ledger),monthIndex:0,cohortId:'visitors'}),next=applyRevision(ledger,{...DEFAULTS,reach:99,capacity:76543},1,'Future',STAMP),after=buildPortCharts({study:buildPolicyStudy(next),monthIndex:0,cohortId:'visitors'});
 assert.deepEqual(card(after,'port-directions'),card(before,'port-directions'));assert.deepEqual(card(after,'port-capacity'),card(before,'port-capacity'));assert.equal(values(card(after,'port-capacity'),'all-passenger-counts')[3],30000);assert.notDeepEqual(card(after,'port-cohort-trend'),card(before,'port-cohort-trend'));
});
test('all-passenger directions can use actual group shares when route allocation is absent',()=>{
 const study=port();study.months[0].routes=[];const p=buildPortCharts({study,monthIndex:0}),direction=card(p,'port-directions');near(values(direction,'additional')[0],682.7333333333333);near(values(direction,'baseline')[0],10100);
});
test('port rejects invalid passenger cohort and missing direction shares',()=>{
 assert.throws(()=>buildPortCharts({study:port(),monthIndex:0,cohortId:'residents'}));assert.throws(()=>buildPortCharts({study:port(),monthIndex:3}));const study=port();delete study.months[0].groups[0].inbound;assert.throws(()=>buildPortCharts({study,monthIndex:0,cohortId:'commuters'}));
});

const api=()=>({date:'2026-09-01',zones:[{name:'Residential',population:12000,jobs:[{type:'Services',count:1800},{type:'Other',count:200}]},{name:'Employment',population:1500,jobs:[{type:'Technology',count:3200}]},{name:'Unknown',population:null,jobs:[]}],roads:[{congestion:[40,null,-99]}],mtr:[{congestion:[0]}],scales:{congestion:'Raw backend index; scale not agreed'}});
test('API returns actual zone population and sums only complete returned job counts',()=>{
 const p=buildApiCharts({frame:api()}),population=card(p,'api-population'),jobs=card(p,'api-jobs');assert.deepEqual(values(population,'population'),[12000,1500,null]);assert.deepEqual(values(jobs,'jobs'),[2000,3200,null]);assert.equal(population.unit,'persons');assert.equal(jobs.unit,'jobs');assert.equal(population.selectedIndex,undefined);assert.match(jobs.description,/not jobs created by policy/);
});
test('API raw congestion preserves negative, zero and missing values and segment identities',()=>{
 const p=buildApiCharts({frame:api()}),congestion=card(p,'api-congestion');assert.deepEqual(values(congestion,'congestion'),[40,null,-99,0]);assert.deepEqual(congestion.labels,['Road 1 · segment 1','Road 1 · segment 2','Road 1 · segment 3','MTR 1 · segment 1']);assert.equal(congestion.unit,'raw congestion index');assert.match(congestion.description,/not percentages, added road length or new construction/);check(p);
});
test('sparse API does not chart feature counts as construction or invent missing fields',()=>{
 const p=buildApiCharts({frame:{date:'2026-09-01',roads:[{points:[[1,1],[2,2]]}],mtr:[],zones:[]}});assert.deepEqual(p.cards,[]);assert.ok(p.unavailable.some(u=>u.id==='transport-construction'));assert.ok(p.unavailable.some(u=>u.id==='api-congestion'));assert.ok(p.unavailable.some(u=>u.id==='api-population'));assert.ok(p.unavailable.some(u=>u.id==='api-jobs'));
});
test('API zero counts are charted as true zero while invalid counts and incomplete jobs remain null',()=>{
 const f=api();f.zones=[{name:'Zero',population:0,jobs:[{count:0}]},{name:'Bad',population:-3,jobs:[{count:100},{count:null}]},{name:'NaN',population:NaN,jobs:[{count:Infinity}]}];const p=buildApiCharts({frame:f});assert.deepEqual(values(card(p,'api-population'),'population'),[0,null,null]);assert.deepEqual(values(card(p,'api-jobs'),'jobs'),[0,null,null]);check(p);
});
test('all-missing congestion produces an unavailable explanation rather than a fake zero chart',()=>{
 const p=buildApiCharts({frame:{date:'2026-09-01',roads:[{congestion:[null,undefined,NaN,Infinity]}]}});assert.ok(!p.cards.some(c=>c.id==='api-congestion'));assert.ok(p.unavailable.some(u=>u.id==='api-congestion'));
});
test('synthetic API charts are explicitly marked and population is not treated as net migration',()=>{
 const p=buildApiCharts({frame:api(),synthetic:true,setup:{policyScope:{areaId:'kwu-tung-north'}}});assert.match(p.basis,/Synthetic API fixture/);assert.match(card(p,'api-population').description,/not unique migration counts/);assert.equal(card(p,'api-population').scope,'kwu-tung-north');assert.ok(p.unavailable.some(u=>u.id==='residential-migration'));
});
test('known synthetic snapshot provenance remains labelled even if the caller omits the flag',()=>{
 const frame={...api(),provenance:'synthetic-contract-fixture'};assert.match(buildApiCharts({frame}).basis,/Synthetic API fixture/);
});
test('API chart specification has no invented baseline, increase series or road length',()=>{
 const p=buildApiCharts({frame:api()});for(const c of p.cards)for(const s of c.series)assert.equal(s.role,'context');assert.ok(!p.cards.some(c=>c.id.includes('construction')||c.unit==='km'));assert.match(p.basis,/no baseline or causal effect/);assert.throws(()=>buildApiCharts({frame:{}}));
});

test('migration and construction templates stay unavailable until explicit data are available',()=>{
 for(const builder of [buildMigrationCharts,buildConstructionCharts])for(const dataset of [undefined,null,{status:'unavailable'},{status:'pending'}]){const p=builder(dataset);assert.deepEqual(p.cards,[]);assert.ok(p.unavailable.length);}
});
test('residential migration template retains negative net and does not subtract through missing counts',()=>{
 const p=buildMigrationCharts(migration()),flows=card(p,'residential-migration-flows'),net=card(p,'residential-migration-net');assert.deepEqual(values(flows,'inflow'),[100,0,20]);assert.deepEqual(values(flows,'outflow'),[150,0,null]);assert.deepEqual(values(net,'net-migration'),[-50,0,null]);assert.equal(net.unit,'persons');assert.match(p.basis,/observed \/ modelled/);assert.match(net.description,/not the total population change/);assert.ok(!p.unavailable.some(u=>u.id==='residential-migration'));check(p);
});
test('all-null residential migration data remain unavailable without fake flow or net charts',()=>{
 const d=migration();for(const r of d.records){r.inflow=null;r.outflow=null;}const p=buildMigrationCharts(d);assert.deepEqual(p.cards,[]);assert.ok(p.unavailable.some(u=>u.id==='residential-migration'));
});
for(const [label,mutate] of [
 ['wrong units',d=>d.unit='passenger trips/day'],['wrong period',d=>d.period='year'],['missing source',d=>delete d.source],['missing area',d=>delete d.areaId],['wrong schema',d=>d.schema='other'],['missing records',d=>d.records=[]],['duplicate dates',d=>d.records[1].date=d.records[0].date],['unordered dates',d=>d.records.reverse()],['non-month-start',d=>d.records[0].date='2026-08-02'],['invalid date',d=>d.records[0].date='2026-13-01'],['missing status',d=>delete d.records[0].status],['invalid status',d=>d.records[0].status='predicted'],['negative inflow',d=>d.records[0].inflow=-1],['fractional count',d=>d.records[0].outflow=1.2],['missing count',d=>delete d.records[0].outflow],['infinite count',d=>d.records[0].inflow=Infinity]
])test(`migration template rejects ${label}`,()=>{const d=migration();mutate(d);assert.throws(()=>buildMigrationCharts(d));});
test('construction template charts explicit cumulative kilometres and null remains missing',()=>{
 const p=buildConstructionCharts(construction()),length=card(p,'construction-length'),remaining=card(p,'construction-remaining');assert.deepEqual(values(length,'planned'),[2.5,2.5,2.5,2.5]);assert.deepEqual(values(length,'completed'),[0,1.2,null,2.5]);assert.deepEqual(values(remaining,'remaining'),[2.5,1.3,null,0]);assert.equal(length.unit,'km');assert.match(length.description,/Final recorded status: completed/);assert.ok(!p.unavailable.some(u=>u.id==='transport-construction'));check(p);
});
for(const [label,mutate] of [
 ['wrong units',d=>d.unit='roads'],['missing project ID',d=>delete d.projectId],['invalid status',d=>d.records[1].status='open'],['status reversal',d=>d.records[2].status='planned'],['negative length',d=>d.records[1].completedKm=-1],['infinite length',d=>d.records[1].plannedKm=Infinity],['missing planned length',d=>d.records[1].plannedKm=null],['completion exceeds plan',d=>d.records[1].completedKm=3],['cumulative completed rollback',d=>d.records[2].completedKm=1],['plan below delivered length',d=>d.records[2].plannedKm=1],['planned state already completed',d=>d.records[0].completedKm=.1],['completed state unfinished',d=>d.records[3].completedKm=2],['completed state unknown',d=>d.records[3].completedKm=null]
])test(`construction template rejects ${label}`,()=>{const d=construction();mutate(d);assert.throws(()=>buildConstructionCharts(d));});
test('zero-length explicit completed project remains exactly zero and is not rendered as positive data',()=>{
 const d=construction();d.records=[{date:'2026-08-01',status:'completed',plannedKm:0,completedKm:0}];const p=buildConstructionCharts(d);assert.deepEqual(values(card(p,'construction-length'),'completed'),[0]);assert.deepEqual(values(card(p,'construction-remaining'),'remaining'),[0]);check(p);
});
test('chart outputs and labels do not alias models or normalized input records',()=>{
 const t=topic('kwu-tung-housing'),beforeTopic=clone(t),study=port(),beforePort=clone(study),f=api(),beforeApi=clone(f),d=migration(),beforeMigration=clone(d),c=construction(),beforeConstruction=clone(c);
 for(const p of [buildTopicCharts({...t,monthIndex:6}),buildPortCharts({study,monthIndex:0}),buildApiCharts({frame:f}),buildMigrationCharts(d),buildConstructionCharts(c)]){p.cards[0].series[0].values[0]=999999;p.cards[0].labels[0]='Changed';p.unavailable[0].requiredFields[0]='Changed';}
 assert.deepEqual(t,beforeTopic);assert.deepEqual(study,beforePort);assert.deepEqual(f,beforeApi);assert.deepEqual(d,beforeMigration);assert.deepEqual(c,beforeConstruction);
});
