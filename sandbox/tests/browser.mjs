// Real browser + HTTP integration; no paid calls, external requests, or npm setup.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [driver, executable, evidenceDirectory = '/private/tmp/sandbox-v2-browser'] = process.argv.slice(2);
if (!driver || !executable) throw new Error('Pass the existing Playwright module and Chromium executable');
const { chromium } = await import(pathToFileURL(driver));
await mkdir(evidenceDirectory, { recursive: true });
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn('/usr/bin/python3', ['-m', 'sandbox.server', '--port', String(port), '--no-save', '--live-request-limit', '0'],
  { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', value => { serverLog += value; });
server.stderr.on('data', value => { serverLog += value; });
let browser;
let page;
const results = [];
const errors = [];
const measurements = {};
const check = async (name, fn) => {
  const start = performance.now();
  try { await fn(); results.push({ name, passed: true, ms: Math.round(performance.now() - start) }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); throw error; }
};
const state = async () => (await fetch(`${base}/api/state`)).json();
const command = async (name, body) => {
  const response = await fetch(`${base}/api/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
};
try {
  await check('temporary loopback server starts with paid calls disabled', async () => {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready: ${serverLog}`);
  });
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await check('actual local WebGL scene renders without a CDN', async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas[data-rendered="true"]', { timeout: 30000 });
    assert.ok(await page.locator('canvas').count());
    await page.waitForFunction(() => document.querySelector('#population')?.textContent !== '—');
  });
  await check('autonomous city advances without user interventions', async () => {
    const before = await state();
    await page.waitForTimeout(1850);
    const after = await state();
    assert.ok(after.world.month > before.world.month);
  });
  await check('pause control freezes simulation while renderer keeps running', async () => {
    await page.locator('#play-button').click();
    await page.waitForTimeout(600);
    const before = await state();
    assert.equal(before.playing, false);
    await page.waitForTimeout(1750);
    assert.equal((await state()).world.month, before.world.month);
  });
  await check('speed selection and play affect actual simulation time', async () => {
    await page.locator('#speed-select').selectOption('8');
    await page.waitForTimeout(200);
    const before = await state();
    await page.locator('#play-button').click();
    await page.waitForTimeout(1200);
    const after = await state();
    assert.equal(after.speed, 8);
    assert.ok(after.world.month >= before.world.month + 3);
    await page.locator('#play-button').click();
    await page.waitForTimeout(500);
  });
  const original = await state();
  const exactMonth = Math.max(0, original.world.month - 3);
  let archived;
  await check('history slider returns an exact saved snapshot', async () => {
    archived = (await (await fetch(`${base}/api/export`)).json()).branches.find(b => b.id === original.id).history[exactMonth];
    await page.locator('#timeline-slider').fill(String(exactMonth));
    await page.locator('#timeline-slider').dispatchEvent('change');
    await page.waitForTimeout(650);
    const rewound = await state();
    assert.equal(rewound.playing, false);
    assert.equal(rewound.viewingMonth, exactMonth);
    assert.deepEqual(rewound.world, archived);
  });
  let fork;
  await check('policy submission while rewound creates an independent playable future', async () => {
    await page.locator('#policy-input').fill('Build affordable housing');
    const started = performance.now();
    await page.locator('#policy-submit').click();
    await page.waitForFunction(id => document.querySelector('#branch-select')?.value !== id, original.id);
    measurements.policyUiMs = Math.round(performance.now() - started);
    fork = await state();
    assert.notEqual(fork.id, original.id);
    assert.equal(fork.parentId, original.id);
    assert.equal(fork.world.month, exactMonth);
    const exported = await (await fetch(`${base}/api/export`)).json();
    assert.deepEqual(exported.branches.find(b => b.id === original.id).history[exactMonth], archived);
  });
  await check('switching timelines recovers the untouched original present', async () => {
    await page.locator('#branch-select').selectOption(original.id);
    await page.waitForTimeout(600);
    assert.equal((await state()).world.month, original.world.month);
    await page.locator('#branch-select').selectOption(fork.id);
    await page.waitForTimeout(600);
  });
  await check('visual climate and mobility layers respond to controls', async () => {
    const normal = await page.locator('#city-canvas').screenshot();
    for (const layer of ['climate', 'mobility', 'housing', 'city']) {
      await page.locator(`button[data-layer="${layer}"]`).click();
      assert.equal(await page.locator(`button[data-layer="${layer}"]`).getAttribute('aria-pressed'), 'true');
      if (layer === 'climate') {
        await page.waitForTimeout(150);
        const colored = await page.locator('#city-canvas').screenshot();
        assert.ok(!normal.equals(colored), 'Climate colors change the real canvas');
      }
    }
  });
  await check('actor activity drawer shows real role state', async () => {
    await page.locator('#actors-toggle').click();
    assert.equal(await page.locator('#actors-drawer').isVisible(), true);
    const text = await page.locator('#actor-cards').innerText();
    assert.ok(text.length > 50);
    await page.locator('[data-close="actors"]').click();
  });
  await check('model assumptions and export are accessible', async () => {
    await page.locator('#model-toggle').click();
    assert.equal(await page.locator('#model-drawer').isVisible(), true);
    await page.waitForFunction(() => document.querySelector('#model-content')?.textContent.length > 80);
    assert.ok((await page.locator('.model-disclaimer').innerText()).includes('not a calibrated forecast'));
    assert.equal((await (await fetch(`${base}/api/export`)).json()).schemaVersion, 2);
    await page.locator('[data-close="model"]').click();
  });
  await check('district navigation moves the actual camera through all four geographic lenses', async () => {
    const positions = new Set();
    for (const district of ['hung-shui-kiu', 'san-tin', 'kwu-tung', 'ta-kwu-ling']) {
      await page.locator(`button[data-district="${district}"]`).click();
      await page.waitForFunction(id => document.querySelector('#city-canvas').dataset.district === id, district);
      await page.waitForTimeout(750);
      const pose = await page.locator('#city-canvas').getAttribute('data-camera-position');
      assert.ok(pose, 'Renderer exposes its actual camera position');
      positions.add(pose);
      assert.equal(await page.locator(`button[data-district="${district}"]`).getAttribute('aria-pressed'), 'true');
    }
    assert.equal(positions.size, 4);
  });
  await check('street exploration moves at ground level and leaves text entry alone', async () => {
    await page.locator('button[data-district="kwu-tung"]').click();
    await page.locator('#view-street').click();
    await page.waitForFunction(() => document.querySelector('#city-canvas').dataset.view === 'street');
    await page.waitForTimeout(900);
    const camera = async () => JSON.parse(await page.locator('#city-canvas').getAttribute('data-camera-position'));
    const before = await camera();
    assert.ok(before[1] < 5, 'Street camera is close to ground level');
    await page.locator('#city-canvas').focus();
    await page.keyboard.down('w');
    await page.waitForTimeout(650);
    await page.keyboard.up('w');
    const after = await camera();
    assert.ok(Math.hypot(after[0] - before[0], after[2] - before[2]) > .1);
    await page.locator('#policy-input').focus();
    await page.keyboard.type('wasd');
    await page.waitForTimeout(300);
    assert.deepEqual(await camera(), after, 'Typing policy text must not move the camera');
    await page.locator('#policy-input').fill('');
    await page.screenshot({ path: path.join(evidenceDirectory, 'street.png') });
    await page.locator('#view-overview').click();
    await page.waitForFunction(() => document.querySelector('#city-canvas').dataset.view === 'overview');
  });
  await check('day and dusk change rendered lighting without advancing simulation time', async () => {
    await page.waitForTimeout(800);
    const before = await state();
    const day = await page.locator('#city-canvas').screenshot();
    await page.locator('#light-dusk').click();
    await page.waitForFunction(() => document.querySelector('#city-canvas').dataset.timeOfDay === 'dusk');
    await page.waitForTimeout(400);
    const dusk = await page.locator('#city-canvas').screenshot();
    assert.ok(!day.equals(dusk), 'Lighting changes the rendered image');
    assert.equal((await state()).world.month, before.world.month);
    await page.screenshot({ path: path.join(evidenceDirectory, 'dusk.png') });
    await page.locator('#light-day').click();
    await page.waitForFunction(() => document.querySelector('#city-canvas').dataset.timeOfDay === 'day');
  });
  await check('objectives remain available in a collapsible panel', async () => {
    assert.equal(await page.locator('#mission-panel').isVisible(), false);
    await page.locator('#objectives-toggle').click();
    assert.equal(await page.locator('#mission-panel').isVisible(), true);
    assert.equal(await page.locator('#objectives .objective').count(), 5);
    await page.locator('#mission-close').click();
    assert.equal(await page.locator('#mission-panel').isVisible(), false);
  });
  await check('a new development cue focuses a real changed parcel and clears on rewind', async () => {
    await page.locator('#policy-input').fill('Invest in solar power');
    await page.locator('#policy-submit').click();
    await page.waitForFunction(() => !document.querySelector('#recent-change').classList.contains('hidden'));
    const parcelId = await page.locator('#recent-change').getAttribute('data-building');
    assert.ok((await state()).world.buildings.some(building => building.id === parcelId));
    await page.locator('#recent-change').click();
    assert.equal(await page.locator('#city-canvas').getAttribute('data-selected-building'), parcelId);
    await page.locator('#inspector-close').click();
    const month = (await state()).world.month;
    assert.ok(month > 0);
    await page.locator('#rewind-button').click();
    await page.waitForFunction(value => document.body.dataset.month === String(value), month - 1);
    assert.equal(await page.locator('#recent-change').isVisible(), false);
  });
  await check('orbit and zoom input preserve a rendered scene', async () => {
    await page.mouse.move(900, 470);
    await page.mouse.down();
    await page.mouse.move(1030, 505, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('canvas').getAttribute('data-rendered'), 'true');
    await page.locator('#reset-camera').click();
  });
  await check('clicking rendered buildings opens an inspector for a real world asset', async () => {
    await page.waitForTimeout(650);
    let selected;
    const points = [];
    for (let y = 390; y <= 630; y += 35) for (let x = 420; x <= 1190; x += 42) points.push([x, y]);
    for (const [x, y] of points) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(30);
      selected = await page.locator('#city-canvas').getAttribute('data-selected-building');
      if (selected) break;
    }
    assert.ok(selected, 'A visible building can be selected');
    assert.ok((await state()).world.buildings.some(building => building.id === selected));
    assert.equal(await page.locator('#inspector').isVisible(), true);
    assert.ok((await page.locator('#inspector').innerText()).length > 30);
  });
  await check('responsive layout keeps time and policy controls reachable', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(450);
    assert.equal(await page.locator('#policy-input').isVisible(), true);
    assert.equal(await page.locator('#play-button').isVisible(), true);
    assert.equal(await page.locator('#objectives-toggle').isVisible(), true);
    await page.locator('#inspector-close').click();
    await page.locator('#region-toggle').click();
    assert.equal(await page.locator('button[data-district="kwu-tung"]').isVisible(), true);
    await page.locator('button[data-district="kwu-tung"]').click();
    await page.waitForFunction(() => document.querySelector('#city-canvas').dataset.district === 'kwu-tung');
    assert.equal(await page.locator('#region-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('#reset-camera').click();
    await page.waitForTimeout(750);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(evidenceDirectory, 'mobile.png') });
    await page.setViewportSize({ width: 1512, height: 982 });
  });
  await check('a suspended live mode can be retried through the actual button without paid calls', async () => {
    const simulated = await state();
    simulated.mode = 'live';
    simulated.ai = { ...simulated.ai, available: true, status: 'error', lastError: 'Synthetic test failure', errors: 1 };
    let retried = 0;
    await page.route('**/api/state', route => route.fulfill({ json: simulated }));
    await page.route('**/api/mode', route => {
      assert.deepEqual(route.request().postDataJSON(), { mode: 'live' });
      retried++;
      return route.fulfill({ json: { ...simulated, ai: { ...simulated.ai, status: 'ready' } } });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#ai-status')?.textContent.includes('error'));
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/mode'), { timeout: 5000 }),
      page.locator('#live-mode').click()
    ]);
    assert.equal(retried, 1);
    await page.unroute('**/api/state');
    await page.unroute('**/api/mode');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas[data-rendered="true"]');
  });
  await check('city remains renderable after rewind, branching and resize with no browser errors', async () => {
    await page.waitForTimeout(700);
    assert.deepEqual(errors, []);
    assert.equal((await state()).ai.requests, 0);
    await page.screenshot({ path: path.join(evidenceDirectory, 'city.png') });
  });
  await check('every district permits real street movement in a dense twenty-year city', async () => {
    const denseWorld = JSON.parse(execFileSync('/usr/bin/python3', ['-c', 'import json; from sandbox.engine import create_world, step_world; w=create_world();\nfor _ in range(240): w=step_world(w)\nprint(json.dumps(w))'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
    assert.equal(denseWorld.buildings.length, 132);
    const dense = { ...(await state()), id: 'dense-browser-fixture', world: denseWorld, playing: false, viewingMonth: null, timeline: [{month: denseWorld.month}], branches: [{id: 'dense-browser-fixture', label: 'Dense test world'}] };
    await page.route('**/api/state', route => route.fulfill({ json: dense }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas[data-rendered="true"]');
    await page.locator('#view-street').click();
    for (const district of ['hung-shui-kiu', 'san-tin', 'kwu-tung', 'ta-kwu-ling']) {
      await page.locator(`button[data-district="${district}"]`).click();
      await page.waitForFunction(id => document.querySelector('#city-canvas').dataset.district === id && document.querySelector('#city-canvas').dataset.view === 'street', district);
      await page.waitForTimeout(200);
      const before = JSON.parse(await page.locator('#city-canvas').getAttribute('data-camera-position'));
      let moved = false;
      await page.locator('#city-canvas').focus();
      for (const key of ['w', 'a', 's', 'd']) {
        await page.keyboard.down(key);
        await page.waitForTimeout(300);
        await page.keyboard.up(key);
        const after = JSON.parse(await page.locator('#city-canvas').getAttribute('data-camera-position'));
        if (Math.hypot(after[0] - before[0], after[2] - before[2]) > .1) { moved = true; break; }
      }
      assert.ok(moved, `${district} arrival must leave a traversable route`);
    }
    assert.deepEqual(errors, []);
    assert.equal((await state()).ai.requests, 0);
    await page.screenshot({ path: path.join(evidenceDirectory, 'dense-street.png') });
  });

} catch (error) {
  if (page) await page.screenshot({ path: path.join(evidenceDirectory, 'failure.png') }).catch(() => {});
  process.stderr.write(`${error.stack}\n`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await writeFile(path.join(evidenceDirectory, 'journey.json'), JSON.stringify({ results, measurements, errors, serverLog }, null, 2));
  const failed = results.filter(item => !item.passed).length;
  const completed = results.length === 22;
  const counts = { schemaVersion: 1, collected: results.length, passed: results.length - failed, failed: failed || (completed ? 0 : 1), skipped: 0, cancelled: 0 };
  console.log(JSON.stringify(counts));
  process.exitCode = failed === 0 && completed ? 0 : 1;
}
