// The pinned regional check also exercises the renderer's spatial regressions.
import './test_renderer.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DISTRICTS, REGION_BOUNDS, PARCEL_FOOTPRINT, DISTRICT_LAND, DEVELOPMENT_SITES,
  DISTRICT_LAYOUTS, RIVER, DEEP_BAY, WETLANDS, HILLS, RAIL_CORRIDORS,
  locateBuilding, districtForBuilding, summarizeDistrict, describeChange } from '../web/geography.js';

const copy = value => JSON.parse(JSON.stringify(value));
const building = (id, x = -44, z = -44, extra = {}) => ({ id, kind: 'housing', x, z, height: 18,
  progress: 1, capacity: 480, owner: 'government', createdMonth: 0, startedMonth: 0, upgrades: 0, ...extra });
const world = (month, buildings, events = [], extra = {}) => ({ version: '2.0.0', seed: 42, month,
  buildings, events, metrics: { population: 12345 }, ...extra });
const inside = (point, polygon) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > point.z) !== (b.z > point.z)
      && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
};
const rectangle = site => {
  const half = PARCEL_FOOTPRINT / 2;
  return [{ x: site.x - half, z: site.z - half }, { x: site.x + half, z: site.z - half },
    { x: site.x + half, z: site.z + half }, { x: site.x - half, z: site.z + half }];
};
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const intersects = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
const polygonsOverlap = (a, b) => a.some(point => inside(point, b)) || b.some(point => inside(point, a))
  || a.some((point, i) => b.some((other, j) => intersects(point, a[(i + 1) % a.length], other, b[(j + 1) % b.length])));
const distanceToSegment = (point, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
};

test('all 132 engine sites map once into four district lenses with stable dry addresses', () => {
  const xs = [-44, -36, -28, -20, -12, -4, 4, 12, 28, 36, 44];
  const zs = Array.from({ length: 12 }, (_, i) => -44 + i * 8);
  const mapped = xs.flatMap(x => zs.map(z => locateBuilding({ x, z })));
  assert.equal(mapped.length, 132);
  assert.equal(DEVELOPMENT_SITES.length, 132);
  assert.equal(new Set(mapped.map(site => `${site.x}:${site.z}`)).size, 132);
  assert.deepEqual(DISTRICTS.map(district => district.id), ['hung-shui-kiu', 'san-tin', 'kwu-tung', 'ta-kwu-ling']);
  assert.deepEqual(DISTRICTS.map(district => mapped.filter(site => site.districtId === district.id).length), [36, 36, 36, 24]);
  for (const site of mapped) {
    assert.ok(site.x >= -150 && site.x <= 150);
    assert.ok(site.z >= -60 && site.z <= 80);
    assert.ok(site.x >= REGION_BOUNDS.minX && site.x <= REGION_BOUNDS.maxX);
    assert.ok(site.z >= REGION_BOUNDS.minZ && site.z <= REGION_BOUNDS.maxZ);
  }
});

test('13-unit parcel footprints do not overlap and stay within their dry landscape pads', () => {
  for (let i = 0; i < DEVELOPMENT_SITES.length; i++) {
    const site = DEVELOPMENT_SITES[i];
    const land = DISTRICT_LAND.find(area => area.id === site.districtId).polygon;
    const corners = rectangle(site);
    assert.ok(corners.every(corner => inside(corner, land)), `${site.logicalX},${site.logicalZ} outside dry pad`);
    for (const other of DEVELOPMENT_SITES.slice(i + 1)) {
      assert.ok(Math.abs(site.x - other.x) >= PARCEL_FOOTPRINT - 1e-6
        || Math.abs(site.z - other.z) >= PARCEL_FOOTPRINT - 1e-6, `overlapping ${site.logicalX},${site.logicalZ}`);
    }
  }
});

test('development footprints stay clear of bay, wetlands, river and hill envelopes', () => {
  for (const site of DEVELOPMENT_SITES) {
    const corners = rectangle(site);
    for (const water of [DEEP_BAY, ...WETLANDS]) assert.equal(polygonsOverlap(corners, water.polygon), false,
      `water overlap at ${site.logicalX},${site.logicalZ}: ${water.id}`);
    for (let i = 1; i < RIVER.points.length; i++) {
      for (const corner of corners) assert.ok(distanceToSegment(corner, RIVER.points[i - 1], RIVER.points[i]) > RIVER.width / 2);
    }
    for (const hill of HILLS) {
      assert.ok(corners.every(corner => ((corner.x - hill.x) / hill.radiusX) ** 2
        + ((corner.z - hill.z) / hill.radiusZ) ** 2 > 1), `hill overlap ${hill.id}`);
    }
  }
});

