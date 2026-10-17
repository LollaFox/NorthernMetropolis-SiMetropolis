import test from 'node:test';
import assert from 'node:assert/strict';
import {AREAS,POLICIES,getPolicy,getArea,matchingPolicies,matchingTags,assertPolicyScope} from '../web/policy-catalog.js';
import {validateTopicInputs,emptyTopicLedger,applyTopicRevision,restoreTopicLedger,buildTopicStudy} from '../web/topic-model.js';
import {TOPIC_STORAGE_KEY,emptyTopicStore,restoreTopicStore,addTopicCase} from '../web/topic-store.js';

const STAMP='2026-10-15T10:00:00Z';
const TOPICS=['kwu-tung-housing','hung-shui-kiu-school'];
const clone=value=>JSON.parse(JSON.stringify(value));
const values=(id,patch={})=>({...getPolicy(id).defaults,...patch});
const apply=(id,patch={},effective,reason='Explicit test scenario')=>{
 const v=values(id,patch);
 return applyTopicRevision(emptyTopicLedger(id),v,effective??v.start,reason,STAMP);
};
const frame=(study,date)=>{const result=study.months.find(m=>m.date===date);assert.ok(result,`Missing month ${date}`);return result;};
const compact=(id,patch={})=>values(id,{start:'2026-08-01',end:'2027-07-01',demand:2000,supply:1000,growth:0,added:900,commission:'2026-10-01',rollout:3,...patch});
const compactLedger=(id,patch={})=>{const v=compact(id,patch);return applyTopicRevision(emptyTopicLedger(id),v,v.start,'Compact test scenario',STAMP);};

test('catalogue maps each available policy to exactly one existing area',()=>{
 assert.equal(new Set(AREAS.map(a=>a.id)).size,AREAS.length);
 assert.equal(new Set(POLICIES.map(p=>p.id)).size,POLICIES.length);
 for(const policy of POLICIES){assert.equal(getArea(policy.areaId).id,policy.areaId);assert.ok(policy.tags.includes(policy.primaryTag));}
});
test('area and tag matching supports all required tags and excludes other places',()=>{
 assert.deepEqual(matchingPolicies('kwu-tung-north',['housing-affordability']).map(p=>p.id),['kwu-tung-housing']);
 assert.deepEqual(matchingPolicies('hung-shui-kiu',['public-services']).map(p=>p.id),['hung-shui-kiu-school']);
 assert.deepEqual(matchingPolicies('huanggang',['border-access','information-reach']).map(p=>p.id),['huanggang-opening']);
 assert.deepEqual(matchingPolicies('kwu-tung-north',['public-services']),[]);
 assert.deepEqual(matchingPolicies('hung-shui-kiu',['public-services','housing-affordability']),[]);
 assert.deepEqual(matchingTags('kwu-tung-north'),['housing-affordability']);
});
test('invalid or missing area-policy-tag selections cannot invoke a mismatched model',()=>{
 for(const args of [['kwu-tung-housing','huanggang',['housing-affordability']],['hung-shui-kiu-school','hung-shui-kiu',[]],['kwu-tung-housing','kwu-tung-north',['public-services']],['missing','huanggang',['border-access']]])assert.throws(()=>assertPolicyScope(...args));
 assert.equal(assertPolicyScope('hung-shui-kiu-school','hung-shui-kiu',['public-services']).model,'education');
 assert.throws(()=>matchingPolicies('missing',[]));assert.throws(()=>getArea('missing'));assert.throws(()=>getPolicy('missing'));
});
test('catalogue definitions and nested defaults resist caller mutation',()=>{
 assert.throws(()=>{getPolicy('kwu-tung-housing').defaults.added=1;},TypeError);
 assert.throws(()=>{getPolicy('hung-shui-kiu-school').tags.push('healthcare');},TypeError);
 assert.throws(()=>{AREAS[0].label='Changed';},TypeError);
 const tags=matchingTags('huanggang');tags.push('caller-only');assert.ok(!matchingTags('huanggang').includes('caller-only'));
});
test('port policy stays on its original model and cannot masquerade as a topic ledger',()=>{
 assert.throws(()=>emptyTopicLedger('huanggang-opening'));
 assert.throws(()=>validateTopicInputs('huanggang-opening',{}));
 assert.throws(()=>addTopicCase(emptyTopicStore(),'huanggang-opening'));
});

