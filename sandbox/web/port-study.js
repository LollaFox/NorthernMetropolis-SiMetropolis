import {POLICY_TAGS} from './analysis-scope.js';
import {buildPortInterpretation} from './policy-interpretation.js';
import {buildPortCharts} from './policy-chart-model.js';
import {DEFAULTS,SOURCES} from './port-model.js';
import {emptyLedger,applyRevision,buildPolicyStudy,restoreLedger,MONTHS} from './policy-ledger.js';
const STORAGE_KEY='huanggang-policy-workspace-v1';
const CASE_KEY='huanggang-policy-workspace-cases-v1';
const $=id=>document.getElementById(id);
const number=n=>new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(n);
function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
export class PortStudyUI {
  constructor(city,options){
    this.city=city;this.options=options;this.active=false;this.opening=false;this.month=0;this.timer=null;this.motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;this.ledger=emptyLedger();this.tab='policy';this.saveStatus='No policy has been applied. The map shows the baseline only.';
    try { const saved=localStorage.getItem(STORAGE_KEY); if(saved){this.ledger=restoreLedger(JSON.parse(saved));this.saveStatus='Applied policy history restored from this browser.';} } catch(_){this.saveStatus='Saved history could not be loaded. Export or recover the existing browser data before relying on this case.';}
    this.cases=[{id:'case-1',label:'Case 1',ledger:this.ledger}];this.caseId='case-1';
    try{const raw=localStorage.getItem(CASE_KEY);if(raw){const saved=JSON.parse(raw);if(!Array.isArray(saved.cases)||!saved.cases.length||saved.cases.length>20)throw new Error('Invalid case list');const seen=new Set();this.cases=saved.cases.map(c=>{if(typeof c.id!=='string'||seen.has(c.id)||typeof c.label!=='string'||c.label.length>80)throw new Error('Invalid case');seen.add(c.id);return {id:c.id,label:c.label,ledger:restoreLedger(c.ledger),analysisTags:Array.isArray(c.analysisTags)&&c.analysisTags.length&&c.analysisTags.every(id=>POLICY_TAGS.some(t=>t.id===id&&t.rules))?[...new Set(c.analysisTags)]:['border-access']};});this.caseId=this.cases.some(c=>c.id===saved.activeId)?saved.activeId:this.cases[0].id;this.ledger=this.cases.find(c=>c.id===this.caseId).ledger;this.saveStatus='Research cases restored from this browser.';}}catch(_){this.cases=[{id:'case-1',label:'Case 1',ledger:this.ledger}];this.caseId='case-1';this.saveStatus='Case list could not be restored. The loaded single case remains available.';}
    this.study=buildPolicyStudy(this.ledger);
    $('policy-new-case').addEventListener('click',()=>{if(this.analysis?.localTopic){try{this.analysis.topics.newCase();}catch(e){this.analysis.status(e.message,true);}return;}if(this.cases.length>=20){this.error(new Error('This workspace supports up to 20 retained cases. Export cases for further research.'));return;}this.stop();const id=`case-${this.cases.length+1}`;this.cases.push({id,label:`Case ${this.cases.length+1}`,ledger:emptyLedger()});this.selectCase(id);this.analysis?.navigation?.setContext('analysis');});
    $('policy-case-select').addEventListener('change',e=>this.analysis?.localTopic?this.analysis.topics.selectCase(e.target.value):this.selectCase(e.target.value));
    $('port-collapse').addEventListener('click',()=>{$('port-panel').classList.add('hidden');$('port-expand').classList.remove('hidden');this.analysis?.navigation?.update();});
    $('port-close').addEventListener('click',()=>this.close());
    for(const b of document.querySelectorAll('[data-port-tab]'))b.addEventListener('click',()=>this.showTab(b.dataset.portTab));
    for(const b of document.querySelectorAll('.port-months button[data-port-month]'))b.addEventListener('click',()=>{this.stop();this.month=Number(b.dataset.portMonth);this.render();});
    for(const id of ['port-mode','port-cohort'])$(id).addEventListener('change',()=>this.render());
    $('port-motion').addEventListener('click',()=>{this.motion=!this.motion;this.updateMotion();});
    $('port-play').addEventListener('click',()=>this.timer?this.stop():this.play());
    $('port-form').addEventListener('input',()=>{this.draftDirty=true;$('port-input-status').textContent='Unapplied draft. Monthly snapshots still show the saved policy.';});
    $('policy-adjust-month').addEventListener('click',()=>{if(this.analysis?.localTopic){this.analysis.configure();return;}this.prepareForm();this.showTab('inputs');});
    $('port-timing').addEventListener('change',()=>{const fixed=$('port-timing').value==='announced';$('port-year').disabled=fixed;if(fixed)$('port-year').value='2026';});
    $('port-form').addEventListener('submit',e=>{e.preventDefault();try{
      const values={year:Number($('port-year').value),timing:$('port-timing').value,baseline:Number($('port-base').value),reach:Number($('port-reach').value),clearance:Number($('port-clearance').value),capacity:Number($('port-cap').value)};
      const effective=Number($('policy-effective').value);
      const next=applyRevision(this.ledger,values,effective,$('policy-reason').value,new Date().toISOString());
      const result=buildPolicyStudy(next);
      this.stop();this.ledger=next;this.study=result;this.month=effective;
      this.saveCases();
      $('port-input-status').textContent='Applied to the simulation. Earlier monthly snapshots are preserved.';
      this.render();this.prepareForm();this.showTab('policy');
    }catch(error){this.error(error);}});
    $('port-export').addEventListener('click',()=>{
      if(this.analysis?.localTopic){this.analysis.topics.export();return;}
      if(this.analysis&&this.analysis.engine!=='rules'){this.analysis.exportAPI();return;}
      const tags=this.cases.find(c=>c.id===this.caseId).analysisTags??['border-access'];
      const blob=new Blob([JSON.stringify({...this.study,policyTags:tags,caseId:this.caseId,caseLabel:this.cases.find(c=>c.id===this.caseId).label,view:{month:this.month,cohort:$('port-cohort').value,mode:$('port-mode').value},interpretation:buildPortInterpretation({study:this.study,monthIndex:this.month,cohortId:$('port-cohort').value,tags}),charts:buildPortCharts({study:this.study,monthIndex:this.month,cohortId:$('port-cohort').value})},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=`huanggang-study-${this.study.inputs.year}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});
    for(const source of SOURCES){const link=node('a','',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';$('port-source-list').append(link,node('p','',source.fact));}
    this.prepareForm();this.updateMotion();
  }
  saveCases(){
    const active=this.cases.find(c=>c.id===this.caseId);active.ledger=this.ledger;
    try{localStorage.setItem(CASE_KEY,JSON.stringify({activeId:this.caseId,cases:this.cases}));this.saveStatus='Research cases saved in this browser. Export copies for your team.';}catch(_){this.saveStatus='In memory only: browser storage is unavailable. Export before closing.';}
  }
  selectCase(id){
    const selected=this.cases.find(c=>c.id===id);if(!selected)return;
    this.stop();this.caseId=id;this.ledger=selected.ledger;this.study=buildPolicyStudy(this.ledger);this.month=0;this.prepareForm();this.saveCases();this.render();this.showTab('policy');
  }
  error(e){$('port-input-status').textContent=e.message;this.showTab('inputs');}
  async open(){
    if(this.opening||this.active)return;this.opening=true;
    try{
      await this.options.pause();this.options.clearPanels();this.active=true;
      document.body.classList.add('port-study-active');
      for(const id of ['port-heading','port-panel','port-deck'])$(id).classList.remove('hidden');
      this.city.resetCamera();this.city.showPortStudy(true);this.showTab(this.tab);this.render();this.analysis?.onOpen();
    }finally{this.opening=false;}
  }
  close(){this.stop();this.analysis?.backend.pauseForExit();this.active=false;document.body.classList.remove('port-study-active');for(const id of ['port-heading','port-panel','port-deck'])$(id).classList.add('hidden');this.city.showPortStudy(false);}
  showTab(tab){if(this.analysis?.localTopic){this.analysis.topics.showTab(tab);return;}if(this.analysis&&this.analysis.engine!=='rules'){this.analysis.showApiResults();return;}this.tab=tab;for(const name of ['policy','results','agents','inputs'])$(name==='policy'?'port-policy-review':`port-${name}`).classList.toggle('hidden',name!==tab);for(const b of document.querySelectorAll('[data-port-tab]')){b.classList.toggle('active',b.dataset.portTab===tab);b.setAttribute('aria-pressed',String(b.dataset.portTab===tab));}if(tab==='inputs'&&!this.draftDirty)this.prepareForm();$('port-panel').scrollTop=0;}
  prepareForm(){
    const p=this.study.months[this.month].activeInputs??this.ledger.revisions.at(-1)?.inputs??DEFAULTS;
    for(const [id,key] of [['port-year','year'],['port-timing','timing'],['port-base','baseline'],['port-reach','reach'],['port-clearance','clearance'],['port-cap','capacity']])$(id).value=p[key];
    const locked=this.ledger.revisions.length>0;
    for(const id of ['port-year','port-timing','port-base'])$(id).disabled=locked||(id==='port-year'&&p.timing==='announced');
    $('policy-effective').value=String(this.month);$('policy-reason').value='';
    $('policy-apply').textContent=locked?'Apply adjustment ↗':'Apply to simulation ↗';
    this.draftInitialized=true;this.draftDirty=false;$('port-input-status').textContent=`Draft effective from ${MONTHS[this.month]}. Apply explicitly to change the simulation.`;
  }
  renderPolicy(snapshot){
    $('policy-case-select').replaceChildren();for(const c of this.cases){const option=node('option','',c.label);option.value=c.id;$('policy-case-select').append(option);}$('policy-case-select').value=this.caseId;
    const labels={not_applied:'No policy applied',scheduled:'Applied · awaiting port opening',in_effect:'In effect'};
    $('policy-month-status').textContent=`${snapshot.name} ${snapshot.year} · ${snapshot.revisionId??'Baseline'} · ${labels[snapshot.policyState]}`;
    $('policy-adjust-month').textContent=this.ledger.revisions.length?`Adjust from ${snapshot.name} ↗`:'Adjust assumptions ↗';
    $('policy-save-status').textContent=this.saveStatus;
    const holder=$('policy-month-record');holder.replaceChildren();
    if(!snapshot.appliedHistory.length)holder.append(node('p','port-footnote','No applied policy exists at this month. Future applications do not rewrite this snapshot.'));
    for(const revision of snapshot.appliedHistory){
      const item=node('article','policy-record');
      item.append(node('strong','',`${revision.id} · from ${MONTHS[revision.effectiveMonth]}${revision.id===snapshot.revisionId?' · effective version':''}`),node('p','',revision.reason));
      for(const change of revision.changes)item.append(node('p','',`${change.label}: ${change.before===null?'initial':number(change.before)} → ${number(change.after)}`));
      item.append(node('small','',`Recorded ${new Date(revision.recordedAt).toLocaleString('en-GB')}`));holder.append(item);
    }
  }
  updateMotion(){this.city.setPortMotion(this.motion);$('port-motion').textContent=this.motion?'Pause flow':'Animate flow';$('port-motion').setAttribute('aria-pressed',String(this.motion));}
  play(){if(!this.ledger.revisions.length)return;this.month=0;this.render();$('port-play').textContent='Pause playback Ⅱ';this.timer=setInterval(()=>{if(this.month>=2){this.stop();return;}this.month++;this.render();if(this.month===2)this.stop();},2200);}
  stop(){clearInterval(this.timer);this.timer=null;$('port-play').textContent='Review Aug–Oct ▶';}
  render(){
    if(this.analysis?.apiResults||this.analysis?.localTopic)return;
    const snapshot=this.study.months[this.month],cohortId=$('port-cohort').value,mode=$('port-mode').value;
    const group=cohortId==='all'?null:snapshot.groups.find(g=>g.id===cohortId);
    const baseline=group?.baseline??snapshot.baseline,extra=group?.extra??snapshot.extra;
    $('port-scenario-note').textContent=!this.ledger.revisions.length?'Choose policy tags below, then Start analysis. Configure assumptions when needed.':this.study.inputs.timing==='hypothetical'?`Hypothetical opening: 1 ${MONTHS[this.study.inputs.openingMonth]} ${snapshot.year}. Official opening: 12 Oct 2026.`:'Official opening: 12 Oct 2026. Applied parameters become active when the port opens.';
    if(this.tab==='inputs'&&!this.draftDirty)this.prepareForm();
    this.renderPolicy(snapshot);$('port-play').disabled=!this.ledger.revisions.length;
    $('port-month-title').textContent=$('port-result-month').textContent=`${snapshot.name} ${snapshot.year}`;
    $('port-group-label').textContent=`${group?group.name.replace(' agent',''):'All passengers'} · two-way trips/day`;
    $('port-baseline').textContent=number(baseline);$('port-policy').textContent=number(baseline+extra);$('port-extra').textContent=`+${number(extra)}`;
    $('policy-adjustment-effect').textContent=snapshot.revisionDelta===null?'No earlier applied version to compare at this month.':`Latest adjustment: ${snapshot.revisionDelta>=0?'+':''}${number(snapshot.revisionDelta)} trips/day versus the previous policy version at the same month (all passengers).`;
    $('port-capacity').textContent=`All passengers: ${(snapshot.capacityUse*100).toFixed(1)}% of assumed feeder capacity. ${number(snapshot.unserved)} extra requested trips/day unserved. ${this.study.inputs.timing==='announced'&&this.month===2?'October includes only 12–31 Oct exposure.':''}`;
    for(const b of document.querySelectorAll('.port-months button[data-port-month]')){const active=Number(b.dataset.portMonth)===this.month;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));let tag=b.querySelector('small');if(!tag){tag=node('small');b.append(tag);}const m=this.study.months[Number(b.dataset.portMonth)];tag.textContent=m.revisionId??'Baseline';}
    const extraFor=m=>cohortId==='all'?m.extra:m.groups.find(g=>g.id===cohortId).extra;
    const max=Math.max(1,...this.study.months.map(extraFor));$('port-chart').replaceChildren();
    for(const m of this.study.months){const value=extraFor(m),button=node('button',m.index===this.month?'active':'');button.setAttribute('aria-label',`${m.name}: ${number(value)} additional trips per day`);const bar=node('span','bar');bar.style.height=`${Math.max(1,value/max*43)}px`;button.append(node('span','',`+${number(value)}`),bar,node('span','',m.name.slice(0,3)));button.addEventListener('click',()=>{this.stop();this.month=m.index;this.render();});$('port-chart').append(button);}
    $('port-route-list').replaceChildren(node('p','quiet','Illustrative destination split · added trips/day'));
    for(const r of snapshot.routes){const row=node('div','port-route');row.append(node('span','',r.name),node('strong','',`+${number(extra*r.share)}`));$('port-route-list').append(row);}
    $('port-trace').replaceChildren();
    for(const step of snapshot.trace){const item=node('div','port-trace-step');item.append(node('strong','',step.stage),node('p','',step.detail));$('port-trace').append(item);}
    $('port-group-traces').replaceChildren();
    for(const g of snapshot.groups){if(snapshot.policyState==='not_applied')continue;if(group&&g.id!==group.id)continue;const detail=node('details','port-agent');detail.append(node('summary','',`${g.name} · +${number(g.extra)} trips/day`),node('p','agent-filter',`Kept: ${g.keep.join(' · ')}`),node('p','',`Ignored for this decision: ${g.drop.join(' · ')}`),node('p','',g.reason),node('p','',`Rule: baseline × sensitivity × clearance gain × informed share × uptake × opening fraction. Assumed sensitivity ${g.sensitivity}; informed ${(g.informed*100).toFixed(1)}%; uptake ${(g.adoption*100).toFixed(0)}%; exposure ${(g.exposure*100).toFixed(1)}%. Capacity settlement follows.`));$('port-group-traces').append(detail);}
    document.body.dataset.policyRevision=snapshot.revisionId??'none';document.body.dataset.policyState=snapshot.policyState;
    document.body.dataset.portMonth=String(this.month);document.body.dataset.portMode=mode;document.body.dataset.portCohort=cohortId;
    this.city.setPortStudy(snapshot,mode,cohortId);this.city.setPortMotion(this.motion);this.analysis?.onRuleRender(snapshot);
  }
}