test('mapping ignores date, kind, ID, order, seed, capacity and progress and never mutates inputs', () => {
  for (const site of DEVELOPMENT_SITES) {
    const before = building('before', site.logicalX, site.logicalZ);
    const saved = copy(before);
    const address = locateBuilding(before);
    for (const kind of ['housing', 'office', 'industry', 'park', 'solar', 'transit', 'civic']) {
      const after = { ...before, id: 'different-branch-id', kind, progress: .23, capacity: 999, height: 78, createdMonth: 50, seed: 900 };
      assert.deepEqual(locateBuilding(after), address);
      assert.equal(districtForBuilding(after).id, address.districtId);
    }
    assert.deepEqual(before, saved);
    address.x = 999;
    assert.notEqual(locateBuilding(before).x, 999);
  }
});

test('district layouts have gentle curved street blocks and a different eastern settlement pattern', () => {
  assert.deepEqual(DISTRICT_LAYOUTS.map(layout => [layout.columns, layout.rows]), [[6, 6], [6, 6], [6, 6], [3, 8]]);
  for (const district of DISTRICTS) {
    const sites = DEVELOPMENT_SITES.filter(site => site.districtId === district.id);
    const row = sites.filter(site => site.row === 2);
    assert.ok(new Set(row.map(site => site.z)).size > 1, 'rows are not a rigid repeated rectangular lattice');
    assert.equal(new Set(sites.map(site => `${site.row}:${site.column}`)).size, sites.length);
  }
});

test('context has distinct existing and planned transport; all published data is immutable', () => {
  assert.ok(RAIL_CORRIDORS.some(route => route.status === 'existing'));
  assert.ok(RAIL_CORRIDORS.some(route => route.status === 'planned' && route.name.includes('planned')));
  assert.ok(RAIL_CORRIDORS.every(route => route.points.length >= 2));
  assert.equal(RIVER.width, 7);
  assert.throws(() => { DISTRICTS[0].x = 0; }, TypeError);
  assert.throws(() => { WETLANDS[0].polygon[0].x = 0; }, TypeError);
  assert.throws(() => { DEVELOPMENT_SITES[0].x = 0; }, TypeError);
});

test('unknown logical sites and district IDs fail explicitly instead of colliding through rounding', () => {
  for (const invalid of [{ x: 20, z: -44 }, { x: 0, z: 0 }, { x: -43.9, z: -44 }, { x: NaN, z: -44 }, { x: '-44', z: -44 }])
    assert.throws(() => locateBuilding(invalid), RangeError);
  assert.throws(() => locateBuilding(null), TypeError);
  assert.throws(() => summarizeDistrict(world(0, []), 'unknown'), RangeError);
});

test('district summaries count only current physical assets and completed capacity', () => {
  const assets = [building('h1'), building('h2', -36, -44, { progress: .5, capacity: 960 }),
    building('o1', -28, -44, { kind: 'office', capacity: 650 }),
    building('s1', -20, -44, { kind: 'solar', capacity: 320 }),
    building('p1', -12, -44, { kind: 'park', capacity: 2600 })];
  const state = world(5, assets, [{ id: 'future', month: 10, type: 'completion', x: -36, z: -44 }],
    { future: { population: 999999999 } });
  const saved = copy(state);
  const west = summarizeDistrict(state, 'hung-shui-kiu');
  assert.equal(west.total, 3);
  assert.equal(west.completed, 2);
  assert.equal(west.underConstruction, 1);
  assert.equal(west.homes, 480);
  assert.equal(west.jobCapacity, 650);
  assert.deepEqual(west.counts, { housing: 2, office: 1, industry: 0, park: 0, solar: 0, transit: 0, civic: 0 });
  assert.deepEqual(west.constructionIds, ['h2']);
  const central = summarizeDistrict(state, 'san-tin');
  assert.equal(central.powerCapacity, 320);
  assert.equal(central.greenSpace, 2600);
  assert.equal('population' in west, false);
  assert.equal(JSON.stringify(west).includes('999999999'), false);
  assert.deepEqual(summarizeDistrict({ ...state, buildings: [...state.buildings].reverse() }, 'hung-shui-kiu'), west);
  west.counts.housing = 123;
  assert.equal(summarizeDistrict(state, 'hung-shui-kiu').counts.housing, 2);
  assert.deepEqual(state, saved);
});

test('summaries at an earlier snapshot cannot inherit later completed capacity', () => {
  const project = building('h1', -44, -44, { progress: .8, capacity: 480 });
  const before = world(5, [project]);
  const after = world(6, [{ ...project, progress: 1 }]);
  assert.equal(summarizeDistrict(before, 'hung-shui-kiu').homes, 0);
  assert.equal(summarizeDistrict(after, 'hung-shui-kiu').homes, 480);
  assert.equal(summarizeDistrict(before, 'hung-shui-kiu').homes, 0);
});

