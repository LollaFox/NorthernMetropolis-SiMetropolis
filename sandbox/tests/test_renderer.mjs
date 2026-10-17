import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as THREE from '../web/vendor/three.module.js';
import { DISTRICTS, DEVELOPMENT_SITES, RAIL_CORRIDORS } from '../web/geography.js';
import { Landscape, terrainHeight, isContextWater } from '../web/landscape.js';

// Optional target supports a recoverable pre-fix checkout for negative controls.
const target = process.env.RENDERER_TEST_WEB_ROOT
  ? pathToFileURL(`${process.env.RENDERER_TEST_WEB_ROOT.replace(/\/$/, '')}/`)
  : new URL('../web/', import.meta.url);
const { CityView } = await import(new URL('city.js', target));
const { Mobility } = await import(new URL('mobility.js', target));
globalThis.document = {
  activeElement: null,
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }) }),
};

// Exercise the real road builder, without a GPU or browser canvas.
const layout = Object.create(Landscape.prototype);
layout.roads = []; layout.material = () => new THREE.MeshBasicMaterial(); layout.static = { add() {} };
layout.makeRoads();
const dense = DEVELOPMENT_SITES.map((site, index) => ({ id: `parcel-${index}`, x: site.logicalX,
  z: site.logicalZ, kind: 'housing', height: 28, capacity: 1000, progress: 1, owner: 'government' }));
const world = buildings => ({ buildings, metrics: { population: 240000 } });
const stubView = () => {
  const view = Object.create(CityView.prototype);
  Object.assign(view, {
    view: 'street', district: 'san-tin', selectedId: null, options: {}, playing: false,
    street: { x: -28, z: 4, yaw: 0, pitch: .05 }, keys: new Set(), buildings: new Map(),
    canvas: { dataset: {} }, renderer: { shadowMap: {} },
    landscape: { roads: layout.roads, update() {}, setDetail() {} },
    batches: { rebuild() {}, updateTransforms() {}, setDetail() {}, pickMeshes: [], meshes: new Map() },
    mobility: { update() {} },
  });
  document.activeElement = view.canvas;
  return view;
};
const clear = (point, buildings = dense) => !isContextWater(point.x, point.z)
  && terrainHeight(point.x, point.z) < 3 && point.x >= -170 && point.x <= 169 && point.z >= -67 && point.z <= 98
  && !buildings.some(building => {
    if (building.kind === 'park' || building.kind === 'solar') return false;
    const site = DEVELOPMENT_SITES.find(site => site.logicalX === building.x && site.logicalZ === building.z);
    return Math.abs(site.x - point.x) < 6.8 && Math.abs(site.z - point.z) < 6.8;
  });
const keys = ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'];

test('every district arrives clear and permits walking with all 132 parcels occupied', () => {
  const view = stubView(); view.update(world(dense), false, true);
  // Start with the reported Ta Kwu Ling trap so the pre-fix control reproduces
  // its eight blocked inputs before the other three district arrivals.
  for (const district of [DISTRICTS[3], ...DISTRICTS.slice(0, 3)]) {
    view.focusDistrict(district.id);
    const arrival = { ...view.street };
    let directionsMoved = 0; const obstructedInputs = [];
    for (const key of keys) {
      view.street = { ...arrival }; view.keys = new Set([key]);
      for (let frame = 0; frame < 60; frame++) view.moveStreet(1 / 60);
      if (Math.hypot(view.street.x - arrival.x, view.street.z - arrival.z) > .5) directionsMoved++;
      if (!clear(view.street)) obstructedInputs.push(key);
    }
    assert.ok(directionsMoved >= 2, `${district.id} has no usable walking direction`);
    assert.ok(clear(arrival), `${district.id} arrival overlaps an occupied parcel or landscape obstacle`);
    assert.deepEqual(obstructedInputs, [], `${district.id} walking entered an occupied parcel`);
  }
});

