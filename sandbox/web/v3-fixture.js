// Synthetic contract fixture. Does not parse PDFs, call an LLM or predict policy outcomes.
import {SCHEMA,schedule} from './v3-contract.js';
export function fixtureSnapshot(date, index=0, bounds={west:114,south:22.45,east:114.15,north:22.6}) {
  const height=new Float32Array(1e6), type=new Int16Array(1e6), pollution=new Int16Array(20000).fill(-1);
  for(let y=0;y<1000;y++) for(let x=0;x<1000;x++) {
    const p=y*1000+x; const h=60+90*Math.sin(x/180)*Math.cos(y/210);
    height[p]=Math.max(0,h);type[p]=x<100||y>950?-1:x<260?0:y<220?3:y>740?1:x>650?2:5;
  }
  for(const [i,p] of [[0,[400,600,60,0]],[1,[720,320,80,1]]]) p.forEach((v,r)=>pollution[r*5000+i]=v);
  const cellSizeM=Math.max((bounds.east-bounds.west)*111320*Math.cos(bounds.north*Math.PI/180),(bounds.north-bounds.south)*111320)/1000;
  return {schema:SCHEMA,date,provenance:'synthetic-contract-fixture',grid:{width:1000,height:1000,origin:'north-west',order:'row-major',crs:'EPSG:4326',originLonLat:[bounds.west,bounds.north],heightUnit:'m',cellSizeM},height:{dtype:'float32',values:height},landType:{dtype:'int16',values:type},pollution:{dtype:'int16',values:pollution},
    roads:[{points:[[280,700,0],[450,500,12],[650,420,0],[850,200,-8]],congestion:[20+index*4,50,70]}],
    mtr:[{points:[[300,800],[460,520],[650,300],[800,180]],congestion:[30,45+index*3,55]}],
    zones:[{name:'Fixture residential zone',type:'residential',boundary:[[320,350],[600,350],[600,660],[320,660],[320,350]],population:12000+index*120,jobs:[{type:'Services',count:1800+index*20}],satisfaction:65+index},{name:'Fixture employment zone',type:'commercial',boundary:[[650,440],[860,440],[860,650],[650,650],[650,440]],population:1500,jobs:[{type:'Technology',count:3200}],satisfaction:null}],
    powerLines:[[[300,600],[580,720],[780,640]]],scales:{congestion:'Fixture index 0–100; not agreed with backend',satisfaction:'Fixture index 0–100; not an observed survey'}};
}
export class FixtureTransport {
  async request(path,body,signal) {
    if(signal?.aborted) throw new Error('Cancelled.');
    if(path==='/initializations') {
      this.setup=JSON.parse(body.get('metadata'));
      return {initializationId:'fixture-init',reviewVersion:'fixture-review-1',items:[{id:'capacity',field:'Service capacity',kind:'assumption',description:'Demonstrates a necessary detail missing from a plan. This fixture has not read your PDF.',value:'Synthetic test value only. No related information was searched; assumption used.'}]};
    }
    if(path.endsWith('/confirm')) return {confirmed:true,reviewVersion:'fixture-review-1'};
    if(path==='/simulations') {this.dates=schedule(this.setup);return {simulationId:'fixture-run',snapshots:this.dates.map((date,i)=>({id:`s${i}`,date}))};}
    const match=path.match(/\/snapshots\/s(\d+)$/);if(match&&this.dates[+match[1]]) return fixtureSnapshot(this.dates[+match[1]],+match[1],this.setup.bounds);
    throw new Error('Unknown fixture operation.');
  }
}
