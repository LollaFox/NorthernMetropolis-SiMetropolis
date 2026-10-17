import {getArea} from './policy-catalog.js';

const SCHEMA='nm-policy-charts-v1';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const count=value=>finite(value)&&value>=0?value:null;
const raw=value=>finite(value)?value:null;
const unavailable=(id,icon,title,reason,requiredFields)=>({id,icon,title,reason,requiredFields});
const migrationMissing=()=>unavailable('residential-migration','migration','Residential migration unavailable','The current model has no residential inflow or outflow counts. Passenger crossings, housing capacity and zone population are not residential migration.', ['areaId','unit: persons','period: month','source','records[].date','records[].status: observed or modelled','records[].inflow','records[].outflow']);
const constructionMissing=()=>unavailable('transport-construction','construction','Transport construction unavailable','Road and MTR features do not identify newly built infrastructure, project progress or added kilometres. No construction schedule or length data are supplied.', ['projectId','areaId','unit: km','period: month','source','records[].date','records[].status','records[].plannedKm','records[].completedKm']);
const missing=()=>[migrationMissing(),constructionMissing()];
const packet=(title,basis,cards=[],unavailable=missing())=>({schema:SCHEMA,title,basis,cards,unavailable});
const series=(id,label,role,values)=>{
 if(!values.every(value=>value===null||finite(value)))throw new Error('Chart values must be finite numbers or explicit nulls.');
 return {id,label,role,values:[...values]};
};
const card=(id,title,icon,kind,unit,description,labels,series,extra={})=>({id,title,icon,kind,unit,description,labels:[...labels],series,...extra});
const month=(study,index)=>{
 if(!study||!Array.isArray(study.months)||!Number.isInteger(index)||index<0||index>=study.months.length)throw new Error('Choose an existing result month.');
 return study.months[index];
};

export function buildTopicCharts({policy,study,monthIndex}){
 const m=month(study,monthIndex);
 if(!policy||policy.id!==study.policyId||policy.model!==m.model||!['housing','education'].includes(policy.model))throw new Error('The selected policy must match the topic result.');
 const housing=policy.model==='housing',icon=housing?'housing':'education',area=getArea(policy.areaId).label;
 const demand=housing?'Households':'Eligible pupils',supply=housing?'Usable housing units':'School places',gapUnit=housing?'households':'pupils';
 const labels=study.months.map(m=>m.date),unit=housing?'households / usable housing units':'pupils / school places';
 const active=Boolean(m.revisionId),state=!active?'No policy is effective in this month.':m.policyState==='scheduled'?`Commissioning is scheduled from ${m.activeInputs.commission}; already commissioned capacity is retained.`:`Current effective version: ${m.revisionId}.`;
 const cards=[
  card('topic-supply-demand',`${housing?'Housing':'Education'} demand and available capacity`,icon,'line',unit,`${area}. Each usable ${housing?'housing unit is capacity for one household':'school place is capacity for one pupil'}. Whole study window with month-specific effective versions; the marker identifies ${m.date}. These are assumed capacities, not occupancy or enrollment.`,labels,[series('demand',demand,'demand',study.months.map(m=>m.demand)),series('baseline','No-policy capacity','baseline',study.months.map(m=>m.baselineSupply)),series('policy','Policy capacity','policy',study.months.map(m=>m.policySupply))],{selectedIndex:monthIndex,scope:area}),
  card('topic-unmet-demand',`${housing?'Housing':'School-place'} unmet demand`,icon,'line',gapUnit,`Baseline and policy gaps are non-negative demand minus available capacity. New capacity is not automatically a benefit of the same size; the ${m.date} gap reduction is ${m.gapReduction} ${gapUnit}. A zero modelled gap does not establish real-world adequacy.`,labels,[series('baseline-gap','No-policy unmet demand','baseline',study.months.map(m=>m.baselineGap)),series('policy-gap','Policy unmet demand','unmet',study.months.map(m=>m.policyGap))],{selectedIndex:monthIndex,scope:area}),
  card('topic-commissioning',`${housing?'Housing':'School-place'} commissioning · ${m.date}`,icon,'stack',supply.toLowerCase(),`${state} Delivered capacity and the remaining scheduled addition refer only to the version effective at ${m.date}; no later revision is imported.`,[m.date],[series('commissioned','Commissioned additions','policy',[m.delivered]),series('remaining','Not yet commissioned','context',[active?m.remaining:0])],{scope:area})
 ];
 return packet(`${area} · ${housing?'housing':'education'} charts`,'Hypothetical local rule model · no observed outcomes',cards);
}