for(const id of TOPICS){
 const kind=getPolicy(id).model;
 test(`${kind}: unapplied scenario has baseline only throughout the window`,()=>{
  const ledger=emptyTopicLedger(id),before=clone(ledger),study=buildTopicStudy(ledger);
  assert.equal(study.provenance,'hypothetical-local-rule-model');assert.equal(study.areaId,getPolicy(id).areaId);
  for(const m of study.months){assert.equal(m.delivered,0);assert.equal(m.policySupply,m.baselineSupply);assert.equal(m.policyGap,m.baselineGap);assert.equal(m.gapReduction,0);assert.equal(m.policyState,'not_applied');assert.equal(m.revisionId,null);assert.deepEqual(m.history,[]);}
  assert.deepEqual(ledger,before);assert.ok(study.unavailable.length);assert.match(study.months[0].trace[0].detail,/test assumptions/);
 });
 test(`${kind}: default commissioning produces no effect before opening and exact final additions`,()=>{
  const study=buildTopicStudy(apply(id)),p=getPolicy(id);
  for(const m of study.months.filter(m=>m.date<p.defaults.commission)){assert.equal(m.delivered,0);assert.equal(m.gapReduction,0);assert.equal(m.policyState,'scheduled');}
  const final=study.months.at(-1);assert.equal(final.delivered,p.defaults.added);assert.equal(final.remaining,0);assert.equal(final.policyState,'in_effect');
  assert.equal(study.units.demand,kind==='housing'?'households':'eligible pupils');
 });
 test(`${kind}: 3-phase commissioning is cumulative rather than repeated monthly additions`,()=>{
  const study=buildTopicStudy(compactLedger(id));
  assert.deepEqual(study.months.slice(0,6).map(m=>m.delivered),[0,0,300,600,900,900]);
  assert.equal(frame(study,'2026-10-01').policyState,'commissioning');assert.equal(frame(study,'2026-12-01').policyState,'in_effect');
  assert.deepEqual(study.months.slice(2,5).map(m=>m.remaining),[600,300,0]);
 });
 test(`${kind}: first application in a future month preserves earlier baseline and empty history`,()=>{
  const v=compact(id,{commission:'2026-12-01'}),l=applyTopicRevision(emptyTopicLedger(id),v,'2026-11-01','Future application',STAMP),study=buildTopicStudy(l);
  for(const m of study.months.slice(0,3)){assert.equal(m.policyState,'not_applied');assert.equal(m.delivered,0);assert.deepEqual(m.history,[]);}
  assert.equal(frame(study,'2026-11-01').policyState,'scheduled');assert.equal(frame(study,'2026-12-01').delivered,300);
 });
 test(`${kind}: commissioning after the study ends remains scheduled with no fabricated result`,()=>{
  const study=buildTopicStudy(compactLedger(id,{commission:'2028-01-01'}));
  for(const m of study.months){assert.equal(m.policyState,'scheduled');assert.equal(m.delivered,0);assert.equal(m.gapReduction,0);}
 });
 test(`${kind}: zero additions retain unchanged supply and zero claimed gap reduction`,()=>{
  const study=buildTopicStudy(compactLedger(id,{added:0}));
  for(const m of study.months){assert.equal(m.delivered,0);assert.equal(m.policySupply,1000);assert.equal(m.gapReduction,0);assert.equal(m.remaining,0);}
 });
 test(`${kind}: declining demand is clamped at zero and zero-demand coverage is unavailable`,()=>{
  const study=buildTopicStudy(compactLedger(id,{demand:20,supply:0,growth:-10,commission:'2026-08-01'}));
  assert.deepEqual(study.months.slice(0,5).map(m=>m.demand),[20,10,0,0,0]);
  for(const m of study.months.slice(2)){assert.equal(m.coverage,null);assert.equal(m.baselineCoverage,null);assert.equal(m.baselineGap,0);assert.equal(m.policyGap,0);assert.equal(m.gapReduction,0);}
 });
 test(`${kind}: all-zero demand and supply never introduce NaN, negative gaps or phantom benefits`,()=>{
  const study=buildTopicStudy(compactLedger(id,{demand:0,supply:0,growth:0,added:0}));
  for(const m of study.months){assert.equal(m.demand,0);assert.equal(m.coverage,null);assert.equal(m.baselineCoverage,null);for(const key of ['baselineGap','policyGap','gapReduction','delivered','remaining'])assert.equal(m[key],0);}
 });
 test(`${kind}: excess initial supply caps coverage at 100% and prevents negative unmet demand`,()=>{
  const study=buildTopicStudy(compactLedger(id,{demand:100,supply:1000,added:900,commission:'2026-08-01'}));
  for(const m of study.months){assert.equal(m.baselineGap,0);assert.equal(m.policyGap,0);assert.equal(m.gapReduction,0);assert.equal(m.coverage,1);assert.equal(m.baselineCoverage,1);}
 });
 test(`${kind}: future revision preserves every earlier snapshot byte-for-byte`,()=>{
  const ledger=compactLedger(id),before=buildTopicStudy(ledger),inputs={...ledger.revisions[0].inputs,added:1200,commission:'2027-01-01',rollout:2};
  const next=applyTopicRevision(ledger,inputs,'2026-12-01','Increase future capacity',STAMP),after=buildTopicStudy(next);
  assert.deepEqual(after.months.filter(m=>m.date<'2026-12-01'),before.months.filter(m=>m.date<'2026-12-01'));
  assert.equal(next.revisions[1].deliveredBefore,600);assert.equal(frame(after,'2026-12-01').delivered,600);assert.equal(frame(after,'2027-01-01').delivered,900);assert.equal(frame(after,'2027-02-01').delivered,1200);
  assert.equal(ledger.revisions.length,1);assert.equal(next.revisions[1].id,`${getPolicy(id).prefix}-002`);
 });
 test(`${kind}: later change cannot remove capacity commissioned before its effective month`,()=>{
  const ledger=compactLedger(id),inputs={...ledger.revisions[0].inputs,added:599,commission:'2026-12-01'};
  assert.throws(()=>applyTopicRevision(ledger,inputs,'2026-12-01','Reduce below delivered stock',STAMP),/already commissioned/);
  assert.equal(ledger.revisions.length,1);assert.equal(buildTopicStudy(ledger).months.at(-1).delivered,900);
  const exact=applyTopicRevision(ledger,{...inputs,added:600},'2026-12-01','Retain the delivered minimum',STAMP);
  for(const m of buildTopicStudy(exact).months.filter(m=>m.date>='2026-12-01'))assert.equal(m.delivered,600);
 });
 test(`${kind}: same-month revisions keep an audit trail while latest revision determines capacity`,()=>{
  const first=compactLedger(id),second=applyTopicRevision(first,{...first.revisions[0].inputs,added:600},'2026-08-01','Revise initial assumption',STAMP),study=buildTopicStudy(second);
  assert.equal(study.months[0].history.length,2);assert.equal(study.months[0].revisionId,`${getPolicy(id).prefix}-002`);assert.equal(study.months.at(-1).delivered,600);assert.equal(first.revisions.length,1);
 });
 test(`${kind}: backdating and locked baseline edits are rejected without side effects`,()=>{
  const first=compactLedger(id),second=applyTopicRevision(first,{...first.revisions[0].inputs,added:1200,commission:'2027-01-01'},'2026-12-01','Future adjustment',STAMP),original=clone(second);
  assert.throws(()=>applyTopicRevision(second,{...second.revisions.at(-1).inputs,added:1300},'2026-11-01','Backdate',STAMP),/Earlier snapshots/);
  for(const [key,value] of [['start','2026-07-01'],['end','2027-08-01'],['demand',2001],['supply',1001],['growth',1]])assert.throws(()=>applyTopicRevision(second,{...second.revisions.at(-1).inputs,[key]:value},'2027-01-01',`Change ${key}`,STAMP),/locked/);
  assert.deepEqual(second,original);
 });
 test(`${kind}: round-trip replay reconstructs IDs, changes and delivered stock instead of trusting cached metadata`,()=>{
  const first=compactLedger(id),ledger=applyTopicRevision(first,{...first.revisions[0].inputs,added:1200,commission:'2027-01-01'},'2026-12-01','Larger second phase',STAMP),raw=clone(ledger);
  raw.base.demand=999999;raw.revisions[0].id='FORGED';raw.revisions[1].deliveredBefore=999999;raw.revisions[1].changes=[];
  const restored=restoreTopicLedger(raw);assert.deepEqual(restored,ledger);assert.deepEqual(buildTopicStudy(restored),buildTopicStudy(ledger));
  raw.revisions[0].inputs.demand=7;assert.equal(restored.revisions[0].inputs.demand,2000);
 });
 test(`${kind}: callers cannot contaminate source ledger or sibling snapshots through returned objects`,()=>{
  const input=compact(id),ledger=applyTopicRevision(emptyTopicLedger(id),input,input.start,'Isolation test',STAMP),original=clone(ledger),study=buildTopicStudy(ledger);
  input.added=1;study.inputs.added=2;study.ledger.revisions[0].inputs.added=3;study.months[0].activeInputs.added=4;study.months[0].history[0].inputs.added=5;study.months[0].trace[0].detail='changed';
  assert.deepEqual(ledger,original);assert.equal(study.months[1].activeInputs.added,900);assert.equal(study.months[1].history[0].inputs.added,900);assert.notEqual(study.months[1].trace[0].detail,'changed');assert.deepEqual(buildTopicStudy(ledger),buildTopicStudy(original));
 });
 test(`${kind}: parameter matrix conserves additions and respects all demand/supply invariants (48 scenarios)`,()=>{
  let cases=0;
  for(const added of [0,1,7,101])for(const rollout of [1,3,4,24])for(const growth of [-50,0,50]){
   const study=buildTopicStudy(compactLedger(id,{added,rollout,growth,demand:120,supply:80,commission:'2026-08-01'}));let previous=0;
   for(const m of study.months){const label=`${kind}, added=${added}, rollout=${rollout}, growth=${growth}, ${m.date}`;
    const expected=Math.floor(added*Math.min(1,(m.index+1)/rollout));assert.equal(m.delivered,expected,label);assert.ok(m.delivered>=previous,label);assert.ok(m.delivered<=added,label);assert.equal(m.delivered+m.remaining,added,label);assert.ok(m.policyGap>=0&&m.policyGap<=m.baselineGap,label);assert.ok(m.gapReduction>=0&&m.gapReduction<=m.delivered,label);assert.equal(m.policySupply-m.baselineSupply,m.delivered,label);assert.ok(m.coverage===null||(m.coverage>=0&&m.coverage<=1),label);previous=m.delivered;
   }cases++;
  }assert.equal(cases,48);
 });
}

