const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const PRODUCT_SCRIPTS=['default-city','function-zones','mixed-zones'];

// The old configured / segregated / mixed scripts, their date pickers, and live
// government start-date decisions are not connected to Configure.
export const GOVERNMENT_LIVE_DECISIONS_ENABLED = false;

export function mountGovernment(){}

export function syncGovernment(){}

export function governmentSetup(){
 if(!$('construction-scenario')||$('analysis-engine')?.value!=='backend')return {};
 const constructionScenario=$('construction-scenario').value;
 return PRODUCT_SCRIPTS.includes(constructionScenario)?{constructionScenario}:{};
}

export function renderGovernmentResults(container,state){
 if(!state?.fiscal)return;
 const section=el('section');section.id='government-results';section.append(el('h3','Government & fiscal results · 政府与财政'));
 const mode=state.governmentMode??'fixed';section.append(el('p',mode==='live'?'LIVE government decisions · resident and firm rules':mode==='offline-test'?'OFFLINE TEST · no model calls':'Fixed schedule · no government model calls'));
 const table=el('table');
 for(const [key,label] of [['population','Residents'],['employed','Employed incl. outside jobs'],['offered_jobs','Local jobs offered'],['local_jobs_filled','Local jobs filled'],['closing_project_budget','Project balance · HKD'],['construction_spending','Construction spending · HKD'],['subsidy_paid','Subsidy paid · HKD'],['salaries_tax_accrual','Salaries tax accrued · HKD'],['profits_tax_accrual','Profits tax accrued · HKD']]){const row=el('tr');row.append(el('th',label),el('td',state.fiscal[key]==null?'Unavailable':new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(state.fiscal[key])));table.append(row);}section.append(table);
 const decision=state.governmentDecisions?.at(-1);
 if(decision){section.append(el('h4',`Government decision · month ${state.step}`),el('p',decision.response.startProjects.length?'Start: '+decision.response.startProjects.join(', '):'Wait — no new construction'),el('p',decision.response.reason));}
 const list=el('ul');for(const b of state.buildings.filter(b=>!b.baseline))list.append(el('li',`${b.id} · ${b.type} · ${b.status} · actual start ${b.actualStart??'—'} · expected completion ${b.actualCompletion??'—'}`));section.append(list);
 section.append(el('p','Synthetic experiment. Project balance is not a government treasury; taxes are modeled accruals. Layout results are not validated policy forecasts.'));
 container.append(section);
}

