import test from 'node:test';
import assert from 'node:assert/strict';
import {getPolicy} from '../web/policy-catalog.js';
import {emptyTopicLedger,applyTopicRevision,buildTopicStudy} from '../web/topic-model.js';
import {DEFAULTS,runStudy} from '../web/port-model.js';
import {emptyLedger,applyRevision,buildPolicyStudy} from '../web/policy-ledger.js';
import {buildTopicInterpretation,buildPortInterpretation,buildApiInterpretation} from '../web/policy-interpretation.js';

const STAMP='2026-10-15T10:00:00Z';
const IDS=['scope','comparison','mechanism','timing','limits','next'];
const clone=value=>JSON.parse(JSON.stringify(value));
const text=value=>JSON.stringify(value);
const section=(value,id)=>value.sections.find(s=>s.id===id).items.join(' ');
const topic=(id,patch={},effective)=>{
 const policy=getPolicy(id),v={...policy.defaults,...patch};
 const ledger=applyTopicRevision(emptyTopicLedger(id),v,effective??v.start,'Explicit interpretation test',STAMP);
 return {policy,ledger,study:buildTopicStudy(ledger)};
};
const port=(patch={},effective=0)=>buildPolicyStudy(applyRevision(emptyLedger(),{...DEFAULTS,...patch},effective,'Explicit interpretation test',STAMP));
const checkShape=value=>{
 assert.equal(value.schema,'nm-policy-interpretation-v1');assert.equal(typeof value.title,'string');assert.ok(value.title.length);assert.equal(typeof value.basis,'string');assert.equal(typeof value.summary,'string');assert.deepEqual(value.sections.map(s=>s.id),IDS);
 for(const s of value.sections){assert.ok(s.title.length>8);assert.ok(s.items.length);assert.ok(s.items.every(i=>typeof i==='string'&&i.length));}
 assert.deepEqual(JSON.parse(JSON.stringify(value)),value);
};
const apiFrame=()=>({date:'2026-09-01',grid:{width:1000,height:1000,cellSizeM:10},zones:[{name:'North residential',population:12000,satisfaction:65,jobs:[{type:'Services',count:1800}]},{name:'Employment zone',population:1500,satisfaction:null,jobs:[{type:'Technology',count:3200}]}],roads:[{congestion:[40,null,-99]}],mtr:[],pollution:[[400,600,60,0]],powerLines:[],scales:{satisfaction:'Fixture index 0–100; not an observed survey',congestion:'Raw agreed scale pending'}});
const setup={start:'2026-08-01',end:'2026-10-01',step:'month',bounds:{west:114,south:22.45,east:114.15,north:22.6},policyScope:{areaId:'kwu-tung-north',policyId:'kwu-tung-housing',tags:['housing-affordability']}};

