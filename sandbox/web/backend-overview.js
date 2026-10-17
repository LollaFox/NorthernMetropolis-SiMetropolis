export const isBackendReplay=envelope=>envelope?.world?.version==='narrative-display-1';
export function metricText(value,formatter=String){return typeof value==='number'&&Number.isFinite(value)?formatter(value):'Not modeled';}
export function savedMonthValue(envelope,exported,date){
 const index=exported.monthlyStates.findIndex(w=>w.month===date),timeline=envelope.timeline??[];
 if(index<0||timeline.length!==exported.monthlyStates.length||!Number.isInteger(timeline[index]?.month))throw new Error('This date has no matching saved overview month.');
 return timeline[index].month;
}
export function backendBuildingLabels(building){
 const complete=building.progress>=1;
 if(building.kind==='housing')return {name:'Residential development cluster',capacity:complete?'Resident places':'Planned resident places'};
 if(building.kind==='office')return {name:'Business development cluster',capacity:'Offered job capacity'};
 return {name:building.kind==='transit'?'Station scenario object':'Park scenario object',capacity:null};
}
