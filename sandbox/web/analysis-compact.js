import {mountGovernment,syncGovernment,governmentSetup} from './government-product.js';
import {AREAS,POLICIES,CATALOG_VERSION,getPolicy,getArea,matchingPolicies,matchingTags,assertPolicyScope} from './policy-catalog.js';
import {TopicStudiesUI} from './topic-ui.js';
import {buildPortInterpretation,buildApiInterpretation} from './policy-interpretation.js';
import {renderInterpretation} from './policy-readout.js';
import {buildPortCharts,buildApiCharts} from './policy-chart-model.js';
import {renderPolicyCharts} from './policy-charts.js';
import {createPolicyIcon} from './policy-visuals.js';
import {BackendWorkspace} from './backend-workspace.js';
import {POLICY_TAGS,validateTags,scopeMetadata,sameInputs} from './analysis-scope.js';
import {applyRevision,buildPolicyStudy,MONTHS} from './policy-ledger.js';
import {V3Session,HttpTransport} from './v3-api.js';
import {FixtureTransport} from './v3-fixture.js';
import {validateSetup,hkToday} from './v3-contract.js';
import {RegionPicker} from './v3-region.js';
import {V3Map} from './v3-map.js';
import {describeAnalysisCapability,renderCapabilityBrief,needsScriptAcknowledgement} from './analysis-capability.js';
const $=id=>document.getElementById(id);
const node=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;return n;};
const number=n=>new Intl.NumberFormat('en').format(Math.round(n));
export class CompactAnalysisUI {
 constructor(city,port,host={}){
  this.city=city;this.port=port;this.engine='rules';this.selected=[...(port.cases.find(c=>c.id===port.caseId)?.analysisTags??['border-access'])];this.lastCaseId=port.caseId;this.resultTags=null;this.apiResults=false;this.apiMap=null;this.apiIndex=0;this.frameGeneration=0;this.session=null;this.busy=false;this.sampleFile=null;this.config={backendConfigured:false};this.savedSetup=null;this.pendingTags=null;this.requiresDeepseekKey=Boolean($('deepseek-api-key'));
  this.policyId='huanggang-opening';this.areaId='huanggang';this.topics=new TopicStudiesUI(this);
  this.initCatalog();this.drawTags();this.bind();mountGovernment(this);this.observeLayout();this.onRuleRender(port.study.months[port.month]);this.backend=new BackendWorkspace(this,host);
  const b=this.bounds();this.picker=new RegionPicker($('analysis-area-map'),value=>{for(const key of Object.keys(value))$(`analysis-${key}`).value=value[key].toFixed(6);this.picker.set(value);});this.picker.set(b);
  $('analysis-start-date').max=new Date(Date.parse(hkToday())-86400000).toISOString().slice(0,10);
  this.ready=new HttpTransport().request('/config').then(c=>{this.config=c;this.backend.configure();this.renderEngineNote();}).catch(()=>{this.config={backendConfigured:false};this.renderEngineNote();});
 }
 initCatalog(){
  $('analysis-area').replaceChildren();for(const a of AREAS){const o=node('option',a.label);o.value=a.id;$('analysis-area').append(o);}$('analysis-area').value=this.areaId;
  this.syncPolicyChoices(false);
  $('analysis-area').addEventListener('change',()=>{this.areaId=$('analysis-area').value;const first=matchingPolicies(this.areaId)[0];this.selected=[first.primaryTag];this.syncPolicyChoices();this.drawTags();});
  $('analysis-policy').addEventListener('change',()=>this.selectPolicy($('analysis-policy').value));
 }
 syncPolicyChoices(activate=true){
  if(!this.selected.length){$('analysis-policy').replaceChildren();const o=node('option','Select policy tags first');o.value='';$('analysis-policy').append(o);this.clearSelection();this.status('Choose at least one policy tag to enable analysis.');return;}
  const choices=matchingPolicies(this.areaId,this.selected);$('analysis-policy').replaceChildren();
  if(!choices.length){const o=node('option','No matching policy');o.value='';$('analysis-policy').append(o);this.clearSelection();this.status('No policy matches these tags in this area.');return;}
  for(const p of choices){const o=node('option',p.label);o.value=p.id;$('analysis-policy').append(o);}
  const id=choices.some(p=>p.id===this.policyId)?this.policyId:choices[0].id;$('analysis-policy').value=id;
  if(activate)this.selectPolicy(id);else this.policyId=id;
 }
 clearSelection(){this.port.stop();this.session?.reset();this.session=null;this.restoreRules();this.policyId='';this.city.showPortStudy(false);this.onOpen();$('port-scenario-note').textContent='Choose a policy tag below to select an analysis scope.';}
 selectPolicy(id){
  if(!id)return;const p=getPolicy(id);this.presetAcknowledged=false;this.port.stop();this.session?.reset();this.session=null;this.restoreRules();this.policyId=id;this.areaId=p.areaId;$('analysis-area').value=this.areaId;
  if(!this.selected.length||!this.selected.every(t=>p.tags.includes(t)))this.selected=[p.primaryTag];
  if(this.engine==='rules'){
   if(p.model==='huanggang'){this.city.resetCamera();this.port.render();this.port.showTab('policy');}
   else this.topics.activate(p);
  }else{
   if(p.model!=='huanggang')this.topics.activate(p);this.topics.leave();this.city.showPortStudy(false);this.showApiResults();
   $('port-scenario-note').textContent=getArea(p.areaId).label+' · '+p.label+' · API setup pending';
  }
  this.drawTags();this.onOpen();this.status(p.model==='huanggang'?'Port study selected. Start analysis to inspect its saved response.':'Hypothetical '+p.model+' scenario selected. Configure assumptions or Start analysis.');this.update();
 }
 get currentPolicy(){return getPolicy(this.policyId||'huanggang-opening');}
 get localTopic(){return Boolean(this.policyId)&&this.engine==='rules'&&this.currentPolicy.model!=='huanggang';}
 get sourceLabel(){return this.backendReplay?'Saved backend city · synthetic':!this.policyId?'Choose policy tags':this.engine==='rules'?(this.localTopic?'Hypothetical '+this.currentPolicy.model:'Local policy demo · port rules'):this.engine==='fixture'?'API test · synthetic':this.apiResults?'Backend model results · synthetic':'Team API setup';}
 renderCapability(){renderCapabilityBrief($('analysis-capability'),describeAnalysisCapability({policy:this.policyId?this.currentPolicy:null,engine:this.engine,backendActive:this.backend?.active,presetAcknowledged:this.presetAcknowledged}));}
 observeLayout(){
  const deck=$('port-deck');
  if(typeof ResizeObserver!=='function'||typeof window==='undefined'||!deck?.getBoundingClientRect||!document.documentElement?.style)return;
  this.deckObserver=new ResizeObserver(()=>{const rect=deck.getBoundingClientRect();if(rect.height<=0||rect.top<0||rect.top>=window.innerHeight)return;document.documentElement.style.setProperty('--analysis-panel-bottom',`${Math.ceil(window.innerHeight-rect.top+12)}px`);});
  this.deckObserver.observe(deck);
 }
 status(message,error=false){$('analysis-entry-status').textContent=message;$('analysis-entry-status').dataset.error=String(error);$('analysis-start').title=message;}
 openPanel(){ $('port-panel').classList.remove('hidden');$('port-expand').classList.remove('hidden');this.navigation?.update(); }
 onOpen(){ $('port-panel').classList.add('hidden');$('port-expand').classList.remove('hidden'); }
 bind(){
  $('analysis-start').addEventListener('click',()=>this.start());
  $('analysis-settings').addEventListener('click',()=>this.configure());
  $('analysis-month').addEventListener('change',()=>{if(this.backendReplay){this.backend.selectMonth(Number($('analysis-month').value));return;}if(this.localTopic){this.topics.selectMonth(Number($('analysis-month').value));return;}if(this.apiResults)this.loadFrame(Number($('analysis-month').value));else {this.port.stop();this.port.month=Number($('analysis-month').value);this.port.render();}});
  $('analysis-config-close').addEventListener('click',()=>$('analysis-config-dialog').close());
  $('analysis-review-close').addEventListener('click',()=>$('analysis-review-dialog').close());
  $('analysis-review-ack').addEventListener('change',()=>this.update());
  $('analysis-confirm-run').addEventListener('click',()=>this.confirmAndRun());
  $('analysis-config-form').addEventListener('submit',e=>{e.preventDefault();this.saveConfiguration();});
  $('deepseek-api-key')?.addEventListener('input',()=>{this.syncSaveAvailability();if($('deepseek-api-key').value.trim()&&$('analysis-config-status').classList.contains('config-key-warning'))this.configNote('');});
  $('analysis-engine').addEventListener('change',()=>{if($('analysis-preset-ack'))$('analysis-preset-ack').checked=false;this.renderEngineNote();});
  $('analysis-sample-pdf').addEventListener('click',async()=>{try{const r=await fetch('./fixture-plan.pdf');if(!r.ok)throw new Error('Test PDF unavailable.');this.sampleFile=new File([await r.blob()],'fixture-plan.pdf',{type:'application/pdf'});$('analysis-pdf-note').textContent='Test PDF selected. No PDF content is analyzed in fixture mode.';}catch(e){this.configNote(e.message);}});
  $('analysis-plan').addEventListener('change',()=>{this.sampleFile=null;const name=$('analysis-plan').files[0]?.name;$('analysis-pdf-note').textContent=(name?name+' · ':'')+'PDF attachment, up to 20 MB. In the scripted backend, its text does not change construction.';});
  for(const key of ['west','east','south','north'])$(`analysis-${key}`).addEventListener('input',()=>this.picker.set(this.bounds()));
  $('analysis-load-map').addEventListener('click',()=>{this.picker.loadTiles(this.config.tileURL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',s=>$('analysis-area-status').textContent=s);$('analysis-load-map').disabled=true;});
  const edit=node('button','Edit demo assumptions ↗','analysis-secondary');edit.type='button';edit.id='analysis-rule-assumptions';edit.addEventListener('click',()=>{$('analysis-config-dialog').close();this.port.prepareForm();this.openPanel();this.port.showTab('inputs');});$('analysis-engine-note').after(edit);
 }
 drawTags(){
  const holder=$('analysis-tag-list');holder.replaceChildren();
  const allowed=this.areaId?matchingTags(this.areaId):POLICY_TAGS.map(t=>t.id);
  const tagIcons={'border-access':'transport','transport-capacity':'capacity','information-reach':'information','housing-affordability':'housing','public-services':'education'};
  for(const tag of POLICY_TAGS){const label=node('label',undefined,'analysis-tag-chip');const checkbox=node('input');checkbox.type='checkbox';checkbox.value=tag.id;checkbox.checked=this.selected.includes(tag.id);checkbox.disabled=!allowed.includes(tag.id);const areas=AREAS.filter(a=>matchingTags(a.id).includes(tag.id)).map(a=>a.label).join(' / ');label.title=checkbox.disabled?`Switch Study area to ${areas} to select ${tag.label}`:tag.focus;checkbox.setAttribute('aria-label',`${tag.label}${checkbox.disabled?' · available in '+areas:''}`);label.append(checkbox,createPolicyIcon(tagIcons[tag.id],{size:16}),node('span',tag.label));checkbox.addEventListener('change',()=>{this.selected=Array.from(holder.querySelectorAll('input:checked')).map(c=>c.value);this.syncPolicyChoices();this.renderTagSummary();this.update();});holder.append(label);}
  this.renderTagSummary();
 }
 renderTagSummary(){const tags=POLICY_TAGS.filter(t=>this.selected.includes(t.id));$('analysis-tag-summary').textContent=tags.length?`${tags.length} selected`:'Select at least one';$('analysis-tag-summary').title=tags.map(t=>t.label).join(' · ');}
 bounds(){return Object.fromEntries(['west','east','south','north'].map(k=>[k,Number($(`analysis-${k}`).value)]));}
 setup(){return {...governmentSetup(),bounds:this.bounds(),start:$('analysis-start-date').value,end:$('analysis-end-date').value,step:$('analysis-step').value,policyScope:{...scopeMetadata(this.selected,this.engine),policyId:this.policyId,areaId:this.areaId,model:this.currentPolicy.model,catalogVersion:CATALOG_VERSION}};}
 configNote(message){const el=$('analysis-config-status');el.textContent=message||'';el.classList.toggle('config-key-warning',/^Enter (a|the) DeepSeek API/.test(message||''));}
 syncSaveAvailability(){if(!this.requiresDeepseekKey)return;const button=$('analysis-save-config');if(!button)return;const idle=!$('deepseek-api-key')?.value.trim();button.classList.toggle('config-save-idle',idle);button.setAttribute('aria-disabled',idle?'true':'false');}
 configure(){if(this.busy)return;if(this.backendReplay){this.backend.newAnalysis();return;}if(this.currentPolicy.model!=='huanggang'&&this.topics.record)this.topics.prepareForm();if($('analysis-engine'))$('analysis-engine').value=this.engine;if($('analysis-preset-ack'))$('analysis-preset-ack').checked=Boolean(this.presetAcknowledged);if($('deepseek-api-key')&&this.deepseekApiKey)$('deepseek-api-key').value=this.deepseekApiKey;this.renderEngineNote();this.configNote('');this.syncSaveAvailability();$('analysis-config-dialog').showModal();}
 renderEngineNote(){
  syncGovernment(this);
  const engine=$('analysis-engine').value,api=engine!=='rules';$('analysis-api-config').classList.toggle('hidden',!api);$('analysis-sample-pdf').classList.toggle('hidden',engine==='rules');$('analysis-rule-assumptions').classList.toggle('hidden',api||this.currentPolicy.model!=='huanggang');$('topic-config').classList.toggle('hidden',api||this.currentPolicy.model==='huanggang');
  $('analysis-engine-note').textContent=engine==='rules'?(this.currentPolicy.model==='huanggang'?'Existing Huanggang travel rules and saved policy history.':'Hypothetical '+this.currentPolicy.model+' capacity model. Commissioning dates control when new capacity appears.'):engine==='fixture'?'Synthetic API test. PDF contents are not read and no policy outcomes are predicted.':this.config.backendConfigured?'Team API configured. Upload and review the plan before analysis.':'Team API not connected. Configure V3_BACKEND_URL on the local server, or select the synthetic API test.';
  if($('analysis-preset-purpose'))$('analysis-preset-purpose').classList.toggle('hidden',engine!=='backend'||!this.backend?.active);
  if(engine==='backend'&&this.backend?.active)$('analysis-engine-note').textContent='This selected policy is not connected to the backend construction script. Choose Local scenario models to analyze it, or explicitly review the fixed server script below. The PDF is an attachment only; it does not drive construction.';
 }
 saveConfiguration(){
  if(this.requiresDeepseekKey){this.saveProductConfiguration();return;}
  try{
   const engine=$('analysis-engine').value;
   if(engine==='backend'&&this.backend?.active&&!$('analysis-preset-ack')?.checked)throw new Error('Choose Local scenario models for the selected policy, or acknowledge that you will run the fixed server construction script.');
   if(engine==='rules'&&this.currentPolicy.model!=='huanggang'){if(!this.topics.record||this.topics.record.ledger.policyId!==this.policyId)this.topics.activate(this.currentPolicy);this.topics.captureDraft();this.session?.reset();this.session=null;this.restoreRules();this.engine='rules';this.topics.activate(this.currentPolicy);this.drawTags();this.navigation?.setContext('analysis');$('analysis-config-dialog').close();this.status('Assumption draft saved. Start analysis to apply it.');this.onOpen();this.update();return;}
   const setup=engine==='rules'?null:validateSetup({...this.setup(),policyScope:{...scopeMetadata(this.selected,engine),policyId:this.policyId,areaId:this.areaId,model:this.currentPolicy.model,catalogVersion:CATALOG_VERSION}});
   if(this.apiResults||this.apiMap||this.localTopic)this.restoreRules();
   this.presetAcknowledged=engine==='backend'&&Boolean(this.backend?.active)&&Boolean($('analysis-preset-ack')?.checked);this.engine=engine;this.savedSetup=setup;this.session?.reset();this.session=engine==='rules'?null:engine==='backend'&&this.backend?.active?this.backend.createSession():new V3Session(engine==='fixture'?new FixtureTransport():new HttpTransport());
   if(engine==='rules'){this.selected=this.selected.filter(id=>POLICY_TAGS.some(t=>t.id===id&&t.rules));if(!this.selected.length)this.selected=['border-access'];}
   this.port.render();this.port.showTab('policy');
   if(engine!=='rules'){
    this.city.showPortStudy(false);document.querySelector('.port-flow-key').classList.add('hidden');
    $('port-scenario-note').textContent='Select policy tags and Start analysis to initialize your plan.';
    $('port-heading').querySelector('small').textContent='City context only. API results appear after initialization and confirmation.';
    this.onOpen();
   }
   this.drawTags();this.navigation?.setContext('analysis');$('analysis-config-dialog').close();this.status(engine==='rules'?'Rule demo ready. Select tags and Start analysis.':'Settings saved. Start analysis to initialize and review the plan.');this.update();
  }catch(e){this.configNote(e.message);}
 }
 saveProductConfiguration(){
  try{
   const script=$('construction-scenario').value;
   if(!['default-city','function-zones','mixed-zones'].includes(script))throw new Error('Choose a government script.');
   const key=$('deepseek-api-key').value.trim();
   if(!key||key.length>4096||/[\r\n\u0000]/.test(key)||/^[\uFEFF"']/.test(key))throw new Error('Enter a DeepSeek API key. This sandbox does not run offline.');
   this.deepseekApiKey=key;this.engine='backend';this.presetAcknowledged=true;
   if($('analysis-engine'))$('analysis-engine').value='backend';
   if($('analysis-preset-ack'))$('analysis-preset-ack').checked=true;
   const years=Number($('simulation-years')?.value);
   if(![1,2,3,4,5].includes(years))throw new Error('Choose 1 to 5 years.');
   const setup=validateSetup({...this.setup(),constructionScenario:script,start:'2025-01-01',end:(2024+years)+'-12-01',step:'month',policyScope:{...scopeMetadata(this.selected,'backend'),policyId:this.policyId,areaId:this.areaId,model:this.currentPolicy.model,catalogVersion:CATALOG_VERSION}});
   delete setup.fiscalEnabled;delete setup.governmentMode;delete setup.fiscalParameters;
   if(this.apiResults||this.apiMap||this.localTopic)this.restoreRules();
   this.savedSetup=setup;this.session?.reset();
   this.session=this.backend?.active?this.backend.createSession():new V3Session(new HttpTransport());
   this.session._apiKey=key;
   this.city.showPortStudy(false);document.querySelector('.port-flow-key')?.classList.add('hidden');
   $('port-scenario-note').textContent='Government script saved. Start analysis to review and run it.';
   this.drawTags();this.navigation?.setContext('analysis');$('analysis-config-dialog').close();
   this.status('Script and API key saved. Start analysis to run.');this.onOpen();this.update();
  }catch(e){this.configNote(e.message);}
 }
 update(){
  $('analysis-start').disabled=this.busy||!this.selected.length||!this.policyId;$('analysis-settings').disabled=this.busy||!this.policyId;
  for(const checkbox of $('analysis-tag-list').querySelectorAll('input'))checkbox.disabled=this.busy||!matchingTags(this.areaId).includes(checkbox.value);
  $('analysis-area').disabled=this.busy;$('analysis-policy').disabled=this.busy;
  $('analysis-month').disabled=this.busy||(!this.backendReplay&&(!this.policyId||(this.localTopic?!this.topics.hasResult:this.engine==='rules'?!this.port.ledger.revisions.length:!this.session?.run)));
  $('analysis-confirm-run').disabled=this.busy||!$('analysis-review-ack').checked||this.session?.state!=='review'||this.session.review.items.some(i=>i.kind==='unresolved');
  $('analysis-start').textContent=this.busy?'Analyzing…':this.backendReplay?'New Team API analysis ↗':this.engine==='backend'&&this.session?.pending?'Resume analysis ↗':this.engine==='backend'&&this.session?.state==='confirmed'?'Retry analysis ↗':'Start analysis ↗';
  if(!this.busy&&!this.backendReplay&&this.engine==='backend'&&this.backend?.active&&!this.session?.pending&&(!this.session||this.session.state==='draft'))$('analysis-start').textContent=this.presetAcknowledged?'Review scenario ↗':'Configure analysis ↗';
  if(!this.busy&&this.engine==='fixture'&&(!this.session||this.session.state==='draft'))$('analysis-start').textContent='Run API test ↗';
  $('port-export').disabled=this.busy||(!this.backendReplay&&(!this.policyId||(this.localTopic?!this.topics.hasResult:this.engine!=='rules'&&!this.session?.review)));
  if(this.backendReplay){$('analysis-start').disabled=this.busy;$('analysis-settings').disabled=this.busy;}
  this.backend?.update();
  this.renderCapability?.();
  this.navigation?.update();
 }
 async start(){
  if(this.busy)return;
  if(this.backendReplay){this.backend.newAnalysis();return;}
  if(this.requiresDeepseekKey){
   if(!this.deepseekApiKey){this.configure();return;}
   this.engine='backend';this.presetAcknowledged=true;if($('analysis-engine'))$('analysis-engine').value='backend';if(this.session)this.session._apiKey=this.deepseekApiKey;
  }
  if(this.engine==='backend'&&this.session?.pending){await this.backend.resume();return;}
  try{
   validateTags(this.selected,this.engine);assertPolicyScope(this.policyId,this.areaId,this.selected);
   if(needsScriptAcknowledgement({engine:this.engine,backendActive:this.backend?.active,presetAcknowledged:this.presetAcknowledged,session:this.session})){this.configure();this.configNote('This selected policy is not connected. Choose a local scenario model, or explicitly use the fixed server script.');return;}
   if(this.localTopic){this.topics.run();return;}
   if(this.engine==='rules'){this.runRules();return;}
   if(this.engine==='backend'&&!this.config.backendConfigured){this.configure();this.configNote('The team backend is not connected yet. No test result will be substituted.');return;}
   const setup=this.setup();
   if(this.requiresDeepseekKey&&this.savedSetup){setup.constructionScenario=this.savedSetup.constructionScenario;setup.start=this.savedSetup.start;setup.end=this.savedSetup.end;setup.step=this.savedSetup.step;delete setup.fiscalEnabled;delete setup.fiscalParameters;delete setup.governmentMode;}
   if(!this.session)this.session=this.engine==='backend'&&this.backend?.active?this.backend.createSession():new V3Session(this.engine==='fixture'?new FixtureTransport():new HttpTransport());
   if(this.session.state!=='draft'&&JSON.stringify(this.session.setup?.policyScope)!==JSON.stringify(setup.policyScope))this.session.reset();
   if(this.session.state==='ready'){if(this.engine==='backend'&&this.backend?.active)await this.backend.openSaved(this.session.run.simulationId);else{this.showApiResults();this.status('Showing the completed analysis. Configure a new setup to run again.');}return;}
   if(this.session.state==='confirmed'){await this.runApi();return;}
   if(this.session.state==='draft'){
    if(this.requiresDeepseekKey){
     // PDF upload is currently disabled. Do not attach a plan file.
     this.busy=true;this.pendingTags=[...this.selected];this.status('Preparing the government script review…');this.update();await this.session.initialize(setup,null,{apiKey:this.deepseekApiKey});
    }else{
     const file=this.sampleFile||$('analysis-plan').files[0];if(!file){this.configure();this.configNote(this.backend?.active?'The current API requires a PDF attachment. Its text is not interpreted and does not change the server script.':'Add the PDF attachment required by this API before continuing.');return;}
     this.busy=true;this.pendingTags=[...this.selected];this.status(this.backend?.active?'Preparing the scripted scenario review…':'Initializing the API review…');this.update();await this.session.initialize(setup,file);
    }
   }
   this.renderReview();$('analysis-review-dialog').showModal();this.status('Review the initialized sources and assumptions to continue.');
  }catch(e){this.status(e.message,true);}finally{this.busy=false;this.update();}
 }
 runRules(){
  this.restoreRules();
  const values=Object.fromEntries([['port-year','year'],['port-timing','timing'],['port-base','baseline'],['port-reach','reach'],['port-clearance','clearance'],['port-cap','capacity']].map(([id,k])=>[k,k==='timing'?$(id).value:Number($(id).value)]));
  const effective=Number($('policy-effective').value),latest=this.port.ledger.revisions.at(-1);
  // A saved historical month is a review, unless the user explicitly edits inputs.
  if(!latest||(this.port.draftDirty&&!sameInputs(values,latest.inputs))){
    const reason=$('policy-reason').value.trim()||`Analysis focus: ${validateTags(this.selected).map(t=>t.label).join(', ')}.`;
    const next=applyRevision(this.port.ledger,values,effective,reason,new Date().toISOString());this.port.ledger=next;this.port.study=buildPolicyStudy(next);this.port.month=effective;
  }
  this.resultTags=[...this.selected];const active=this.port.cases.find(c=>c.id===this.port.caseId);active.analysisTags=[...this.resultTags];this.port.saveCases();this.port.draftDirty=false;this.port.prepareForm();this.port.render();this.port.showTab('results');this.openPanel();
  this.navigation?.markResult(`${active.label} · Port opening`);
  this.status('Rule analysis ready. Result month retrieves its saved policy and response.');
 }
 onRuleRender(snapshot){
  if(this.apiResults||this.engine!=='rules'||this.localTopic)return;
  if(this.lastCaseId!==this.port.caseId){this.lastCaseId=this.port.caseId;this.selected=[...(this.port.cases.find(c=>c.id===this.port.caseId)?.analysisTags??['border-access'])];this.drawTags();}
  $('analysis-month').replaceChildren();for(const m of this.port.study.months){const option=node('option',`${m.name.slice(0,3)} ${m.year}`);option.value=m.index;$('analysis-month').append(option);}$('analysis-month').value=String(snapshot.index);
  $('analysis-panel-source').textContent='Rule demo · synthetic';
  let card=$('analysis-rule-focus');if(!card){card=node('div',undefined,'analysis-focus-card');card.id='analysis-rule-focus';$('port-results').insertBefore(card,$('port-results').firstChild);}
  const tags=this.port.cases.find(c=>c.id===this.port.caseId)?.analysisTags??this.selected;
  if(this.dashboard){this.update();return;}
  card.replaceChildren(node('strong',`Analysis focus · ${validateTags(tags,'fixture').map(t=>t.label).join(' / ')}`));
  const p=snapshot.activeInputs??this.port.study.inputs;
  if(tags.includes('border-access'))card.append(node('p',`Clearance target: ${p.clearance} min · ${snapshot.policyState.replace('_',' ')}`));
  if(tags.includes('transport-capacity'))card.append(node('p',`Capacity: ${number(p.capacity)} trips/day · unserved: ${number(snapshot.unserved)}`));
  if(tags.includes('information-reach'))card.append(node('p',`Information reach: ${p.reach}% · inspect group assumptions in Agents.`));
  renderInterpretation($('port-interpretation'),buildPortInterpretation({study:this.port.study,monthIndex:this.port.month,cohortId:$('port-cohort').value,tags}));
  renderPolicyCharts($('port-visuals'),buildPortCharts({study:this.port.study,monthIndex:this.port.month,cohortId:$('port-cohort').value}));
  if(this.engine==='rules')this.update();
 }
 renderReview(){
  $('analysis-review-items').replaceChildren();$('analysis-review-ack').checked=false;
  $('analysis-review-status').textContent=this.session.review.items.some(i=>i.kind==='unresolved')?'Required information is unresolved. Update the PDF or setup before analysis.':this.engine==='fixture'?'Synthetic contract fixture · no PDF extraction or model inference.':'Confirm this initialization version before simulation.';
  for(const item of this.session.review.items){const card=node('article',undefined,'analysis-review-item');card.append(node('strong',`${item.kind.toUpperCase()} · ${item.field}`),node('p',item.description));if(item.value)card.append(node('p',item.value));for(const source of item.sources||[]){const link=node('a',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);} $('analysis-review-items').append(card);}
  if(!this.session.review.items.length)$('analysis-review-items').append(node('p','No missing necessary information was reported.','quiet'));
 }
 async confirmAndRun(){
  if(this.busy)return;this.busy=true;this.update();
  try{await this.session.confirm($('analysis-review-ack').checked);$('analysis-review-dialog').close();await this.runApi();}
  catch(e){$('analysis-review-status').textContent=e.message;this.status(e.message,true);}finally{this.busy=false;this.update();}
 }
 async runApi(){
  this.busy=true;this.status(this.backend?.active?'Running the confirmed server construction script…':'Running the confirmed scenario…');this.update();
  try{
   await this.session.simulate();this.port.stop();this.resultTags=[...(this.pendingTags??this.session.setup?.policyScope?.tags??this.selected)];this.apiResults=true;
   if(this.engine==='backend'&&this.backend?.active)await this.backend.openSaved(this.session.run.simulationId,undefined,{withinAnalysis:true});
   else{this.fillApiMonths();this.showApiResults();await this.loadFrame(0);}
  }finally{this.busy=false;this.update();}
 }
 fillApiMonths(){ $('analysis-month').replaceChildren();this.session.run.snapshots.forEach((f,i)=>{const option=node('option',f.date);option.value=i;$('analysis-month').append(option);}); }
 showApiResults(){
  this.openPanel();this.port.tab='results';document.body.classList.add('analysis-api-results');$('port-results').classList.remove('hidden');$('compact-api-results').classList.remove('hidden');for(const b of document.querySelectorAll('[data-port-tab]')){b.classList.toggle('active',b.dataset.portTab==='results');b.setAttribute('aria-pressed',String(b.dataset.portTab==='results'));}
  $('analysis-panel-source').textContent=this.engine==='fixture'?'API test · synthetic':'Team API snapshot';
  if(!this.session?.run)$('compact-api-results').replaceChildren(node('p','Select policy tags and Start analysis. API results appear here after initialization and confirmation.','analysis-api-wait'));
 }
 async loadFrame(index){
  const record=this.session?.run?.snapshots[index];if(!record)return;
  if(this.engine==='backend'&&this.backend?.active){await this.backend.openSaved(this.session.run.simulationId,record.date);return;}
  this.frameAbort?.abort();this.frameAbort=new AbortController();const generation=++this.frameGeneration;this.apiIndex=index;$('analysis-month').value=String(index);this.currentFrame=null;this.apiMap?.clear();
  const holder=$('compact-api-results');holder.replaceChildren(node('p',`Loading ${record.date}…`,'analysis-api-wait'));this.status('Loading the selected result snapshot…');
  try{
   const frame=await this.session.snapshot(index,this.frameAbort.signal);if(generation!==this.frameGeneration)return;
   this.currentFrame=frame;if(!this.apiMap)this.apiMap=new V3Map(this.city);this.apiMap.show(frame);this.city.showPortStudy(false);
   if(this.dashboard){
    if(document.body.dataset.workspace!=='history')this.navigation?.markResult(this.engine==='fixture'?'API test · current session only':'Returned API snapshot');
    this.dashboard.update();$('port-scenario-note').textContent=frame.date+' · returned API snapshot';this.status('Returned snapshot displayed. No baseline or real policy effect is inferred.');return;
   }
   if(this.engine==='backend'&&this.backend?.active){
    const data=await this.backend.loadExport(this.session.run.simulationId);if(generation!==this.frameGeneration)return;
    this.backend.render(holder,frame.date,data);this.backend.current=data;
    $('port-scenario-note').textContent=`${frame.date} · backend synthetic scenario · completed footprints`;
    document.querySelector('.port-flow-key').classList.add('hidden');$('port-heading').querySelector('small').textContent='Backend grid shows completed footprint zones only. Planned and construction stages are listed in saved object details. Grid positions are schematic, not surveyed geography.';
    this.status('Backend results loaded. Counts, stages and provider metrics come from the canonical export.');return;
   }
   holder.replaceChildren(node('h3',frame.date),node('p',this.engine==='fixture'?'Synthetic API test · no real policy forecast':'Returned team-model snapshot','port-footnote'));
   const interpretation=node('div');renderInterpretation(interpretation,buildApiInterpretation({frame,setup:this.session.setup,synthetic:this.engine==='fixture'}));holder.prepend(interpretation);
   const visuals=node('div');renderPolicyCharts(visuals,buildApiCharts({frame,setup:this.session.setup,synthetic:this.engine==='fixture'}));holder.prepend(visuals);
   holder.append(node('p',`Scope · ${validateTags(this.resultTags,'fixture').map(t=>t.label).join(' / ')}`,'port-footnote'));
   const layers=node('div',undefined,'compact-api-layers');for(const [id,label] of [['terrain','Terrain'],['roads','Roads'],['mtr','MTR'],['zones','Zones'],['pollution','Pollution'],['power','Power']]){const l=node('label'),c=node('input');c.type='checkbox';c.checked=true;c.addEventListener('change',()=>this.apiMap.toggle(id,c.checked));l.append(c,node('span',label));layers.append(l);}holder.append(layers);
   for(const z of frame.zones){const card=node('article',undefined,'compact-api-zone');card.append(node('strong',z.name),node('p',`Population · ${number(z.population)}`),node('p',`Satisfaction · ${z.satisfaction??'Not provided'}${z.satisfaction===null?'':' (raw index)'}`));for(const j of z.jobs)card.append(node('p',`${j.type} · ${number(j.count)} jobs`));holder.append(card);}
   const details=node('details',undefined,'compact-api-details');details.append(node('summary','Grid & transport details'),node('p',`1,000 × 1,000 · ${frame.grid.cellSizeM.toFixed(2)} m/cell · preview sampled at 10-cell spacing.`),node('p',`Roads ${frame.roads.length} · MTR ${frame.mtr.length} · pollution ${frame.pollution.length} · power ${frame.powerLines.length}.`));for(const [kind,lines] of [['Road',frame.roads],['MTR',frame.mtr]])lines.forEach((l,i)=>details.append(node('p',`${kind} ${i+1} segment congestion: ${l.congestion.map(v=>v??'Unknown').join(', ')} (raw).`)));holder.append(details);
   $('port-scenario-note').textContent=`${frame.date} · ${this.engine==='fixture'?'Synthetic API test':'Team API result'}`;document.querySelector('.port-flow-key').classList.add('hidden');$('port-heading').querySelector('small').textContent='Returned terrain and infrastructure. Lines are map features; no passenger-flow data returned.';
   this.status('Analysis ready. Result month retrieves returned snapshots.');
  }catch(e){if(generation!==this.frameGeneration)return;holder.replaceChildren(node('p',e.message,'analysis-api-wait'));const retry=node('button','Retry snapshot','analysis-secondary');retry.addEventListener('click',()=>this.loadFrame(index));holder.append(retry);this.status(e.message,true);}
 }
 restoreRules(){
  this.backend?.leave();
  this.topics?.leave();this.frameAbort?.abort();this.frameGeneration++;this.apiMap?.restore();this.apiMap=null;this.apiResults=false;this.currentFrame=null;document.body.classList.remove('analysis-api-results');$('compact-api-results').classList.add('hidden');const legend=document.querySelector('.port-flow-key');legend.classList.remove('hidden');legend.replaceChildren(node('span','● Baseline','cyan'),node('span','● Added trips','gold'));$('port-heading').querySelector('small').innerText='Arrows show direction. Density shows modeled volume.\nSchematic links; not measured routes or journey speed.';this.city.showPortStudy(true);
 }
 exportAPI(){
  if(this.engine==='backend'&&this.backend?.active){this.backend.exportCurrent().catch(e=>this.status(e.message,true));return;}
  const data={schema:'nm-compact-analysis-export-v1',engine:this.engine,policyTags:this.session.setup.policyScope.tags,setup:this.session.setup,review:this.session.review,run:this.session.run,currentSnapshot:this.currentFrame?{date:this.currentFrame.date,grid:this.currentFrame.grid,zones:this.currentFrame.zones,roads:this.currentFrame.roads,mtr:this.currentFrame.mtr,pollution:this.currentFrame.pollution,powerLines:this.currentFrame.powerLines}:null,interpretation:this.currentFrame?buildApiInterpretation({frame:this.currentFrame,setup:this.session.setup,synthetic:this.engine==='fixture'}):null,charts:this.currentFrame?buildApiCharts({frame:this.currentFrame,setup:this.session.setup,synthetic:this.engine==='fixture'}):null,note:'Summary only; PDF and raster arrays omitted. Not a restorable API run.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=node('a');link.href=url;link.download=`policy-analysis-${this.engine}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
}