test('all three builders return the same six serializable section types',()=>{
 const t=topic('kwu-tung-housing');for(const value of [buildTopicInterpretation({...t,monthIndex:6}),buildPortInterpretation({study:port(),monthIndex:0}),buildApiInterpretation({frame:apiFrame(),setup,synthetic:true})])checkShape(value);
});
test('housing February result independently reports 12240 demand, 400 deliveries and 840 remaining gap',()=>{
 const t=topic('kwu-tung-housing'),value=buildTopicInterpretation({...t,monthIndex:6});
 assert.match(value.summary,/12,240 households/);assert.match(value.summary,/840 households/);assert.match(section(value,'comparison'),/11,000 baseline \+ 400 commissioned = 11,400 usable housing units/);assert.match(section(value,'comparison'),/Gap reduction is 400 households/);assert.match(section(value,'mechanism'),/increases by 40 per month/);assert.match(section(value,'timing'),/KH-001/);
});
test('housing July benefit is capped at 1440 deficit despite 1600 delivered units',()=>{
 const value=buildTopicInterpretation({...topic('kwu-tung-housing'),monthIndex:11});
 assert.match(section(value,'comparison'),/Gap reduction is 1,440 households, not automatically the 1,600 commissioned additions/);assert.match(section(value,'limits'),/zero modelled housing gap does not establish/);assert.match(section(value,'next'),/allocation, accessibility and eligibility/);
});
test('education interpretation uses pupil and school-place units with 730 gap reduction, not 900',()=>{
 const value=buildTopicInterpretation({...topic('hung-shui-kiu-school'),monthIndex:13});
 assert.match(value.summary,/3,730 eligible pupils/);assert.match(section(value,'comparison'),/3,000 baseline \+ 900 commissioned = 3,900 school places/);assert.match(section(value,'comparison'),/Gap reduction is 730 pupils/);assert.match(section(value,'limits'),/healthcare/);assert.doesNotMatch(value.summary,/households/);
});
test('a scheduled housing policy explains zero additions and the specific commissioning milestone',()=>{
 const value=buildTopicInterpretation({...topic('kwu-tung-housing'),monthIndex:0});
 assert.match(section(value,'mechanism'),/commissioning starts on 2027-02-01/);assert.match(section(value,'comparison'),/11,000 baseline \+ 0 commissioned/);assert.match(section(value,'timing'),/Planned completion: 2027-05-01/);assert.match(section(value,'next'),/2027-02-01/);
});
test('a mid-rollout month explains remaining delivery and next observation without claiming completion',()=>{
 const value=buildTopicInterpretation({...topic('kwu-tung-housing'),monthIndex:7});
 assert.match(section(value,'mechanism'),/800 are available.*800 remain/);assert.match(section(value,'timing'),/phased through 2027-05-01/);assert.match(section(value,'timing'),/Next available observation: 2027-04-01/);
});
test('unapplied topic baseline does not infer an intended delivery effect',()=>{
 const policy=getPolicy('kwu-tung-housing'),study=buildTopicStudy(emptyTopicLedger(policy.id)),value=buildTopicInterpretation({policy,study,monthIndex:7});
 assert.match(section(value,'mechanism'),/No policy is effective/);assert.match(section(value,'timing'),/No policy version is effective/);assert.match(section(value,'next'),/Select and apply/);assert.doesNotMatch(section(value,'mechanism'),/1,600/);
});
test('topic interpretation cannot import a future revision ID, total additions or later delivery schedule',()=>{
 const first=topic('kwu-tung-housing'),before=buildTopicInterpretation({...first,monthIndex:6});
 const next=applyTopicRevision(first.ledger,{...first.ledger.revisions[0].inputs,added:9876,commission:'2027-06-01'},'2027-05-01','Future distinct values',STAMP);
 const after=buildTopicInterpretation({policy:first.policy,study:buildTopicStudy(next),monthIndex:6});
 assert.deepEqual(after,before);assert.doesNotMatch(text(after),/KH-002|9,876|Future distinct values/);
});
test('a future first application cannot leak its additions into an earlier no-policy explanation',()=>{
 const t=topic('kwu-tung-housing',{added:9876},'2027-01-01'),value=buildTopicInterpretation({...t,monthIndex:0});
 assert.doesNotMatch(text(value),/9,876|KH-001/);assert.match(section(value,'comparison'),/Gap reduction is 0 households/);
});
test('latest same-month topic revision is named and audit count remains explicit',()=>{
 const t=topic('kwu-tung-housing'),l=applyTopicRevision(t.ledger,{...t.ledger.revisions[0].inputs,added:1400},'2026-08-01','Same-month revision',STAMP),value=buildTopicInterpretation({policy:t.policy,study:buildTopicStudy(l),monthIndex:6});
 assert.match(section(value,'timing'),/KH-002/);assert.match(section(value,'timing'),/2 revision\(s\)/);assert.match(section(value,'timing'),/last version in the same month applies/);assert.match(section(value,'mechanism'),/1,400 total additional/);
});
test('negative demand growth and zero demand receive a clamp and unavailable-coverage explanation',()=>{
 const t=topic('kwu-tung-housing',{demand:10,supply:0,growth:-10}),value=buildTopicInterpretation({...t,monthIndex:1});
 assert.match(section(value,'mechanism'),/decreases by 10 per month/);assert.match(section(value,'mechanism'),/zero-clamped demand is 0/);assert.match(section(value,'mechanism'),/coverage is unavailable rather than a percentage/);assert.doesNotMatch(text(value),/NaN|Infinity/);
});
test('a final month and an out-of-window commissioning date state the specific limits',()=>{
 const t=topic('kwu-tung-housing',{commission:'2028-01-01'}),value=buildTopicInterpretation({...t,monthIndex:11});
 assert.match(section(value,'timing'),/2028-04-01 \(after this study window\)/);assert.match(section(value,'timing'),/final observation/);
});
test('topic mismatch and missing or fractional month selections are rejected',()=>{
 const t=topic('kwu-tung-housing');for(const monthIndex of [-1,12,.5,undefined])assert.throws(()=>buildTopicInterpretation({...t,monthIndex}));assert.throws(()=>buildTopicInterpretation({...t,policy:getPolicy('hung-shui-kiu-school'),monthIndex:0}));
});

