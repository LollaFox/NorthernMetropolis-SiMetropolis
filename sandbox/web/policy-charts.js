import {createPolicyIcon,renderVisualLibrary,VISUAL_ROLES} from './policy-visuals.js';
const NS='http://www.w3.org/2000/svg';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>v===null?'Not provided':new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(v);
const short=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(v+'T00:00:00Z').toLocaleDateString('en',{month:'short',year:'2-digit',timeZone:'UTC'}):v;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
const svgEl=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,String(value));if(text!==undefined)e.textContent=String(text);return e;};
const role=s=>VISUAL_ROLES[s.role]??VISUAL_ROLES.context;
export const seriesStyle=(card,series)=>{const style=role(series),index=card.series.filter(s=>s.role===series.role).indexOf(series);return {...style,dash:index===0?style.dash:['2 3','10 3','6 2 2 2'][index%3],marker:index%2?'square':'circle'};};
function validate(card){
 if(!['line','bar','stack'].includes(card.kind)||!Array.isArray(card.labels)||!card.labels.length||!Array.isArray(card.series)||!card.series.length)throw new Error('Chart needs a supported type, labels and series.');
 for(const series of card.series){if(!Array.isArray(series.values)||series.values.length!==card.labels.length||series.values.some(v=>v!==null&&!finite(v)))throw new Error('Chart values must be finite or explicitly unavailable.');if(card.kind==='stack'&&series.values.some(v=>v!==null&&v<0))throw new Error('Stack values cannot be negative.');}
 if(card.selectedIndex!==undefined&&(!Number.isInteger(card.selectedIndex)||card.selectedIndex<0||card.selectedIndex>=card.labels.length))throw new Error('Selected chart month is outside its labels.');
}
export function chartDomain(card){
 validate(card);const values=card.kind==='stack'?card.labels.map((_,i)=>card.series.some(s=>finite(s.values[i]))?card.series.reduce((sum,s)=>sum+(finite(s.values[i])?s.values[i]:0),0):null):card.series.flatMap(s=>s.values);
 const available=values.filter(finite),min=Math.min(0,...available),max=Math.max(0,...available);return {min,max:max===min?min+1:max};
}
function axis(svg,domain,box){
 const y=v=>box.top+(domain.max-v)/(domain.max-domain.min)*box.height;
 const ticks=[...new Set([domain.min,0,domain.max])];if(domain.min===0)ticks.splice(1,0,domain.max/2);
 for(const value of [...new Set(ticks)]){const py=y(value);svg.append(svgEl('line',{x1:box.left,y1:py,x2:box.left+box.width,y2:py,stroke:value===0?'#bed1d0':'#87a6a340','stroke-dasharray':value===0?'':'3 4'}),svgEl('text',{x:box.left-6,y:py+3,'text-anchor':'end',class:'chart-axis-label'},new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(value)));}
 return y;
}
function lineChart(card,domain){
 const box={left:39,top:18,width:265,height:113},svg=svgEl('svg',{viewBox:'0 0 320 168',role:'img','aria-label':`${card.title}. ${card.unit}. Shared axis ${num(domain.min)} to ${num(domain.max)}.`,class:'policy-data-chart','data-y-min':domain.min,'data-y-max':domain.max});
 svg.append(svgEl('title',{},card.title),svgEl('desc',{},`${card.description} Null values leave gaps. The full data table follows this chart.`));const y=axis(svg,domain,box),x=i=>box.left+(card.labels.length===1?.5:i/(card.labels.length-1))*box.width;
 for(const series of card.series){let d='',connected=false;series.values.forEach((v,i)=>{if(v===null){connected=false;return;}d+=`${connected?'L':'M'}${x(i)},${y(v)} `;connected=true;});const style=seriesStyle(card,series);svg.append(svgEl('path',{d,fill:'none',stroke:style.color,'stroke-width':2.3,'stroke-dasharray':style.dash,'data-series':series.id}));
  series.values.forEach((v,i)=>{if(v===null)return;const radius=i===card.selectedIndex?3.6:1.8,dot=style.marker==='square'?svgEl('rect',{x:x(i)-radius,y:y(v)-radius,width:radius*2,height:radius*2,fill:style.color,'data-value':v}):svgEl('circle',{cx:x(i),cy:y(v),r:radius,fill:style.color,'data-value':v});dot.append(svgEl('title',{},`${card.labels[i]} · ${series.label}: ${num(v)} ${card.unit}`));svg.append(dot);});
 }
 if(card.selectedIndex!==undefined)svg.append(svgEl('line',{x1:x(card.selectedIndex),x2:x(card.selectedIndex),y1:box.top,y2:box.top+box.height,stroke:'#e9e7c9','stroke-dasharray':'3 4','data-selected-index':card.selectedIndex}));
 for(const i of [...new Set([0,Math.floor((card.labels.length-1)/2),card.labels.length-1])])svg.append(svgEl('text',{x:x(i),y:151,'text-anchor':i===0?'start':i===card.labels.length-1?'end':'middle',class:'chart-axis-label'},short(card.labels[i])));
 return svg;
}
function bars(card,domain){
 const shown=card.labels.slice(0,10),rowH=card.kind==='stack'?39:27+card.series.length*14,height=shown.length*rowH+28;
 const svg=svgEl('svg',{viewBox:`0 0 320 ${height}`,role:'img','aria-label':`${card.title}. ${card.unit}. Common axis ${num(domain.min)} to ${num(domain.max)}.`,class:'policy-data-chart','data-y-min':domain.min,'data-y-max':domain.max});svg.append(svgEl('title',{},card.title),svgEl('desc',{},'Quantities and missing values are available in the table. All rows share the same scale.'));
 const left=6,right=258,width=right-left,x=v=>left+(v-domain.min)/(domain.max-domain.min)*width;
 shown.forEach((label,i)=>{
  const top=8+i*rowH;svg.append(svgEl('text',{x:left,y:top+4,class:'chart-row-label'},short(label).length>38?short(label).slice(0,35)+'…':short(label)));
  let cumulative=0;card.series.forEach((series,j)=>{const v=series.values[i],style=role(series),py=top+10+(card.kind==='stack'?0:j*14);if(v===null){svg.append(svgEl('text',{x:left,y:py+9,class:'chart-axis-label'},`${series.label}: Not provided`));return;}
   const start=card.kind==='stack'?cumulative:0,end=start+v,rect=svgEl('rect',{x:Math.min(x(start),x(end)),y:py,width:Math.abs(x(end)-x(start)),height:9,rx:1.5,fill:style.color,'data-value':v,'data-series':series.id});rect.append(svgEl('title',{},`${label} · ${series.label}: ${num(v)} ${card.unit}`));svg.append(rect);
   if(card.kind==='stack')cumulative+=v;else svg.append(svgEl('text',{x:268,y:py+8,class:'chart-value-label'},num(v)));
  });if(card.kind==='stack')svg.append(svgEl('text',{x:268,y:top+18,class:'chart-value-label'},card.series.some(s=>s.values[i]===null)?'Unknown':num(cumulative)));
  svg.append(svgEl('line',{x1:x(0),x2:x(0),y1:top+8,y2:top+rowH-8,stroke:'#b9cbc7',opacity:.7}));
 });return svg;
}
function table(card){
 const details=el('details',undefined,'chart-data-table');details.append(el('summary','Data & units'));
 const table=el('table');table.append(el('caption',`${card.title} · ${card.unit}`));const head=el('tr');head.append(el('th','Observation'));for(const s of card.series){const h=el('th',s.label);h.setAttribute('scope','col');head.append(h);}const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
 card.labels.forEach((label,i)=>{const row=el('tr'),h=el('th',label);h.setAttribute('scope','row');row.append(h);for(const s of card.series)row.append(el('td',num(s.values[i])));body.append(row);});table.append(body);details.append(table);return details;
}
function drawCard(card,basis){
 const domain=chartDomain(card),article=el('article',undefined,'policy-chart-card');article.dataset.chartId=card.id;article.dataset.chartKind=card.kind;
 const header=el('div',undefined,'policy-chart-heading');header.append(createPolicyIcon(card.icon,{size:26}),el('h4',card.title));article.append(header,el('p',`${card.scope?card.scope+' · ':''}${card.unit}`,'chart-unit'),el('p',card.description,'policy-chart-note'));
 const svg=card.kind==='line'?lineChart(card,domain):bars(card,domain);const viewport=el('div',undefined,'chart-viewport');viewport.append(svg);article.append(viewport);
 const legend=el('div',undefined,'policy-chart-legend');for(const s of card.series){const item=el('span'),swatch=svgEl('svg',{viewBox:'0 0 24 10',width:24,height:10,'aria-hidden':'true',focusable:'false'}),style=seriesStyle(card,s);swatch.append(svgEl('path',{d:'M0 5H24',stroke:style.color,'stroke-width':2,'stroke-dasharray':style.dash}));swatch.append(style.marker==='square'?svgEl('rect',{x:10,y:3,width:4,height:4,fill:style.color}):svgEl('circle',{cx:12,cy:5,r:2,fill:style.color}));item.append(swatch,el('span',s.label));legend.append(item);}article.append(legend);
 if(card.selectedIndex!==undefined){const row=el('p',undefined,'chart-current-values');row.append(el('strong',short(card.labels[card.selectedIndex])));for(const s of card.series)row.append(el('span',`${s.label}: ${num(s.values[card.selectedIndex])}`));article.append(row);}
 if(card.kind!=='line'&&card.labels.length>10)article.append(el('p',`Preview: first 10 of ${card.labels.length} observations. The shared scale and full data table include all observations.`,'policy-chart-note'));
 const actions=el('div',undefined,'chart-actions'),save=el('button','Save SVG ↓');save.type='button';save.setAttribute('aria-label',`Save ${card.title} as SVG`);save.addEventListener('click',()=>{
  const copy=svg.cloneNode(true),plotHeight=Number(svg.getAttribute('viewBox').split(' ')[3]);
  for(const t of copy.querySelectorAll('text')){t.setAttribute('fill','#d5e1da');t.setAttribute('font-size','10');}
  const wrap=text=>String(text).match(/.{1,50}(?:\s|$)|.{1,50}/g)??[''];
  const titleLines=wrap(card.title),unitLines=wrap(`${card.scope?card.scope+' · ':''}${card.unit}`),basisLines=wrap(basis),top=18+titleLines.length*15+unitLines.length*12+8,legendTop=top+plotHeight+14,height=legendTop+card.series.length*16+basisLines.length*12+22;
  const output=svgEl('svg',{xmlns:NS,viewBox:`0 0 360 ${height}`,width:900,height:Math.round(height*2.5),role:'img','aria-label':svg.getAttribute('aria-label'),'data-y-min':domain.min,'data-y-max':domain.max});output.append(svgEl('rect',{width:360,height,fill:'#17323d'}),svgEl('title',{},`${card.title} · ${card.unit}`),svgEl('desc',{},`${basis}. ${card.description}`));
  titleLines.forEach((line,i)=>output.append(svgEl('text',{x:20,y:20+i*15,fill:'#f0e5c7','font-size':13,'font-family':'sans-serif'},line)));unitLines.forEach((line,i)=>output.append(svgEl('text',{x:20,y:24+titleLines.length*15+i*12,fill:'#c4d6cb','font-size':10,'font-family':'sans-serif'},line)));
  copy.setAttribute('x',20);copy.setAttribute('y',top);copy.setAttribute('width',320);copy.setAttribute('height',plotHeight);output.append(copy);
  card.series.forEach((series,i)=>{const style=seriesStyle(card,series),py=legendTop+i*16;output.append(svgEl('path',{d:`M20 ${py-3}H42`,stroke:style.color,'stroke-width':2,'stroke-dasharray':style.dash}),svgEl('text',{x:50,y:py,fill:'#d5e1da','font-size':10,'font-family':'sans-serif'},series.label));});basisLines.forEach((line,i)=>output.append(svgEl('text',{x:20,y:legendTop+card.series.length*16+9+i*12,fill:'#b5ccc1','font-size':9,'font-family':'sans-serif'},line)));
  const data=new XMLSerializer().serializeToString(output),url=URL.createObjectURL(new Blob([data],{type:'image/svg+xml'})),a=el('a');a.href=url;a.download=`${card.id}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });actions.append(save);article.append(actions,table(card));return article;
}
export function renderPolicyCharts(container,spec){
 if(spec?.schema!=='nm-policy-charts-v1'||!Array.isArray(spec.cards)||!Array.isArray(spec.unavailable))throw new Error('A policy chart specification is required.');
 const root=el('section',undefined,'policy-visual-analysis');root.setAttribute('aria-label','Automatic policy charts');root.dataset.schema=spec.schema;
 root.append(el('p','VISUAL ANALYSIS','readout-eyebrow'),el('h3',spec.title),el('p',spec.basis,'policy-chart-note'));
 for(const card of spec.cards)root.append(drawCard(card,spec.basis));
 if(!spec.cards.length)root.append(el('p','No supported numeric series were returned. No chart is inferred from missing data.','policy-chart-note'));
 if(spec.unavailable.length){const missing=el('details',undefined,'policy-data-needed');missing.append(el('summary',`More views · ${spec.unavailable.length} need data`));for(const item of spec.unavailable){const row=el('div',undefined,'policy-data-needed-item');row.append(createPolicyIcon(item.icon),el('strong',item.title),el('p',item.reason,'policy-chart-note'));if(item.requiredFields?.length)row.append(el('p',`Needed: ${item.requiredFields.join(', ')}`,'policy-chart-note'));missing.append(row);}root.append(missing);}
 renderVisualLibrary(root);container.replaceChildren(root);return root;
}
