/** Original, compressed Northern Metropolis schematic. No cadastral geometry.
 *
 * Logical coordinates remain in the saved world. This pure facade never writes
 * into it, adds capacity, advances time, or uses a clock/random/network source.
 */

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const DISTRICTS = freeze([
  { id: 'hung-shui-kiu', name: 'Hung Shui Kiu / Ha Tsuen', shortName: 'Hung Shui Kiu',
    subtitle: 'Logistics · mixed-use town', x: -113, z: 18, color: '#c4a982',
    description: 'A western district lens: logistics yards, working streets and mixed podium estates beside the Deep Bay landscape.' },
  { id: 'san-tin', name: 'San Tin / The Loop', shortName: 'San Tin',
    subtitle: 'Innovation · wetland edge', x: -28, z: -1, color: '#83b3b0',
    description: 'An innovation district lens: low and mid-rise campuses, courtyards and a northern wetland buffer, with Shenzhen across the boundary.' },
  { id: 'kwu-tung', name: 'Kwu Tung / Fanling', shortName: 'Kwu Tung',
    subtitle: 'Rail · urban neighborhoods', x: 57, z: 20, color: '#a8b98a',
    description: 'An urban district lens: rail-oriented neighborhoods, communal podiums and established town life at the transition toward greener land.' },
  { id: 'ta-kwu-ling', name: 'Ta Kwu Ling', shortName: 'Ta Kwu Ling',
    subtitle: 'New town · green eastern transition', x: 126, z: 10, color: '#91ad83',
    description: 'An eastern district lens: a narrower settlement pattern, community spaces, village-scale context and hills beyond the developed parcels.' },
]);

export const REGION_BOUNDS = freeze({ minX: -174, maxX: 178, minZ: -112, maxZ: 112, north: 'negative-z' });
export const PARCEL_FOOTPRINT = 13;

// Dry landscape pads are envelopes, not official district/zone boundaries.
export const DISTRICT_LAND = freeze([
  { id: 'hung-shui-kiu', polygon: [{ x: -156, z: -40 }, { x: -69, z: -40 }, { x: -69, z: 78 }, { x: -156, z: 78 }] },
  { id: 'san-tin', polygon: [{ x: -71, z: -60 }, { x: 15, z: -60 }, { x: 15, z: 58 }, { x: -71, z: 58 }] },
  { id: 'kwu-tung', polygon: [{ x: 14, z: -39 }, { x: 100, z: -39 }, { x: 100, z: 80 }, { x: 14, z: 80 }] },
  { id: 'ta-kwu-ling', polygon: [{ x: 104, z: -61 }, { x: 148, z: -61 }, { x: 148, z: 81 }, { x: 104, z: 81 }] },
]);

export const RIVER = freeze({ id: 'boundary-river', name: 'Northern boundary river (schematic)', width: 7,
  points: [{ x: -174, z: -77 }, { x: -115, z: -73 }, { x: -66, z: -80 },
    { x: -20, z: -77 }, { x: 34, z: -84 }, { x: 90, z: -76 }, { x: 174, z: -80 }] });

export const DEEP_BAY = freeze({ id: 'deep-bay', name: 'Deep Bay landscape',
  polygon: [{ x: -174, z: -112 }, { x: -92, z: -112 }, { x: -100, z: -85 },
    { x: -129, z: -58 }, { x: -165, z: -44 }, { x: -174, z: -46 }] });

export const WETLANDS = freeze([
  { id: 'western-wetlands', name: 'Deep Bay / Mai Po wetland context',
    polygon: [{ x: -166, z: -86 }, { x: -103, z: -91 }, { x: -85, z: -74 },
      { x: -105, z: -48 }, { x: -143, z: -43 }, { x: -163, z: -57 }] },
  { id: 'san-tin-buffer', name: 'San Tin wetland buffer (schematic)',
    polygon: [{ x: -84, z: -94 }, { x: 16, z: -94 }, { x: 16, z: -63 },
      { x: -63, z: -61 }, { x: -84, z: -72 }] },
]);

export const HILLS = freeze([
  { id: 'western-ridge', x: -142, z: 112, radiusX: 43, radiusZ: 24, width: 86, depth: 48, height: 24 },
  { id: 'southern-ridge', x: -25, z: 112, radiusX: 65, radiusZ: 25, width: 130, depth: 50, height: 32 },
  { id: 'eastern-ridge', x: 79, z: 110, radiusX: 53, radiusZ: 23, width: 106, depth: 46, height: 35 },
  { id: 'green-east', x: 178, z: 17, radiusX: 23, radiusZ: 69, width: 46, depth: 138, height: 43 },
]);

