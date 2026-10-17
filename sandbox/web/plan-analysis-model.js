import {normalizeBackendExport} from './backend-results.js';
import {getArea} from './policy-catalog.js';
import {deltaSymbol} from './change-symbols.js';
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const difference=(v,p)=>number(v)===null||number(p)===null?null:v-p;
const geometryCache=new WeakMap();
function extent(points){return points.reduce((a,p)=>({minX:Math.min(a.minX,p.x),maxX:Math.max(a.maxX,p.x),minY:Math.min(a.minY,p.y),maxY:Math.max(a.maxY,p.y)}),{minX:0,maxX:1,minY:0,maxY:1});}
function backendGeometry(n){
 if(geometryCache.has(n))return geometryCache.get(n);
 const all=n.dates.flatMap(d=>[...n.byDate.get(d).objectsById.values()]);
 const out={bounds:extent(all),max:{}};
 for(const field of ['actualResidents','housingCapacity','filledJobs'])out.max[field]=all.reduce((max,b)=>Math.max(max,number(b[field])??0),1);
 geometryCache.set(n,out);return out;
}
function stageChange(now,old,hasPrevious){
 if(!hasPrevious)return 'unavailable';if(!now)return 'removed';if(!old)return 'added';
 if(now.status===old.status)return 'unchanged';if(now.status==='complete')return 'completed';if(now.status==='construction'&&old.status==='planned')return 'started';return 'unavailable';
}
const layer=(id,title,icon,unit,features,extra={})=>({id,title,icon,unit,features,...extra});
export function backendPlan(data,date){
 const n=normalizeBackendExport(data),i=n.dates.indexOf(date);if(i<0)throw new Error('Plan view requires an exact saved month.');
 const day=n.byDate.get(date),previous=i>0?n.byDate.get(n.dates[i-1]):null,g=backendGeometry(n),ids=new Set([...day.objectsById.keys(),...(previous?.objectsById.keys()??[])]);
 const objects=[...ids].map(id=>{const now=day.objectsById.get(id),old=previous?.objectsById.get(id),b=now??old;return {id,type:b.type,x:b.x,y:b.y,status:now?.status??'removed',change:stageChange(now,old,Boolean(previous)),current:Boolean(now),value:1,delta:null};});
 const metricFeatures=(type,field)=>[...day.objectsById.values()].filter(b=>b.type===type).map(b=>{
  const old=previous?.objectsById.get(b.id),v=number(b[field]),prior=previous?(old?number(old[field]):0):null,delta=difference(v,prior);
  return {id:b.id,type:b.type,x:b.x,y:b.y,status:b.status,current:true,value:v,delta,change:deltaSymbol(delta)};
 });
 const layers=[
  layer('construction','Construction','construction',n.objectLabel,objects,{kind:'status',summary:`${day.stages.planned} planned · ${day.stages.construction} building · ${day.stages.complete} complete`,scaleMax:1,color:'#434d52'}),
  layer('residents','Residents','population','modeled residents',metricFeatures('residential','actualResidents'),{kind:'quantity',scaleMax:g.max.actualResidents,color:'#3b829c',summary:'Resident stock per residential object; no migration directions are inferred.'}),
  layer('housing','Housing capacity','housing','resident places',metricFeatures('residential','housingCapacity'),{kind:'quantity',scaleMax:g.max.housingCapacity,color:'#4b927d',summary:'Capacity for people, not dwelling units or affordability.'}),
  layer('jobs','Filled jobs','jobs','filled jobs',metricFeatures('business','filledJobs'),{kind:'quantity',scaleMax:g.max.filledJobs,color:'#b48337',summary:'Filled jobs per business object; not economic benefit.'}),
  layer('stations','Stations','rail',n.objectLabel,objects.filter(b=>b.type==='station'),{kind:'status',scaleMax:1,color:'#ad5f5a',summary:'Saved station objects and construction states; no railway alignment or catchment is supplied.'})
 ];
 return {schema:'nm-plan-analysis-v1',key:'backend:'+n.simulationId,source:'backend',title:'Saved city · plan analysis',date,previousDate:previous?.date??null,bounds:g.bounds,context:objects,layers,
  spatialBasis:'Canonical model grid · schematic, not a geographic basemap',comparison:previous?'Changes vs '+previous.date+'; temporal changes are not policy causal effects.':'First saved month · no prior comparison.',
  unavailable:'Building heights, street alignments and POI density are not supplied. No heatmap or metric ground scale is inferred.',unit:n.objectLabel};
}
function portDate(m){return `${m.year}-${String(m.index+8).padStart(2,'0')}-01`;}
export function portPlan(study,monthIndex,cohortId='all'){
 const m=study?.months?.[monthIndex];if(!m)throw new Error('Port plan requires a saved study month.');
 const totals=(s,r)=>{const c=cohortId==='all'?null:s.groups.find(g=>g.id===cohortId);if(cohortId!=='all'&&!c)throw new Error('Unknown passenger group.');return {baseline:c?c.baseline*r.share:r.baseline,extra:c?c.extra*r.share:r.extra};};
 const build=(s,field)=>s.routes.map(r=>({id:r.id,label:r.name,x:r.x,y:r.z,value:totals(s,r)[field],delta:null,change:'unavailable',current:true,type:'route'}));
 const flowScale=Math.max(1,...study.months.flatMap(s=>s.routes.flatMap(r=>[r.baseline,r.extra])));
 const routes=m.routes.map(r=>({id:r.id,label:r.name,x:r.x,y:r.z})),port={x:-14,y:-87};
 return {schema:'nm-plan-analysis-v1',key:'port:'+cohortId,source:'port',title:'Huanggang · passenger plan',date:portDate(m),previousDate:null,bounds:extent([...routes,port]),port,context:routes,
  layers:[layer('trips','Baseline trips','transport','passenger trips/day',build(m,'baseline'),{kind:'flows',scaleMax:flowScale,color:'#337f96',summary:'Assumed no-opening trips allocated to districts.'}),layer('added-trips','Added trips','transport','additional trips/day',build(m,'extra'),{kind:'flows',scaleMax:flowScale,color:'#aa7227',summary:'Additional modeled trips vs the assumed no-opening baseline.'})],
  spatialBasis:'Schematic district links · not measured routes or geographic distances',comparison:'Both flow layers and all groups share one fixed full-study scale. Two-way trip totals; no directional migration is inferred.',
  unavailable:'Route allocation and passenger responses are assumptions. No observed OD, resident migration or building change is supplied.',unit:'passenger trips/day'};
}
export function topicPlan(policy,study,monthIndex){
 const m=study?.months?.[monthIndex];if(!m||m.policyId!==policy.id||m.model!==policy.model)throw new Error('Topic plan requires the matching policy snapshot.');
 const previous=study.months[monthIndex-1],unit=policy.model==='housing'?'housing units':'school places',marker=(value,prior)=>[{id:policy.areaId,label:getArea(policy.areaId).label,x:0,y:0,value,delta:difference(value,prior),change:deltaSymbol(difference(value,prior)),current:true,type:policy.model}];
 return {schema:'nm-plan-analysis-v1',key:'topic:'+policy.id,source:'topic',title:getArea(policy.areaId).label+' · capacity plan',date:m.date,previousDate:previous?.date??null,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},context:[],
  layers:[layer('supply','Commissioned supply',policy.model==='housing'?'housing':'education',unit,marker(m.delivered,previous?.delivered),{kind:'aggregate',scaleMax:Math.max(1,...study.months.map(v=>v.delivered)),color:'#4b927d',summary:'One area-level marker; no individual facility locations are supplied.'}),layer('gap','Unmet demand','capacity',policy.model==='housing'?'households':'eligible pupils',marker(m.policyGap,previous?.policyGap),{kind:'aggregate',scaleMax:Math.max(1,...study.months.map(v=>v.policyGap)),color:'#b17551',summary:'Remaining demand in this assumed scenario; not a spatial catchment.'})],
  spatialBasis:'Area-level schematic · no building footprints or project locations',comparison:previous?'Changes vs '+previous.date+'; values follow the local capacity model.':'First saved month · no prior comparison.',
  unavailable:'All inputs are hypothetical. Capacity is shown at the area level; no density, observed household distribution or school catchment is inferred.',unit};
}
export function selectedPlanLayer(packet,id){return packet.layers.find(l=>l.id===id)??packet.layers[0];}
