import {renderGovernmentResults} from './government-product.js';
import {renderPolicyCharts} from './policy-charts.js';
import {renderInterpretation} from './policy-readout.js';
import {createPolicyIcon} from './policy-visuals.js';
import {renderEvidenceBrief} from './evidence-gate.js';

const NORMALIZED='nm-canonical-backend-results-v1';
const TOTAL_FIELDS=['housingCapacity','plannedHousingCapacity','actualResidents','offeredJobs','filledJobs','vacancies'];
const TYPES=['residential','business','park','station'];
const STAGES=['planned','construction','complete'];
const STAGE_LABELS={planned:'Planned',construction:'Under construction',complete:'Complete'};
const number=new Intl.NumberFormat('en',{maximumFractionDigits:2});
const display=value=>value===null||value===undefined?'Not provided':number.format(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
const text=(value,name)=>typeof value==='string'&&value.trim()?value:fail(`${name} must be explicit text.`);
function iso(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Canonical results need valid ISO dates.');return value;}
function count(value,name){if(value===undefined||value===null)return null;if(!Number.isSafeInteger(value)||value<0)fail(`${name} must be a non-negative whole count or missing.`);return value;}
function metric(value,name){if(value===undefined||value===null)return null;if(typeof value!=='number'||!Number.isFinite(value))fail(`${name} must be a finite number or missing.`);return value;}
function index(items,key,name){if(!Array.isArray(items))fail(`${name} must be an array.`);const result=new Map();for(const value of items){if(!object(value))fail(`${name} records must be objects.`);const id=text(value[key],`${name} ${key}`);if(result.has(id))fail(`Duplicate ${name} ${id}.`);result.set(id,value);}return result;}
function chosen(data,date){const normalized=normalizeBackendExport(data);const day=normalized.byDate.get(iso(date??normalized.dates[0]));if(!day)fail('The selected date has no canonical monthly state.');return {normalized,day};}

/** Canonical export join: date + persistent object id only. Display-zone names are never identifiers. */
export function normalizeBackendExport(data){
 if(data?.schema===NORMALIZED&&data.byDate instanceof Map&&data.objectsByDate instanceof Map)return data;
 if(!object(data)||data.schemaVersion!==1||!object(data.run)||!Array.isArray(data.monthlyStates)||!data.monthlyStates.length||data.monthlyStates.length>240)fail('A canonical backend export with 1–240 monthly states is required.');
 const simulationId=text(data.run.simulationId,'simulationId');
 const stateIndex=index(data.monthlyStates,'month','monthly state'),totalsIndex=index(data.monthlyBuildingTotals,'date','monthly totals');
 if(stateIndex.size!==totalsIndex.size)fail('Monthly states and totals must cover the same dates.');
 const dates=[...stateIndex.keys()].map(iso).sort();for(const day of totalsIndex.keys())if(!stateIndex.has(iso(day)))fail('Monthly totals reference a date without a state.');
 const scale=data.scale??data.monthlyStates[0]?.config?.scale??null;
 if(scale!==null&&(!object(scale)||!['building','development_cluster'].includes(scale.unit)))fail('Unsupported canonical object scale.');
 const objectUnit=scale?.unit??'building',objectLabel=objectUnit==='development_cluster'?'development clusters':'modeled buildings';
 const byDate=new Map(),objectsByDate=new Map(),identities=new Map();
 for(const date of dates){
  const state=stateIndex.get(date),totals=totalsIndex.get(date),buildings=index(state.buildings,'id','object'),rows=index(totals.buildings,'id','object totals');
  if(buildings.size!==rows.size)fail('Monthly object state and totals have different identities.');
  const objectsById=new Map(),stages=Object.fromEntries(STAGES.map(key=>[key,0]));
  for(const [id,rawBuilding] of buildings){
   const building=rawBuilding.status==='building'?{...rawBuilding,status:'construction'}:rawBuilding;
   const row=rows.get(id);if(!row)fail(`Missing totals for object ${id} at ${date}.`);
   if(!TYPES.includes(building.type)||!STAGES.includes(building.status))fail(`Unknown object type or construction state for ${id}.`);
   if(!Number.isInteger(building.x)||!Number.isInteger(building.y)||row.type!==building.type||row.x!==building.x||row.y!==building.y)fail(`Object identity/coordinates do not match for ${id}.`);
   const identity=`${building.type}:${building.x}:${building.y}`;if(identities.has(id)&&identities.get(id)!==identity)fail(`Persistent object ${id} changed identity across dates.`);identities.set(id,identity);
   const values=Object.fromEntries(TOTAL_FIELDS.map(field=>[field,count(row[field],`${id} ${field}`)]));
   if(values.housingCapacity!==null&&values.plannedHousingCapacity!==null&&values.housingCapacity>values.plannedHousingCapacity)fail('Available resident places exceed planned capacity.');
   if(values.actualResidents!==null&&values.housingCapacity!==null&&values.actualResidents>values.housingCapacity)fail('Actual residents exceed available resident places.');
   if(['offeredJobs','filledJobs','vacancies'].every(k=>values[k]!==null)&&values.filledJobs+values.vacancies!==values.offeredJobs)fail('Offered jobs must equal filled jobs plus vacancies.');
   const entry={...building,...values,sourceDate:date,stage:STAGE_LABELS[building.status],objectUnit};objectsById.set(id,entry);stages[building.status]++;
  }
  const aggregate=Object.fromEntries(TOTAL_FIELDS.map(field=>{const values=[...objectsById.values()].map(b=>b[field]);return [field,values.some(v=>v===null)?null:values.reduce((sum,v)=>sum+v,0)];}));
  const metrics=object(state.metrics)?{...state.metrics}:{};
  for(const key of ['population','groups','jobCapacity','filledJobs','vacancies','unemployedWorkers'])metrics[key]=count(metrics[key],key);
  for(const key of ['meanSatisfaction','monthlyProfit','monthlyGDP','totalGDP'])metrics[key]=metric(metrics[key],key);
  if(metrics.meanSatisfaction!==null&&(metrics.meanSatisfaction<0||metrics.meanSatisfaction>100))fail('Synthetic satisfaction must be in its returned 0–100 scale.');
  const day={sourceDate:date,date,state,objectsById,totals:aggregate,metrics,stages};byDate.set(date,day);objectsByDate.set(date,objectsById);
 }
 const snapshots=Array.isArray(data.run.snapshots)?data.run.snapshots:[];const snapshotIds=new Set(),snapshotDates=new Set();
 for(const snapshot of snapshots){const id=text(snapshot.id,'snapshot id'),date=iso(snapshot.date);if(snapshotIds.has(id)||snapshotDates.has(date)||!byDate.has(date))fail('Snapshot identities/dates must be unique and reference canonical states.');snapshotIds.add(id);snapshotDates.add(date);}
 const providerMetrics=object(data.run.providerMetrics)?data.run.providerMetrics:null;
 return {schema:NORMALIZED,raw:data,simulationId,dates,byDate,objectsByDate,scale,objectUnit,objectLabel,providerMetrics,provenance:typeof data.run.provenance==='string'?data.run.provenance:'Not provided'};
}

const line=(id,title,icon,unit,description,dates,series,selectedIndex)=>({id,title,icon,kind:'line',unit,description,labels:[...dates],series,selectedIndex});
const series=(id,label,role,values)=>({id,label,role,values});
export function buildBackendCharts(data,date){
 const {normalized:n,day}=chosen(data,date),days=n.dates.map(date=>n.byDate.get(date)),selectedIndex=n.dates.indexOf(day.date);
 const cards=[
  line('backend-residents-capacity','Residents and available housing capacity','housing','persons / resident places','Actual residents and resident-place capacity are separate canonical counts. A resident place is not a dwelling unit; modeled objects are '+n.objectLabel+'. Each date uses its own saved state.',n.dates,[series('actual-residents','Actual residents','context',days.map(d=>d.totals.actualResidents)),series('available-places','Available resident places','policy',days.map(d=>d.totals.housingCapacity)),series('planned-places','Full planned resident places','demand',days.map(d=>d.totals.plannedHousingCapacity))],selectedIndex),
  line('backend-jobs','Offered, filled and vacant jobs','jobs','jobs','Offered jobs are the model firm capacity. Filled jobs and vacancies are separate counts. More offered jobs do not establish employment or real economic gain.',n.dates,[series('offered','Offered jobs','demand',days.map(d=>d.totals.offeredJobs)),series('filled','Filled jobs','policy',days.map(d=>d.totals.filledJobs)),series('vacancies','Vacancies','context',days.map(d=>d.totals.vacancies))],selectedIndex),
  {id:'backend-construction',title:'Construction state · '+day.date,icon:'construction',kind:'stack',unit:n.objectLabel,description:'Counts come from the selected canonical monthlyStates.buildings.status, not display-zone names. These counts do not express completed road kilometres, dwelling units or service capacity.',labels:[day.date],series:[series('planned','Planned','context',[day.stages.planned]),series('construction','Under construction','unmet',[day.stages.construction]),series('complete','Complete','policy',[day.stages.complete])]},
 ];
 if(days.some(d=>d.metrics.meanSatisfaction!==null))cards.push(line('backend-satisfaction','Synthetic resident satisfaction','information','synthetic index (0–100)','Population-weighted model satisfaction, not an observed survey or a percentage of satisfied residents. Null remains unavailable when no score is returned.',n.dates,[series('satisfaction','Synthetic mean satisfaction','context',days.map(d=>d.metrics.meanSatisfaction))],selectedIndex));
 return {schema:'nm-policy-charts-v1',title:'Canonical backend results · '+day.date,basis:'Synthetic narrative-city scenario · saved canonical monthly states, not observations',cards,unavailable:[
  {id:'backend-unmodelled',icon:'information',title:'Unmodeled indicators',reason:'Climate, electricity, observed travel times, healthcare and school-place supply are not supplied by this export. They are not displayed as zero.',requiredFields:['source definitions and explicit modeled series']},
  {id:'backend-comparison',icon:'information',title:'Policy-effect comparison unavailable',reason:'This run has no matched no-policy counterfactual. A change across dates is a scenario change, not proof that the requested policy caused it.',requiredFields:['matched baseline run','documented policy mechanism']}
 ]};
}

const section=(id,title,...items)=>({id,title,items});
export function buildBackendInterpretation(data,date){
 const {normalized:n,day}=chosen(data,date),p=n.providerMetrics?.summary,scale=n.scale;
 const provider=p?`Whole-run provider metrics, not this month's separate usage. Provider: ${p.provider??'Not provided'}; source type: ${p.sourceType??'Not provided'}. Calls ${display(p.callCount)}, attempts ${display(p.attemptCount)}, successful calls ${display(p.successfulCalls)}. Returned statuses: ${object(p.statuses)?Object.entries(p.statuses).map(([k,v])=>`${k} ${display(v)}`).join(', '):'Not provided'}.`:'No provider execution metrics were supplied.';
 return {schema:'nm-policy-interpretation-v1',title:'Backend scenario interpretation · '+day.date,basis:'Synthetic backend scenario · not measured regional outcomes',summary:`${day.date}: ${display(day.totals.actualResidents)} actual modeled residents; ${display(day.totals.housingCapacity)} available resident places; ${display(day.totals.offeredJobs)} offered jobs, ${display(day.totals.filledJobs)} filled and ${display(day.totals.vacancies)} vacant.`,sections:[
  section('scope','Canonical scope and scale',`Simulation ${n.simulationId}. Objects are ${n.objectLabel}; identities come from saved object IDs.`,scale?.label??'No regional scale label was supplied.',`Requested policy ${n.raw.setup?.policyScope?.policyId??'Not provided'} is request context. The configured construction script, rather than PDF text, controls delivery.`,scale?`Reference housing capacity ${display(scale.referenceHousingCapacity)} and reference jobs ${display(scale.referenceJobs)} are scenario reference targets, not current residents or filled jobs.`:'No regional reference target is inferred.'),
  section('comparison','Current counts and comparison limits',`${display(day.totals.housingCapacity)} available resident places versus ${display(day.totals.plannedHousingCapacity)} full planned resident places; ${display(day.totals.actualResidents)} actual residents. Places are capacity for people, not housing units.`,`${display(day.totals.offeredJobs)} offered = ${display(day.totals.filledJobs)} filled + ${display(day.totals.vacancies)} vacancies when all terms are provided.`, 'Whole-run trends share a fixed axis across the saved dates. No matched no-policy counterfactual was supplied; temporal changes do not establish policy causation.'),
  section('mechanism','Construction and numerical settlement',`${day.stages.planned} planned, ${day.stages.construction} under construction and ${day.stages.complete} complete ${n.objectLabel} at this date.`, day.state.fiscal?'Fiscal model: residents enter or exit by income, jobs, distance and park rules. Government controls starts only in a selected government mode.':'Available resident places require completion. Job offers require a firm; the backend separately allocates filled jobs and retains vacancies. Model resident moves are whole fictional groups.',`Synthetic mean satisfaction: ${display(day.metrics.meanSatisfaction)} on the returned 0–100 model scale; it is not an observed survey.`),
  section('timing','Exact saved month and object identity',`Only ${day.date} supplies the current counts and object details. The export contains ${n.dates.length} saved settlement dates from ${n.dates[0]} through ${n.dates.at(-1)}.`, 'Quarterly or yearly snapshot output can be sparse while canonical monthlyStates retains intermediate settlements. Objects are joined by date and persistent id, never by a display-zone name.'),
  section('limits','Evidence and provider execution',`Returned provenance: ${n.provenance}. All city outcomes remain synthetic.`,provider,'A completed simulation job does not mean every provider attempt succeeded. Retries, fallbacks and interrupted uncheckpointed usage must be assessed in the returned provider metrics.',p?.usageAvailable===true?`Reported token usage: ${JSON.stringify(p.usage??{})}.`:'Token usage is unavailable; zero placeholders are not treated as measured zero usage.','Climate, power, observed transport outcomes and unprovided service indicators are unavailable, not zero.'),
  section('next','What to verify next','Check source data, fictional group size, cluster scale and construction schedule before interpreting a real location.', 'Compare an explicitly matched baseline and inspect provider attempt records before attributing outcomes to a policy or successful AI reasoning.')
 ]};
}

export function renderBackendResults(container,data,date,{selectedObjectId,onDate,onObject,compact=false,evidence}={}){
 const {normalized:n,day}=chosen(data,date),make=(tag,value,cls)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(cls)el.className=cls;return el;};
 const root=make('section',undefined,'backend-canonical-results');root.dataset.backendDate=day.date;root.setAttribute('aria-label','Canonical backend scenario results');
 if(!compact){
 root.append(make('p','SYNTHETIC BACKEND · CANONICAL MONTHLY STATE','readout-eyebrow'),make('h3',day.date),make('p',n.objectLabel+' · resident places are not dwelling units','policy-chart-note'));
 const controls=make('div',undefined,'analysis-input-grid'),dateLabel=make('label','Result date'),dateSelect=make('select');dateSelect.setAttribute('data-backend-date','');dateSelect.setAttribute('aria-label','Canonical result date');
 for(const value of n.dates){const option=make('option',value);option.value=value;dateSelect.append(option);}dateSelect.value=day.date;dateLabel.append(dateSelect);controls.append(dateLabel);root.append(controls);
 dateSelect.addEventListener('change',()=>{if(onDate)onDate(dateSelect.value);else renderBackendResults(container,n,dateSelect.value,{selectedObjectId,onDate,onObject});});
 const metrics=make('div',undefined,'port-metrics');
 for(const [label,value] of [['Actual modeled residents',day.totals.actualResidents],['Available resident places',day.totals.housingCapacity],['Full planned resident places',day.totals.plannedHousingCapacity],['Offered jobs',day.totals.offeredJobs],['Filled jobs',day.totals.filledJobs],['Vacant jobs',day.totals.vacancies]]){const item=make('div');item.append(make('span',label),make('strong',display(value)));metrics.append(item);}root.append(metrics);
 const visuals=make('div');renderPolicyCharts(visuals,buildBackendCharts(n,day.date));root.append(visuals);
 }else if(evidence){const brief=make('div');renderEvidenceBrief(brief,evidence);root.append(brief);}
 const objectFold=make('details',undefined,'chart-data-table');objectFold.open=compact?Boolean(selectedObjectId):true;objectFold.append(make('summary','Selected object · saved details'));
 const objectLabel=make('label','Object'),select=make('select');select.setAttribute('data-backend-object','');select.setAttribute('aria-label','Canonical object id');
 const ids=[...day.objectsById.keys()].sort();if(selectedObjectId&&!day.objectsById.has(selectedObjectId)){const option=make('option','Object not found at this date');option.value='';select.append(option);}
 for(const id of ids){const entry=day.objectsById.get(id),option=make('option',`${id} · ${entry.type} · ${entry.stage}`);option.value=id;select.append(option);}select.value=selectedObjectId??ids[0]??'';if(selectedObjectId&&!day.objectsById.has(selectedObjectId))select.value='';objectLabel.append(select);objectFold.append(objectLabel);
 const details=make('div',undefined,'policy-record');objectFold.append(details);root.append(objectFold);
 const showObject=id=>{details.replaceChildren();const entry=day.objectsById.get(id);if(!entry){details.append(make('p','No object with this persistent id is available at this date.'));return;}
  const heading=make('strong');heading.append(createPolicyIcon(entry.type==='residential'?'housing':entry.type==='business'?'jobs':entry.type==='station'?'rail':'information'),make('span',`${entry.id} · ${entry.type} · ${entry.stage}`));details.append(heading,make('p',`${day.date} · canonical grid (${entry.x}, ${entry.y}) · ${n.objectLabel}; display-map distances are illustrative.`));
  const allFields=[['Available resident places','housingCapacity'],['Full planned resident places','plannedHousingCapacity'],['Actual residents','actualResidents'],['Offered jobs','offeredJobs'],['Filled jobs','filledJobs'],['Vacancies','vacancies']];
  const fields=compact?entry.type==='residential'?allFields.slice(0,3):entry.type==='business'?allFields.slice(3):[]:allFields;
  for(const [label,key] of fields)details.append(make('p',`${label}: ${display(entry[key])}`));
  details.append(make('p',`${entry.actualStart!=null?"Actual start step":"Scheduled start step"}: ${display(entry.actualStart??entry.startMonth)} · expected completion step: ${display(entry.actualCompletion??entry.completionMonth)} · completed date: ${entry.completedAt??'Not completed'}`));if(!compact&&typeof entry.narrative==='string')details.append(make('p',entry.narrative));
 };
 select.addEventListener('change',()=>{showObject(select.value);onObject?.(select.value,day.objectsById.get(select.value)??null,day.date);});showObject(select.value);
 if(!compact){const readout=make('div');renderInterpretation(readout,buildBackendInterpretation(n,day.date));root.append(readout);}
 else{const audit=make('details',undefined,'evidence-audit'),summary=n.providerMetrics?.summary;audit.append(make('summary','Technical provenance · whole run'),make('p','Provider: '+(summary?.provider??'Not supplied')+' · successful calls: '+display(summary?.successfulCalls)+' · attempts: '+display(summary?.attemptCount)),make('p','Run '+n.simulationId+'. Call success is not a measure of policy accuracy.'));root.append(audit);}
 renderGovernmentResults(root,day.state);
 container.replaceChildren(root);return root;
}