// These decorative alignments do not add capacity to the economic model.
export const RAIL_CORRIDORS = freeze([
  { id: 'western-rail', name: 'Tuen Ma Line (schematic context)', status: 'existing', color: '#a57964',
    points: [{ x: -166, z: 43 }, { x: -160, z: 76 }, { x: -114, z: 82 }, { x: -60, z: 85 }] },
  { id: 'eastern-rail', name: 'East Rail Line (schematic context)', status: 'existing', color: '#75a8b2',
    points: [{ x: 102, z: 102 }, { x: 102, z: 32 }, { x: 102, z: -56 }, { x: 112, z: -82 }] },
  { id: 'northern-link', name: 'Northern Link — planned (schematic)', status: 'planned', color: '#9b8eae',
    points: [{ x: -72, z: 79 }, { x: -34, z: 73 }, { x: 22, z: 80 }, { x: 86, z: 83 }, { x: 102, z: 71 }] },
  { id: 'western-green-transit', name: 'Hung Shui Kiu green transit — planned', status: 'planned', color: '#95b89c',
    points: [{ x: -158, z: 70 }, { x: -158, z: 10 }, { x: -157, z: -35 }] },
]);

const LOGICAL_X = [-44, -36, -28, -20, -12, -4, 4, 12, 28, 36, 44];
const LOGICAL_Z = Array.from({ length: 12 }, (_, i) => -44 + i * 8);
const KINDS = ['housing', 'office', 'industry', 'park', 'solar', 'transit', 'civic'];
const LABELS = { housing: 'Housing', office: 'Workplace', industry: 'Industry', park: 'Park',
  solar: 'Solar', transit: 'Transit', civic: 'Civic' };
const UNITS = { housing: 'homes', office: 'job capacity', industry: 'job capacity', park: 'green area units',
  solar: 'power units', transit: 'commuter capacity', civic: 'job capacity' };
const districtMap = new Map(DISTRICTS.map(district => [district.id, district]));
export const DISTRICT_LAYOUTS = freeze(DISTRICTS.map((district, index) => ({ id: district.id,
  columns: index === 3 ? 3 : 6, rows: index === 3 ? 8 : 6, spacingX: 14.4,
  spacingZ: index === 3 ? 17 : 18.8, footprint: PARCEL_FOOTPRINT })));
const round = n => Math.round(n * 1e6) / 1e6;
const stableNoise = (x, z, salt) => {
  let value = 2166136261;
  for (const character of `${x}:${z}:${salt}`) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967295;
};

const sites = [];
for (let column = 0; column < LOGICAL_X.length; column++) {
  const districtIndex = column < 9 ? Math.floor(column / 3) : 3;
  const district = DISTRICTS[districtIndex];
  const firstLogicalColumn = districtIndex * 3;
  const columns = districtIndex === 3 ? 3 : 6;
  const rows = districtIndex === 3 ? 8 : 6;
  const stepZ = districtIndex === 3 ? 17 : 18.8;
  for (let logicalRow = 0; logicalRow < LOGICAL_Z.length; logicalRow++) {
    const logicalX = LOGICAL_X[column], logicalZ = LOGICAL_Z[logicalRow];
    const localIndex = (column - firstLogicalColumn) * 12 + logicalRow;
    const localColumn = localIndex % columns, localRow = Math.floor(localIndex / columns);
    const envelope = Math.sin(Math.PI * localColumn / (columns - 1));
    const bend = Math.sin(localRow * 1.22 + districtIndex * 1.31) * 1.2;
    const x = district.x + (localColumn - (columns - 1) / 2) * 14.4
      + envelope * (bend + (stableNoise(logicalX, logicalZ, 'x') - .5) * .4);
    const z = district.z + (localRow - (rows - 1) / 2) * stepZ
      + Math.sin(localColumn * 1.17 + districtIndex * .7) * 1.1
      + (stableNoise(logicalX, logicalZ, 'z') - .5) * .5;
    sites.push({ logicalX, logicalZ, x: round(x), z: round(z), districtId: district.id, districtName: district.name,
      row: localRow, column: localColumn });
  }
}

export const DEVELOPMENT_SITES = freeze(sites);
const siteMap = new Map(DEVELOPMENT_SITES.map(site => [`${site.logicalX}:${site.logicalZ}`, site]));

export function locateBuilding(building) {
  if (!building || typeof building !== 'object') throw new TypeError('A building with logical x/z is required');
  if (typeof building.x !== 'number' || typeof building.z !== 'number') throw new RangeError('Logical coordinates must be numbers');
  const site = siteMap.get(`${building.x}:${building.z}`);
  if (!site) throw new RangeError('Coordinates are outside the 132 development sites');
  return { x: site.x, z: site.z, districtId: site.districtId, districtName: site.districtName };
}

