import {getPolicy} from './policy-catalog.js';
import {emptyTopicLedger,restoreTopicLedger} from './topic-model.js';
export const TOPIC_STORAGE_KEY='nm-topic-scenarios-v1';
export function emptyTopicStore(){return {schema:TOPIC_STORAGE_KEY,activeByPolicy:{},cases:[]};}
export function restoreTopicStore(raw){
 if(!raw||raw.schema!==TOPIC_STORAGE_KEY||!Array.isArray(raw.cases)||raw.cases.length>40||!raw.activeByPolicy||typeof raw.activeByPolicy!=='object')throw new Error('Unsupported scenario storage.');
 const ids=new Set();const cases=raw.cases.map(c=>{if(typeof c.id!=='string'||!/^topic-[a-z0-9-]{1,80}$/.test(c.id)||ids.has(c.id)||typeof c.label!=='string'||!c.label.trim()||c.label.length>80||!Number.isInteger(c.month)||c.month<0||c.month>59)throw new Error('Invalid topic scenario.');ids.add(c.id);const ledger=restoreTopicLedger(c.ledger);if(!getPolicy(ledger.policyId).defaults)throw new Error('Invalid topic model.');return {id:c.id,label:c.label,month:c.month,ledger};});
 const result=emptyTopicStore();result.cases=cases;
 for(const c of cases){const p=c.ledger.policyId;result.activeByPolicy[p]=cases.some(x=>x.id===raw.activeByPolicy[p]&&x.ledger.policyId===p)?raw.activeByPolicy[p]:c.id;}
 return result;
}
export function addTopicCase(store,policyId){
 getPolicy(policyId);if(store.cases.length>=40)throw new Error('Export scenarios before exceeding the 40-case preview limit.');
 const next=JSON.parse(JSON.stringify(store));const n=next.cases.filter(c=>c.ledger.policyId===policyId).length+1;
 let count=next.cases.length+1,id=`topic-${count}`;while(next.cases.some(c=>c.id===id))id=`topic-${++count}`;
 next.cases.push({id,label:`Scenario ${n}`,month:0,ledger:emptyTopicLedger(policyId)});next.activeByPolicy[policyId]=id;return next;
}
