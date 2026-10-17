// Seed policy tags for this prototype; not automatic labels from a knowledge base.
export const POLICY_TAGS=Object.freeze([
 {id:'border-access',label:'Port opening',rules:true,focus:'Clearance and cross-boundary access'},
 {id:'transport-capacity',label:'Transport capacity',rules:true,focus:'Feeder capacity and unserved demand'},
 {id:'information-reach',label:'Information reach',rules:true,focus:'Awareness and informed passenger groups'},
 // Stable IDs retain compatibility with saved histories; display labels name
 // only the indicators actually supported by the current adapters.
 {id:'housing-affordability',label:'Housing supply',rules:true,focus:'Usable housing supply and household demand; affordability is not modeled'},
 {id:'public-services',label:'School places',rules:true,focus:'School-place capacity pilot; healthcare and care are not modeled'}
]);
export function validateTags(ids,mode='rules') {
 if(!Array.isArray(ids)||!ids.length||ids.length>POLICY_TAGS.length||new Set(ids).size!==ids.length)throw new Error('Select at least one policy tag.');
 const tags=ids.map(id=>POLICY_TAGS.find(t=>t.id===id));
 if(tags.some(t=>!t))throw new Error('Unknown policy tag.');
 return tags;
}
export function scopeMetadata(ids,mode){return {schema:'nm-policy-scope-v1',tags:validateTags(ids,mode).map(t=>t.id),purpose:'policy-analysis'};}
export function sameInputs(a,b){return ['year','timing','baseline','reach','clearance','capacity'].every(k=>a?.[k]===b?.[k]);}
