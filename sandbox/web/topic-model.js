import {getPolicy} from './policy-catalog.js';
import {schedule,date} from './v3-contract.js';
const copy=x=>JSON.parse(JSON.stringify(x));
const BASE_FIELDS=['start','end','demand','supply','growth'];
const PARAMETERS=['added','commission','rollout'];
function month(value){date(value);if(!value.endsWith('-01'))throw new Error('Use the first day of a calendar month.');return value;}
function int(value,min,max,key){if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${key} must be a whole number ${min}–${max}.`);}
export function validateTopicInputs(policyId,values){
 const p=getPolicy(policyId);if(!p.defaults)throw new Error('This policy uses the original port model.');
 const v=Object.fromEntries([...BASE_FIELDS,...PARAMETERS].map(k=>[k,values[k]]));
 month(v.start);month(v.end);month(v.commission);
 if(v.end<v.start)throw new Error('End month must follow the start month.');
 const dates=schedule({start:v.start,end:v.end,step:'month'});
 if(dates.length<2||dates.length>60)throw new Error('Choose a study window of 2–60 months.');
 int(v.demand,0,1000000,'Baseline demand');int(v.supply,0,1000000,'Baseline supply');int(v.growth,-10000,10000,'Monthly demand change');
 int(v.added,0,p.model==='housing'?20000:5000,'Total policy additions');int(v.rollout,1,24,'Commissioning duration');
 if(v.commission<v.start)throw new Error('Commissioning cannot precede the study start.');
 if(v.commission>'2100-01-01'||v.start<'2000-01-01'||v.end>'2100-01-01')throw new Error('Use a study between 2000 and 2100.');
 return v;
}
export function emptyTopicLedger(policyId){const p=getPolicy(policyId);if(!p.defaults)throw new Error('Not a topic policy.');return {schema:'nm-topic-ledger-v1',policyId,base:null,revisions:[]};}
export function applyTopicRevision(ledger,values,effective,reason,recordedAt){
 const policy=getPolicy(ledger.policyId),v=validateTopicInputs(policy.id,values),last=ledger.revisions.at(-1);
 const dates=schedule({start:v.start,end:v.end,step:'month'});
 if(!dates.includes(effective))throw new Error('Effective month must be in the study window.');
 if(last&&effective<last.effective)throw new Error('Earlier snapshots are preserved. Choose the latest revision month or later.');
 if(v.commission<effective)throw new Error('Commissioning must be at or after the adjustment effective month.');
 if(typeof reason!=='string'||!reason.trim()||reason.trim().length>500)throw new Error('Add a reason of 1–500 characters.');
 if(typeof recordedAt!=='string'||!Number.isFinite(Date.parse(recordedAt)))throw new Error('A valid recorded time is required.');
 if(ledger.revisions.length>=100)throw new Error('This scenario supports 100 revisions.');
 if(ledger.base&&BASE_FIELDS.some(k=>v[k]!==ledger.base[k]))throw new Error('Baseline and study window are locked. Create a new scenario to change them.');
 const changes=PARAMETERS.filter(k=>!last||v[k]!==last.inputs[k]).map(k=>({field:k,before:last?.inputs[k]??null,after:v[k]}));
 if(last&&!changes.length)throw new Error('No policy parameters changed.');
 const before=last?buildTopicStudy(ledger).months.filter(m=>m.date<effective).at(-1)?.delivered??0:0;
 if(v.added<before)throw new Error('The total additions cannot be lower than capacity already commissioned before this month.');
 const next=copy(ledger);next.base??=Object.fromEntries(BASE_FIELDS.map(k=>[k,v[k]]));
 next.revisions.push({id:`${policy.prefix}-${String(next.revisions.length+1).padStart(3,'0')}`,effective,inputs:v,deliveredBefore:before,reason:reason.trim(),recordedAt,changes});return next;
}
export function restoreTopicLedger(data){
 if(!data||data.schema!=='nm-topic-ledger-v1'||!Array.isArray(data.revisions)||data.revisions.length>100)throw new Error('Unsupported topic scenario history.');
 let result=emptyTopicLedger(data.policyId);for(const r of data.revisions)result=applyTopicRevision(result,r.inputs,r.effective,r.reason,r.recordedAt);return result;
}
export function buildTopicStudy(ledger){
 const policy=getPolicy(ledger.policyId),initial=ledger.revisions[0],v=validateTopicInputs(policy.id,initial?.inputs??policy.defaults);
 const dates=schedule({start:v.start,end:v.end,step:'month'});let delivered=0;
 const months=dates.map((date,index)=>{
  const history=ledger.revisions.filter(r=>r.effective<=date),revision=history.at(-1),p=revision?.inputs??v;
  let candidate=0;
  if(revision&&date>=p.commission){const elapsed=(Number(date.slice(0,4))-Number(p.commission.slice(0,4)))*12+Number(date.slice(5,7))-Number(p.commission.slice(5,7))+1;
   candidate=revision.deliveredBefore+Math.floor((p.added-revision.deliveredBefore)*Math.min(1,elapsed/p.rollout));}
  delivered=Math.max(delivered,candidate);
  const demand=Math.max(0,v.demand+index*v.growth),baselineSupply=v.supply,policySupply=baselineSupply+delivered;
  const baselineGap=Math.max(0,demand-baselineSupply),policyGap=Math.max(0,demand-policySupply);
  return {index,date,policyId:policy.id,model:policy.model,revisionId:revision?.id??null,policyState:!revision?'not_applied':date<p.commission?'scheduled':delivered<p.added?'commissioning':'in_effect',
   demand,baselineSupply,policySupply,baselineGap,policyGap,gapReduction:baselineGap-policyGap,delivered,remaining:revision?p.added-delivered:0,
   coverage:demand?Math.min(1,policySupply/demand):null,baselineCoverage:demand?Math.min(1,baselineSupply/demand):null,
   activeInputs:copy(p),history:copy(history),trace:[
    {stage:'Evidence',detail:'All baseline values, demand growth and policy dates are explicit test assumptions. No census, real project or LLM output is loaded.'},
    {stage:'Demand',detail:`max(0, ${v.demand} + ${index} × ${v.growth}) = ${demand} ${policy.model==='housing'?'households':'eligible pupils'}.`},
    {stage:'Commissioning',detail:revision?`${revision.id}: ${p.added} total additions; commission from ${p.commission}, over ${p.rollout} month(s). Already commissioned capacity is retained.`:'No applied policy: no new units or places are added.'},
    {stage:'Supply and gap',detail:`${baselineSupply} baseline + ${delivered} commissioned = ${policySupply}. Unmet demand max(0, ${demand} − ${policySupply}) = ${policyGap}.`},
    {stage:'Boundary',detail:policy.limits}
   ]};
 });
 return {schema:'nm-topic-study-v1',policyId:policy.id,areaId:policy.areaId,model:policy.model,provenance:'hypothetical-local-rule-model',inputs:copy(ledger.revisions.at(-1)?.inputs??v),ledger:copy(ledger),months,
  units:policy.model==='housing'?{demand:'households',supply:'usable housing units',gap:'households'}:{demand:'eligible pupils',supply:'school places',gap:'pupils'},
  unavailable:policy.model==='housing'?['rent burden','affordability','migration','population changes']:['healthcare','care services','travel time','waiting time','school allocation'],limits:policy.limits};
}