test('housing default gives 400/800/1200/1600 units and caps benefit at actual housing deficit',()=>{
 const study=buildTopicStudy(apply('kwu-tung-housing'));
 assert.deepEqual(['2027-02-01','2027-03-01','2027-04-01','2027-05-01'].map(d=>frame(study,d).delivered),[400,800,1200,1600]);
 const feb=frame(study,'2027-02-01');assert.equal(feb.demand,12240);assert.equal(feb.baselineGap,1240);assert.equal(feb.policyGap,840);
 const last=study.months.at(-1);assert.equal(last.demand,12440);assert.equal(last.policyGap,0);assert.equal(last.gapReduction,1440);
});
test('education default releases 900 places in September 2027 and reports pupil units only',()=>{
 const study=buildTopicStudy(apply('hung-shui-kiu-school')),sep=frame(study,'2027-09-01');
 assert.equal(sep.demand,3730);assert.equal(sep.delivered,900);assert.equal(sep.baselineGap,730);assert.equal(sep.policyGap,0);assert.equal(sep.gapReduction,730);assert.equal(study.units.supply,'school places');assert.ok(study.unavailable.includes('healthcare'));assert.ok(study.unavailable.includes('waiting time'));
});
test('month sequence handles a year boundary and leap February without drifting dates',()=>{
 const study=buildTopicStudy(compactLedger('kwu-tung-housing',{start:'2027-12-01',end:'2028-03-01',commission:'2028-01-01',added:7,rollout:3}));
 assert.deepEqual(study.months.map(m=>m.date),['2027-12-01','2028-01-01','2028-02-01','2028-03-01']);assert.deepEqual(study.months.map(m=>m.delivered),[0,2,4,7]);
});
test('study accepts exactly 2 and 60 months but rejects 1 or 61',()=>{
 const id='kwu-tung-housing';
 assert.equal(buildTopicStudy(compactLedger(id,{start:'2026-01-01',end:'2026-02-01',commission:'2026-01-01'})).months.length,2);
 assert.equal(buildTopicStudy(compactLedger(id,{start:'2026-01-01',end:'2030-12-01',commission:'2026-01-01'})).months.length,60);
 for(const end of ['2026-01-01','2031-01-01'])assert.throws(()=>validateTopicInputs(id,compact(id,{start:'2026-01-01',end,commission:'2026-01-01'})),/2–60/);
});

