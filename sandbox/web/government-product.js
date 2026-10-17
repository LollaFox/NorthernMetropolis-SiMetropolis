const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const fields=[['initial_budget','Project budget · HKD',200000000],['wage','Monthly wage · HKD',17000],['rent_per_person','Rent per resident · HKD/month',3000],['living_cost_per_person','Living cost · HKD/month',2500],['subsidy_per_person','Subsidy per resident · HKD/month',200]];

export function mountGovernment(owner){
 const section=el('section');section.id='government-config';section.className='analysis-preset-purpose hidden';
 const label=el('label','Construction layout · 建设情景'),layout=el('select');layout.id='construction-scenario';
 for(const [value,text] of [['configured','Original server scenario'],['segregated','功能分区 · Business district + residential/park district'],['mixed','混合布局 · Two mixed districts']]){const o=el('option',text);o.value=value;layout.append(o);}label.append(layout);section.append(label);
 const modeLabel=el('label','Government operation · 政府运行方式'),mode=el('select');mode.id='government-mode';
 for(const [value,text] of [['fixed','Fixed schedule · 无API'],['offline-test','Government test · 离线测试，不是AI'],['live','Government AI · 仅政府调用API']]){const o=el('option',text);o.value=value;mode.append(o);}modeLabel.append(mode);section.append(modeLabel);
 const note=el('p');note.id='government-availability';note.className='quiet';section.append(note);
 const params=el('details'),summary=el('summary','Fiscal assumptions · 财政参数');params.append(summary);
 for(const [key,title,value] of fields){const l=el('label',title),input=el('input');input.type='number';input.min='0';input.step='any';input.value=String(value);input.id='government-'+key;l.append(input);params.append(l);}section.append(params);
 section.append(el('p','Six fixed projects; government may choose start times. Residents, firms and fiscal settlement use rules. PDF text and policy tags do not change these plans.'));
 $('analysis-api-config').prepend(section);
 layout.addEventListener('change',()=>{if(layout.value!=='configured'){$('analysis-start-date').value='2025-01-01';$('analysis-end-date').value='2026-12-01';$('analysis-step').value='month';}syncGovernment(owner);});
 mode.addEventListener('change',()=>syncGovernment(owner));
}

export function syncGovernment(owner){
 if(!$('government-config'))return;
 $('government-config').classList.toggle('hidden',$('analysis-engine').value!=='backend');
 const configured=$('construction-scenario').value==='configured';$('government-mode').disabled=configured;
 const live=$('government-mode').querySelector('option[value="live"]');live.disabled=!owner.config?.governmentLiveAvailable;
 $('government-availability').textContent=owner.config?.governmentLiveAvailable?`Live provider ready: ${owner.config.governmentModel}. Only a confirmed AI run makes API calls.`:'Live provider not configured. Use offline test, or launch the server with a backend API key. No key is entered in the browser.';
}

export function governmentSetup(){
 if(!$('construction-scenario')||$('analysis-engine')?.value!=='backend')return {};
 const constructionScenario=$('construction-scenario').value;
 if(constructionScenario==='configured')return {constructionScenario};
 const fiscalParameters=Object.fromEntries(fields.map(([key])=>{const input=$('government-'+key),value=Number(input.value);if(!input.value.trim()||!Number.isFinite(value)||value<0)throw new Error('Enter a non-negative '+key);return [key,value];}));
 return {constructionScenario,fiscalEnabled:true,governmentMode:$('government-mode').value,fiscalParameters};
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

