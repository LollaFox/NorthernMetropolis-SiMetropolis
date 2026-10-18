import {HttpTransport} from './v3-api.js';
import {backendHistory,localHistory,filterHistory} from './analysis-history.js';
import {getPolicy} from './policy-catalog.js';
const $=id=>document.getElementById(id);
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
const POPUPS={file:['file-menu','backend-replay'],appearance:['appearance-popover','port-expand'],help:['help-popover','help-toggle']};
export class WorkspaceNavigation{
 constructor(owner,host={}){
  this.owner=owner;this.host=host;this.backendRows=[];this.historyGeneration=0;this.historyError='';this.loading=false;
  $('analysis-history-close').addEventListener('click',()=>this.closeHistory());
  $('analysis-history-dialog').addEventListener('close',()=>$('backend-replay').setAttribute('aria-expanded','false'));
  $('analysis-history-search').addEventListener('input',()=>this.renderHistory());$('analysis-history-source').addEventListener('change',()=>this.renderHistory());
  $('analysis-history-refresh').addEventListener('click',()=>this.refreshHistory());
  $('analysis-results-toggle').addEventListener('click',()=>this.showResults());
  $('file-new-city').addEventListener('click',()=>this.newCity());
  $('file-save-city').addEventListener('click',()=>this.saveCity());
  $('file-load-city').addEventListener('click',()=>this.openHistory());
  $('help-send-feedback').addEventListener('click',()=>this.closeMenus());
  this.bindChoice('help-view-license',()=>this.openLicense());
  $('license-close').addEventListener('click',()=>this.closeLicense());
  this.bindChoice('help-about',()=>this.openAbout());
  $('about-close').addEventListener('click',()=>this.closeAbout());
  this.bindChoice('menu-camera-overview',()=>this.focusCamera('overview'));
  for(const id of ['hung-shui-kiu','san-tin','kwu-tung','ta-kwu-ling'])this.bindChoice('menu-camera-'+id,()=>this.focusCamera(id));
  this.bindChoice('menu-style-original',()=>this.chooseSelect('render-style','original'));
  this.bindChoice('menu-style-white',()=>this.chooseSelect('render-style','white'));
  this.bindChoice('menu-light-day',()=>$('light-day').click());
  this.bindChoice('menu-light-dusk',()=>$('light-dusk').click());
  this.bindChoice('menu-quality-auto',()=>this.chooseSelect('quality-select','auto'));
  this.bindChoice('menu-quality-high',()=>this.chooseSelect('quality-select','high'));
  this.bindChoice('menu-quality-balanced',()=>this.chooseSelect('quality-select','balanced'));
  this.bindChoice('menu-quality-light',()=>this.chooseSelect('quality-select','light'));
  this.bindHoverMenus();
  for(const button of document.querySelectorAll('[data-workspace-close]'))button.addEventListener('click',()=>this.closeMenus(true));
  for(const id of ['model-toggle','scene-toggle'])$(id).addEventListener('click',()=>this.closeMenus());
  document.addEventListener('pointerdown',event=>{if(!this.popup)return;const [panel,toggle]=POPUPS[this.popup];if(!$(panel).contains(event.target)&&!$(toggle).contains(event.target))this.closeMenus();});
  this.update();
 }
 get rows(){return [...this.backendRows,...localHistory(this.owner.port.cases,this.owner.topics.store.cases)];}
 get hasResults(){const o=this.owner;if(o.backendReplay)return true;if(o.engine==='rules')return Boolean(o.localTopic?o.topics.hasResult:o.port.ledger.revisions.length);return Boolean(o.apiResults&&o.session?.state==='ready');}
 update(){
  const o=this.owner;$('analysis-results-toggle').disabled=o.busy||!this.hasResults;$('analysis-results-toggle').setAttribute('aria-expanded',String(!$('port-panel').classList.contains('hidden')));
  $('backend-replay').disabled=Boolean(o.busy);$('analysis-history-refresh').disabled=this.loading;
  const save=$('file-save-city');if(save)save.disabled=Boolean(o.busy)||Boolean($('port-export')?.disabled);
  for(const button of $('analysis-history-list').querySelectorAll('button'))button.disabled=Boolean(o.busy);
  o.dashboard?.update();
 }
 closeMenus(restore=false){const previous=this.popup;for(const [panel,toggle] of Object.values(POPUPS)){$(panel).classList.add('hidden');$(toggle).setAttribute('aria-expanded','false');}this.popup=null;document.body.classList.remove('nav-menu-open');if(restore&&previous)$(POPUPS[previous][1]).focus?.();}
 openMenu(kind){if(!POPUPS[kind]||this.popup===kind)return;this.closeMenus();this.owner.plan?.close();this.host.closeDrawers?.();this.popup=kind;const [panel,toggle]=POPUPS[kind];$(panel).classList.remove('hidden');$(toggle).setAttribute('aria-expanded','true');document.body.classList.add('nav-menu-open');}
 toggle(kind){const opening=this.popup!==kind;this.closeMenus();if(opening){this.openMenu(kind);if(kind==='help')$(POPUPS[kind][0]).querySelector('select, button')?.focus?.();this.update();}}
 bindChoice(id,action){const el=$(id);if(!el)return;el.addEventListener('click',()=>{action();this.closeMenus();});}
 focusCamera(id){const city=this.owner.city;if(!city?.focusDistrict)return;if(id==='overview'){city.resetCamera();return;}if(city.view==='street')city.setView('overview');city.focusDistrict(id);}
 chooseSelect(id,value){const select=$(id);if(!select)return;select.value=value;select.dispatchEvent?.(new Event('change'));}
 bindHoverMenus(){this.menuCloseTimer=0;for(const host of document.querySelectorAll('.nav-menu')){const kind=host.getAttribute('data-menu');if(!kind||!POPUPS[kind])continue;const button=host.querySelector('.nav-menu-button');host.addEventListener('pointerenter',()=>{if(button?.disabled)return;clearTimeout(this.menuCloseTimer);this.openMenu(kind);});host.addEventListener('pointerleave',()=>{clearTimeout(this.menuCloseTimer);this.menuCloseTimer=setTimeout(()=>{if(this.popup===kind)this.closeMenus();},140);});button?.addEventListener('click',event=>{if(button.disabled)return;if(event.detail===0)this.toggle(kind);else this.openMenu(kind);});}for(const row of document.querySelectorAll('.nav-cascade')){const trigger=row.querySelector('.nav-cascade-item');const set=open=>trigger?.setAttribute('aria-expanded',String(open));row.addEventListener('pointerenter',()=>set(true));row.addEventListener('pointerleave',()=>set(false));row.addEventListener('focusin',()=>set(true));row.addEventListener('focusout',event=>{if(!row.contains(event.relatedTarget))set(false);});}}
 async newCity(){if(this.owner.busy)return;try{await this.openSandbox();this.owner.configure?.();}catch(e){this.owner.status(e.message,true);}}
 saveCity(){if(this.owner.busy||$('file-save-city')?.disabled)return;this.closeMenus();const button=$('port-export');if(!button||button.disabled)return;button.click();}
 closeHistory(){$('analysis-history-dialog').close();$('backend-replay').setAttribute('aria-expanded','false');$('backend-replay').focus?.();}
 openAbout(){const dialog=$('about-dialog');if(dialog&&!dialog.open)dialog.showModal();}
 closeAbout(){const dialog=$('about-dialog');if(dialog?.open)dialog.close();$('help-toggle').focus?.();}
 openLicense(){const dialog=$('license-dialog');if(dialog&&!dialog.open)dialog.showModal();const body=$('license-text');if(!body||body.dataset.loaded)return;fetch('./LICENSE.txt').then(response=>{if(!response.ok)throw new Error('unavailable');return response.text();}).then(text=>{body.textContent=text;body.dataset.loaded='1';}).catch(()=>{body.textContent='The license could not be loaded from this page. The controlling copy is the LICENSE file in the repository root.';});}
 closeLicense(){const dialog=$('license-dialog');if(dialog?.open)dialog.close();$('help-toggle').focus?.();}
 async openHistory(){
  if(this.owner.busy)return;this.owner.plan?.close();this.closeMenus();this.host.clearView?.();this.host.closeDrawers?.();$('analysis-history-search').value='';$('analysis-history-source').value='all';
  if(!$('analysis-history-dialog').open)$('analysis-history-dialog').showModal();$('backend-replay').setAttribute('aria-expanded','true');await this.refreshHistory();
 }
 async refreshHistory(){
  const token=++this.historyGeneration;this.loading=true;this.historyError='';this.renderHistory();this.update();
  try{const rows=this.owner.backend.active?backendHistory(await new HttpTransport().request('/simulations')):[];if(token===this.historyGeneration){for(const row of rows){const old=this.backendRows.find(r=>r.id===row.id);if(old&&old.savedMonths!==row.savedMonths)this.owner.backend.cache?.delete(row.simulationId);}this.backendRows=rows;}}
  catch(e){if(token===this.historyGeneration)this.historyError='Backend history could not be refreshed. Local studies remain available. '+e.message;}
  finally{if(token===this.historyGeneration){this.loading=false;this.renderHistory();this.update();}}
 }
 renderHistory(){
  const rows=filterHistory(this.rows,$('analysis-history-search').value,$('analysis-history-source').value),list=$('analysis-history-list');list.replaceChildren();
  $('analysis-history-status').textContent=this.historyError||(this.loading?'Loading saved backend runs…':`${rows.length} of ${this.rows.length} saved analyses. Backend runs first; local studies by latest revision.`);
  if(!rows.length)list.append(make('p',this.loading?'Checking saved history…':this.rows.length?'No analysis matches this search.':'No saved analysis yet. Run an analysis in Analysis sandbox; unrun drafts are not listed.','quiet'));
  for(const row of rows){const card=make('article',undefined,'history-card');card.dataset.historyId=row.id;card.append(make('span',row.sourceLabel,'history-source'),make('h3',row.title),make('p',`${row.start} — ${row.end}`,'history-period'),make('p',`${row.status}${row.savedMonths?' · '+row.savedMonths+' saved months':''}${row.provider?' · '+row.provider:''}`,'quiet'));
   const open=make('button','Open results ↗','history-open');open.type='button';open.disabled=Boolean(this.owner.busy);open.addEventListener('click',()=>this.openRecord(row).catch(e=>{this.historyError=e.message;this.renderHistory();}));card.append(open);list.append(card);}
 }
 setContext(mode,title=''){
  document.body.dataset.workspace=mode;$('analysis-context-label').textContent=title;$('analysis-context-label').classList.toggle('hidden',mode!=='history');this.update();
 }
 markResult(title){this.setContext('history',title);if(this.owner.dashboard)this.owner.onOpen();this.update();this.refreshHistory();}
 async openRecord(row){
  const o=this.owner;if(o.busy)return;this.closeMenus();this.host.clearView?.();
  if(row.source==='backend'){if(row.status!=='Complete')o.backend.cache?.delete(row.simulationId);await o.backend.openSaved(row.simulationId,row.start);}
  else{
   // Selecting a historical browser case must not reset a recoverable API job.
   const session=o.session;o.session=null;
   try{o.restoreRules();o.engine='rules';o.selected=[...row.tags];o.selectPolicy(row.policyId);}finally{o.session=session;}
   if(!o.port.active)await o.port.open();
   if(row.source==='port'){o.port.selectCase(row.caseId);o.port.showTab('results');}
   else{o.topics.selectCase(row.caseId);o.topics.showTab('results');}
   o.openPanel();o.update();
  }
  this.setContext('history',row.title);if(o.dashboard)o.onOpen();this.update();this.closeHistory();o.status('Saved analysis opened. No new policy revision or model run was created.');
 }
 async openSandbox(){
  const o=this.owner;if(o.busy)return;this.closeMenus();this.host.clearView?.();this.host.closeDrawers?.();
  if($('analysis-history-dialog').open)this.closeHistory();
  if(o.backendReplay){o.restoreRules();o.engine='backend';}
  // Completed runs remain in server history. Pending/reviewed work stays resumable.
  if(o.engine==='backend'&&o.session?.state==='ready')o.session.reset();
  if(!o.port.active)await o.port.open();
  if(o.engine==='rules'){
   const session=o.session;o.session=null;try{o.selectPolicy(o.policyId||'huanggang-opening');}finally{o.session=session;}
  }else{
   o.restoreRules();o.city.showPortStudy(false);document.querySelector('.port-flow-key').classList.add('hidden');
   $('port-heading').querySelector('small').textContent='City context only. Configure and start an analysis, or load a saved city from File.';
   $('port-scenario-note').textContent=o.session?.pending?'An existing backend task is available to resume.':'Select policy tags and Configure the analysis inputs. Saved cities stay under File, then Load City.';
  }
  o.onOpen();this.setContext('analysis');o.update();o.status(o.session?.pending?'Resume the existing task; opening the sandbox did not submit a new run.':'Choose policy tags, Configure the inputs, then Start analysis.');
 }
 showResults(){const o=this.owner;if(o.busy||!this.hasResults)return;o.plan?.close();if(o.dashboard&&document.body.dataset.workspace!=='history')this.setContext('history',o.sourceLabel);if(o.backendReplay||o.apiResults)o.showApiResults();else{o.port.showTab('results');o.openPanel();}this.update();}
}