const cohorts={all:'All passengers',commuters:'Commuters',visitors:'Family and visitors',business:'Business passengers'};
function groupFor(m,id){if(id==='all')return m;const group=m.groups?.find(g=>g.id===id);if(!group)throw new Error('The selected passenger cohort is unavailable.');return group;}
function directions(m,cohortId){
 if(cohortId!=='all'){
  const g=groupFor(m,cohortId);if(!finite(g.inbound)||g.inbound<0||g.inbound>1)throw new Error('A cohort direction share is required.');
  return {baseline:[g.baseline*g.inbound,g.baseline*(1-g.inbound)],additional:[g.extra*g.inbound,g.extra*(1-g.inbound)]};
 }
 if(Array.isArray(m.routes)&&m.routes.length){
  const fields=['inboundBaseline','outboundBaseline','inboundExtra','outboundExtra'];
  const totals=fields.map(field=>{if(!m.routes.every(r=>finite(r[field])))throw new Error('All-passenger route direction totals are required.');return m.routes.reduce((sum,r)=>sum+r[field],0);});
  return {baseline:totals.slice(0,2),additional:totals.slice(2)};
 }
 if(!Array.isArray(m.groups)||!m.groups.length)throw new Error('Passenger direction data are required.');
 const groups=m.groups.map(g=>directions({...m,groups:[g]},g.id));
 return {baseline:[0,1].map(i=>groups.reduce((sum,g)=>sum+g.baseline[i],0)),additional:[0,1].map(i=>groups.reduce((sum,g)=>sum+g.additional[i],0))};
}
export function buildPortCharts({study,monthIndex,cohortId='all'}){
 const m=month(study,monthIndex);if(!Object.hasOwn(cohorts,cohortId))throw new Error('Choose a valid passenger cohort.');
 const label=cohorts[cohortId],selected=groupFor(m,cohortId),direction=directions(m,cohortId),unit='passenger trips/day';
 const v=study.ledger?(m.revisionId?m.activeInputs:null):(m.activeInputs??study.inputs);
 const labels=study.months.map(m=>`${m.name} ${m.year}`),name=labels[monthIndex];
 return packet(`Huanggang · ${label.toLowerCase()} charts`,'Rule-based trip scenario · not resident migration',[
  card('port-cohort-trend',`${label} · baseline and policy`,'transport','line',unit,'Both directions combined. Each month uses its own effective policy version. Crossings may repeat; these are not unique residents or net migration.',labels,[series('baseline','No-opening baseline','baseline',study.months.map(m=>groupFor(m,cohortId).baseline)),series('policy','Policy trips','policy',study.months.map(m=>groupFor(m,cohortId).policy))],{selectedIndex:monthIndex,scope:label}),
  card('port-directions',`${label} · crossing direction · ${name}`,'transport','stack',unit,`Inbound and outbound passenger crossings for the selected cohort. Baseline and additional-trip directions use their own assumed shares. The two additional components sum to ${selected.extra} trips/day; this is not residential inflow/outflow.` ,['Inbound crossings','Outbound crossings'],[series('baseline','Baseline crossings','baseline',direction.baseline),series('additional','Additional crossings','policy',direction.additional)],{scope:label}),
  card('port-capacity',`All-passenger capacity constraint · ${name}`,'capacity','bar',unit,`Shared feeder constraint for all passengers, regardless of the selected ${label.toLowerCase()} view. Unserved additions are requested additional crossings that cannot be served. ${v?'Capacity is an assumed daily operating limit.':'No policy is effective; an active policy capacity is not supplied.'}`,['Served total','Requested total','Unserved additions','Effective capacity'],[series('all-passenger-counts','All-passenger daily counts','context',[m.policy,m.baseline+m.requestedExtra,m.unserved,v?count(v.capacity):null])],{scope:'All passengers'})
 ]);
}

