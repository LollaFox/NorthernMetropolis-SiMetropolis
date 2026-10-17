// Seed catalogue. Housing and school entries are hypothetical studies, not official projects.
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
export const CATALOG_VERSION='nm-policy-catalog-v1';
export const AREAS=freeze([
 {id:'huanggang',label:'Huanggang',districtId:'san-tin',geography:'Schematic port context'},
 {id:'kwu-tung-north',label:'Kwu Tung North',districtId:'kwu-tung',geography:'Schematic district; not an official policy polygon'},
 {id:'hung-shui-kiu',label:'Hung Shui Kiu',districtId:'hung-shui-kiu',geography:'Schematic district; not an official policy polygon'}
]);
export const POLICIES=freeze([
 {id:'huanggang-opening',areaId:'huanggang',label:'Port opening',model:'huanggang',tags:['border-access','transport-capacity','information-reach'],primaryTag:'border-access',kind:'rule-demo',description:'Existing Huanggang travel study. Clearance, reach and feeder capacity affect assumed passenger trips.',limits:'No housing, migration or school effects; no observed traffic is loaded.'},
 {id:'kwu-tung-housing',areaId:'kwu-tung-north',label:'Additional homes · scenario',model:'housing',tags:['housing-affordability'],primaryTag:'housing-affordability',kind:'hypothetical',prefix:'KH',glyphUnit:250,
  description:'Hypothetical release of usable housing units in Kwu Tung North. Compare household demand with housing stock from the assumed commissioning month.',limits:'No rent, household income, affordability, migration choice or actual project schedule is available. One usable unit represents capacity for one household, not a promise of settlement.',
  defaults:{start:'2026-08-01',end:'2027-07-01',demand:12000,supply:11000,growth:40,added:1600,commission:'2027-02-01',rollout:4}},
 {id:'hung-shui-kiu-school',areaId:'hung-shui-kiu',label:'Additional school places · scenario',model:'education',tags:['public-services'],primaryTag:'public-services',kind:'hypothetical',prefix:'HS',glyphUnit:100,
  description:'Hypothetical addition of primary-school places in Hung Shui Kiu. Compare eligible-pupil demand with school capacity after the assumed opening month.',limits:'Education only. Capacity coverage is not a geographic catchment or an enrollment guarantee. No healthcare, waiting-time, travel-time or care-service model is included.',
  defaults:{start:'2026-08-01',end:'2027-12-01',demand:3600,supply:3000,growth:10,added:900,commission:'2027-09-01',rollout:1}}
]);
export function getPolicy(id){const p=POLICIES.find(p=>p.id===id);if(!p)throw new Error('Unknown policy.');return p;}
export function getArea(id){const a=AREAS.find(a=>a.id===id);if(!a)throw new Error('Unknown study area.');return a;}
export function matchingPolicies(areaId,tags=[]){getArea(areaId);return POLICIES.filter(p=>p.areaId===areaId&&tags.every(t=>p.tags.includes(t)));}
export function matchingTags(areaId){return [...new Set(matchingPolicies(areaId).flatMap(p=>p.tags))];}
export function assertPolicyScope(policyId,areaId,tags){const p=getPolicy(policyId);if(!tags?.length||p.areaId!==areaId||!tags.every(t=>p.tags.includes(t)))throw new Error('Choose a policy matching the selected area and tags.');return p;}
