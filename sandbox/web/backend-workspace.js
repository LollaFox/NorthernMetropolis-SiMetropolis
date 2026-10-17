import {HttpTransport,V3Session} from './v3-api.js';
import {normalizeBackendExport,renderBackendResults} from './backend-results.js';
import {savedMonthValue} from './backend-overview.js';
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
export class BackendWorkspace{
 constructor(owner,host={}){this.owner=owner;this.host=host;this.cache=new Map();this.generation=0;this.selectedObjectId=null;
  $('backend-run-select').addEventListener('change',()=>this.openSaved($('backend-run-select').value).catch(e=>owner.status(e.message,true)));
  $('backend-local-demos').addEventListener('click',()=>{owner.session?.stopWaiting();owner.restoreRules();owner.engine='rules';owner.selectPolicy(owner.policyId||'huanggang-opening');owner.status('Local policy demo. Its assumptions do not change the backend construction script.');});
  $('backend-resume').addEventListener('click',()=>this.resume().catch(e=>owner.status(e.message,true)));
  $('backend-stop-wait').addEventListener('click',()=>{owner.session?.stopWaiting();owner.status('Stopped waiting only. The backend may still be running; resume this task to check it.');});
  $('backend-month-prev').addEventListener('click',()=>this.stepMonth(-1));
  $('backend-month-next').addEventListener('click',()=>this.stepMonth(1));
  $('backend-month-play').addEventListener('click',()=>this.togglePlayback().catch(e=>owner.status(e.message,true)));
 }
 get active(){return this.owner.config?.transport==='local-narrative-scenario';}
 configure(){
  if(!this.active)return;
  $('backend-replay').classList.remove('hidden');$('backend-object-details').classList.remove('hidden');
  $('analysis-start-date').value='2025-01-01';$('analysis-end-date').value='2026-09-01';
  this.owner.session=this.createSession();
  // Fresh users start with the policy-specific local models. An existing API
  // operation keeps its mode so opening the app does not discard recovery.
  if(this.owner.session.pending||['review','confirmed'].includes(this.owner.session.state))this.owner.engine='backend';
  if(this.owner.config.productVersion==='government-integrated-1'&&!this.owner.session.pending){
   this.owner.engine='backend';$('analysis-engine').value='backend';
   if($('construction-scenario')&&!$('construction-scenario').value)$('construction-scenario').value='default-city';
   // Government decision AI is disabled; do not select live or offline-test.
   if($('government-mode'))$('government-mode').value='fixed';
   $('analysis-start-date').value='2025-01-01';$('analysis-end-date').value='2026-12-01';
  }
  this.owner.update();
 }
 createSession(transport=new HttpTransport()){
  let storage;try{storage=globalThis.localStorage;}catch{}
  return new V3Session(transport,{storage,storageKey:'nm-integrated-backend-session-v1',pollLimit:1800,
   onProgress:p=>{const progress=p.progress??{},done=p.completedMonths??progress.completedMonths,total=p.totalMonths??progress.totalMonths,active=progress.activeMonth;
    const metrics=p.providerMetrics??{};const text=`Backend task: ${p.status}${Number.isFinite(done)?' · '+done+(Number.isFinite(total)?'/'+total:'')+' months saved':''}${active?' · '+active:''}${Number.isFinite(metrics.successfulCalls)?' · successful calls '+metrics.successfulCalls:''}${Number.isFinite(metrics.attemptCount)?' / attempts '+metrics.attemptCount:''}. Completion is distinct from call success.`;
    $('backend-job-progress').textContent=text;this.owner.status(text);this.update();},
   onState:()=>this.update()});
 }
 update(){
  const o=this.owner,pending=o.session?.pending;
  $('backend-resume').classList.toggle('hidden',!this.active||!pending||o.busy);$('backend-stop-wait').classList.toggle('hidden',!this.active||!o.busy||!pending);
  $('backend-run-select').disabled=Boolean(o.busy);$('backend-replay').disabled=Boolean(o.busy);
  $('backend-local-demos').classList.toggle('hidden',!this.active);$('backend-local-demos').disabled=Boolean(o.busy);
  this.updatePlayback();
 }
 updatePlayback(){
  const shown=Boolean(this.owner.backendReplay&&this.current),index=this.current?.dates.indexOf(this.date)??-1,playing=Boolean(this.state?.playing),busy=Boolean(this.owner.busy),count=this.current?.dates.length??0;
  $('backend-month-controls').classList.toggle('hidden',!shown);$('backend-month-position').classList.toggle('hidden',!shown);
  $('backend-month-prev').disabled=!shown||busy||index<=0;$('backend-month-next').disabled=!shown||busy||index>=count-1;
  const play=$('backend-month-play');play.disabled=!shown||busy||count<2;play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-pressed',String(playing));play.setAttribute('aria-label',playing?'Pause saved monthly replay':index===count-1?'Replay saved months from the beginning':'Play saved months');play.title=play.getAttribute('aria-label');
  $('backend-month-position').textContent=shown?`${index+1} / ${count}`:'';
 }
 async request(path,body){if(this.host.request)return this.host.request(path,body,30000);const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Backend request failed.');return data;}
 async loadExport(id){
  if(this.cache.has(id))return this.cache.get(id);
  const operation=(this.owner.session?.run?.simulationId===id?this.owner.session.exportRun():new HttpTransport(undefined,60000).request(`/simulations/${encodeURIComponent(id)}/export`)).then(normalizeBackendExport).then(data=>{if(data.simulationId!==id)throw new Error('Saved export does not match the requested simulation.');return data;});
  this.cache.set(id,operation);try{const data=await operation;this.cache.set(id,Promise.resolve(data));return data;}catch(e){this.cache.delete(id);throw e;}
 }
 async openSaved(id,date,{withinAnalysis=false}={}){
  const o=this.owner;if(o.busy&&!withinAnalysis)return;const wasBusy=o.busy;o.busy=true;o.update();let token;
  try{
   if(!o.port.active&&typeof o.port.open==='function')await o.port.open();
   o.restoreRules();token=++this.generation;o.engine='backend';let state=await this.request('/api/state');if(token!==this.generation)return;const wanted=id||state.id;
   if(wanted==='empty')throw new Error('No saved run yet. Configure Team API to initialize a scenario.');
   if(state.id!==wanted)state=await this.request('/api/switch',{id:wanted});
   if(state.playing)state=await this.request('/api/control',{playing:false});
   const normalized=await this.loadExport(wanted),data=normalized.raw,selected=date??normalized.dates[0];
   if(token!==this.generation)return;
   if(!normalized.byDate.has(selected))throw new Error('That saved date is unavailable.');
   const month=savedMonthValue(state,data,selected);
   if(state.world.sourceDate!==selected)state=await this.request('/api/seek',{month});
   if(token!==this.generation)return;
   this.current=normalized;this.simulationId=wanted;this.date=selected;this.state=state;
   this.host.applyState?.(state,true);o.backendReplay=true;o.apiResults=true;document.body.classList.add('analysis-api-results','analysis-backend-replay');o.city.showPortStudy(false);
   $('backend-run-select').replaceChildren();for(const run of state.branches){const option=node('option',run.label);option.value=run.id;$('backend-run-select').append(option);}$('backend-run-select').value=wanted;
   $('analysis-month').replaceChildren();normalized.dates.forEach((day,index)=>{const option=node('option',day);option.value=index;$('analysis-month').append(option);});$('analysis-month').value=normalized.dates.indexOf(selected);
   $('port-heading').querySelector('h1').textContent='Saved city. Explore its development.';
   $('port-heading').querySelector('small').textContent='Synthetic model objects on a schematic city. Residential capacity means resident places, not housing units. Select an object for saved details.';
   $('port-scenario-note').textContent=`${selected} · saved backend run · saved construction and government decisions`;
   document.querySelector('.port-flow-key').classList.add('hidden');o.showApiResults();this.render($('compact-api-results'),selected);o.openPanel();
   o.city.canvas.dataset.backendSimulation=wanted;o.city.canvas.dataset.backendDate=selected;
   o.navigation?.markResult(`Backend city · ${normalized.dates[0]} — ${normalized.dates.at(-1)}`);
   o.status(`Saved month ${normalized.dates.indexOf(selected)+1} / ${normalized.dates.length}. Use ← / → or Play; no model call.`);
  }catch(e){o.status(e.message,true);throw e;}finally{o.busy=wasBusy;o.update();}
 }
 syncOverview(state){
  if(!this.owner.backendReplay||this.owner.busy||state.world?.version!=='narrative-display-1')return;
  const date=state.world.sourceDate;
  if(state.id!==this.simulationId){this.openSaved(state.id,date).catch(()=>{});return;}
  this.state=state;this.updatePlayback();
  if(date===this.date||!this.current?.byDate.has(date))return;
  this.date=date;$('analysis-month').value=this.current.dates.indexOf(date);this.render($('compact-api-results'),date);
  $('port-scenario-note').textContent=`${date} · saved backend run · saved construction and government decisions`;
  this.owner.city.canvas.dataset.backendDate=date;
  this.updatePlayback();
 }
 render(container,date,data=this.current){
  if(!data)return;const packet=this.owner.dashboard?.packetForBackend(data,date);renderBackendResults(container,data,date,{compact:Boolean(this.owner.dashboard),evidence:packet?.evidence,selectedObjectId:this.selectedObjectId,onDate:day=>{
   if(this.owner.backendReplay)this.seekIndex(this.current.dates.indexOf(day)).catch(()=>{});
   else{const i=this.owner.session?.run?.snapshots.findIndex(s=>s.date===day);if(i>=0)this.owner.loadFrame(i);else this.openSaved(data.raw.run.simulationId,day).catch(()=>{});}
  },onObject:id=>{this.selectedObjectId=id;}});
  $('analysis-panel-source').textContent='Backend saved results · synthetic';
  if(packet)this.owner.dashboard.show(packet);
 }
 async inspect(id){this.selectedObjectId=id;const s=this.host.getState?.();await this.openSaved(s?.id,s?.world?.sourceDate);}
 async seekIndex(index){
  const o=this.owner,date=this.current?.dates[index];if(!o.backendReplay||o.busy||!date)return;
  o.busy=true;o.update();const token=this.generation;
  try{const month=savedMonthValue(this.state,this.current.raw,date);const state=await this.request('/api/seek',{month});
   if(token!==this.generation)return;if(state.id!==this.simulationId||state.world.sourceDate!==date)throw new Error('Saved replay returned a different run or month.');
   this.state=state;this.date=date;this.host.applyState?.(state);$('analysis-month').value=index;this.render($('compact-api-results'),date);
   $('port-scenario-note').textContent=`${date} · saved backend run · saved construction and government decisions`;o.city.canvas.dataset.backendDate=date;
   o.status('Saved month '+(index+1)+' / '+this.current.dates.length+'. Display transition only; no model call.');
  }catch(e){$('analysis-month').value=this.current.dates.indexOf(this.date);o.status(e.message,true);throw e;}finally{o.busy=false;o.update();}
 }
 stepMonth(delta){if(delta!==-1&&delta!==1)return;return this.seekIndex((this.current?.dates.indexOf(this.date)??-1)+delta).catch(()=>{});}
 selectMonth(index){return this.seekIndex(index).catch(()=>{});}
 async togglePlayback(){
  const o=this.owner;if(!o.backendReplay||o.busy||this.current?.dates.length<2)return;
  if(!this.state?.playing&&this.date===this.current.dates.at(-1))await this.seekIndex(0);
  if(!o.backendReplay||o.busy)return;const token=this.generation;o.busy=true;o.update();
  try{const state=await this.request('/api/control',{playing:!this.state.playing,speed:1});if(token!==this.generation)return;
   if(state.id!==this.simulationId)throw new Error('Playback returned a different saved run.');this.state=state;this.host.applyState?.(state);o.status(state.playing?'Playing saved months · one month per 1.6 seconds · no model call.':'Saved monthly replay paused.');
  }finally{o.busy=false;o.update();}
 }
 pauseForExit(){if(this.state?.playing){this.state={...this.state,playing:false};this.request('/api/control',{playing:false}).catch(e=>this.owner.status('Could not pause saved playback: '+e.message,true));}}
 leave(){this.pauseForExit();++this.generation;this.owner.backendReplay=false;delete this.owner.city.canvas.dataset.backendSimulation;delete this.owner.city.canvas.dataset.backendDate;document.body.classList.remove('analysis-backend-replay');$('port-heading').querySelector('h1').textContent='Explore policy scenarios. Inspect the evidence.';this.updatePlayback();}
 newAnalysis(){this.owner.restoreRules();this.owner.engine='backend';this.owner.presetAcknowledged=false;this.owner.session?.reset();this.owner.session=this.createSession();this.owner.configure();this.owner.status('Choose a government script and enter a DeepSeek API key.');}
 async resume(){
  const o=this.owner;if(o.busy||!o.session?.pending)return;o.restoreRules();o.engine='backend';o.busy=true;o.update();
  try{if(o.deepseekApiKey&&o.session)o.session._apiKey=o.deepseekApiKey;await o.session.resume(o.sampleFile||$('analysis-plan')?.files?.[0]);
   if(o.session.state==='ready'){if(this.active)await this.openSaved(o.session.run.simulationId,undefined,{withinAnalysis:true});else{o.apiResults=true;o.fillApiMonths();o.showApiResults();await o.loadFrame(0);}}
   else if(o.session.state==='review'){o.renderReview();$('analysis-review-dialog').showModal();}
   else o.status('Saved operation restored. Start analysis to continue after confirmation.');
  }catch(e){o.status(e.message,true);}finally{o.busy=false;o.update();}
 }
 async exportCurrent(){const id=this.owner.backendReplay?this.simulationId:this.owner.session?.run?.simulationId;if(!id)throw new Error('No completed simulation is selected.');const data=(await this.loadExport(id)).raw;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download=`backend-city-${id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