const invalidInputs=[
 ['nonexistent calendar date',{start:'2026-02-30'}],['not first of month',{start:'2026-08-02'}],['malformed commissioning',{commission:'2027-2-01'}],['end before start',{end:'2026-07-01'}],['commission before start',{commission:'2026-07-01'}],['start before supported period',{start:'1999-12-01',end:'2000-08-01',commission:'2000-01-01'}],['end after supported period',{start:'2099-12-01',end:'2100-02-01',commission:'2100-01-01'}],['commission after supported period',{commission:'2100-02-01'}],
 ['negative demand',{demand:-1}],['excessive demand',{demand:1000001}],['fractional demand',{demand:1.5}],['string supply',{supply:'1000'}],['NaN supply',{supply:NaN}],['infinite additions',{added:Infinity}],['negative additions',{added:-1}],['too many housing additions',{added:20001}],['growth too negative',{growth:-10001}],['growth too positive',{growth:10001}],['zero rollout',{rollout:0}],['excessive rollout',{rollout:25}],['fractional rollout',{rollout:1.5}]
];
for(const [name,patch] of invalidInputs)test(`validation rejects ${name}`,()=>assert.throws(()=>validateTopicInputs('kwu-tung-housing',values('kwu-tung-housing',patch))));
test('education limit is 5000 places while housing supports 20000 units',()=>{
 assert.equal(validateTopicInputs('hung-shui-kiu-school',values('hung-shui-kiu-school',{added:5000})).added,5000);
 assert.throws(()=>validateTopicInputs('hung-shui-kiu-school',values('hung-shui-kiu-school',{added:5001})));
 assert.equal(validateTopicInputs('kwu-tung-housing',values('kwu-tung-housing',{added:20000})).added,20000);
});
test('validating input returns a detached whitelist of supported fields',()=>{
 const input={...values('kwu-tung-housing'),extra:'ignored'},output=validateTopicInputs('kwu-tung-housing',input);assert.ok(!Object.hasOwn(output,'extra'));output.added=1;assert.equal(input.added,1600);
});
test('effective month must belong to the study and commissioning cannot precede adjustment effectiveness',()=>{
 const id='kwu-tung-housing',v=compact(id);
 for(const effective of ['2026-07-01','2027-08-01','2026-08-15','bad'])assert.throws(()=>applyTopicRevision(emptyTopicLedger(id),v,effective,'Bad effective month',STAMP));
 assert.throws(()=>applyTopicRevision(emptyTopicLedger(id),v,'2026-11-01','Commission is already past',STAMP),/Commissioning/);
});
test('revision reasons and timestamps must be valid and whitespace is normalized',()=>{
 const id='kwu-tung-housing',v=compact(id);
 for(const reason of ['', '   ', 'x'.repeat(501),null])assert.throws(()=>applyTopicRevision(emptyTopicLedger(id),v,v.start,reason,STAMP));
 for(const stamp of [undefined,null,'not-a-date'])assert.throws(()=>applyTopicRevision(emptyTopicLedger(id),v,v.start,'Valid reason',stamp));
 const l=applyTopicRevision(emptyTopicLedger(id),v,v.start,'  Reviewed test  ',STAMP);assert.equal(l.revisions[0].reason,'Reviewed test');
});
test('unchanged re-analysis cannot produce a duplicate policy revision',()=>{
 const l=compactLedger('kwu-tung-housing');assert.throws(()=>applyTopicRevision(l,l.revisions[0].inputs,'2026-09-01','No change',STAMP),/No policy parameters/);assert.equal(l.revisions.length,1);
});
test('100 revisions are replayable and revision 101 is rejected',()=>{
 const id='kwu-tung-housing',v=compact(id,{commission:'2026-08-01'});let l=emptyTopicLedger(id);
 for(let i=0;i<100;i++)l=applyTopicRevision(l,{...v,added:i%2?2:1},v.start,`Revision ${i+1}`,STAMP);
 assert.equal(l.revisions.at(-1).id,'KH-100');assert.deepEqual(restoreTopicLedger(clone(l)),l);assert.throws(()=>applyTopicRevision(l,{...v,added:3},v.start,'Over limit',STAMP),/100 revisions/);
});
test('corrupt ledger schemas, policies, revision arrays and invalid replay data are rejected',()=>{
 for(const data of [null,{}, {schema:'other',revisions:[]}, {schema:'nm-topic-ledger-v1',policyId:'missing',revisions:[]}, {schema:'nm-topic-ledger-v1',policyId:'kwu-tung-housing',revisions:{}}, {schema:'nm-topic-ledger-v1',policyId:'kwu-tung-housing',revisions:Array(101).fill({})}])assert.throws(()=>restoreTopicLedger(data));
 const raw=clone(compactLedger('kwu-tung-housing'));raw.revisions[0].inputs.added=-1;assert.throws(()=>restoreTopicLedger(raw));
});