test('focusing each of the 132 occupied parcels also finds a verified street arrival', () => {
  const view = stubView(); view.update(world(dense), false, true);
  for (const building of dense) {
    view.focus(building.id);
    assert.ok(clear(view.street), `${building.id} focus arrival is obstructed`);
  }
});

test('a new development relocates an obstructed street camera, preserving its look direction', () => {
  const view = stubView(); view.update(world([]), false, true);
  const site = DEVELOPMENT_SITES.find(site => site.districtId === 'ta-kwu-ling' && site.row === 4 && site.column === 1);
  view.street = { x: site.x, z: site.z, yaw: .71, pitch: .19 };
  assert.ok(clear(view.street, []));
  view.update(world(dense), true, false);
  assert.ok(clear(view.street), 'growth left the camera inside a new building');
  assert.equal(view.street.yaw, .71); assert.equal(view.street.pitch, .19);
});

const routes = RAIL_CORRIDORS.map(route => ({ ...route, elevation: 1.3, points: route.points.map(p => [p.x, p.z]) }));
const movingMeshes = mobility => [mobility.body, mobility.windows, mobility.trainBody, mobility.trainGlass, mobility.pedestrians];
const renderInitialBounds = mobility => {
  mobility.animate(0, false);
  for (const mesh of movingMeshes(mobility)) if (!mesh.boundingSphere) mesh.computeBoundingSphere();
};

test('a train ahead of the street camera remains included by the real Three.js frustum after moving', () => {
  const mobility = new Mobility(new THREE.Scene(), layout.roads, routes);
  mobility.update(world(dense)); renderInitialBounds(mobility); mobility.animate(4, true);
  const camera = new THREE.PerspectiveCamera(68, 1512 / 982, .12, 1500);
  camera.position.set(101.78, 2.2, -25.76); camera.lookAt(101.78, 2.2, -26.76); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const matrix = new THREE.Matrix4(); mobility.trainBody.getMatrixAt(4, matrix);
  const train = new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.ok(frustum.containsPoint(train), 'the reproduction train must actually be ahead of the camera');
  assert.ok(frustum.intersectsObject(mobility.trainBody), 'the moved train body was culled by stale bounds');
  assert.ok(frustum.intersectsObject(mobility.trainGlass), 'the moved train windows were culled by stale bounds');
  mobility.dispose();
});

test('all moving instance bodies remain inside their culling bounds across routes, counts and pause', () => {
  const mobility = new Mobility(new THREE.Scene(), layout.roads, routes);
  mobility.update({ metrics: { population: 0 } }); renderInitialBounds(mobility);
  const matrix = new THREE.Matrix4();
  for (let sample = 0; sample < 31; sample++) {
    if (sample === 2) mobility.update(world(dense));
    mobility.animate(4, true);
    for (const mesh of movingMeshes(mobility)) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix);
        const instance = mesh.geometry.boundingSphere.clone().applyMatrix4(matrix);
        assert.ok(mesh.boundingSphere.center.distanceTo(instance.center) + instance.radius <= mesh.boundingSphere.radius + 1e-5,
          `moving batch left its culling bounds at ${mobility.elapsed}s, instance ${index}`);
      }
    }
  }
  const matrices = movingMeshes(mobility).map(mesh => Array.from(mesh.instanceMatrix.array));
  mobility.animate(10, false);
  assert.deepEqual(movingMeshes(mobility).map(mesh => Array.from(mesh.instanceMatrix.array)), matrices, 'paused traffic changed position');
  mobility.dispose();
});

test('existing trains animate even with no local roads; planned rail adds no trains', () => {
  const mobility = new Mobility(new THREE.Scene(), [], routes);
  mobility.update(world(dense)); mobility.animate(4, true);
  assert.equal(mobility.body.count, 0); assert.equal(mobility.pedestrians.count, 0);
  assert.equal(mobility.trainBody.count, routes.filter(route => route.status === 'existing').length * 4);
  mobility.dispose();
});
