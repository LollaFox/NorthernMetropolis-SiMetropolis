import {runStudy,validateInputs,DEFAULTS} from './port-model.js';
export const MONTHS=['August','September','October'];
const copy=x=>JSON.parse(JSON.stringify(x));
const keys=['reach','clearance','capacity'];
const fieldNames={reach:'Information reach (%)',clearance:'Clearance target (min)',capacity:'Effective feeder capacity (trips/day)'};
export function emptyLedger(){return {schema:'huanggang-policy-ledger-v1',base:null,revisions:[]};}
export function applyRevision(ledger,values,effectiveMonth,reason,recordedAt){
  if(!Number.isInteger(effectiveMonth)||effectiveMonth<0||effectiveMonth>2)throw new Error('Select August, September or October as the effective month.');
  if(typeof reason!=='string'||!reason.trim()||reason.trim().length>500)throw new Error('Add an adjustment reason (1–500 characters).');
  if(typeof recordedAt!=='string'||!Number.isFinite(Date.parse(recordedAt)))throw new Error('A valid recorded time is required.');
  if(ledger.revisions.length>=100)throw new Error('This research case is limited to 100 policy revisions.');
  const last=ledger.revisions.at(-1);
  const first=ledger.revisions[0];
  const p=validateInputs({...values,openingMonth:first?first.inputs.openingMonth:effectiveMonth});
  if(last&&effectiveMonth<last.effectiveMonth)throw new Error(`Choose ${MONTHS[last.effectiveMonth]} or later. Earlier policy history is preserved.`);
  if(ledger.base&&['year','timing','baseline'].some(k=>p[k]!==ledger.base[k]))throw new Error('The case year, opening scenario and baseline are fixed after the first application.');
  const changes=last?keys.filter(k=>p[k]!==last.inputs[k]).map(k=>({field:k,label:fieldNames[k],before:last.inputs[k],after:p[k]})):keys.map(k=>({field:k,label:fieldNames[k],before:null,after:p[k]}));
  if(last&&!changes.length)throw new Error('No policy parameters changed. Edit a parameter before applying a revision.');
  const next=copy(ledger);
  if(!next.base)next.base={year:p.year,timing:p.timing,baseline:p.baseline};
  next.revisions.push({id:`HG-${String(next.revisions.length+1).padStart(3,'0')}`,effectiveMonth,inputs:copy(p),reason:reason.trim(),recordedAt,changes});
  return next;
}
export function restoreLedger(data){
  if(!data||data.schema!=='huanggang-policy-ledger-v1'||!Array.isArray(data.revisions)||data.revisions.length>100)throw new Error('Saved policy case has an unsupported format.');
  let restored=emptyLedger();
  for(const r of data.revisions)restored=applyRevision(restored,r.inputs,r.effectiveMonth,r.reason,r.recordedAt);
  return restored;
}
export function buildPolicyStudy(ledger){
  const initial=ledger.revisions[0];
  const noPolicy=runStudy({...DEFAULTS,...initial?.inputs,reach:0});
  const study=copy(noPolicy);
  study.schemaVersion=2;study.model='huanggang-policy-ledger-v1';study.ledger=copy(ledger);
  study.inputs=copy(ledger.revisions.at(-1)?.inputs??DEFAULTS);
  study.months=MONTHS.map((name,index)=>{
    const eligible=ledger.revisions.filter(r=>r.effectiveMonth<=index);
    const revision=eligible.at(-1);
    const snapshot=copy(revision?runStudy(revision.inputs).months[index]:noPolicy.months[index]);
    snapshot.policyState=!revision?'not_applied':snapshot.openingFraction===0?'scheduled':'in_effect';
    snapshot.revisionId=revision?.id??null;snapshot.activeInputs=revision?copy(revision.inputs):null;
    snapshot.appliedHistory=copy(eligible);
    snapshot.revisionDelta=eligible.length>1?snapshot.extra-runStudy(eligible.at(-2).inputs).months[index].extra:null;
    snapshot.trace.unshift({stage:'00 · Policy version at this month',detail:revision?`${revision.id}, effective from ${MONTHS[revision.effectiveMonth]}. ${revision.reason}`:'No applied policy at this month. Only the unchanged baseline is shown.',sources:[]});
    if(!revision){snapshot.trace=snapshot.trace.slice(0,1);snapshot.groups.forEach(g=>{g.reason='No applied policy at this month; no policy response has been calculated.';g.keep=[];g.drop=[];});}
    return snapshot;
  });
  study.totalAdditionalTrips=study.months.reduce((sum,m)=>sum+m.monthlyExtra,0);
  return study;
}
