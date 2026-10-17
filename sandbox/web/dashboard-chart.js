import {chartDomain,seriesStyle} from './policy-charts.js';
const NS='http://www.w3.org/2000/svg',short=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.slice(0,7):v;
const value=v=>v===null?'Not provided':new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(v);
const compact=v=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(v);
export function renderDashboardChart(container,card){
 container.replaceChildren();const domain=chartDomain(card),width=Math.max(280,container.clientWidth||560),rowH=22+(card.kind==='stack'?12:12*card.series.length),height=card.kind==='line'?124:Math.max(124,30+Math.min(5,card.labels.length)*rowH),left=44,right=12,top=10,bottom=96,w=width-left-right,h=bottom-top;
 const node=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=String(text);return e;};
 const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`${card.title}. ${card.unit}. Full-window axis ${domain.min} to ${domain.max}.`,class:'dashboard-plot','data-y-min':domain.min,'data-y-max':domain.max,'data-chart-id':card.id,'data-chart-kind':card.kind});svg.style.height=height+'px';svg.append(node('title',{},card.title),node('desc',{},card.description));
 if(card.kind==='line'){
  const x=i=>left+(card.labels.length===1?.5:i/(card.labels.length-1))*w,y=v=>top+(domain.max-v)/(domain.max-domain.min)*h;
  for(const tick of [...new Set([domain.min,(domain.min+domain.max)/2,domain.max])])svg.append(node('line',{x1:left,x2:width-right,y1:y(tick),y2:y(tick),stroke:'#9ebeb235','stroke-dasharray':'3 4'}),node('text',{x:left-6,y:y(tick)+4,'text-anchor':'end',fill:'#bdd2c3','font-size':11},compact(tick)));
  for(const series of card.series){const style=seriesStyle(card,series);let d='',connect=false;series.values.forEach((v,i)=>{if(v===null){connect=false;return;}d+=`${connect?'L':'M'}${x(i)},${y(v)} `;connect=true;});svg.append(node('path',{d,stroke:style.color,'stroke-dasharray':style.dash,'stroke-width':2,fill:'none','data-series':series.id}));
   series.values.forEach((v,i)=>{if(v===null)return;const radius=i===card.selectedIndex?3.8:1.6,mark=style.marker==='square'?node('rect',{x:x(i)-radius,y:y(v)-radius,width:radius*2,height:radius*2,fill:style.color}):node('circle',{cx:x(i),cy:y(v),r:radius,fill:style.color});mark.append(node('title',{},`${card.labels[i]} · ${series.label}: ${value(v)} ${card.unit}`));svg.append(mark);});
  }
  if(card.selectedIndex!==undefined)svg.append(node('line',{x1:x(card.selectedIndex),x2:x(card.selectedIndex),y1:top,y2:bottom,stroke:'#f3e4ad','stroke-dasharray':'2 3','data-selected-index':card.selectedIndex}));
  for(const i of [...new Set([0,Math.floor((card.labels.length-1)/2),card.labels.length-1])])svg.append(node('text',{x:x(i),y:118,'text-anchor':i===0?'start':i===card.labels.length-1?'end':'middle',fill:'#c5d6ca','font-size':11},short(card.labels[i])));
 }else{
  const labels=card.labels.slice(0,5),x=v=>left+(v-domain.min)/(domain.max-domain.min)*w,band=12;
  labels.forEach((label,i)=>{const rowY=top+i*rowH;svg.append(node('text',{x:left,y:rowY+8,fill:'#c5d6ca','font-size':11},short(label)));let cumulative=0;card.series.forEach((series,j)=>{const v=series.values[i],style=seriesStyle(card,series),py=rowY+12+(card.kind==='stack'?0:j*band);if(v===null){svg.append(node('text',{x:left,y:py+10,fill:'#c5d6ca','font-size':10},series.label+': Not provided'));return;}const start=card.kind==='stack'?cumulative:0,end=start+v;const bar=node('rect',{x:Math.min(x(start),x(end)),y:py,width:Math.abs(x(end)-x(start)),height:card.kind==='stack'?12:band-1,fill:style.color,'data-value':v,'data-series':series.id});bar.append(node('title',{},`${series.label}: ${value(v)} ${card.unit}`));svg.append(bar);if(card.kind==='stack')cumulative+=v;});});
  svg.append(node('text',{x:left,y:height-5,fill:'#c5d6ca','font-size':11},compact(domain.min)),node('text',{x:width-right,y:height-5,'text-anchor':'end',fill:'#c5d6ca','font-size':11},compact(domain.max)));
 }
 container.append(svg);return svg;
}
