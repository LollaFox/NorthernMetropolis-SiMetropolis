import {backendPlan,portPlan,topicPlan,selectedPlanLayer} from './plan-analysis-model.js';
import {renderPlanMap,PLAN_STAGES,featureDescription} from './plan-map.js';
import {CHANGE_SYMBOLS,createChangeSymbol} from './change-symbols.js';
import {createPolicyIcon} from './policy-visuals.js';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
export class PlanAnalysis{
 constructor(owner){this.owner=owner;this.open=false;this.layers=new Map();this.signature='';
  $('plan-analysis-toggle').addEventListener('click',()=>this.toggle());$('plan-analysis-close').addEventListener('click',()=>this.close(true));
  $('plan-analysis-symbol-toggle').addEventListener('click',()=>this.showSymbols());
  // Space operates the focused plan control, not the city's global playback shortcut.
  $('plan-analysis-panel').addEventListener('keydown',e=>{if(e.key===' '||e.code==='Space')e.stopPropagation();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.open)this.close(true);});
  this.renderLibrary();
 }
 getPacket(){const o=this.owner;
  if(o.backendReplay&&o.backend.current)return backendPlan(o.backend.current,o.backend.date);
  if(o.localTopic&&o.topics.hasResult)return topicPlan(o.currentPolicy,o.topics.study,o.topics.record.month);
  if(o.engine==='rules'&&o.port?.ledger.revisions.length)return portPlan(o.port.study,o.port.month,$('port-cohort').value);
  return null;
 }
 update(){
  const visible=document.body.dataset.workspace==='history';let packet=null,error='';
  if(visible)try{packet=this.getPacket();}catch(e){error='Plan view unavailable: '+e.message;}
  this.packet=packet;$('plan-analysis-tools').classList.toggle('hidden',!visible);$('plan-analysis-toggle').disabled=Boolean(this.owner.busy);$('plan-analysis-symbol-toggle').disabled=Boolean(this.owner.busy);
  if(!visible){this.close();this.signature='';return;}
  $('plan-analysis-panel').classList.toggle('hidden',!this.open);$('plan-analysis-toggle').setAttribute('aria-expanded',String(this.open));document.body.classList.toggle('plan-analysis-open',this.open);
  const signature=JSON.stringify(packet);if(signature===this.signature&&!error)return;this.signature=signature;
  const list=$('plan-analysis-layers');list.replaceChildren();
  if(!packet){$('plan-analysis-title').textContent='2D analysis';$('plan-analysis-title').title='';$('plan-analysis-context').textContent='SPATIAL VIEW';$('plan-analysis-date').textContent='';$('plan-analysis-map-title').textContent='';$('plan-analysis-summary').textContent='';$('plan-analysis-map').replaceChildren(el('p',error||'This API returns no supported spatial plan. Use saved backend cities or local port/housing/school studies.','plan-empty'));$('plan-analysis-source').textContent='No spatial inference is substituted.';$('plan-analysis-comparison').textContent='';$('plan-analysis-note').textContent='';$('plan-analysis-legend').replaceChildren();$('plan-analysis-selection').textContent='';return;}
  $('plan-analysis-title').textContent='2D analysis';$('plan-analysis-title').title=packet.title;$('plan-analysis-context').textContent=packet.source==='backend'?'SAVED CITY · MODEL GRID':packet.source==='port'?'HUANGGANG · TRAVEL MODEL':'LOCAL CAPACITY · ASSUMED';$('plan-analysis-date').textContent=packet.date;$('plan-analysis-source').textContent=packet.spatialBasis;$('plan-analysis-comparison').textContent=packet.comparison;$('plan-analysis-note').textContent=packet.unavailable;
  const selected=selectedPlanLayer(packet,this.layers.get(packet.key)).id;
  for(const l of packet.layers){const button=el('button',undefined,'plan-layer');button.type='button';button.dataset.layer=l.id;button.setAttribute('aria-pressed',String(l.id===selected));button.title=l.title+' · '+l.unit;button.append(createPolicyIcon(l.icon,{size:16}),el('span',l.title));button.addEventListener('click',()=>this.selectLayer(l.id));list.append(button);}
  this.renderSelected();
 }
 toggle(){if(this.owner.busy)return;this.open=!this.open;if(this.open){this.owner.navigation?.closeMenus();this.owner.onOpen();}this.update();if(this.open)$('plan-analysis-close').focus?.();}
 close(restore=false){this.open=false;$('plan-analysis-panel').classList.add('hidden');$('plan-analysis-toggle').setAttribute('aria-expanded','false');document.body.classList.remove('plan-analysis-open');if(restore)$('plan-analysis-toggle').focus?.();}
 selectLayer(id){if(!this.packet?.layers.some(l=>l.id===id))return;this.layers.set(this.packet.key,id);for(const b of $('plan-analysis-layers').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.layer===id));this.renderSelected();}
 renderSelected(){if(!this.packet)return;const packet=this.packet,l=selectedPlanLayer(packet,this.layers.get(packet.key));
  $('plan-analysis-map-title').textContent=l.title+' · '+l.unit;$('plan-analysis-summary').textContent=l.summary;$('plan-analysis-selection').textContent=packet.source==='backend'?'Select a marker for its saved value and change.':'Select a marker or link endpoint for its value.';
  renderPlanMap($('plan-analysis-map'),packet,l.id,{onSelect:f=>{$('plan-analysis-selection').textContent=featureDescription(packet,l,f);}});
  const legend=$('plan-analysis-legend');legend.replaceChildren();
  if(l.kind==='status')for(const [key,style] of Object.entries(PLAN_STAGES)){const row=el('span'),swatch=el('i');swatch.style.background=style.fill;swatch.style.border=`1px ${style.dash?'dashed':'solid'} ${style.stroke}`;row.append(swatch,el('span',style.label));legend.append(row);}
  else legend.append(el('span',l.kind==='flows'?'Line width = trips · common scale across both layers and months':l.kind==='aggregate'?'One area-level marker · size scale fixed across study months':'Circle size = count · fixed scale across saved months'));
  legend.append(el('span','? = missing · small faint dot = zero. Symbols indicate change, not benefit.'));
 }
 renderLibrary(){const holder=$('plan-symbol-library');holder.replaceChildren();for(const [id,symbol] of Object.entries(CHANGE_SYMBOLS)){const row=el('div');row.dataset.symbol=id;const text=el('span');text.append(el('strong',symbol.label),el('small',symbol.meaning));row.append(createChangeSymbol(id),text);holder.append(row);}}
 showSymbols(){if(this.owner.busy)return;if(!this.open){this.open=true;this.owner.navigation?.closeMenus();this.owner.onOpen();this.update();}$('plan-symbol-details').open=true;$('plan-symbol-details').scrollIntoView?.({block:'nearest',behavior:'auto'});}
}
