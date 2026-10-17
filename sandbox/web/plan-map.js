import {CHANGE_SYMBOLS,createChangeSymbol} from './change-symbols.js';
import {selectedPlanLayer} from './plan-analysis-model.js';
const NS='http://www.w3.org/2000/svg';
const svgEl=(name,attrs={},text)=>{const e=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=String(text);return e;};
const fmt=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(value):'Not supplied';
export const PLAN_STAGES=Object.freeze({planned:{label:'Planned',fill:'#f5f5f1',stroke:'#969d9b',dash:'3 2'},construction:{label:'Under construction',fill:'#ead5ae',stroke:'#99743b'},complete:{label:'Complete',fill:'#535d61',stroke:'#535d61'},removed:{label:'Removed since prior month',fill:'#fff7f5',stroke:'#ac5b51',dash:'2 2'}});
export function planProjection(bounds){
 const rx=Math.max(1,bounds.maxX-bounds.minX),ry=Math.max(1,bounds.maxY-bounds.minY),scale=Math.min(338/rx,194/ry);
 return {scale,point:p=>({x:210+(p.x-(bounds.minX+bounds.maxX)/2)*scale,y:140+(p.y-(bounds.minY+bounds.maxY)/2)*scale})};
}
export function featureDescription(packet,layer,f){
 const value=layer.kind==='status'?(PLAN_STAGES[f.status]?.label??f.status):fmt(f.value)+' '+layer.unit;
 if(layer.kind==='flows')return `${f.label??f.id} · ${value} · modeled two-way allocation`;
 const delta=f.delta===null?'No comparable prior value':`${f.delta>0?'+':''}${fmt(f.delta)} vs ${packet.previousDate}`;
 return `${f.label??f.id} · ${value}${layer.kind==='status'?' · '+(CHANGE_SYMBOLS[f.change]?.label??f.change):' · '+delta}`;
}
export function renderPlanMap(container,packet,layerId,{thumbnail=false,onSelect}={}){
 const layer=selectedPlanLayer(packet,layerId),projection=planProjection(packet.bounds),svg=svgEl('svg',{viewBox:'0 0 420 280',class:'plan-map',role:onSelect&&!thumbnail?'group':'img','aria-label':layer.title+' · '+packet.date+' · '+packet.spatialBasis});
 svg.append(svgEl('title',{},layer.title+' · '+packet.date));
 svg.append(svgEl('rect',{width:420,height:280,fill:'#f8f9f6'}));
 for(let x=30;x<420;x+=30)svg.append(svgEl('line',{x1:x,y1:18,x2:x,y2:262,stroke:'#e6eae6','stroke-width':.6}));
 for(let y=20;y<280;y+=30)svg.append(svgEl('line',{x1:16,y1:y,x2:404,y2:y,stroke:'#e6eae6','stroke-width':.6}));
 const radius=packet.source==='backend'?Math.min(10,Math.max(2,projection.scale*.3)):16;
 if(packet.source==='backend')for(const f of packet.context){const p=projection.point(f);svg.append(svgEl('rect',{x:p.x-radius*.7,y:p.y-radius*.7,width:radius*1.4,height:radius*1.4,fill:'#e0e5e1',stroke:'#bfc9c3','stroke-width':.5}));}
 if(packet.source==='topic')svg.append(svgEl('rect',{x:93,y:48,width:234,height:184,rx:7,fill:'#edf1ec',stroke:'#b4bdb6','stroke-dasharray':'5 4'}));
 if(layer.kind==='flows'){
  const origin=projection.point(packet.port);svg.append(svgEl('circle',{cx:origin.x,cy:origin.y,r:5,fill:'#31464a'}));
  if(!thumbnail)svg.append(svgEl('text',{x:origin.x,y:origin.y-10,'text-anchor':'middle',fill:'#31464a','font-size':11},'Huanggang Port'));
 }
 for(const f of layer.features){
  const p=projection.point(f),g=svgEl('g',{'data-plan-feature':f.id}),description=featureDescription(packet,layer,f);g.append(svgEl('title',{},description));
  if(layer.kind==='flows'){
   const origin=projection.point(packet.port);
   // Shared full-study scale, including zero. These are two-way totals, not migration arrows.
   if(f.value>0)g.append(svgEl('path',{d:`M${origin.x} ${origin.y} Q${origin.x} ${p.y} ${p.x} ${p.y}`,fill:'none',stroke:layer.color,'stroke-width':.8+5*Math.sqrt(f.value/layer.scaleMax),opacity:.8}));
   g.append(svgEl('circle',{cx:p.x,cy:p.y,r:4,fill:layer.color}));
   if(!thumbnail){g.append(svgEl('text',{x:p.x,y:p.y+16,'text-anchor':'middle',fill:'#263e43','font-size':10},f.label),svgEl('text',{x:p.x,y:p.y+29,'text-anchor':'middle',fill:'#53656a','font-size':10},fmt(f.value)));}
  }else if(layer.kind==='status'){
   const style=PLAN_STAGES[f.status]??PLAN_STAGES.planned;
   const shape=f.type==='station'?svgEl('path',{d:`M${p.x} ${p.y-radius}l${radius} ${radius} -${radius} ${radius} -${radius} -${radius}Z`}):svgEl('rect',{x:p.x-radius,y:p.y-radius,width:radius*2,height:radius*2,rx:1});
   for(const [k,v] of Object.entries({fill:style.fill,stroke:style.stroke,'stroke-width':1.3,...(style.dash?{'stroke-dasharray':style.dash}:{})}))shape.setAttribute(k,String(v));g.append(shape);
   if(!thumbnail&&['added','removed','started','completed'].includes(f.change)){const badge=createChangeSymbol(f.change,{size:13,decorative:true});badge.setAttribute('x',String(p.x+radius-3));badge.setAttribute('y',String(p.y-radius-10));g.append(badge);}
  }else{
   const aggregate=layer.kind==='aggregate',r=f.value===null?7:aggregate?18+38*Math.sqrt(f.value/layer.scaleMax):f.value===0?2:Math.max(2,radius*Math.sqrt(f.value/layer.scaleMax));
   const attrs={cx:p.x,cy:p.y,r,fill:f.value===null?'#f7f7f4':layer.color,'fill-opacity':f.value===0?.12:.75,stroke:f.value===null?'#758180':layer.color,'stroke-width':1,...(f.value===null?{'stroke-dasharray':'2 2'}:{})};
   g.append(svgEl('circle',attrs));
   if(!thumbnail&&aggregate){g.append(svgEl('text',{x:p.x,y:p.y-5,'text-anchor':'middle',fill:'#17383f','font-size':24,'font-weight':600},fmt(f.value)),svgEl('text',{x:p.x,y:p.y+17,'text-anchor':'middle',fill:'#17383f','font-size':12},layer.unit),svgEl('text',{x:210,y:253,'text-anchor':'middle',fill:'#53656a','font-size':11},f.label));}
   if(!thumbnail&&!aggregate&&f.value===null)g.append(svgEl('text',{x:p.x,y:p.y+3,'text-anchor':'middle','font-size':9,fill:'#414f50'},'?'));
   if(!thumbnail&&!aggregate&&f.delta!==null&&f.delta!==0){const badge=createChangeSymbol(f.change,{size:11,decorative:true});badge.setAttribute('x',String(p.x+r-2));badge.setAttribute('y',String(p.y-r-9));g.append(badge);}
  }
  if(!thumbnail&&onSelect){
   // The invisible target remains large enough for pointer and keyboard selection.
   g.append(svgEl('circle',{cx:p.x,cy:p.y,r:Math.max(11,radius),fill:'transparent'}));g.setAttribute('role','button');g.setAttribute('tabindex','0');g.setAttribute('aria-label',description);g.setAttribute('class','plan-feature');
   g.addEventListener('click',()=>onSelect(f));g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation?.();onSelect(f);}});
  }
  svg.append(g);
 }
 if(!layer.features.length&&!thumbnail)svg.append(svgEl('text',{x:210,y:140,'text-anchor':'middle',fill:'#53656a','font-size':12},'No objects of this type in this saved month.'));
 container.replaceChildren(svg);return svg;
}
