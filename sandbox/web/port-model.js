/** Pure, deterministic study adapter. Passenger trips are NOT unique people.
 * Replace group decision rules with a validated agent adapter before claiming LLM results.
 */
export const SOURCES = [
  {id:'opening-notice', title:'Official opening notice · 9 Oct 2026', url:'https://www.info.gov.hk/gia/general/202610/09/P2026100900281p.htm', fact:'Public opening: 12 October 2026, 06:30; 24-hour passenger service.'},
  {id:'design-targets', title:'Clearance and design targets · 30 Jul 2026', url:'https://www.info.gov.hk/gia/general/202607/30/P2026073000180.htm', fact:'Government-stated targets: approximately 30 to 5 minutes clearance; 200,000 trips/day design capacity. These are not observed outcomes.'},
  {id:'passenger-data', title:'Immigration Department · daily passenger data', url:'https://data.gov.hk/en-data/dataset/hk-immd-set5-statistics-daily-passenger-traffic', fact:'Next validation source. Lok Ma Chau road crossing must be distinguished from Lok Ma Chau Spur Line. No daily observations are loaded in this demo.'}
];
export const DEFAULTS = Object.freeze({year:2026, timing:'hypothetical', baseline:20000, reach:70, clearance:5, capacity:30000, openingMonth:0});
export const GROUPS = Object.freeze([
  {id:'commuters',name:'Commuter agent',share:.5,sensitivity:.28,awareness:.95,inbound:.45,keep:['Clearance time','Operating hours','Feeder access'],drop:['Housing construction','Park provision'],reason:'Repeated trips respond to time savings; feeder access constrains uptake.'},
  {id:'visitors',name:'Family & visitor agent',share:.3,sensitivity:.45,awareness:.7,inbound:.6,keep:['Clearance time','Information reach','Operating hours'],drop:['Industrial capacity','Long-term housing supply'],reason:'Discretionary visits respond to information and lower crossing friction.'},
  {id:'business',name:'Business traveller agent',share:.2,sensitivity:.35,awareness:.85,inbound:.5,keep:['Clearance time','Operating hours','Feeder access'],drop:['Cargo handling','School places'],reason:'Passenger business trips use the time saving; cargo is outside this study.'}
]);
export const ROUTES = Object.freeze([
  {id:'hung-shui-kiu',name:'Hung Shui Kiu',share:.2,x:-113,z:18},
  {id:'san-tin',name:'San Tin',share:.4,x:-28,z:-1},
  {id:'kwu-tung',name:'Kwu Tung',share:.25,x:57,z:20},
  {id:'ta-kwu-ling',name:'Ta Kwu Ling',share:.15,x:126,z:10}
]);
export function validateInputs(values) {
  const p={...DEFAULTS,...values};
  for (const [key,min,max] of [['year',2020,2040],['baseline',1,200000],['reach',0,100],['clearance',0,30],['capacity',1,200000],['openingMonth',0,2]]) {
    if (typeof p[key]!=='number' || !Number.isFinite(p[key]) || p[key]<min || p[key]>max) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(p.openingMonth)) throw new Error('Opening month must be a whole index.');
  if (!Number.isInteger(p.year)) throw new Error('Use a whole calendar year.');
  if (!['hypothetical','announced'].includes(p.timing)) throw new Error('Choose a valid opening scenario.');
  if (p.timing==='announced' && p.year!==2026) throw new Error('The official-date scenario applies to 2026.');
  if (p.capacity<p.baseline) throw new Error('Effective capacity must be at least the baseline trips/day.');
  return p;
}
export function runStudy(values={}) {
  const p=validateInputs(values);
  // Constant no-opening baseline isolates this assumed event. No seasonality or port diversion is estimated.
  const months=['August','September','October'].map((name,index)=>{
    const days=new Date(Date.UTC(p.year,index+8,0)).getUTCDate();
    const fraction=p.timing==='hypothetical'?(index>=p.openingMonth?1:0):index===2?(20-6.5/24)/31:0;
    const phase=p.timing==='hypothetical'?Math.max(0,index-p.openingMonth):0;
    const adoption=[.4,.7,1][phase];
    const groups=GROUPS.map(g=>{
      const informed=p.reach/100*g.awareness;
      const baseline=p.baseline*g.share;
      const uplift=g.sensitivity*((30-p.clearance)/30)*informed*adoption*fraction;
      return {...g,keep:[...g.keep],drop:[...g.drop],baseline,informed,adoption,exposure:fraction,uplift,requestedExtra:baseline*uplift};
    });
    const requestedExtra=groups.reduce((s,g)=>s+g.requestedExtra,0);
    const extra=Math.min(requestedExtra,Math.max(0,p.capacity-p.baseline));
    const scale=requestedExtra?extra/requestedExtra:1;
    for (const g of groups) {g.extra=g.requestedExtra*scale;g.policy=g.baseline+g.extra;}
    const inboundBaseline=groups.reduce((s,g)=>s+g.baseline*g.inbound,0);
    const inboundExtra=groups.reduce((s,g)=>s+g.extra*g.inbound,0);
    const routes=ROUTES.map(r=>({...r,baseline:p.baseline*r.share,extra:extra*r.share,policy:(p.baseline+extra)*r.share,
      inboundBaseline:inboundBaseline*r.share,inboundExtra:inboundExtra*r.share,
      outboundBaseline:(p.baseline-inboundBaseline)*r.share,outboundExtra:(extra-inboundExtra)*r.share}));
    return {index,name,year:p.year,days,openingFraction:fraction,adoption,baseline:p.baseline,extra,policy:p.baseline+extra,
      requestedExtra,unserved:requestedExtra-extra,capacityUse:(p.baseline+extra)/p.capacity,
      weightedClearance:30*(1-fraction)+p.clearance*fraction,monthlyExtra:extra*days,groups,routes,
      trace:[
        {stage:'01 · Event & evidence',detail:p.timing==='hypothetical'?`Assume opening on 1 ${['August','September','October'][p.openingMonth]} ${p.year}. This is a counterfactual, not the official date.`:'Use the announced 12 October 2026, 06:30 opening; August and September receive no opening effect.',sources:['opening-notice','design-targets']},
        {stage:'02 · Relevance filter',detail:'Keep passenger clearance, hours, access and information. Exclude cargo, housing and school effects for this three-month travel study.',sources:['design-targets']},
        {stage:'03 · Group decisions',detail:'Three rule-based agent stand-ins calculate added trip demand. Sensitivities, shares and awareness are explicit research assumptions; no LLM call is made.',sources:[]},
        {stage:'04 · Capacity settlement',detail:`Proportionally cap extra demand at effective feeder capacity. ${Math.round(requestedExtra-extra).toLocaleString('en')} requested extra trips/day are unserved.`,sources:[]},
        {stage:'05 · Flow snapshot',detail:'Allocate trips by assumed district and direction shares. Curves are schematic desire lines, not road routes or measured OD data.',sources:[]}
      ]};
  });
  return {schemaVersion:1,model:'huanggang-rule-study-v1',generatedBy:'deterministic rule-based agent stand-ins',inputs:p,
    unit:'passenger trips/day; both directions combined',sources:SOURCES.map(s=>({...s})),months,
    assumptions:{districtShares:'fixed illustrative allocation',groups:'mutually exclusive trip-purpose categories, not resident counts',directionShares:'illustrative group-specific split',baseline:'user-supplied constant; no observed data loaded',comparison:'no-opening counterfactual with otherwise identical assumptions',calibration:'none',seasonality:'not modeled',otherPorts:'diversion not modeled'},
    totalAdditionalTrips:months.reduce((s,m)=>s+m.monthlyExtra,0)};
}
