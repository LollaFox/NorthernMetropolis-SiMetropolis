// Original procedural development archetypes. One parcel may contain several
// blocks; all blocks still point to the same simulation asset and capacity.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function seedValue(value) {
  let seed = 2166136261;
  for (const char of String(value)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return (seed >>> 0) / 4294967296;
}

export function development(building, location) {
  const random = seedValue(building.id);
  const height = clamp(Number(building.height) || 8, .6, 80);
  const residential = ['kwu-tung', 'hung-shui-kiu'].includes(location.districtId);
  const items = [];
  const add = (material, x, y, z, w, h, d, options = {}) => items.push({ material, x, y, z, w, h, d, rotation: 0, ...options });
  const roof = (x, y, z, w, d) => add('roof', x, y, z, w, .24, d, { phase: .94 });
  const tree = (x, z, size = 1) => {
    add('trunk', x, .72 * size, z, .19 * size, 1.44 * size, .19 * size, { shape: 'cylinder', fixed: true });
    add('foliage', x, 2 * size, z, 1.7 * size, 2 * size, 1.7 * size, { shape: 'crown', fixed: true });
  };
  add('paving', 0, .08, 0, 13, .16, 13, { fixed: true });
  const podiumHeight = Math.min(3.6, Math.max(1.6, height * .13));
  let visibleHeight = height;
  if (building.kind === 'housing') {
    // Slab and point towers rise from a retail podium, with a shared courtyard.
    const facade = ['housingWarm', 'housingWhite', 'housingStone'][Math.floor(random * 3)];
    add('retail', 0, podiumHeight / 2, .4, 11.7, podiumHeight, 10.5);
    add('roofGarden', 0, podiumHeight + .04, .4, 11.8, .14, 10.6, { phase: .8 });
    add('stationAccent', 0, Math.min(1.7, podiumHeight * .62), 5.78, 11.8, .15, .65, { phase: .8 });
    const count = building.capacity >= 1000 ? 3 : building.capacity >= 600 ? 2 : residential ? 2 : 1;
    const towerH = Math.max(5, height - podiumHeight);
    if (count === 1) {
      add(facade, -.65, podiumHeight + towerH / 2, -.4, 6.4, towerH, 5.2);
      roof(-.65, height + .1, -.4, 6.65, 5.4);
      add('roofEquipment', 1, height + .55, -.8, 1.2, .8, 1.5, { phase: .98 });
    } else {
      for (let i = 0; i < count; i++) {
        const x = count === 3 ? [-3.6, 3.5, .2][i] : [-3.25, 3.25][i];
        const z = count === 3 ? [-2.8, -2.4, 3.2][i] : -.4;
        const h = towerH * (1 - i * .045);
        add(facade, x, podiumHeight + h / 2, z, count === 3 ? 3.4 : 4.15, h, count === 3 ? 3.6 : 5.4);
        roof(x, podiumHeight + h, z, count === 3 ? 3.55 : 4.35, count === 3 ? 3.75 : 5.6);
      }
    }
    add('roofGarden', 0, podiumHeight + .12, 4.3, 5, .2, 1.4, { phase: .8 });
    tree(-5.5, 5.1, .8); tree(5.4, 5.3, .72);
  } else if (building.kind === 'office') {
    if (location.districtId === 'san-tin' || location.districtId === 'ta-kwu-ling') {
      // Innovation precincts have broad mid-rise laboratory blocks and atria.
      visibleHeight = Math.max(6, height * .66);
      for (let i = 0; i < 3; i++) {
        const x = [-3.7, 3.4, -.2][i], z = [-2.7, -2.8, 3.5][i];
        const h = visibleHeight * (i === 2 ? .62 : 1);
        add(i === 1 ? 'glassBlue' : 'laboratory', x, h / 2, z, i === 2 ? 9.4 : 4.8, h, 4.8);
        roof(x, h, z, i === 2 ? 9.6 : 5, 5);
      }
      add('glassBlue', 0, 2.1, -.5, 2.9, 4.2, 5);
      tree(5.2, 5.2, .9);
    } else {
      add('retail', 0, 1.6, .4, 11, 3.2, 9.6);
      add(random > .5 ? 'glassBlue' : 'glassSilver', -.8, height / 2 + 1.6, -.5, 7.4, height, 6.7);
      roof(-.8, height + 1.6, -.5, 7.6, 6.9);
      add('glassBlue', 3.7, height * .27 + 1.6, 1.8, 3.8, height * .54, 4.7);
      roof(3.7, height * .54 + 1.6, 1.8, 4, 4.9);
      visibleHeight = height + 1.7;
    }
  } else if (building.kind === 'industry') {
    visibleHeight = Math.max(4, height * .48);
    add('logistics', -.2, visibleHeight / 2, -.2, 11.8, visibleHeight, 9.4);
    roof(-.2, visibleHeight, -.2, 12.2, 9.8);
    for (let i = 0; i < 3; i++) add('loadingDoor', -3.4 + i * 3.2, 1.2, 4.55, 2.2, 2.4, .13);
    for (let i = 0; i < 4; i++) add('solarPanel', -4.2 + i * 2.7, visibleHeight + .24, -.1, 1.8, .08, 5.7, { phase: .98 });
    add('roofEquipment', 4.2, visibleHeight + .65, -2.6, 1.2, .8, 1.8, { phase: .95 });
    add('container', 4.8, .8, 5.3, 2.4, 1.6, 1.4, { fixed: true });
  } else if (building.kind === 'park') {
    visibleHeight = 4;
    add('lawn', 0, .18, 0, 12.4, .2, 12.4, { fixed: true });
    add('paving', 0, .3, 0, 1.1, .04, 12.1, { fixed: true });
    add('paving', 0, .31, 0, 12.1, .04, 1.1, { fixed: true });
    for (let i = 0; i < 7; i++) tree(Math.cos(i * .9) * 4.4, Math.sin(i * .9) * 4.4, 1.0 + i % 2 * .18);
    add('water', 2.8, .31, 2.5, 3.2, .03, 2.5, { fixed: true });
    add('bench', -2.4, .58, 1.4, 1.8, .55, .5, { fixed: true });
    add('civicRoof', -3, 2, -2.8, 3.2, .22, 3.2);
    for (const x of [-4.3, -1.7]) add('roofEquipment', x, 1, -2.8, .15, 2, .15);
  } else if (building.kind === 'solar') {
    visibleHeight = 2.5;
    add('lawn', 0, .2, 0, 12.3, .12, 12.3, { fixed: true });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      add('solarPanel', -4.5 + i * 3, 1.3, -3.8 + j * 3.7, 2.5, .12, 3, { tilt: -.27 });
      add('roofEquipment', -4.5 + i * 3, .7, -3.8 + j * 3.7, .12, 1.4, .12);
    }
    add('civic', 4.8, 1, 5.1, 1.8, 2, 1.5);
  } else if (building.kind === 'transit') {
    visibleHeight = 6;
    add('station', 0, 1.4, 0, 12.1, 2.8, 8.2);
    add('glassBlue', 0, 3.4, -.3, 10.5, 2, 6.5);
    add('civicRoof', 0, 4.6, -.3, 12.7, .36, 8.5);
    add('paving', 0, .3, 5.4, 11.8, .25, 2.4, { fixed: true });
    for (const x of [-4.4, 4.4]) add('stationAccent', x, 2, 4.3, .38, 4, .38);
    tree(-5.4, -5.3, .8); tree(5.4, -5.3, .8);
  } else {
    visibleHeight = height;
    add('civic', 0, height * .3, -.4, 11.3, height * .6, 8.9);
    add('glassSilver', 0, height * .37, 4.1, 9.5, height * .54, .18);
    add('civicRoof', 0, height * .62, -.2, 12.7, .44, 10.4);
    add('paving', 0, .3, 5.9, 12.4, .24, 1.6, { fixed: true });
    for (let i = 0; i < 5; i++) add('civic', -4 + i * 2, height * .26, 4.8, .22, height * .5, .22);
    tree(5.5, -5.4, .9);
  }
  // A crane is a visual of the parcel's real construction state, never capacity.
  const craneHeight = visibleHeight + 6;
  add('crane', 5.9, craneHeight / 2, -5.1, .17, craneHeight, .17, { construction: true, selectable: false });
  add('crane', 2.9, craneHeight - .8, -5.1, 10, .17, .17, { construction: true, selectable: false });
  add('cable', -1.8, craneHeight - 2.6, -5.1, .05, 3.8, .05, { construction: true, selectable: false });
  return { items, height: visibleHeight, width: 13, depth: 13 };
}
