// One presentation structure for every source; text is set without HTML injection.
export function renderInterpretation(container,brief){
  const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(cls)el.className=cls;return el;};
  const card=make('article',undefined,'policy-readout');card.setAttribute('aria-label','Standardized policy interpretation');
  card.dataset.schema=brief.schema;
  const heading=make('div',undefined,'readout-heading');heading.append(make('span','POLICY INTERPRETATION','readout-eyebrow'));
  const toggle=make('button','Expand all','readout-expand');toggle.type='button';toggle.setAttribute('aria-expanded','false');heading.append(toggle);
  card.append(heading,make('h3',brief.title),make('p',brief.basis,'readout-basis'),make('p',brief.summary,'readout-summary'));
  const details=[];
  brief.sections.forEach((section,index)=>{
    const item=make('details',undefined,'readout-section');item.dataset.section=section.id;item.open=['comparison','mechanism','timing'].includes(section.id);
    const title=make('summary');title.append(make('span',String(index+1).padStart(2,'0'),'readout-index'),make('span',section.title));
    const list=make('ul');for(const text of section.items)list.append(make('li',text));item.append(title,list);details.push(item);card.append(item);
  });
  const sync=()=>{const expanded=details.every(item=>item.open);toggle.textContent=expanded?'Collapse all':'Expand all';toggle.setAttribute('aria-expanded',String(expanded));};
  for(const item of details)item.addEventListener('toggle',sync);
  toggle.addEventListener('click',()=>{const expand=!details.every(item=>item.open);for(const item of details)item.open=expand;sync();});
  container.replaceChildren(card);return card;
}