export function buildApiCharts({frame,setup,synthetic=false}){
 if(!frame||typeof frame.date!=='string')throw new Error('A dated returned API snapshot is required.');
 const isSynthetic=synthetic||frame.provenance==='synthetic-contract-fixture';
 const cards=[],unavailableItems=missing(),zones=Array.isArray(frame.zones)?frame.zones:[],labels=zones.map((z,i)=>typeof z.name==='string'?z.name:`Zone ${i+1}`),scope=typeof setup?.policyScope?.areaId==='string'?setup.policyScope.areaId:'Returned zones';
 const population=zones.map(z=>count(z.population));
 if(population.some(v=>v!==null))cards.push(card('api-population',`Returned zone population · ${frame.date}`,'population','bar','persons','Returned zone populations in one snapshot. Zone totals are not unique migration counts; no baseline, net change or policy gain is inferred.',labels,[series('population','Returned population','context',population)],{scope}));
 else unavailableItems.push(unavailable('api-population','population','Zone population unavailable','No finite non-negative zone population values are returned.',['zones[].name','zones[].population']));
 const jobs=zones.map(z=>Array.isArray(z.jobs)&&z.jobs.length&&z.jobs.every(j=>count(j.count)!==null)?z.jobs.reduce((sum,j)=>sum+j.count,0):null);
 if(jobs.some(v=>v!==null))cards.push(card('api-jobs',`Returned zone jobs · ${frame.date}`,'jobs','bar','jobs','Sum of the returned job categories within each zone. Missing or incomplete categories remain unavailable. These are snapshot counts, not jobs created by policy.',labels,[series('jobs','Returned jobs','context',jobs)],{scope}));
 else unavailableItems.push(unavailable('api-jobs','jobs','Zone jobs unavailable','No complete numeric returned job-category counts are available.',['zones[].name','zones[].jobs[].count']));
 const congestionLabels=[],congestion=[];
 for(const [key,label] of [['roads','Road'],['mtr','MTR']])if(Array.isArray(frame[key]))frame[key].forEach((line,i)=>{if(Array.isArray(line.congestion))line.congestion.forEach((value,j)=>{congestionLabels.push(`${label} ${i+1} · segment ${j+1}`);congestion.push(raw(value));});});
 if(congestion.some(v=>v!==null))cards.push(card('api-congestion',`Returned segment congestion · ${frame.date}`,'transport','bar','raw congestion index',`Raw returned segment values; null remains missing and negative indices are retained. These values are not percentages, added road length or new construction. ${typeof frame.scales?.congestion==='string'?`Returned scale note: ${frame.scales.congestion}`:'The backend has not provided a scale definition.'}`,congestionLabels,[series('congestion','Returned raw congestion','context',congestion)],{scope}));
 else unavailableItems.push(unavailable('api-congestion','transport','Segment congestion unavailable','No numeric congestion values are returned; line features alone cannot determine congestion.',['roads[].congestion[] or mtr[].congestion[]','scales.congestion']));
 return packet(`API charts · ${frame.date}`,isSynthetic?'Synthetic API fixture · not a real policy forecast':'Returned API snapshot · no baseline or causal effect inferred',cards,unavailableItems);
}

