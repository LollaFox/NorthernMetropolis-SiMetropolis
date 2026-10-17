// Presentation of known adapters only. This is not a server capability contract
// or evidence that a policy has a real-world effect.
const LOCAL={
 huanggang:{label:'Local passenger model',mechanism:'Clearance target, assumed reach and shared feeder capacity change modeled passenger trips.',units:'Passenger trips/day; not unique people or residential migration.',source:'Published policy context with assumed demand responses; no observed traffic is connected.',limits:'Housing, settlement and employment effects are not modeled.'},
 housing:{label:'Local housing supply model',mechanism:'Commissioning month and rollout release assumed housing capacity; demand determines the unmet gap.',units:'Households and housing units are separate counts.',source:'Hypothetical demand, supply and commissioning inputs.',limits:'Rent, household income and housing affordability are not assessed.'},
 education:{label:'Local school-place model',mechanism:'Commissioning month releases assumed school places against eligible-pupil demand.',units:'Pupils and school places are separate counts.',source:'Hypothetical pupil demand and school capacity.',limits:'Healthcare, care services and actual enrollment are not assessed.'}
};
export function describeAnalysisCapability({policy,engine,backendActive=false,presetAcknowledged=false}={}){
 if(!policy)return {status:'Choose a policy',support:'unselected',title:'Select an area and policy tags',basis:'No analysis scope selected.',mechanism:'Choose a matching policy before configuring inputs.',units:'Not selected',source:'Not selected',limits:'No results are inferred.'};
 if(engine==='rules'){
  const model=LOCAL[policy.model];if(!model)return {status:'Not connected',support:'unavailable',title:policy.label,basis:'No local model supports this policy.',mechanism:'A model adapter is required.',units:'Not provided',source:'Not provided',limits:'This policy cannot run in the current local model.'};
  return {...model,status:'Local model ready',support:'local',title:policy.label,basis:model.label+' · assumed inputs'};
 }
 if(engine==='fixture')return {status:'API test only',support:'test',title:policy.label,basis:'Synthetic contract test; not a policy analysis.',mechanism:'Returns test snapshots to check the interface. Policy tags do not produce policy effects.',units:'Returned test units only.',source:'Synthetic API fixture; PDF text is not read.',limits:'No policy inference or real-world prediction is performed.'};
 if(backendActive)return {status:presetAcknowledged?'Server script only':'Policy not connected',support:'script',title:policy.label,basis:'Selected policy is context only; the selected server scenario and government mode control this run.',mechanism:'Choose a construction layout and government mode in Configure, or choose Local scenario models in Configure to analyze this selected policy.',units:'Resident places, modeled residents and jobs; not housing units.',source:'Server scenario JSON. The PDF is recorded as an attachment, not interpreted.',limits:'Selecting tags or uploading a PDF does not change the construction script. Policy-to-script binding is not connected.'};
 return {status:'Capabilities unverified',support:'unknown',title:policy.label,basis:'External Team API support must be checked in its initialization review.',mechanism:'Do not infer support from the selected tags. Check the returned review before confirming.',units:'Use only the returned metric units.',source:'External API; capabilities are not declared by this frontend.',limits:'Connection status does not establish policy support or model accuracy.'};
}
export function needsScriptAcknowledgement({engine,backendActive,presetAcknowledged,session}={}){
 return engine==='backend'&&backendActive&&!presetAcknowledged&&!session?.pending&&(!session||session.state==='draft');
}
export function renderCapabilityBrief(container,packet){
 if(!container)return;
 const signature=JSON.stringify(packet);if(container.dataset.signature===signature)return;container.dataset.signature=signature;container.dataset.support=packet.support;
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
 const summary=el('summary'),heading=el('span',packet.title,'capability-title'),badge=el('span',packet.status,'capability-badge');badge.setAttribute('role','status');summary.append(heading,badge,el('span','Scope & limits ⌄','capability-expand'));
 const body=el('div',undefined,'capability-content');body.append(el('p',packet.basis));
 for(const [label,text] of [['Model mechanism',packet.mechanism],['Units',packet.units],['Source basis',packet.source],['Not assessed',packet.limits]]){const row=el('p');row.append(el('strong',label+' · '),el('span',text));body.append(row);}
 container.replaceChildren(summary,body);
}