test('commuter interpretation independently reports 10000 baseline and 620.67 extra trips/day in August',()=>{
 const value=buildPortInterpretation({study:port(),monthIndex:0,cohortId:'commuters'});
 assert.match(value.summary,/Commuter trips: baseline 10,000, policy 10,620\.67, added 620\.67 passenger trips\/day/);assert.match(section(value,'comparison'),/19,240\.67 passenger trips in this month/);assert.match(section(value,'comparison'),/All passengers: 21,339\.33 \/ 30,000/);assert.match(section(value,'mechanism'),/66\.5%/);
});
test('visitor and business selected counts do not reuse the all-passenger total',()=>{
 const study=port(),visitor=buildPortInterpretation({study,monthIndex:0,cohortId:'visitors'}),business=buildPortInterpretation({study,monthIndex:0,cohortId:'business'});
 assert.match(visitor.summary,/baseline 6,000, policy 6,441, added 441/);assert.match(business.summary,/baseline 4,000, policy 4,277\.67, added 277\.67/);assert.doesNotMatch(visitor.summary,/1,339/);
});
test('all-passenger selection uses the actual aggregate rate and passenger-trip units',()=>{
 const value=buildPortInterpretation({study:port(),monthIndex:0});assert.match(value.summary,/baseline 20,000, policy 21,339\.33, added 1,339\.33 passenger trips\/day/);assert.match(section(value,'scope'),/not unique residents/);assert.match(section(value,'limits'),/not net migration/);assert.match(value.basis,/no LLM/);
});
test('port no-policy baseline is distinct from a policy waiting for announced opening',()=>{
 const none=buildPortInterpretation({study:buildPolicyStudy(emptyLedger()),monthIndex:0}),waiting=buildPortInterpretation({study:port({timing:'announced'}),monthIndex:1});
 assert.match(section(none,'mechanism'),/No policy is applied/);assert.match(section(none,'comparison'),/no applied policy capacity/);assert.match(section(waiting,'mechanism'),/Opening exposure is 0%/);assert.match(section(waiting,'timing'),/12 October 2026 at 06:30/);assert.match(section(waiting,'next'),/non-zero exposure/);
});
test('zero information reach explains a zero request rather than a capacity or preference conclusion',()=>{
 const value=buildPortInterpretation({study:port({reach:0}),monthIndex:0,cohortId:'visitors',tags:['information-reach']});
 assert.match(section(value,'mechanism'),/Information reach is 0%/);assert.match(section(value,'mechanism'),/not evidence of resident indifference/);assert.match(section(value,'scope'),/0% assumed reach/);assert.match(section(value,'next'),/zero reach is intended/);
});
test('equal clearance reference explains zero time-saving uplift separately',()=>{
 const value=buildPortInterpretation({study:port({clearance:30}),monthIndex:0});assert.match(value.summary,/added 0 passenger trips\/day/);assert.match(section(value,'mechanism'),/no time-saving uplift/);
});
test('capacity constrained group result uses selected-cohort counts while unserved demand stays all-passenger',()=>{
 const value=buildPortInterpretation({study:port({capacity:20500}),monthIndex:0,cohortId:'commuters',tags:['transport-capacity']});
 assert.match(value.summary,/policy 10,231\.71, added 231\.71/);assert.match(section(value,'comparison'),/All passengers: 20,500 \/ 20,500/);assert.match(section(value,'comparison'),/839\.33 requested additional passenger trips\/day are unserved/);assert.match(section(value,'mechanism'),/group additions are reduced proportionally/);
});
test('zero capacity headroom is identified as a constraint rather than zero interest',()=>{
 const value=buildPortInterpretation({study:port({capacity:20000}),monthIndex:0});assert.match(value.summary,/added 0 passenger trips\/day/);assert.match(section(value,'mechanism'),/requested additions exceed available feeder headroom/);assert.match(section(value,'next'),/not|before attributing/);
});
test('focus tags change the relevant interpretation without changing model numbers',()=>{
 const study=port(),border=buildPortInterpretation({study,monthIndex:0,tags:['border-access']}),reach=buildPortInterpretation({study,monthIndex:0,tags:['information-reach']});
 assert.equal(border.summary,reach.summary);assert.match(section(border,'scope'),/5 minutes/);assert.match(section(reach,'scope'),/70% assumed reach/);assert.notEqual(section(border,'scope'),section(reach,'scope'));
});
test('a future port revision cannot leak new reach or capacity into an earlier interpretation',()=>{
 const first=applyRevision(emptyLedger(),DEFAULTS,0,'First version',STAMP),before=buildPortInterpretation({study:buildPolicyStudy(first),monthIndex:0,cohortId:'business',tags:['information-reach','transport-capacity']});
 const second=applyRevision(first,{...DEFAULTS,reach:99,capacity:76543},1,'Future values',STAMP),after=buildPortInterpretation({study:buildPolicyStudy(second),monthIndex:0,cohortId:'business',tags:['information-reach','transport-capacity']});
 assert.deepEqual(after,before);assert.doesNotMatch(text(after),/76,543|HG-002|99% assumed reach/);
});
test('partial announced October exposure is stated without calling it an observed outcome',()=>{
 const value=buildPortInterpretation({study:port({timing:'announced'}),monthIndex:2});assert.match(section(value,'timing'),/63\.64%/);assert.match(section(value,'timing'),/partial month/);assert.match(section(value,'timing'),/last available observation/);assert.match(section(value,'limits'),/uncalibrated/);
});
test('plain unversioned port-model output is supported and invalid cohort/month inputs reject',()=>{
 const study=runStudy(),value=buildPortInterpretation({study,monthIndex:0});assert.match(section(value,'timing'),/unversioned rule inputs/);
 assert.throws(()=>buildPortInterpretation({study,monthIndex:0,cohortId:'residents'}));assert.throws(()=>buildPortInterpretation({study,monthIndex:3}));
});

