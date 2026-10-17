// Reusable change marks. Pair every mark with a metric, date, unit and comparison.
// These describe model records; none is a confidence or causal-effect score.
export const CHANGE_SYMBOL_VERSION='nm-change-symbols-v1';
const symbol=(label,meaning,color,paths)=>Object.freeze({label,meaning,color,paths:Object.freeze(paths)});
export const CHANGE_SYMBOLS=Object.freeze({
 added:symbol('Added object','Present now and absent in the prior saved month.','#267950',['M12 4v16M4 12h16']),
 removed:symbol('Removed object','Present in the prior saved month and absent now.','#ad4c42',['M4 12h16']),
 started:symbol('Construction started','Existing planned object changed to construction.','#a16b27',['M5 20V7h14M3 7h18M15 7v9M12 16h6']),
 completed:symbol('Completed','Existing object changed to complete since the prior saved month.','#267950',['M4 12l5 5L20 6']),
 increase:symbol('Increase','Positive difference from the prior comparable saved value.','#236b88',['M12 20V4M5 11l7-7 7 7']),
 decrease:symbol('Decrease','Negative difference from the prior comparable saved value.','#ad4c42',['M12 4v16M5 13l7 7 7-7']),
 unchanged:symbol('Unchanged','Comparable saved value or state is unchanged.','#68747b',['M5 9h14M5 15h14']),
 unavailable:symbol('Not comparable','Missing value or no prior comparable saved month; not zero.','#68747b',['M8 7a4 4 0 0 1 8 0c0 3-4 3-4 6M12 18v1'])
});
export function deltaSymbol(delta){return typeof delta!=='number'||!Number.isFinite(delta)?'unavailable':delta>0?'increase':delta<0?'decrease':'unchanged';}
export function createChangeSymbol(key,{size=20,decorative=false}={}){
 const data=CHANGE_SYMBOLS[key]??CHANGE_SYMBOLS.unavailable,ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:data.color,'stroke-width':1.9,'stroke-linecap':'round','stroke-linejoin':'round',focusable:'false',class:'change-symbol'}))svg.setAttribute(k,String(v));
 if(decorative)svg.setAttribute('aria-hidden','true');else{svg.setAttribute('role','img');svg.setAttribute('aria-label',data.label);}
 const title=document.createElementNS(ns,'title');title.textContent=data.label+' · '+data.meaning;svg.append(title);
 for(const d of data.paths){const p=document.createElementNS(ns,'path');p.setAttribute('d',d);svg.append(p);}return svg;
}