test('change cues use actual new construction and matching current attributed engine events', () => {
  const before = world(3, [building('h1')]);
  const added = building('s2', -20, -44, { kind: 'solar', capacity: 320, progress: 0, createdMonth: 3, startedMonth: 3 });
  const event = { id: 'e2', month: 3, type: 'construction', title: 'New solar commissioned', detail: '12M committed; physical construction begins.', x: -20, z: -44 };
  const after = world(3, [...before.buildings, added], [event]);
  assert.deepEqual(describeChange(after, before), { title: event.title, detail: event.detail, buildingId: 's2', districtId: 'san-tin' });
  assert.equal(describeChange(after, copy(after)), null);
});

test('completion and redevelopment cues reflect actual progress changes, not claims in events', () => {
  const project = building('h1', -44, -44, { progress: .83 });
  const before = world(5, [project]);
  const after = world(6, [{ ...project, progress: 1 }]);
  const completed = describeChange(after, before);
  assert.equal(completed.buildingId, 'h1');
  assert.match(completed.title, /complete/);
  assert.match(completed.detail, /480 homes/);
  const reopened = world(6, [{ ...after.buildings[0], progress: 0, capacity: 960, upgrades: 1, startedMonth: 6 }]);
  assert.match(describeChange(reopened, after).title, /works/);
  const falseClaim = world(6, [...after.buildings], [{ id: 'claim', month: 6, type: 'completion', title: 'Impossible new capacity', x: -44, z: -44 }]);
  assert.equal(describeChange(falseClaim, after), null);
});

test('old and future event text cannot override an actual adjacent current change', () => {
  const before = world(4, [building('h1')]);
  const added = building('o2', -28, -36, { kind: 'office', capacity: 650, progress: .125, createdMonth: 4, startedMonth: 4 });
  const after = world(5, [...before.buildings, added], [
    { id: 'old', month: 0, type: 'construction', title: 'OLD_EVENT_SENTINEL', x: -28, z: -36 },
    { id: 'future', month: 7, type: 'construction', title: 'FUTURE_EVENT_SENTINEL', x: -28, z: -36 },
  ]);
  const cue = describeChange(after, before);
  assert.equal(cue.buildingId, 'o2');
  assert.equal(JSON.stringify(cue).includes('SENTINEL'), false);
  assert.match(cue.detail, /13%/);
});

test('skipped live polls retain real cues; rewind, explicit seek, reset and incompatible branches suppress them', () => {
  const before = world(5, [building('h1')]);
  const added = building('h2', -36, -44, { progress: 0, createdMonth: 5, startedMonth: 5 });
  const after = world(6, [...before.buildings, added]);
  assert.equal(describeChange(before, after), null);
  assert.equal(describeChange({ ...after, month: 8 }, before).buildingId, 'h2');
  const completedBetweenPolls = world(9, [...before.buildings, { ...added, progress: 1 }],
    [{ id: 'e9', month: 9, type: 'completion', title: 'Housing now operational', detail: '480 homes complete.', x: -36, z: -44 }]);
  assert.equal(describeChange(completedBetweenPolls, before).title, 'Housing now operational');
  assert.equal(describeChange({ ...after, seed: 43 }, before), null);
  assert.equal(describeChange({ ...after, version: '3.0.0' }, before), null);
  assert.equal(describeChange(world(6, [added]), before), null);
  assert.equal(describeChange(world(6, [{ ...before.buildings[0], kind: 'office' }, added]), before), null);
  assert.equal(describeChange(world(6, [{ ...before.buildings[0], x: -36 }, added]), before), null);
  assert.equal(describeChange(world(6, [{ ...before.buildings[0], capacity: 200 }, added]), before), null);
  assert.equal(describeChange(world(6, [{ ...before.buildings[0], progress: .5 }, added]), before), null);
  assert.equal(describeChange(after, null), null); // Caller clears previous world on explicit seek or branch-ID change.
});

test('change cues are deterministic, bounded and leave both input snapshots untouched', () => {
  const before = world(1, [building('h1')]);
  const added = building('s2', -20, -44, { kind: 'solar', progress: 0, capacity: 320, createdMonth: 1 });
  const after = world(1, [...before.buildings, added], [{ id: 'e2', month: 1, type: 'construction',
    title: 'x'.repeat(400), detail: 'y'.repeat(1200), x: -20, z: -44 }]);
  const savedBefore = copy(before), savedAfter = copy(after);
  const cue = describeChange(after, before);
  assert.equal(cue.title.length, 100);
  assert.equal(cue.detail.length, 220);
  assert.deepEqual(describeChange(after, before), cue);
  assert.deepEqual(after, savedAfter);
  assert.deepEqual(before, savedBefore);
});
