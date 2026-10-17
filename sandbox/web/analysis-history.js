import {getPolicy} from './policy-catalog.js';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value));
export function backendHistory(data){
 if(data?.schema!=='nm-analysis-history-v1'||!Array.isArray(data.simulations))throw new Error('Unsupported backend history index.');
 const seen=new Set();return data.simulations.map(row=>{
  if(!validId(row.simulationId)||seen.has(row.simulationId)||!iso(row.start)||!iso(row.end)||!Number.isInteger(row.savedMonths)||row.savedMonths<1)throw new Error('Invalid saved backend history record.');
  seen.add(row.simulationId);const complete=row.status==='complete';
  const title=row.policyId==='offline-narrative-demo'?'Northern Metropolis · offline city':row.policyId?'Government-script city · '+row.policyId:'Government-script city';
  return {id:'backend:'+row.simulationId,source:'backend',sourceLabel:'Backend city · synthetic',title,start:row.start,end:row.end,status:complete?'Complete':'Partial · '+(row.status||'unknown'),savedMonths:row.savedMonths,provider:row.provider||'Not recorded',order:row.createdOrder??0,simulationId:row.simulationId};
 }).sort((a,b)=>b.order-a.order);
}
export function localHistory(portCases=[],topicCases=[]){
 const rows=[];
 for(const item of portCases){const revisions=item.ledger?.revisions;if(!revisions?.length)continue;const year=revisions[0].inputs.year;
  rows.push({id:'port:'+item.id,source:'port',sourceLabel:'Local · Huanggang rule demo',title:item.label+' · Port opening',start:year+'-08-01',end:year+'-10-01',status:'Analyzed · assumptions',updated:revisions.at(-1).recordedAt,caseId:item.id,policyId:'huanggang-opening',tags:item.analysisTags??['border-access']});
 }
 for(const item of topicCases){const revisions=item.ledger?.revisions;if(!revisions?.length)continue;const policy=getPolicy(item.ledger.policyId),inputs=revisions[0].inputs;
  rows.push({id:'topic:'+item.id,source:policy.model,sourceLabel:'Local · '+(policy.model==='housing'?'Housing':'School places')+' assumptions',title:item.label+' · '+policy.label,start:inputs.start,end:inputs.end,status:'Analyzed · hypothetical',updated:revisions.at(-1).recordedAt,caseId:item.id,policyId:policy.id,tags:[policy.primaryTag]});
 }
 return rows.sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
}
export function filterHistory(rows,query='',source='all'){const q=query.trim().toLowerCase();return rows.filter(r=>(source==='all'||r.source===source)&&(!q||[r.title,r.sourceLabel,r.status,r.start,r.end,r.id].join(' ').toLowerCase().includes(q)));}