test('API interpretation reports actual zone values and raw satisfaction without a percent conversion',()=>{
 const value=buildApiInterpretation({frame:apiFrame(),setup}),comparison=section(value,'comparison');
 assert.match(comparison,/North residential: population 12,000; satisfaction 65 \(raw index; not a percentage\); Services jobs 1,800/);assert.match(comparison,/Employment zone: population 1,500; satisfaction not provided; Technology jobs 3,200/);assert.doesNotMatch(text(value),/65%|65 %/);assert.match(comparison,/No no-policy baseline/);
});
test('API geometry and congestion counts use only returned arrays and preserve negative/raw values',()=>{
 const value=buildApiInterpretation({frame:apiFrame(),setup}),mechanism=section(value,'mechanism');
 assert.match(mechanism,/1 road lines; 0 MTR lines; 1 pollution records; 0 power lines/);assert.match(mechanism,/1,000 × 1,000/);assert.match(mechanism,/40, not provided, -99 \(raw index\)/);assert.match(mechanism,/no such mechanism is inferred/);
});
test('API synthetic fixtures are visibly identified in basis, summary, limits and next steps',()=>{
 const value=buildApiInterpretation({frame:apiFrame(),setup,synthetic:true});assert.match(value.basis,/Synthetic API fixture/);assert.match(value.summary,/Synthetic test snapshot/);assert.match(section(value,'limits'),/not an observed result or policy forecast/);assert.match(section(value,'next'),/replace this synthetic fixture/);
});
test('sparse API snapshots do not fabricate zero fields, missing layers or numeric benefits',()=>{
 const value=buildApiInterpretation({frame:{date:'2026-09-01'}});checkShape(value);
 assert.match(section(value,'comparison'),/No zone array is provided/);assert.match(section(value,'mechanism'),/No grid or infrastructure counts are provided/);assert.doesNotMatch(text(value),/0 zones|0 road|population 0|satisfaction 0|\+\d/);assert.match(value.summary,/cannot be inferred from one snapshot alone/);
});
test('API empty returned arrays, true zeroes and negative raw satisfaction remain distinguishable',()=>{
 const f={date:'2026-09-01',zones:[{name:'Empty zone',population:0,satisfaction:-99,jobs:[]}],roads:[],pollution:[]},value=buildApiInterpretation({frame:f});
 assert.match(section(value,'comparison'),/population 0; satisfaction -99 \(raw index/);assert.match(section(value,'comparison'),/0 returned job categories/);assert.match(section(value,'mechanism'),/0 road lines/);assert.doesNotMatch(section(value,'mechanism'),/MTR|power lines/);
 const empty=buildApiInterpretation({frame:{date:'2026-09-01',zones:[]}});assert.match(section(empty,'comparison'),/explicitly returns 0 zones/);
});
test('API requested policy, tags and window are identified as request metadata, not estimated effects',()=>{
 const value=buildApiInterpretation({frame:apiFrame(),setup});
 assert.match(section(value,'scope'),/Requested area identifier: kwu-tung-north/);assert.match(section(value,'scope'),/Requested policy identifier: kwu-tung-housing/);assert.match(section(value,'scope'),/do not establish an estimated effect/);assert.match(section(value,'timing'),/2026-08-01 to 2026-10-01, step month/);assert.match(section(value,'timing'),/does not itself demonstrate change/);
});
test('interpretation is pure and repeated calls cannot contaminate input or sibling explanations',()=>{
 const t=topic('kwu-tung-housing'),source=clone(t),study=port(),original=clone(study),frame=apiFrame(),apiOriginal=clone(frame);
 const values=[buildTopicInterpretation({...t,monthIndex:6}),buildPortInterpretation({study,monthIndex:0}),buildApiInterpretation({frame,setup})];for(const value of values)value.sections[0].items[0]='Caller changed text';
 assert.deepEqual(t,source);assert.deepEqual(study,original);assert.deepEqual(frame,apiOriginal);assert.notEqual(buildTopicInterpretation({...t,monthIndex:6}).sections[0].items[0],'Caller changed text');assert.notEqual(buildPortInterpretation({study,monthIndex:0}).sections[0].items[0],'Caller changed text');assert.notEqual(buildApiInterpretation({frame,setup}).sections[0].items[0],'Caller changed text');
});
test('API builder requires an actual dated snapshot rather than silently producing an explanation',()=>{
 for(const frame of [undefined,null,{}, {date:12}])assert.throws(()=>buildApiInterpretation({frame}));
});