function requiredText(value,key){if(typeof value!=='string'||!value.trim())throw new Error(`${key} must be explicit non-empty text.`);}
function datedRecords(dataset,schema){
 if(dataset.schema!==schema||dataset.period!=='month')throw new Error('Use the agreed monthly dataset schema.');
 requiredText(dataset.areaId,'areaId');requiredText(dataset.source,'source');
 if(!Array.isArray(dataset.records)||!dataset.records.length||dataset.records.length>240)throw new Error('Provide 1–240 monthly records.');
 let previous='';for(const r of dataset.records){if(typeof r.date!=='string'||!/^\d{4}-\d{2}-01$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date||r.date<=previous)throw new Error('Record dates must be unique increasing calendar month starts.');previous=r.date;}
}
function optionalCount(value,key){if(value!==null&&(!Number.isSafeInteger(value)||value<0))throw new Error(`${key} must be a non-negative whole count or explicit null.`);return value;}
export function buildMigrationCharts(dataset){
 if(!dataset||dataset.status!=='available')return packet('Residential migration charts','Data unavailable',[],[migrationMissing()]);
 datedRecords(dataset,'nm-residential-migration-v1');if(dataset.unit!=='persons')throw new Error('Residential migration uses persons, not trips.');
 const labels=[],inflow=[],outflow=[],net=[];
 for(const r of dataset.records){if(!['observed','modelled'].includes(r.status))throw new Error('Migration records require observed or modelled status.');const i=optionalCount(r.inflow,'inflow'),o=optionalCount(r.outflow,'outflow');labels.push(r.date);inflow.push(i);outflow.push(o);net.push(i===null||o===null?null:i-o);}
 if(inflow.every(v=>v===null)&&outflow.every(v=>v===null))return packet('Residential migration charts','Data unavailable',[],[migrationMissing()]);
 const statuses=[...new Set(dataset.records.map(r=>r.status))].join(' / '),basis=`${statuses} residential movements · source: ${dataset.source}`;
 return packet(`Residential migration · ${dataset.areaId}`,basis,[
  card('residential-migration-flows','Residential inflow and outflow','migration','line','persons',`Monthly residential moves, separately recorded as inflow and outflow. Record status: ${statuses}. Missing values remain null; no policy cause is inferred.`,labels,[series('inflow','Residential inflow','context',inflow),series('outflow','Residential outflow','context',outflow)],{scope:dataset.areaId}),
  card('residential-migration-net','Net residential migration','migration','bar','persons','Inflow minus outflow in the same month. Negative values indicate more outflow; if either value is missing, net remains unavailable. Net moves are not the total population change.',labels,[series('net-migration','Net residential moves','context',net)],{scope:dataset.areaId})
 ],[constructionMissing()]);
}
function optionalLength(value,key){if(value!==null&&(!finite(value)||value<0))throw new Error(`${key} must be a non-negative length or explicit null.`);return value;}
export function buildConstructionCharts(dataset){
 if(!dataset||dataset.status!=='available')return packet('Transport construction charts','Data unavailable',[],[constructionMissing()]);
 datedRecords(dataset,'nm-transport-construction-v1');if(dataset.unit!=='km')throw new Error('Construction lengths use km.');requiredText(dataset.projectId,'projectId');
 const labels=[],planned=[],completed=[],remaining=[],stages=['planned','under_construction','completed'];let known=0,stage=-1;
 for(const r of dataset.records){const nextStage=stages.indexOf(r.status);if(nextStage<stage||nextStage<0)throw new Error('Construction status must progress from planned to under_construction to completed.');stage=nextStage;
  const p=optionalLength(r.plannedKm,'plannedKm'),c=optionalLength(r.completedKm,'completedKm');if(p===null)throw new Error('A planned project length is required.');
  if(p<known||(c!==null&&(c<known||c>p)))throw new Error('Cumulative completed length cannot decrease or exceed planned length.');
  if(r.status==='planned'&&c!==null&&c!==0)throw new Error('A planned project cannot have completed length.');
  if(r.status==='completed'&&(c===null||c!==p))throw new Error('Completed status requires the full planned length.');
  if(c!==null)known=c;labels.push(r.date);planned.push(p);completed.push(c);remaining.push(c===null?null:p-c);
 }
 return packet(`Transport construction · ${dataset.projectId}`,`Provided project records · source: ${dataset.source}`,[
  card('construction-length','Planned and cumulative completed length','construction','line','km',`${dataset.projectId} in ${dataset.areaId}. Planned length and cumulative completed length are project records, not road-feature counts or an estimated policy effect. Final recorded status: ${dataset.records.at(-1).status}.`,labels,[series('planned','Planned project length','context',planned),series('completed','Cumulative completed length','policy',completed)],{scope:dataset.areaId}),
  card('construction-remaining','Recorded remaining construction length','construction','bar','km','Planned minus cumulative completed length for each dated record. Missing completion stays unavailable; these records do not establish traffic or resident benefits.',labels,[series('remaining','Remaining project length','context',remaining)],{scope:dataset.areaId})
 ],[migrationMissing()]);
}