test('new cases start unapplied and independently preserve housing and education histories',()=>{
 const initial=emptyTopicStore(),first=addTopicCase(initial,'kwu-tung-housing'),houseId=first.activeByPolicy['kwu-tung-housing'];
 first.cases[0].ledger=compactLedger('kwu-tung-housing');first.cases[0].month=3;
 const second=addTopicCase(first,'kwu-tung-housing'),third=addTopicCase(second,'hung-shui-kiu-school');
 assert.equal(initial.cases.length,0);assert.equal(first.cases.length,1);assert.equal(second.cases.length,2);assert.equal(third.cases.length,3);
 assert.equal(third.cases.find(c=>c.id===houseId).ledger.revisions.length,1);assert.equal(third.cases.find(c=>c.id===houseId).month,3);
 assert.equal(third.cases.find(c=>c.id===third.activeByPolicy['kwu-tung-housing']).ledger.revisions.length,0);
 assert.equal(third.cases.find(c=>c.id===third.activeByPolicy['hung-shui-kiu-school']).ledger.policyId,'hung-shui-kiu-school');
 third.cases[0].ledger.revisions[0].inputs.added=123;assert.equal(first.cases[0].ledger.revisions[0].inputs.added,900);
});
test('mixed-policy store round-trip retains valid active selections and never aliases imported objects',()=>{
 let s=addTopicCase(emptyTopicStore(),'kwu-tung-housing');s=addTopicCase(s,'kwu-tung-housing');s=addTopicCase(s,'hung-shui-kiu-school');
 s.cases[0].ledger=compactLedger('kwu-tung-housing');s.cases[2].ledger=compactLedger('hung-shui-kiu-school');s.activeByPolicy['kwu-tung-housing']=s.cases[0].id;
 const raw=clone(s),restored=restoreTopicStore(raw);assert.deepEqual(restored,s);
 raw.cases[0].label='Mutated';raw.cases[0].ledger.revisions[0].inputs.added=5;raw.activeByPolicy['kwu-tung-housing']='missing';assert.notEqual(restored.cases[0].label,'Mutated');assert.equal(restored.cases[0].ledger.revisions[0].inputs.added,900);assert.equal(restored.activeByPolicy['kwu-tung-housing'],s.cases[0].id);
});
test('stale or cross-policy active IDs recover to an existing case of the correct policy',()=>{
 let s=addTopicCase(emptyTopicStore(),'kwu-tung-housing');s=addTopicCase(s,'hung-shui-kiu-school');s.activeByPolicy['kwu-tung-housing']=s.cases[1].id;s.activeByPolicy['hung-shui-kiu-school']='missing';
 const restored=restoreTopicStore(s);for(const [policyId,id] of Object.entries(restored.activeByPolicy))assert.equal(restored.cases.find(c=>c.id===id).ledger.policyId,policyId);
});
test('new case identifiers avoid collisions even after non-contiguous cases were restored',()=>{
 const s=addTopicCase(emptyTopicStore(),'kwu-tung-housing');s.cases[0].id='topic-2';s.activeByPolicy['kwu-tung-housing']='topic-2';const next=addTopicCase(s,'kwu-tung-housing');assert.equal(new Set(next.cases.map(c=>c.id)).size,2);assert.equal(next.cases[1].id,'topic-3');
});
test('40 independent stored cases are supported while adding or importing 41 is rejected',()=>{
 let s=emptyTopicStore();for(let i=0;i<40;i++)s=addTopicCase(s,TOPICS[i%2]);assert.equal(restoreTopicStore(clone(s)).cases.length,40);assert.throws(()=>addTopicCase(s,'kwu-tung-housing'),/40-case/);
 const over=clone(s);over.cases.push({...clone(over.cases[0]),id:'topic-41'});assert.throws(()=>restoreTopicStore(over));
});
test('corrupt storage metadata, duplicate IDs and invalid case data are rejected',()=>{
 const valid=addTopicCase(emptyTopicStore(),'kwu-tung-housing');
 for(const raw of [null,{}, {...clone(valid),schema:'other'}, {...clone(valid),cases:{}}, {...clone(valid),activeByPolicy:null}])assert.throws(()=>restoreTopicStore(raw));
 for(const patch of [{id:'invalid/id'},{id:''},{label:''},{label:' '.repeat(3)},{label:'x'.repeat(81)},{month:-1},{month:60},{month:1.5},{ledger:{schema:'other',revisions:[]}}]){const raw=clone(valid);Object.assign(raw.cases[0],patch);assert.throws(()=>restoreTopicStore(raw));}
 const duplicate=clone(valid);duplicate.cases.push(clone(duplicate.cases[0]));assert.throws(()=>restoreTopicStore(duplicate));
 assert.deepEqual(restoreTopicStore({schema:TOPIC_STORAGE_KEY,cases:[],activeByPolicy:{}}),emptyTopicStore());
});
