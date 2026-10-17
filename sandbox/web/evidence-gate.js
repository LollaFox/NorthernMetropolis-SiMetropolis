// Presentation review, not a real-world truth detector. Caller-provided canonical
// facts are trusted model records; confidence or citations inside a claim are not.
const textKey=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/[\s.,，。!！?？:：;；]+/g,'').trim();
export function reviewClaims(claims,{facts=[],date,objectIds=[]}={}){
 const seen=new Set(),ids=new Set(objectIds),reviewed=[];
 for(const claim of claims??[]){
  const item=typeof claim==='string'?{text:claim}:claim??{},key=textKey(item.text);let status='withheld',reason='No checkable link to a saved field.';
  if(!key){status='excluded';reason='Empty content.';}
  else if(seen.has(key)){status='excluded';reason='Duplicate content.';}
  else if(item.date&&item.date!==date){status='excluded';reason='Different result month.';}
  else if(item.objectId&&!ids.has(item.objectId)){status='excluded';reason='Object is outside this result scope.';}
  else if(item.kind==='real_world_effect'||item.kind==='causal'){status='unsupported';reason='No independently validated causal comparison is connected.';}
  else if(item.kind==='assumption'){status='assumption';reason='An assumption is not an observed outcome.';}
  else if(item.kind==='state'){
   const fact=facts.find(f=>f.field===item.field&&f.objectId===item.objectId&&f.date===date);
   if(!fact){status='unsupported';reason='Field is outside the supplied model data.';}
   else if(typeof item.value!=='number'||!Number.isFinite(item.value)||item.value!==fact.value){status='excluded';reason='Claimed value does not match the saved field.';}
   else{status='model_record';reason=`Saved model field ${fact.field} matches; wording is not independently verified.`;}
  }
  if(key)seen.add(key);
  // Raw wording is retained for an audit/export, never promoted to a headline.
  reviewed.push({...item,status,reason,publishRawText:false});
 }
 const counts={};for(const row of reviewed)counts[row.status]=(counts[row.status]??0)+1;
 return {schema:'nm-evidence-review-v1',date,reviewed,counts,withheld:reviewed.length,independentValidation:false};
}
export function renderEvidenceBrief(container,evidence){
 const el=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;};
 container.replaceChildren();const root=el('section',undefined,'evidence-brief');
 root.append(el('p',evidence.status,'evidence-state'),el('h3',evidence.title));
 for(const [title,value] of [['Mechanism',evidence.mechanism],['What this supports',evidence.supports],['What it does not prove',evidence.limits]]){const block=el('div',undefined,'evidence-point');block.append(el('strong',title),el('p',value));root.append(block);}
 const audit=el('details',undefined,'evidence-audit');audit.append(el('summary','Assumptions & content review'));
 for(const item of evidence.assumptions??[])audit.append(el('p',item));
 if(evidence.review?.withheld){audit.append(el('p',`${evidence.review.withheld} narrative item(s) kept out of the main conclusion. Original wording remains in the source export.`));const reasons=[...new Set(evidence.review.reviewed.map(row=>row.reason))];for(const reason of reasons.slice(0,4))audit.append(el('p',reason));}
 else audit.append(el('p','No unsupported generated wording is used as a main finding.'));
 audit.append(el('p','This review checks supplied fields and scope. It does not independently verify real-world policy effects.'));root.append(audit);container.append(root);return root;
}
