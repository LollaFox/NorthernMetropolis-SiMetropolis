import {getPolicy,getArea} from './policy-catalog.js';
import {validateTopicInputs,emptyTopicLedger,applyTopicRevision,buildTopicStudy} from './topic-model.js';
import {TOPIC_STORAGE_KEY,emptyTopicStore,restoreTopicStore,addTopicCase} from './topic-store.js';
import {TopicOverlay} from './topic-overlay.js';
import {buildTopicInterpretation} from './policy-interpretation.js';
import {renderInterpretation} from './policy-readout.js';
import {buildTopicCharts} from './policy-chart-model.js';
import {renderPolicyCharts} from './policy-charts.js';
const $=id=>document.getElementById(id);
const n=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;};
const num=v=>new Intl.NumberFormat('en').format(v);
const monthLabel=d=>new Date(d+'T00:00:00Z').toLocaleDateString('en',{month:'short',year:'numeric',timeZone:'UTC'});
export class TopicStudiesUI {
 constructor(owner){
  this.owner=owner;this.city=owner.city;this.port=owner.port;this.store=emptyTopicStore();this.drafts={};this.activeId=null;this.overlay=null;this.storageBlocked=false;this.storageStatus='Scenarios saved in this browser.';
  try{const raw=localStorage.getItem(TOPIC_STORAGE_KEY);if(raw)this.store=restoreTopicStore(JSON.parse(raw));}catch{this.storageBlocked=true;this.storageStatus='Saved topic scenarios could not be read. Working in memory; existing browser data is preserved.';}
 }
 get record(){return this.store.cases.find(c=>c.id===this.activeId);}
 get policy(){return getPolicy(this.record.ledger.policyId);}
 get hasResult(){return Boolean(this.record?.ledger.revisions.length);}
 save(){
  if(this.storageBlocked)return;
  try{localStorage.setItem(TOPIC_STORAGE_KEY,JSON.stringify(this.store));this.storageStatus='Scenarios saved in this browser. Export a copy for your team.';}catch{this.storageStatus='In memory only. Export before closing this page.';}
 }
 activate(policy){
  if(!this.store.cases.some(c=>c.id===this.store.activeByPolicy[policy.id]&&c.ledger.policyId===policy.id))this.store=addTopicCase(this.store,policy.id);
  this.activeId=this.store.activeByPolicy[policy.id];this.study=buildTopicStudy(this.record.ledger);this.record.month=Math.min(this.record.month,this.study.months.length-1);
  document.body.classList.add('analysis-topic');this.city.showPortStudy(false);
  this.city.focusDistrict(getArea(policy.areaId).districtId);
  this.overlay??=new TopicOverlay(this.city);
  this.save();this.render();this.showTab(this.hasResult?'results':'policy');
 }
 leave(){
  this.overlay?.hide();document.body.classList.remove('analysis-topic');
  for(const id of ['topic-policy-review','topic-results','topic-model-trace'])$(id).classList.add('hidden');
  $('port-panel').querySelector('h2').textContent='Policy analysis';$('port-panel').querySelector('.port-subtitle').textContent='Huanggang case · inspect results and evidence.';
  document.querySelector('[data-port-tab="agents"]').textContent='Agents';document.querySelector('[data-port-tab="inputs"]').textContent='Apply / adjust';
 }
 selectCase(id){if(!this.store.cases.some(c=>c.id===id&&c.ledger.policyId===this.policy.id))return;this.store.activeByPolicy[this.policy.id]=id;this.activeId=id;this.study=buildTopicStudy(this.record.ledger);this.record.month=Math.min(this.record.month,this.study.months.length-1);this.save();this.render();this.showTab(this.hasResult?'results':'policy');this.owner.update();}
 newCase(){this.store=addTopicCase(this.store,this.policy.id);this.activeId=this.store.activeByPolicy[this.policy.id];this.study=buildTopicStudy(this.record.ledger);this.save();this.render();this.showTab('policy');this.owner.navigation?.setContext('analysis');this.owner.openPanel();this.owner.status('New independent scenario. Configure assumptions, then Start analysis.');this.owner.update();}
 prepareForm(){
  if(!this.record)return;
  const draft=this.drafts[this.activeId],values=draft?.values??this.record.ledger.revisions.at(-1)?.inputs??this.policy.defaults;
  for(const key of ['demand','supply','growth','added','rollout'])$(`topic-${key}`).value=values[key];
  for(const key of ['start','end','commission'])$(`topic-${key}`).value=values[key].slice(0,7);
  const housing=this.policy.model==='housing';$('topic-config-description').textContent=`${getArea(this.policy.areaId).label} · ${housing?'housing units and households':'school places and eligible pupils'} · all values assumed.`;
  $('topic-added-label').textContent=housing?'Total additional housing units':'Total additional school places';
  $('topic-demand-label').textContent=housing?'Households requiring housing':'Eligible pupils';$('topic-supply-label').textContent=housing?'Baseline usable housing units':'Baseline school places';
  $('topic-growth-label').textContent=housing?'Household demand change / month':'Pupil demand change / month';
  $('topic-effective').replaceChildren();for(const m of this.study.months){const option=n('option',monthLabel(m.date));option.value=m.date;$('topic-effective').append(option);}
  $('topic-effective').value=draft?.effective??this.study.months[this.record.month].date;
  if(!this.hasResult)$('topic-effective').value=values.start;
  $('topic-reason').value=draft?.reason??'';
  for(const key of ['start','end','demand','supply','growth'])$(`topic-${key}`).disabled=this.hasResult;
  $('topic-baseline-note').textContent=this.hasResult?'Baseline and window are locked. Use New case for different starting data.':'Hypothetical starting data; replace with sourced data before research validation.';
 }
 captureDraft(){
  const values={};for(const key of ['demand','supply','growth','added','rollout']){if(!$(`topic-${key}`).value.trim())throw new Error('Complete all numeric assumptions before saving.');values[key]=Number($(`topic-${key}`).value);}
  for(const key of ['start','end','commission'])values[key]=$(`topic-${key}`).value+'-01';
  const validated=validateTopicInputs(this.policy.id,values);
  const effective=this.hasResult?$('topic-effective').value:validated.start;
  this.drafts[this.activeId]={values:validated,effective,reason:$('topic-reason').value.trim()};return this.drafts[this.activeId];
 }
 run(){
  const policy=this.policy,draft=this.drafts[this.activeId],values=draft?.values??this.record.ledger.revisions.at(-1)?.inputs??policy.defaults;
  const last=this.record.ledger.revisions.at(-1),changed=!last||JSON.stringify(validateTopicInputs(policy.id,values))!==JSON.stringify(last.inputs);
  if(changed){const effective=draft?.effective??values.start,reason=draft?.reason||`Hypothetical ${policy.model} study: ${values.added} additions from ${values.commission}.`;
   this.record.ledger=applyTopicRevision(this.record.ledger,values,effective,reason,new Date().toISOString());this.study=buildTopicStudy(this.record.ledger);this.record.month=this.study.months.findIndex(m=>m.date===effective);}
  delete this.drafts[this.activeId];this.save();this.render();this.showTab('results');this.owner.openPanel();this.owner.status('Assumption model ready. Use Result month or jump to commissioning.');
  this.owner.navigation?.markResult(`${this.record.label} · ${policy.label}`);
 }
 selectMonth(index){if(!Number.isInteger(index)||index<0||index>=this.study.months.length)return;this.record.month=index;this.save();this.render();}
 showTab(tab){
  if(tab==='inputs'){this.owner.configure();return;}
  if(!['policy','results','agents'].includes(tab))tab='policy';this.port.tab=tab;
  for(const name of ['policy','results','agents','inputs'])$(name==='policy'?'port-policy-review':`port-${name}`).classList.toggle('hidden',name!==tab);
  for(const button of document.querySelectorAll('[data-port-tab]')){button.classList.toggle('active',button.dataset.portTab===tab);button.setAttribute('aria-pressed',String(button.dataset.portTab===tab));}
  $('port-panel').scrollTop=0;
 }
 render(){
  const p=this.policy,area=getArea(p.areaId),m=this.study.months[this.record.month],housing=p.model==='housing';
  for(const id of ['topic-policy-review','topic-results','topic-model-trace'])$(id).classList.remove('hidden');
  $('port-panel').querySelector('h2').textContent=housing?'Housing analysis':'School places';$('port-panel').querySelector('.port-subtitle').textContent=`${area.label} · hypothetical scenario`;
  document.querySelector('[data-port-tab="agents"]').textContent='Model';document.querySelector('[data-port-tab="inputs"]').textContent='Adjust';
  $('policy-case-select').replaceChildren();for(const c of this.store.cases.filter(c=>c.ledger.policyId===p.id)){const o=n('option',c.label);o.value=c.id;$('policy-case-select').append(o);}$('policy-case-select').value=this.activeId;
  $('policy-month-status').textContent=this.hasResult?`${monthLabel(m.date)} · ${m.revisionId??'Baseline'} · ${m.policyState.replaceAll('_',' ')}`:'Not analyzed · all input values are assumptions';
  $('analysis-panel-source').textContent=this.storageBlocked?'In memory · assumption model':`${housing?'Housing':'Education'} · assumption model`;
  $('analysis-month').replaceChildren();for(const f of this.study.months){const o=n('option',monthLabel(f.date));o.value=f.index;$('analysis-month').append(o);}$('analysis-month').value=m.index;
  $('port-scenario-note').textContent=this.hasResult?`${area.label} · ${monthLabel(m.date)} · hypothetical ${p.model}`:`${area.label} · ${p.label}. Select Start analysis.`;
  const legend=document.querySelector('.port-flow-key');legend.classList.remove('hidden');legend.replaceChildren(n('span','● City context','topic-grey'),n('span','● Commissioned additions','gold'));
  $('port-heading').querySelector('small').textContent=`Gold blocks symbolize ${p.glyphUnit} ${housing?'housing units':'school places'} each; the last block is proportional. Schematic placement, not actual buildings or service catchments.`;
  this.overlay?.show(p,this.hasResult?m:null);
  this.renderPolicy(m);this.renderResults(m);this.renderTrace(m);this.owner.update();
 }
 renderPolicy(m){
  const holder=$('topic-policy-review');holder.replaceChildren(n('p','HYPOTHETICAL POLICY · LOCAL RULE MODEL','port-tag'),n('h3',this.policy.label),n('p',this.policy.description,'port-footnote'),n('p',this.policy.limits,'port-footnote'));
  const configure=n('button','Configure assumptions ↗','analysis-secondary');configure.addEventListener('click',()=>this.owner.configure());holder.append(configure,n('h3','Policy history at this month'));
  if(!m.history.length)holder.append(n('p','No applied policy at this month.','port-footnote'));
  for(const r of m.history){const item=n('article',undefined,'policy-record');item.append(n('strong',`${r.id} · from ${monthLabel(r.effective)}`),n('p',r.reason),n('p',`${r.inputs.added} total additions · commission ${monthLabel(r.inputs.commission)} · ${r.inputs.rollout} month(s).`));holder.append(item);}
  holder.append(n('p',this.storageStatus,'port-footnote'));
 }
 renderResults(m){
  const holder=$('topic-results');holder.replaceChildren();
  if(!this.hasResult){holder.append(n('p','Start analysis to calculate this scenario. The map currently marks the selected study location only.','port-footnote'));return;}
  if(this.owner?.dashboard){this.owner.dashboard.update();return;}
  const visuals=n('div');renderPolicyCharts(visuals,buildTopicCharts({policy:this.policy,study:this.study,monthIndex:this.record.month}));holder.append(visuals);
  const interpretation=n('div');renderInterpretation(interpretation,buildTopicInterpretation({policy:this.policy,study:this.study,monthIndex:this.record.month}));holder.append(interpretation);
  const housing=this.policy.model==='housing';holder.append(n('p',`${monthLabel(m.date)} · ASSUMPTION MODEL`,'port-footnote'));
  const metrics=n('div',undefined,'port-metrics');
  for(const [label,value] of [[housing?'Household demand':'Eligible-pupil demand',m.demand],[housing?'Usable housing units':'Available school places',m.policySupply],[housing?'Unmet housing demand (households)':'Unmet demand (pupils)',m.policyGap]]){const e=n('div');e.append(n('span',label),n('strong',num(value)));metrics.append(e);}holder.append(metrics);
  holder.append(n('p',`No-policy shortfall: ${num(m.baselineGap)} · reduction: ${num(m.gapReduction)} ${housing?'households':'pupils'}.`,'port-footnote'),n('p',`Commissioned additions: ${num(m.delivered)} · planned remaining: ${num(m.remaining)}.`,'port-footnote'));
  if(!housing)holder.append(n('p',`Places / modeled demand: ${m.coverage===null?'No demand':(m.coverage*100).toFixed(1)+'%'}. Capacity coverage only.`,'port-footnote'));
  const commissioning=m.activeInputs.commission,index=this.study.months.findIndex(f=>f.date>=commissioning);
  if(index>=0){const jump=n('button',`Jump to ${monthLabel(commissioning)} commissioning ↗`,'analysis-secondary');jump.addEventListener('click',()=>this.selectMonth(index));holder.append(jump);}else holder.append(n('p','Commissioning is outside the study window; no new capacity appears yet.','port-footnote'));
  holder.append(n('p',this.policy.limits,'port-footnote'));
 }
 chart(current){
  const box=n('div',undefined,'topic-chart'),NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 280 88');svg.setAttribute('role','img');svg.setAttribute('aria-label','Unmet demand over the whole study: baseline cyan, policy gold; lower is better.');
  const max=Math.max(1,...this.study.months.map(m=>m.baselineGap),...this.study.months.map(m=>m.policyGap));
  for(const [key,color] of [['baselineGap','#28c3d7'],['policyGap','#ffbd4c']]){const path=document.createElementNS(NS,'path');path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','2');path.setAttribute('d',this.study.months.map((m,i)=>`${i?'L':'M'}${4+i/(this.study.months.length-1)*272},${78-m[key]/max*70}`).join(' '));svg.append(path);}
  const marker=document.createElementNS(NS,'line');marker.setAttribute('x1',String(4+current.index/(this.study.months.length-1)*272));marker.setAttribute('x2',marker.getAttribute('x1'));marker.setAttribute('y1','4');marker.setAttribute('y2','82');marker.setAttribute('stroke','#c4d1bd');marker.setAttribute('stroke-dasharray','3 3');svg.append(marker);
  box.append(n('p','Unmet demand · lower is better','port-footnote'),svg,n('p',`Cyan: no-policy baseline · Gold: policy. ${monthLabel(this.study.months[0].date)} → ${monthLabel(this.study.months.at(-1).date)}.`,'port-footnote'));return box;
 }
 renderTrace(m){
  const holder=$('topic-model-trace');holder.replaceChildren(n('p','Deterministic calculations. No LLM or generated resident decisions are used.','port-footnote'));
  for(const step of m.trace){const e=n('div',undefined,'port-trace-step');e.append(n('strong',step.stage),n('p',step.detail));holder.append(e);}
 }
 export(){
  const data={...this.study,catalogPolicy:this.policy,caseId:this.record.id,caseLabel:this.record.label,viewMonth:this.study.months[this.record.month].date,interpretation:buildTopicInterpretation({policy:this.policy,study:this.study,monthIndex:this.record.month}),charts:buildTopicCharts({policy:this.policy,study:this.study,monthIndex:this.record.month})};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=n('a');a.href=url;a.download=`${this.policy.id}-${this.record.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
}