export function districtForBuilding(building) {
  return districtMap.get(locateBuilding(building).districtId);
}

export function summarizeDistrict(world, id) {
  const district = districtMap.get(id);
  if (!district) throw new RangeError('Unknown district lens');
  if (!world || !Array.isArray(world.buildings)) throw new TypeError('A current world is required');
  const buildings = world.buildings.filter(building => districtForBuilding(building).id === id);
  const counts = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  const completedCapacity = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  const constructionIds = [];
  for (const building of buildings) {
    if (KINDS.includes(building.kind)) {
      counts[building.kind]++;
      if (building.progress === 1) completedCapacity[building.kind] += building.capacity;
    }
    if (building.progress < 1) constructionIds.push(building.id);
  }
  return {
    id, name: district.name, month: world.month, total: buildings.length,
    completed: buildings.length - constructionIds.length, underConstruction: constructionIds.length,
    counts, completedCapacity, buildingIds: buildings.map(building => building.id).sort(), constructionIds: constructionIds.sort(),
    homes: completedCapacity.housing,
    jobCapacity: completedCapacity.office + completedCapacity.industry + completedCapacity.civic,
    powerCapacity: completedCapacity.solar, transitCapacity: completedCapacity.transit, greenSpace: completedCapacity.park,
  };
}

const sameIdentity = (a, b) => ['id', 'kind', 'x', 'z', 'owner', 'createdMonth'].every(key => a[key] === b[key]);
const trim = (text, limit) => typeof text === 'string' ? text.slice(0, limit) : '';

/** A cue from actual changes since the last observed snapshot, including skipped
 * live polls. Pass null after seeking or switching branch. World snapshots alone
 * do not carry branch IDs; the caller owns explicit historical boundaries.
 */
export function describeChange(world, previousWorld) {
  if (!world || !previousWorld || !Array.isArray(world.buildings) || !Array.isArray(previousWorld.buildings)
    || world.seed !== previousWorld.seed || world.version !== previousWorld.version
    || !Number.isInteger(world.month) || !Number.isInteger(previousWorld.month)
    || world.month < previousWorld.month) return null;
  const current = new Map(world.buildings.map(building => [building.id, building]));
  const previous = new Map(previousWorld.buildings.map(building => [building.id, building]));
  if (current.size !== world.buildings.length || previous.size !== previousWorld.buildings.length) return null;
  for (const before of previous.values()) {
    const after = current.get(before.id);
    if (!after || !sameIdentity(before, after) || after.capacity < before.capacity
      || (after.upgrades ?? 0) < (before.upgrades ?? 0)) return null;
    if (after.progress < before.progress && !(after.startedMonth >= previousWorld.month
      && (after.upgrades ?? 0) > (before.upgrades ?? 0))) return null;
  }
  const candidates = [];
  for (const building of current.values()) {
    const before = previous.get(building.id);
    if (!before && building.createdMonth >= previousWorld.month && building.createdMonth <= world.month)
      candidates.push({ building, type: building.progress === 1 ? 'completion' : 'construction' });
    else if (before && before.progress < 1 && building.progress === 1)
      candidates.push({ building, type: 'completion' });
    else if (before && building.progress < before.progress && building.startedMonth >= previousWorld.month)
      candidates.push({ building, type: 'construction' });
  }
  if (!candidates.length) return null;
  const oldEventIds = new Set((previousWorld.events || []).map(event => event.id));
  const events = (world.events || []).filter(event => !oldEventIds.has(event.id)
    && event.month >= previousWorld.month && event.month <= world.month
    && ['construction', 'completion'].includes(event.type));
  // Prefer the newest actual record matching an actual changed parcel.
  let candidate = candidates.sort((a, b) => a.building.id.localeCompare(b.building.id))[0];
  let record = null;
  for (const event of [...events].reverse()) {
    const match = candidates.find(item => item.type === event.type
      && item.building.x === event.x && item.building.z === event.z);
    if (match) { candidate = match; record = event; break; }
  }
  const { building, type } = candidate;
  const district = districtForBuilding(building);
  const label = LABELS[building.kind] || 'Development';
  const detail = type === 'completion'
    ? `${building.capacity} ${UNITS[building.kind] || 'capacity units'} completed in ${district.shortName}.`
    : `${district.shortName}: ${label.toLowerCase()} works at ${Math.round(building.progress * 100)}%. Capacity follows physical completion.`;
  return { title: trim(record?.title, 100) || `${label} ${type === 'completion' ? 'now complete' : 'works commissioned'}`,
    detail: trim(record?.detail, 220) || detail, buildingId: building.id, districtId: district.id };
}
