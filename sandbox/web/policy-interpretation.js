import {getArea} from './policy-catalog.js';

const SCHEMA='nm-policy-interpretation-v1';
const number=new Intl.NumberFormat('en',{maximumFractionDigits:2});
const n=value=>number.format(value);
const section=(id,title,...items)=>({id,title,items:items.filter(item=>typeof item==='string'&&item.length)});
const result=(title,basis,summary,sections)=>({schema:SCHEMA,title,basis,summary,sections});
const selectedMonth=(study,index)=>{
 if(!study||!Array.isArray(study.months)||!Number.isInteger(index)||index<0||index>=study.months.length)throw new Error('Select an existing analysis month.');
 return study.months[index];
};
const addMonths=(value,amount)=>{
 const date=new Date(value+'T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+amount);return date.toISOString().slice(0,10);
};
const nextObservation=(study,index)=>study.months[index+1];

/** Deterministic explanatory text. Read current-month inputs/history, never the latest future revision. */
export function buildTopicInterpretation({policy,study,monthIndex}){
 const m=selectedMonth(study,monthIndex);
 if(!policy||policy.id!==study.policyId||policy.model!==m.model||!['housing','education'].includes(policy.model))throw new Error('Policy and topic result must match.');
 const housing=policy.model==='housing',area=getArea(policy.areaId),v=m.activeInputs,active=Boolean(m.revisionId),revision=active?m.history.at(-1):null;
 const demandUnit=housing?'households':'eligible pupils',capacityUnit=housing?'usable housing units':'school places',gapUnit=housing?'households':'pupils';
 const current=`${m.date} · ${area.label}`;
 const growth=v.growth===0?`Demand is held constant at ${n(v.demand)} ${demandUnit}.`:`Demand starts at ${n(v.demand)} ${demandUnit} and ${v.growth>0?'increases':'decreases'} by ${n(Math.abs(v.growth))} per month. At index ${m.index}, the zero-clamped demand is ${n(m.demand)}.`;
 const mechanism=!active?'No policy is effective in this month, so the model adds 0 capacity.':m.policyState==='scheduled'?`${m.revisionId} is effective, but commissioning starts on ${v.commission}. Capacity commissioned so far is ${n(m.delivered)} ${capacityUnit}; previously commissioned capacity is retained.`:`${m.revisionId} specifies ${n(v.added)} total additional ${capacityUnit}, commissioned from ${v.commission} over ${n(v.rollout)} month(s). ${n(m.delivered)} are available in this month and ${n(m.remaining)} remain.`;
 const timing=[active?`The effective version at ${m.date} is ${m.revisionId}, effective from ${revision.effective}. ${m.history.length} revision(s) are effective by this month; the last version in the same month applies.`:`No policy version is effective at ${m.date}. Current results contain no capacity from a later policy version.`];
 if(active){const finish=addMonths(v.commission,v.rollout-1);timing.push(m.date<v.commission?`Next commissioning milestone under this version: ${v.commission}. Planned completion: ${finish}${finish>study.months.at(-1).date?' (after this study window)':''}.`:m.delivered<v.added?`Remaining capacity under this version is phased through ${finish}${finish>study.months.at(-1).date?' (after this study window)':''}.`:`All ${n(v.added)} additions specified by this version are commissioned; demand can still change in later months.`);}
 const next=nextObservation(study,monthIndex);timing.push(next?`Next available observation: ${next.date}. Later adjustments are not used to explain this month's result.`:'This is the final observation in the study window. Extend the study in a new case to inspect later months.');
 const checks=!active?'Select and apply explicit policy assumptions before interpreting a policy effect.':m.policyState==='scheduled'?`Check the assumed ${v.commission} commissioning date and ${n(v.rollout)}-month rollout before using this scenario for delivery planning.`:m.policyGap>0?`Check whether ${n(m.policyGap)} unmet ${gapUnit} reflect missing baseline capacity, the demand assumption, or capacity still awaiting commissioning.`:`Check allocation, accessibility and eligibility data before interpreting the zero modelled gap as adequate real-world provision.`;
 return result(`${housing?'Housing':'Education'} interpretation · ${m.date}`,'Hypothetical local rule model · explicit assumptions',`${current}: demand is ${n(m.demand)} ${demandUnit}; the policy scenario leaves a gap of ${n(m.policyGap)} ${gapUnit}, ${n(m.gapReduction)} fewer than the no-policy baseline.`,[
  section('scope','Area, policy and affected demand',`${area.label} · ${policy.label}. This month covers ${n(m.demand)} ${demandUnit} and ${n(m.policySupply)} ${capacityUnit}.`,`${area.geography}. ${housing?'One usable housing unit represents capacity for one household.':'This is a school-capacity comparison for eligible pupils.'}`),
  section('comparison','Baseline and current policy result',`No-policy baseline: ${n(m.baselineSupply)} ${capacityUnit}; unmet demand ${n(m.baselineGap)} ${gapUnit}.`,`Current policy scenario: ${n(m.baselineSupply)} baseline + ${n(m.delivered)} commissioned = ${n(m.policySupply)} ${capacityUnit}; unmet demand ${n(m.policyGap)} ${gapUnit}.`,`Gap reduction is ${n(m.gapReduction)} ${gapUnit}, not automatically the ${n(m.delivered)} commissioned additions. It is capped by demand that was unmet in the baseline.`),
  section('mechanism','Demand and commissioning mechanism',growth,mechanism,m.demand===0?'Demand is zero after clamping; capacity coverage is unavailable rather than a percentage.':`Capacity covers ${n(m.coverage*100)}% of assumed demand; this is a capacity ratio, not an observed service outcome.`),
  section('timing','Effective version and next milestones',...timing),
  section('limits','Evidence and interpretation limits','All starting values, growth and delivery dates are test assumptions; this explanation is deterministic and uses no LLM inference.',policy.limits,m.policyGap===0?`A zero modelled ${housing?'housing':'school-place'} gap does not establish that real needs are resolved.`:`The remaining ${n(m.policyGap)}-${gapUnit} gap describes this capacity model, not measured unmet applications.`),
  section('next','What to verify next',checks,`${housing?'Collect sourced household demand, usable housing stock and project commissioning schedules.':'Collect sourced pupil demand, school capacity and opening schedules.'} Validate them before replacing these assumptions.`)
 ]);
}

const cohortNames={all:'All passenger trips',commuters:'Commuter trips',visitors:'Family and visitor trips',business:'Business passenger trips'};
const tagNames={'border-access':'Border access','transport-capacity':'Transport capacity','information-reach':'Information reach'};
export function buildPortInterpretation({study,monthIndex,cohortId='all',tags=[]}){
 const m=selectedMonth(study,monthIndex),group=cohortId==='all'?null:m.groups?.find(g=>g.id===cohortId);
 if(!cohortNames[cohortId]||(cohortId!=='all'&&!group))throw new Error('Select an available passenger cohort.');
 const view=group??m,label=cohortNames[cohortId],ledger=Boolean(study.ledger),active=ledger?Boolean(m.revisionId):true;
 const v=active?(m.activeInputs??study.inputs):null,state=active?(m.policyState??(m.openingFraction===0?'scheduled':'in_effect')):'not_applied';
 const units='passenger trips/day',history=m.appliedHistory??[],revision=history.at(-1),remaining=Math.max(0,(v?.capacity??m.baseline)-m.policy);
 const focus=tags.filter(t=>Object.hasOwn(tagNames,t));
 const focusItems=focus.length?focus.map(tag=>!active?`${tagNames[tag]} is selected as an analysis focus; no policy parameters are effective yet.`:tag==='border-access'?`Border access focus: the current clearance assumption is ${n(v.clearance)} minutes, compared with the model's 30-minute reference.`:tag==='information-reach'?`Information reach focus: ${n(v.reach)}% assumed reach gates the trip response; it is not measured awareness.`:`Transport capacity focus: effective feeder capacity is ${n(v.capacity)} ${units} for all passengers, with ${n(remaining)} trips/day headroom in the returned result.`):['No additional focus tag is selected; the current result is still the passenger-trip study.'];
 const response=!active?'No policy is applied in this month. The policy series equals the baseline and no additional trip response is claimed.':state==='scheduled'?`Opening exposure is 0% in this month. The policy is scheduled, so added trips are zero despite the entered reach and clearance assumptions.`:v.reach===0?'Information reach is 0%, so the rule model generates zero additional trip demand. This is an assumed information gate, not evidence of resident indifference.':v.clearance===30?'The clearance assumption equals the 30-minute reference, so the model has no time-saving uplift.':m.unserved>0?`All-passenger requested additions exceed available feeder headroom. ${n(m.unserved)} requested additional passenger trips/day are unserved, and group additions are reduced proportionally.`:`The current rule response fits within all-passenger feeder capacity. The selected cohort adds ${n(view.extra)} ${units}.`;
 const timing=[active?`${m.name} ${m.year}: ${m.revisionId??'unversioned rule inputs'}${revision?`, effective from ${['August','September','October'][revision.effectiveMonth]} ${m.year}`:''}. Opening exposure is ${n(m.openingFraction*100)}% of the month; adoption weight is ${n(m.adoption*100)}%.`:`${m.name} ${m.year}: no effective policy version. Later revisions do not enter the current calculation.`];
 if(v)timing.push(v.timing==='announced'?'This version uses the model’s announced opening on 12 October 2026 at 06:30; October averages include a partial month of exposure.':`This version assumes opening on 1 ${['August','September','October'][v.openingMonth]} ${v.year}; it is a hypothetical event date.`);
 const next=nextObservation(study,monthIndex);timing.push(next?`Next available observation: ${next.name} ${next.year}. Review it separately; this explanation does not import its parameter revision.`:'October is the last available observation in this three-month study.');
 const capacity=active?`All passengers: ${n(m.policy)} / ${n(v.capacity)} ${units} use ${n(m.capacityUse*100)}% of assumed effective capacity; ${n(m.unserved)} requested additional ${units} are unserved.`:`All passengers: baseline ${n(m.baseline)} ${units}; no applied policy capacity or unserved policy demand is interpreted.`;
 const check=!active?'Apply a policy version before evaluating changes from opening.':state==='scheduled'?'Check the opening date and inspect a month with non-zero exposure before evaluating uptake.':v.reach===0?'Verify whether zero reach is intended and collect evidence on actual policy awareness.':m.unserved>0?`Verify all-passenger feeder capacity and the ${n(m.unserved)} trips/day unserved-demand assumption before attributing the constrained result to low demand.`:'Compare the selected trip-purpose counts with sourced passenger observations before assessing the assumed response.';
 return result(`Port interpretation · ${m.name} ${m.year}`,'Rule-based passenger-trip scenario · no LLM decisions',`${label}: baseline ${n(view.baseline)}, policy ${n(view.policy)}, added ${n(view.extra)} ${units} in ${m.name} ${m.year}.`,[
  section('scope','Trip cohort and policy focus',`Huanggang · ${label}. Counts are passenger trips in both directions combined; repeated crossings are possible and these are not unique residents.`,...focusItems),
  section('comparison','Selected-cohort comparison and shared capacity',`${label}: no-opening baseline ${n(view.baseline)} ${units}; policy ${n(view.policy)} ${units}; difference +${n(view.extra)} ${units}.`,`At the same average rate across ${m.days} days, the selected cohort adds ${n(view.extra*m.days)} passenger trips in this month.`,capacity),
  section('mechanism','Opening, information and capacity mechanism',response,active?`The selected cohort's requested addition is ${n(view.requestedExtra)} ${units}. ${group?`Its assumed awareness-adjusted informed share is ${n(group.informed*100)}%.`:`The three trip-purpose groups are combined using fixed assumed shares.`}`:'No current-policy demand mechanism is active.'),
  section('timing','Current version and observation timing',...timing),
  section('limits','Evidence and trip-count limits','Baseline, sensitivities, awareness and route allocation are uncalibrated study assumptions; no observed traffic or LLM decision is loaded.','Additional crossings are not net migration, new residents or a measured social benefit. Other-port diversion, housing and school effects are outside this model.'),
  section('next','What to verify next',check,`Keep the ${label.toLowerCase()} comparison separate from shared all-passenger capacity when reporting results.`)
 ]);
}

const supplied=value=>typeof value==='number'&&Number.isFinite(value);
const scalar=value=>typeof value==='string'||supplied(value);
export function buildApiInterpretation({frame,setup,synthetic=false}){
 if(!frame||typeof frame.date!=='string')throw new Error('A returned dated API snapshot is required.');
 const zones=Array.isArray(frame.zones)?frame.zones:null,scope=setup?.policyScope;
 const basis=synthetic?'Synthetic API fixture · not an observed result or policy forecast':'Returned API snapshot · evidence depends on the team model';
 const scopeItems=[`Returned snapshot date: ${frame.date}.`];
 if(scalar(scope?.areaId))scopeItems.push(`Requested area identifier: ${scope.areaId}.`);
 if(scalar(scope?.policyId))scopeItems.push(`Requested policy identifier: ${scope.policyId}.`);
 if(Array.isArray(scope?.tags)&&scope.tags.length)scopeItems.push(`Requested tags: ${scope.tags.filter(scalar).join(', ')}. Tags describe the request; they do not establish an estimated effect.`);
 const bounds=setup?.bounds;if(bounds&&['west','south','east','north'].every(k=>supplied(bounds[k])))scopeItems.push(`Requested bounds: west ${bounds.west}, south ${bounds.south}, east ${bounds.east}, north ${bounds.north} (longitude/latitude).`);
 const zoneItems=[];
 if(zones){if(!zones.length)zoneItems.push('The snapshot explicitly returns 0 zones.');for(const [i,z] of zones.entries()){
  const name=typeof z.name==='string'?z.name:`Returned zone ${i+1}`,parts=[];
  if(supplied(z.population))parts.push(`population ${n(z.population)}`);
  if(Object.hasOwn(z,'satisfaction'))parts.push(supplied(z.satisfaction)?`satisfaction ${n(z.satisfaction)} (raw index; not a percentage)`:'satisfaction not provided');
  if(Array.isArray(z.jobs))parts.push(z.jobs.length?z.jobs.filter(j=>supplied(j.count)).map(j=>`${typeof j.type==='string'?j.type:'unclassified'} jobs ${n(j.count)}`).join('; '):'0 returned job categories');
  zoneItems.push(`${name}: ${parts.filter(Boolean).join('; ')||'no population, jobs or satisfaction values provided'}.`);
 }}else zoneItems.push('No zone array is provided in this snapshot.');
 const layers=[];for(const [key,label] of [['roads','road lines'],['mtr','MTR lines'],['pollution','pollution records'],['powerLines','power lines']])if(Array.isArray(frame[key]))layers.push(`${n(frame[key].length)} ${label}`);
 if(frame.grid){const g=frame.grid;if(supplied(g.width)&&supplied(g.height))layers.push(`grid ${n(g.width)} × ${n(g.height)}`);if(supplied(g.cellSizeM))layers.push(`${n(g.cellSizeM)} m per cell`);}
 const transport=[];for(const [key,label] of [['roads','Road'],['mtr','MTR']])if(Array.isArray(frame[key]))frame[key].forEach((line,i)=>{if(Array.isArray(line.congestion))transport.push(`${label} ${i+1} returned congestion values: ${line.congestion.map(value=>supplied(value)?n(value):'not provided').join(', ')||'empty array'} (raw index).`);});
 const scaleItems=[];for(const key of ['satisfaction','congestion'])if(typeof frame.scales?.[key]==='string')scaleItems.push(`Returned ${key} scale note: ${frame.scales[key]}`);
 const timing=[`Only the ${frame.date} snapshot is interpreted here. No previous or counterfactual snapshot is supplied to this explanation.`];
 if(typeof setup?.start==='string'&&typeof setup?.end==='string')timing.push(`Requested study window: ${setup.start} to ${setup.end}${typeof setup.step==='string'?`, step ${setup.step}`:''}. This request window does not itself demonstrate change over time.`);
 return result(`API snapshot interpretation · ${frame.date}`,basis,`${synthetic?'Synthetic test snapshot':'Returned snapshot'} at ${frame.date}${zones?` contains ${n(zones.length)} returned zone record(s)`:''}. Policy impact cannot be inferred from one snapshot alone.`,[
  section('scope','Returned area and requested policy',...scopeItems),
  section('comparison','Returned values and comparison availability',...zoneItems,'No no-policy baseline or matched comparison is supplied. These values do not establish a policy-induced increase, reduction or benefit.'),
  section('mechanism','Returned layers and model explanation',layers.length?`Available returned layers: ${layers.join('; ')}.`:'No grid or infrastructure counts are provided in this snapshot.',...transport,'The snapshot does not provide a causal policy mechanism or agent decision trace; no such mechanism is inferred.'),
  section('timing','Snapshot date and study window',...timing),
  section('limits','Source, scales and interpretation limits',basis,...scaleItems,'Raw satisfaction and congestion values retain their supplied index units. They are not treated as percentages, outcome improvements or observed survey results.'),
  section('next','Evidence needed before policy comparison',`For the ${frame.date} result, obtain source definitions and agreed units for the fields actually returned.`,`Request a matched baseline, documented policy mechanism and comparable dates before evaluating policy effects${synthetic?'; replace this synthetic fixture with team-model output first':''}.`)
 ]);
}
