import {backendDashboard,topicDashboard,portDashboard,apiDashboard} from './analysis-dashboard-model.js';
import {renderDashboardChart} from './dashboard-chart.js';
import {renderEvidenceBrief} from './evidence-gate.js';
import {seriesStyle} from './policy-charts.js';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
const exact=v=>v===null?'Not provided':new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(v);
const large=v=>v===null?'—':new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(v);
export class AnalysisDashboard{
 constructor(owner){this.owner=owner;this.selected=new Map();this.signature='';
  $('dashboard-chart-select').addEventListener('change',()=>{if(!this.packet)return;this.selected.set(this.packet.key,$('dashboard-chart-select').value);this.renderPlot();});
  if(typeof ResizeObserver==='function'){this.resize=new ResizeObserver(()=>{const width=$('dashboard-chart').clientWidth;if(width&&width!==this.width){this.width=width;this.renderPlot();}});this.resize.observe($('dashboard-chart'));}
 }
 packetForBackend(data,date){return backendDashboard(data,date);}
 getPacket(){const o=this.owner;if(o.backendReplay&&o.backend.current)return backendDashboard(o.backend.current,o.backend.date);if(o.localTopic)return o.topics.hasResult?topicDashboard({policy:o.currentPolicy,study:o.topics.study,monthIndex:o.topics.record.month}):null;if(o.engine==='rules'&&o.port?.ledger.revisions.length)return portDashboard({study:o.port.study,monthIndex:o.port.month,cohortId:$('port-cohort').value});if(o.apiResults&&o.currentFrame)return apiDashboard({frame:o.currentFrame,setup:o.session.setup,synthetic:o.engine==='fixture'});return null;}
 update(){
  this.owner.plan?.update();
  document.body.dataset.analysisEngine=this.owner.engine;
  document.body.dataset.analysisBusy=String(Boolean(this.owner.busy));
  const visible=document.body.dataset.workspace==='history',packet=visible?this.getPacket():null;
  $('analysis-dashboard').classList.toggle('hidden',!packet);document.body.classList.toggle('analysis-dashboard-active',Boolean(packet));if(!packet){this.signature='';return;}
  this.show(packet);
 }
 show(packet){
  this.owner.plan?.update();
  this.packet=packet;const signature=JSON.stringify([packet.key,packet.date,packet.metrics,packet.charts]);if(signature===this.signature)return;this.signature=signature;
  $('dashboard-basis').textContent=packet.basis;$('dashboard-date').textContent=packet.date;$('dashboard-comparison').textContent=packet.comparison;
  const holder=$('dashboard-metrics');holder.replaceChildren();for(const m of packet.metrics){const card=el('article',undefined,'dashboard-metric');card.dataset.metric=m.id;const number=el('strong',large(m.value),'dashboard-value');number.title=exact(m.value);number.setAttribute('aria-label',exact(m.value)+' '+m.unit);card.append(el('span',m.label,'dashboard-label'),number,el('span',m.unit,'dashboard-unit'));const change=m.delta===null?'No comparable prior month':`${m.delta>0?'+':''}${exact(m.delta)} vs prior month`;card.append(el('span',change,'dashboard-delta'));if(m.note)card.title=m.note;holder.append(card);}
  const choices=$('dashboard-chart-select');choices.replaceChildren();for(const chart of packet.charts){const option=el('option',chart.title);option.value=chart.id;choices.append(option);}const saved=this.selected.get(packet.key);choices.value=packet.charts.some(c=>c.id===saved)?saved:packet.charts[0]?.id??'';choices.disabled=!packet.charts.length;this.renderPlot();
  if(!this.owner.backendReplay)renderEvidenceBrief($('analysis-evidence'),packet.evidence);
 }
 renderPlot(){
  if(!this.packet)return;const card=this.packet.charts.find(c=>c.id===$('dashboard-chart-select').value),holder=$('dashboard-chart'),legend=$('dashboard-chart-legend'),table=$('dashboard-chart-table');legend.replaceChildren();table.replaceChildren();
  if(!card){holder.replaceChildren(el('p','No supported series returned.','quiet'));return;}
  renderDashboardChart(holder,card);$('dashboard-chart-unit').textContent=card.unit;
  $('dashboard-chart-preview').textContent=card.kind!=='line'&&card.labels.length>5?`Preview shows 5 of ${card.labels.length} observations; Data & units includes all.`:'';
  for(const series of card.series){const item=el('span'),swatch=el('i'),style=seriesStyle(card,series);swatch.style.borderTop=`2px ${style.dash?'dashed':'solid'} ${style.color}`;swatch.setAttribute('aria-hidden','true');item.append(swatch,el('span',series.label));legend.append(item);}
  const data=el('table'),caption=el('caption',card.title+' · '+card.unit),head=el('tr');head.append(el('th','Date / observation'));for(const series of card.series){const th=el('th',series.label);th.setAttribute('scope','col');head.append(th);}const thead=el('thead');thead.append(head);data.append(caption,thead);const body=el('tbody');card.labels.forEach((label,i)=>{const row=el('tr'),th=el('th',label);th.setAttribute('scope','row');row.append(th);for(const series of card.series)row.append(el('td',exact(series.values[i])));body.append(row);});data.append(body);table.append(data);
 }
}
