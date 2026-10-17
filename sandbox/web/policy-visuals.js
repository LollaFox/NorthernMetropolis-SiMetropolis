// Semantic SVG symbols; quantities are always carried by labelled chart data.
const icon=(label,meaning,paths)=>Object.freeze({label,meaning,paths:Object.freeze(paths)});
export const POLICY_ICONS=Object.freeze({
 population:icon('Population','Resident stock; not trips or migration',['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6','M3 20v-2a6 6 0 0 1 12 0v2','M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2']),
 migration:icon('Residential migration','People moving residence; inflow and outflow remain separate',['M3 7h16m-4-4 4 4-4 4','M21 17H5m4-4-4 4 4 4']),
 inflow:icon('Inflow','Recorded incoming people, with a stated period',['M3 12h12m-4-4 4 4-4 4','M17 4h4v16h-4']),
 outflow:icon('Outflow','Recorded outgoing people, with a stated period',['M9 12h12m-4-4 4 4-4 4','M7 4H3v16h4']),
 housing:icon('Housing supply','Usable housing capacity; not buildings or household affordability',['M3 11 12 3l9 8','M5 10v11h14V10','M9 21v-7h6v7']),
 construction:icon('Construction progress','Scheduled and completed delivery; status needs a dated source',['M4 21V3h14M3 7h18l-5-4','M16 7v8m-2 0h4v3h-4z','M2 21h7']),
 transport:icon('Passenger movement','Trips in a period; not unique residents',['M5 4h14v13H5z','M8 8h8M5 12h14','M7 17v3m10-3v3M8 15h1m6 0h1']),
 rail:icon('Rail infrastructure','Railway asset or project; not proof of new construction',['M7 3h10v13H7zM7 9h10M10 13h4','M9 16l-4 5m10-5 4 5M7 19h10']),
 road:icon('Road infrastructure','Road asset or length with explicit status and unit',['M7 3 3 21M17 3l4 18','M12 3v3m0 4v4m0 4v3']),
 capacity:icon('Capacity constraint','Shared supply, utilisation or unserved demand',['M4 19a8 8 0 1 1 16 0','M12 17l5-7M12 18h.01','M4 19h16']),
 education:icon('School places','Pupil demand and school-place capacity',['M3 9 12 4l9 5-9 5z','M6 11v6l6 3 6-3v-6M21 9v8']),
 healthcare:icon('Healthcare','Health-service capacity; no waiting time inferred',['M8 3h8v5h5v8h-5v5H8v-5H3V8h5z']),
 care:icon('Care services','Care demand and provision; coverage needs eligibility data',['M3 15h5l3 3h8a2 2 0 0 1 0 4H9l-6-4','M13 13l-5-5a3 3 0 0 1 5-4 3 3 0 0 1 5 4z']),
 information:icon('Information reach','Awareness and evidence; not decision probability',['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18','M12 11v6m0-10h.01']),
 jobs:icon('Employment','Jobs or capacity, with explicit source and date',['M3 7h18v14H3zM8 7V3h8v4','M3 12l9 3 9-3M12 12v5'])
});
export const VISUAL_ROLES=Object.freeze({
 baseline:Object.freeze({label:'No-policy baseline',color:'#28c3d7',dash:'7 4'}),
 policy:Object.freeze({label:'Policy scenario / commissioned',color:'#ffbd4c',dash:''}),
 demand:Object.freeze({label:'Demand',color:'#e1e8ed',dash:'2 4'}),
 unmet:Object.freeze({label:'Unmet / remaining',color:'#f2a18e',dash:'3 3'}),
 context:Object.freeze({label:'Returned / planned context',color:'#9eb3be',dash:'8 3 2 3'})
});
export function createPolicyIcon(key,{decorative=true,size=24}={}){
 const data=POLICY_ICONS[key]??POLICY_ICONS.information,NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width',String(size));svg.setAttribute('height',String(size));svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('focusable','false');svg.setAttribute('class','policy-icon');
 if(decorative)svg.setAttribute('aria-hidden','true');else {svg.setAttribute('role','img');svg.setAttribute('aria-label',data.label);const title=document.createElementNS(NS,'title');title.textContent=data.label;svg.append(title);}
 for(const d of data.paths){const path=document.createElementNS(NS,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}
export function renderVisualLibrary(container){
 const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 const details=make('details',undefined,'policy-visual-key');details.append(make('summary',`Visual key · ${Object.keys(POLICY_ICONS).length} symbols`));
 const grid=make('div',undefined,'policy-icon-library');for(const [key,icon] of Object.entries(POLICY_ICONS)){const row=make('div');row.append(createPolicyIcon(key),make('strong',icon.label),make('small',icon.meaning));grid.append(row);}
 details.append(grid,make('p','Icons identify topics. Data availability decides which charts can be generated. A road icon alone does not establish a construction project.','policy-chart-note'));container.append(details);return details;
}
