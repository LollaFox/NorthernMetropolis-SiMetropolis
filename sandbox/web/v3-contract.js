// Frontend normalization proposal, not an endpoint specification supplied by the team.
export const SCHEMA = 'nm-v3-draft-1';
export const STEPS = {month: 1, quarter: 3, year: 12};
export const GRID = 1000;
const fail = message => { throw new Error(message); };
function identifier(value,name) {if(typeof value!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail(`${name}: use 1–100 letters, digits, underscores or hyphens.`);return value;}
export function text(value, name, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name}: expected non-empty text (max ${max}).`);
  return value;
}
export function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${name}: expected integer ${min}–${max}.`);
  return value;
}
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) fail('Use a valid ISO date.');
  return value;
}
export function hkToday(now = new Date()) { return new Date(+now + 8*3600000).toISOString().slice(0,10); }
export function validateSetup(input, today = hkToday()) {
  const b = input.bounds;
  if (!b || !['west','south','east','north'].every(k => Number.isFinite(b[k]))) fail('Enter all four geographic bounds.');
  if (b.west < 113.7 || b.east > 114.7 || b.south < 22.1 || b.north > 22.9 || b.west >= b.east || b.south >= b.north) fail('Select a non-empty rectangle within the Hong Kong–Shenzhen study extent.');
  date(input.start); date(input.end);
  if (input.start >= today) fail('The simulation start must be before today (Hong Kong time).');
  if (input.end < input.start) fail('The end date must not precede the start date.');
  if (!Object.hasOwn(STEPS, input.step)) fail('Step must be month, quarter or year.');
  if (schedule(input).length > 240) fail('This preview supports at most 240 snapshots per run.');
  return {...input, bounds: {...b}, crs: 'EPSG:4326', vertices: [[b.west,b.north],[b.east,b.north],[b.east,b.south],[b.west,b.south]]};
}
export function schedule({start, end, step}) {
  date(start); date(end);
  if (!Object.hasOwn(STEPS, step)) fail('Invalid time step.');
  const origin = new Date(start), result = [];
  for (let n=0;n<=240;n++) {
    const d = new Date(Date.UTC(origin.getUTCFullYear(),origin.getUTCMonth()+n*STEPS[step],1));
    const last = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    d.setUTCDate(Math.min(origin.getUTCDate(), last));
    const day=d.toISOString().slice(0,10); if(day>end) break; result.push(day);
  }
  return result;
}
export async function validatePDF(file) {
  if (!file || !/\.pdf$/i.test(file.name) || !file.size || file.size > 20*1024*1024) fail('Choose a PDF up to 20 MB (preview upload limit).');
  const signature = new TextDecoder().decode(await file.slice(0,5).arrayBuffer());
  if(signature !== '%PDF-') fail('The selected file does not have a PDF signature.');
  return file;
}
export function safeURL(value) {
  try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function reviewResponse(data) {
  identifier(data.initializationId,'initializationId'); identifier(data.reviewVersion,'reviewVersion');
  if (!Array.isArray(data.items) || data.items.length > 200) fail('Review items must be an array (max 200).');
  const ids=new Set();
  for (const item of data.items) {
    identifier(item.id,'item id'); if(ids.has(item.id)) fail('Duplicate review item.'); ids.add(item.id);
    text(item.field,'field',200); text(item.description,'description');
    if (!['sourced','assumption','unresolved'].includes(item.kind)) fail('Unknown review item kind.');
    if (item.kind !== 'unresolved') text(item.value,'review value');
    if (item.kind === 'sourced' && (!Array.isArray(item.sources) || !item.sources.length)) fail('Sourced information requires valid source links.');
    if (item.sources !== undefined && (!Array.isArray(item.sources) || item.sources.length>50 || item.sources.some(s => !safeURL(s.url) || !s.title))) fail('Review source links must use HTTP(S).');
  }
  return data;
}
export function runResponse(data, setup) {
  identifier(data.simulationId,'simulationId');
  if(!Array.isArray(data.snapshots) || !data.snapshots.length || data.snapshots.length>240) fail('Missing or oversized snapshot list.');
  const allowed = new Set(schedule(setup)), seen = new Set(); let previous='';
  for(const frame of data.snapshots) {
    identifier(frame.id,'snapshot id'); date(frame.date);
    if(seen.has(frame.id) || frame.date<=previous || !allowed.has(frame.date)) fail('Snapshot IDs/dates must be unique, ordered and on the requested schedule.');
    seen.add(frame.id); previous=frame.date;
  }
  return data;
}
function vector(value, size, name, grid = true) {
  if(!Array.isArray(value) || value.length!==size) fail(`${name}: wrong coordinate dimension.`);
  value.forEach((n,i)=>integer(n,grid&&i<2?0:-32768,grid&&i<2?999:32767,name)); return value;
}
function arrayLayer(layer, type, length, name, allowed) {
  if(!layer || layer.dtype!==type || !(Array.isArray(layer.values) || ArrayBuffer.isView(layer.values)) || layer.values.length!==length) fail(`${name}: expected ${type} with ${length} elements.`);
  const values=layer.values;
  for(let i=0;i<values.length;i++) {
    const v=values[i];
    if(!Number.isFinite(v) || (type==='float32' ? Math.abs(v)>3.4028234663852886e38 : !Number.isInteger(v)||v < -32768||v >32767) || (allowed && !allowed.has(v))) fail(`${name}: invalid value at ${i}.`);
  }
  return type==='float32' ? new Float32Array(values) : new Int16Array(values);
}
export function snapshotResponse(data, expectedDate) {
  if(data.schema !== SCHEMA || date(data.date)!==expectedDate) fail('Snapshot schema/date mismatch.');
  const g=data.grid;
  if(!g || g.width!==GRID || g.height!==GRID || g.origin!=='north-west' || g.order!=='row-major' || g.heightUnit!=='m' || !Number.isFinite(g.cellSizeM) || g.cellSizeM<=0) fail('Grid requires 1000×1000, north-west origin, row-major, metre heights and explicit cellSizeM. Do not infer the conflicting /100 scale.');
  if(g.crs!=='EPSG:4326' || !Array.isArray(g.originLonLat) || g.originLonLat.length!==2 || !g.originLonLat.every(Number.isFinite) || Math.abs(g.originLonLat[0])>180 || Math.abs(g.originLonLat[1])>90) fail('Grid requires a geographic origin and CRS.');
  const height=arrayLayer(data.height,'float32',GRID*GRID,'Height');
  const landType=arrayLayer(data.landType,'int16',GRID*GRID,'Land type',new Set([-1,0,1,2,3,4,5]));
  const raw=arrayLayer(data.pollution,'int16',4*5000,'Pollution'); const pollution=[];
  for(let i=0;i<5000;i++) {
    const p=[raw[i],raw[5000+i],raw[10000+i],raw[15000+i]];
    if(p.every(v=>v===-1)) continue;
    integer(p[0],0,999,'Pollution x'); integer(p[1],0,999,'Pollution y'); integer(p[2],0,32767,'Pollution radius'); integer(p[3],0,1,'Pollution type'); pollution.push(p);
  }
  for(const key of ['roads','mtr','zones','powerLines']) if(!Array.isArray(data[key]) || data[key].length>10000) fail(`${key}: missing or oversized array.`);
  let pointCount=0;
  for(const [key,dimensions] of [['roads',3],['mtr',2]]) for(const line of data[key]) {
    if(!Array.isArray(line.points) || line.points.length<2 || line.points.length>10000) fail('Invalid transport line.');
    line.points.forEach(p=>vector(p,dimensions,key));
    pointCount+=line.points.length;
    if(!Array.isArray(line.congestion) || line.congestion.length!==line.points.length-1) fail('Each transport segment requires one congestion value.');
    line.congestion.forEach(v=>{if(v!==null) integer(v,-32768,32767,'Congestion');});
  }
  for(const z of data.zones) {
    text(z.name,'Zone name',200); text(z.type,'Zone type',100); integer(z.population,0,2147483647,'Population');
    if(z.satisfaction!==null) integer(z.satisfaction,-32768,32767,'Satisfaction');
    if(!Array.isArray(z.boundary) || z.boundary.length<4 || z.boundary.length>10000) fail('A zone needs a closed polygon.');
    z.boundary.forEach(p=>vector(p,2,'Zone boundary'));
    pointCount+=z.boundary.length;
    if(z.boundary[0].some((n,i)=>n!==z.boundary.at(-1)[i])) fail('Zone boundary must be closed.');
    if(!Array.isArray(z.jobs) || z.jobs.length>1000) fail('Jobs must be an array.');
    z.jobs.forEach(j=>{text(j.type,'Job type',100); integer(j.count,0,2147483647,'Job count');});
  }
  for(const line of data.powerLines) {if(!Array.isArray(line)||line.length<2||line.length>10000) fail('Invalid power line.'); line.forEach(p=>vector(p,2,'Power line'));pointCount+=line.length;}
  if(pointCount>200000) fail('Snapshot exceeds the 200,000 vector-point preview limit.');
  return {...data, height, landType, pollution};
}
