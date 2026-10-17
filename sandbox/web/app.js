import {PlanAnalysis} from './plan-analysis.js';
import {WorkspaceNavigation} from './workspace-navigation.js';
import {AnalysisDashboard} from './analysis-dashboard.js';
import { CompactAnalysisUI } from './analysis-compact.js';
import { PortStudyUI } from './port-study.js';
import { DISTRICTS, districtForBuilding, summarizeDistrict, describeChange } from './geography.js';
import {isBackendReplay,metricText,backendBuildingLabels} from './backend-overview.js';

const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const money = value => metricText(value,v=>`$${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(v)}m`);
const kinds = { housing: ['Residential quarter', '▥', 'Homes'], office: ['Business tower', '▦', 'Jobs'], industry: ['Industrial works', '▤', 'Jobs'], park: ['Neighbourhood park', '♧', 'Amenities'], solar: ['Solar garden', '▱', 'Energy'], transit: ['Transit station', '⇄', 'Capacity'], civic: ['Civic landmark', '⌂', 'Capacity'] };
const actorNames = { government: 'Government', business: 'Business', residents: 'Residents', energy: 'Energy', user: 'You', system: 'City' };
const actorSymbols = { government: '⌂', business: '▦', residents: '◉', energy: 'ϟ' };
let state = null;
let city = null;
let portStudy = null;
let analysis = null;
let workspaceNavigation = null;
let selectedId = null;
let epochYear = 2030;
let generation = 0;
let mutationCount = 0;
let mutationQueue = Promise.resolve();
let pollFailures = 0;
let scrubbing = false;
let toastTimer;
let drawer = null;
let activitySignature = '';
let worldSignature = '';
let objectivesSignature = '';
let branchSignature = '';
let modelLoaded = false;
let pendingPlay = null;
let pendingSpeed = null;
let activeDistrict = null;
let viewMode = 'overview';
let latestChange = null;
let branchOrigin = null;
const districtLabels = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function titleCase(text) { return String(text).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }
function dateLabel(month, year = epochYear + Math.floor(month / 12)) {
  const name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][((month % 12) + 12) % 12];
  return `${name} ${year}`;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').classList.remove('hidden');
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), error ? 6500 : 4200);
}
async function request(path, body, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `The local server returned ${response.status}.`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The local city server took too long to respond. Please try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach the local city server. Check that it is running.');
    throw error;
  } finally { clearTimeout(timer); }
}
function mutate(path, body, options = {}) {
  if(isBackendReplay(state)&&['/api/branch','/api/intervention','/api/reset'].includes(path)){const error=new Error('This backend replays saved cities. Use Team API setup for a new scenario.');toast(error.message,true);return Promise.reject(error);}
  generation++;
  mutationCount++;
  const operation = mutationQueue.then(async () => {
    try {
      const data = await request(path, body);
      applyState(data, options.snap || false);
      pollFailures = 0;
      $('connection-banner').classList.add('hidden');
      options.onSuccess?.(data);
      return data;
    } catch (error) {
      options.onError?.(error);
      toast(error.message, true);
      throw error;
    } finally {
      mutationCount--;
      options.onFinish?.();
    }
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}
async function poll() {
  const atStart = generation;
  try {
    const data = await request('/api/state', undefined, 5000);
    if (atStart === generation && mutationCount === 0) applyState(data);
    pollFailures = 0;
    $('connection-banner').classList.add('hidden');
  } catch (error) {
    pollFailures++;
    if (pollFailures >= 2) {
      $('connection-banner').textContent = `${error.message} Reconnecting automatically…`;
      $('connection-banner').classList.remove('hidden');
      $('scenario-state').textContent = 'Connection interrupted';
      if (!state) $('loading-state').classList.add('hidden');
    }
  } finally { setTimeout(poll, 450); }
}

function renderObjectives(objectives) {
  const signature = JSON.stringify(objectives);
  if (objectivesSignature === signature) return;
  objectivesSignature = signature;
  $('objectives').replaceChildren();
  $('mission-count').textContent = `${objectives.filter(o => o.achieved).length} / ${objectives.length}`;
  if (!objectives.length) { $('objectives').append(element('p', 'quiet', 'A city takes shape one choice at a time.')); return; }
  for (const goal of objectives) {
    const row = element('div', `objective${goal.achieved ? ' achieved' : ''}`);
    const head = element('div', 'objective-head');
    const label = element('span');
    label.append(element('i', 'objective-dot'), document.createTextNode(goal.label));
    const count = element('span', 'objective-count', goal.achieved ? 'COMPLETE ✓' : `${compact.format(Number(goal.current) || 0)} / ${compact.format(Number(goal.target) || 0)}`);
    head.append(label, count);
    const track = element('div', 'objective-track');
    const fill = element('span');
    fill.style.width = `${Math.max(0, Math.min(100, (Number(goal.current) || 0) / Math.max(1, Number(goal.target) || 1) * 100))}%`;
    track.append(fill);
    row.append(head, track);
    $('objectives').append(row);
  }
}
function renderBranches(branches, current) {
  const signature = JSON.stringify(branches.map(branch => [branch.id, branch.label])) + current;
  if (signature === branchSignature) return;
  branchSignature = signature;
  $('branch-select').replaceChildren();
  for (const branch of branches) {
    const option = element('option', '', branch.label);
    option.value = branch.id;
    $('branch-select').append(option);
  }
  $('branch-select').value = current;
}
function renderActors(world) {
  const signature = JSON.stringify([world.actors, world.messages]);
  if (signature === activitySignature) return;
  activitySignature = signature;
  $('actor-cards').replaceChildren();
  for (const actor of world.actors || []) {
    const card = element('div', 'actor-card');
    const head = element('div', 'actor-card-head');
    head.append(element('span', 'actor-avatar', actorSymbols[actor.id] || '◉'), element('span', '', actor.name || actorNames[actor.id] || actor.id));
    card.append(head, element('p', 'actor-role', actor.role || actor.stance || ''), element('div', 'actor-value', money(actor.cashM)), element('p', 'actor-mood', `Outlook ${Math.round(Number(actor.mood) || 0)} / 100`));
    $('actor-cards').append(card);
  }
  const messages = (world.messages || []).slice(-24).reverse();
  $('activity-count').textContent = `${messages.length}`;
  $('actor-messages').replaceChildren();
  for (const message of messages) {
    const row = element('article', 'message');
    const meta = element('div', 'message-meta');
    meta.append(element('strong', '', actorNames[message.source] || message.source || 'City'), element('span', '', dateLabel(message.month)));
    const provenance = element('div');
    provenance.append(element('span', `message-type ${message.sourceType || 'rules'}`, message.sourceType === 'live' ? 'LIVE AI' : message.sourceType === 'user' ? 'YOUR PROPOSAL' : 'RULES ENGINE'));
    if (message.action) provenance.append(element('span', 'quiet', titleCase(message.action)));
    row.append(meta, element('p', '', message.text), provenance);
    $('actor-messages').append(row);
  }
  if (!messages.length) $('actor-messages').append(element('p', 'quiet', 'The city actors will share their decisions here.'));
}
function renderInspector() {
  if (!state || !selectedId) { $('inspector').classList.add('hidden'); return; }
  const building = state.world.buildings.find(b => b.id === selectedId);
  if (!building) { selectedId = null; $('inspector').classList.add('hidden'); return; }
  let [name, symbol, capacityType] = kinds[building.kind] || ['City building', '▥', 'Capacity'];
  if(isBackendReplay(state)){const labels=backendBuildingLabels(building);name=labels.name;capacityType=labels.capacity;}
  $('building-title').textContent = name;
  $('building-symbol').textContent = symbol;
  $('building-owner').textContent = `${districtForBuilding(building).name} · ${actorNames[building.owner] || titleCase(building.owner || 'Public')}`;
  $('building-facts').replaceChildren();
  const facts = [...(capacityType?[[capacityType, metricText(building.capacity,v=>fmt.format(v))]]:[]), ['Model height', `${Number(building.height).toFixed(1)} display units`], ['Persistent object ID', building.id], ['Established', dateLabel(building.createdMonth || 0)]];
  if(isBackendReplay(state))facts.push(['Backend grid cell',building.canonicalCell?.join(', ')??'Not provided'],['Position','Schematic city projection']);
  for (const [label, value] of facts) {
    const fact = element('div');
    fact.append(element('span', '', label), element('strong', '', value));
    $('building-facts').append(fact);
  }
  const progress = Math.round((Number(building.progress) || 0) * 100);
  $('construction-fill').style.width = `${progress}%`;
  $('construction-label').textContent = progress >= 100 ? 'Complete · contributing to the city' : `Under construction · ${progress}% complete`;
  $('inspector').classList.remove('hidden');
}
function renderDistrict() {
  const district = DISTRICTS.find(entry => entry.id === activeDistrict);
  $('experience-title').textContent = district?.shortName || 'A world in the making.';
  $('experience-subtitle').textContent = district?.description || 'Explore a possible future, from the wetlands to the city streets.';
  for (const button of document.querySelectorAll('button[data-district]')) {
    const active = button.dataset.district === activeDistrict;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  document.body.dataset.district = activeDistrict || 'region';
  // Summaries refer only to the selected snapshot, including while exploring history.
  if (district && state) {
    const summary = summarizeDistrict(state.world, district.id);
    $('experience-subtitle').title = `${summary.completed} completed development parcels · ${summary.underConstruction} under construction in this snapshot`;
  } else $('experience-subtitle').removeAttribute('title');
}
function renderView(mode) {
  viewMode = mode;
  document.body.dataset.view = mode;
  for (const candidate of ['overview', 'street']) {
    const active = candidate === mode;
    $(`view-${candidate}`).classList.toggle('active', active);
    $(`view-${candidate}`).setAttribute('aria-pressed', String(active));
  }
  document.querySelector('.navigation-hint').textContent = mode === 'street' ? 'Drag to look · W A S D / arrows to walk · Select a development' : 'Drag to orbit · Scroll to explore · Select a development';
}
function renderLabels(labels, headingDegrees = 0) {
  document.querySelector('.compass i').style.transform = `rotate(${headingDegrees}deg)`;
  const width = $('city-view').clientWidth;
  const height = $('city-view').clientHeight;
  for (const label of labels) {
    const button = districtLabels.get(label.id);
    if (!button) continue;
    const clearOfControls = label.x > (width < 761 ? 200 : 260) && label.x < width - 85 && label.y > 120 && label.y < height - (width < 761 ? 350 : 295);
    button.classList.toggle('hidden', !label.visible || viewMode === 'street' || !clearOfControls);
    button.style.left = `${label.x}px`;
    button.style.top = `${label.y}px`;
  }
}
function renderChange(world, previous, discontinuity) {
  if (discontinuity) latestChange = null;
  else if (previous) latestChange = describeChange(world, previous) || latestChange;
  if (latestChange?.buildingId && !world.buildings.some(building => building.id === latestChange.buildingId)) latestChange = null;
  $('recent-change').classList.toggle('hidden', !latestChange);
  if (latestChange) {
    $('change-title').textContent = latestChange.title;
    $('change-detail').textContent = latestChange.detail;
    $('recent-change').dataset.building = latestChange.buildingId || '';
  }
}
function toggleObjectives(open = $('mission-panel').classList.contains('hidden')) {
  $('mission-panel').classList.toggle('hidden', !open);
  $('objectives-toggle').setAttribute('aria-expanded', String(open));
}
function renderAI(envelope) {
  if(isBackendReplay(envelope)){
    $('rules-mode').disabled=true;$('live-mode').disabled=true;$('live-mode').title='Provider execution belongs to confirmed backend jobs; see saved result metrics.';
    $('ai-status').textContent='Saved backend replay · synthetic; provider metrics are in result details';
    $('scenario-state').textContent=portStudy?.active?(analysis?.sourceLabel??'Backend saved city'):'Backend saved replay';return;
  }
  const { mode, ai = {} } = envelope;
  $('rules-mode').classList.toggle('active', mode === 'rules');
  $('rules-mode').setAttribute('aria-pressed', String(mode === 'rules'));
  $('live-mode').classList.toggle('active', mode === 'live');
  $('live-mode').setAttribute('aria-pressed', String(mode === 'live'));
  $('live-mode').disabled = !ai.available && mode !== 'live';
  $('live-mode').title = mode === 'live' && ai.status === 'error' ? 'Retry the suspended live AI request' : ai.available ? `Use ${ai.provider || 'configured provider'} · ${ai.model || 'configured model'}` : 'Live AI requires an existing configured provider. Rules mode is available.';
  const count = `${ai.requests || 0}/${ai.limit || 0} calls`;
  const aiLabels = { budget_exhausted: 'allowance used · Rules available', thinking: 'actors are considering', error: 'request paused · select Live AI to retry', ready: 'ready', idle: 'waiting for the city' };
  const status = mode === 'live' ? `Live AI · ${aiLabels[ai.status] || ai.status || 'ready'} · ${count}` : 'Rules engine · synthetic scenario';
  $('ai-status').textContent = status + (Number(ai.errors) > 0 ? ` · ${ai.errors} errors` : '') + (envelope.storageError ? ' · autosave issue' : '');
  $('ai-status').title = [ai.lastError, ai.status === 'budget_exhausted' ? 'The approved AI request allowance is used. Select Rules for continuing autonomous local decisions.' : '', envelope.storageError, 'Synthetic scenario · model-based projection, not a calibrated forecast.'].filter(Boolean).join(' · ');
  $('scenario-state').textContent = portStudy?.active ? (analysis?.sourceLabel??'Policy sandbox · rules') : mode === 'live' ? 'Live AI decisions' : 'Rules simulation';
  $('ai-status').classList.toggle('has-errors', Number(ai.errors) > 0 || Boolean(envelope.storageError));
}
function applyState(envelope, snap = false) {
  if (!envelope?.world || !Array.isArray(envelope.world.buildings)) throw new Error('The server returned an incomplete city state.');
  const previous = state;
  state = envelope;
  epochYear = Number(envelope.world.year) - Math.floor(Number(envelope.world.month) / 12);
  const world = envelope.world;
  const metrics = world.metrics || {};
  const backend=isBackendReplay(envelope);document.body.classList.toggle('backend-connected',backend);
  for(const id of ['branch-button','reset-world','policy-submit'])$(id).disabled=backend;
  $('population').textContent = metricText(metrics.population,v=>compact.format(v));
  $('population').title = `${fmt.format(metrics.population || 0)} people`;
  $('jobs').textContent = metricText(metrics.jobs,v=>compact.format(v));
  $('jobs').title = `${fmt.format(metrics.jobs || 0)} jobs`;
  $('happiness').textContent = metricText(metrics.happiness,v=>String(Math.round(v)));
  $('population-change').textContent = backend?`${metricText(metrics.homes,v=>compact.format(v))} resident places · capacity`:`${compact.format(metrics.homes || 0)} places to call home`;
  $('jobs-foot').textContent = backend?'Offered jobs · filled jobs shown in results':`${world.buildings.filter(b => b.progress >= 1).length} completed places`;
  $('happiness-foot').textContent = backend?'Synthetic satisfaction index':Number(metrics.happiness) >= 70 ? 'A city feeling hopeful' : Number(metrics.happiness) >= 45 ? 'Room to make life better' : 'Your city needs care';
  $('city-date').textContent = backend?world.sourceDate:dateLabel(world.month, world.year);
  $('history-indicator').classList.toggle('hidden', envelope.viewingMonth === null || envelope.viewingMonth === undefined);
  $('history-indicator').textContent = 'PAST SNAPSHOT';
  $('latest-button').classList.toggle('hidden', envelope.viewingMonth == null);
  renderPlay();
  $('speed-select').value = String(pendingSpeed ?? envelope.speed ?? 1);
  const timeline = envelope.timeline || [];
  const first = timeline.length ? timeline[0].month : 0;
  const last = timeline.length ? timeline[timeline.length - 1].month : world.month;
  if (!scrubbing) {
    $('timeline-slider').min = first;
    $('timeline-slider').max = last;
    $('timeline-slider').value = world.month;
  }
  $('timeline-slider').disabled = last <= first;
  $('rewind-button').disabled = world.month <= first;
  $('timeline-start').textContent = dateLabel(first);
  $('timeline-end').textContent = dateLabel(last);
  $('timeline-status').textContent = backend?`Saved replay · ${world.sourceDate} · no new model call`:envelope.viewingMonth !== null && envelope.viewingMonth !== undefined ? 'Saved moment · resume to branch' : `${envelope.playing ? 'City is growing' : 'A moment to think'} · ${world.month} months`;
  $('timeline-slider').style.background = `linear-gradient(to right, #cbe780 ${Math.max(0, (world.month - first) / Math.max(1, last - first) * 100)}%, #496665 0%)`;
  if (!$('timeline-ticks').children.length) for (let i = 0; i < 21; i++) $('timeline-ticks').append(element('i'));
  renderBranches(envelope.branches || [], envelope.id);
  renderObjectives(world.objectives || []);
  renderAI(envelope);
  $('treasury').textContent = money(metrics.treasuryM);
  $('air-quality').textContent = metricText(metrics.airQuality,v=>`${Math.round(v)} / 100`);
  $('emissions').textContent = metricText(metrics.emissions,v=>`${compact.format(v)} tCO₂e`);
  $('energy-balance').textContent = Number.isFinite(metrics.powerCapacity)&&Number.isFinite(metrics.powerDemand)?`${compact.format(metrics.powerCapacity)} / ${compact.format(metrics.powerDemand)}`:'Not modeled';
  if (drawer === 'actors') renderActors(world);
  renderInspector();
  renderDistrict();
  const signature = JSON.stringify([envelope.id, world.month, world.buildings]);
  if (signature !== worldSignature) {
    worldSignature = signature;
    const historicalChange = snap || (previous && (previous.id !== envelope.id || previous.world.month > world.month));
    renderChange(world, previous?.world, historicalChange || !previous || previous.id !== envelope.id);
    const savedTransition=backend&&previous?.id===envelope.id&&previous.world.sourceDate!==world.sourceDate;
    if(!city?.externalMapActive) city?.update(world, pendingPlay ?? envelope.playing, historicalChange,{savedTransition});
  } else if (city && !city.externalMapActive) city.playing = pendingPlay ?? envelope.playing;
  $('loading-state').classList.add('hidden');
  document.body.dataset.branch = envelope.id;
  document.body.dataset.month = String(world.month);
  document.body.dataset.mode = envelope.mode;
  document.body.dataset.playing = String(pendingPlay ?? envelope.playing);
  analysis?.backend.syncOverview(envelope);
}
function renderPlay() {
  const playing = pendingPlay ?? state?.playing ?? true;
  $('play-symbol').textContent = playing ? 'Ⅱ' : '▶';
  $('play-button').setAttribute('aria-label', playing ? 'Pause simulation' : 'Play simulation');
  $('play-button').title = playing ? 'Pause simulation (Space)' : 'Play simulation (Space)';
  if (city) city.playing = playing;
}
function togglePlay() {
  if (portStudy?.active) return;
  if (!state) return;
  const wanted = !(pendingPlay ?? state.playing);
  pendingPlay = wanted;
  renderPlay();
  mutate('/api/control', { playing: wanted }, {
    onSuccess: () => { if (pendingPlay === wanted) pendingPlay = null; renderPlay(); },
    onError: () => { if (pendingPlay === wanted) pendingPlay = null; renderPlay(); }
  }).catch(() => {});
}
function openDrawer(name) {
  drawer = drawer === name ? null : name;
  for (const id of ['actors', 'model']) {
    $(`${id}-drawer`).classList.toggle('hidden', drawer !== id);
    $(`${id}-toggle`).setAttribute('aria-expanded', String(drawer === id));
  }
  toggleObjectives(false);
  $('help-popover').classList.add('hidden');
  $('help-toggle').setAttribute('aria-expanded', 'false');
  if (drawer === 'actors' && state) renderActors(state.world);
  if (drawer === 'model' && !modelLoaded) loadModel();
}
async function loadModel() {
  try {
    const model = await request('/api/model');
    $('model-content').replaceChildren();
    for (const [key, value] of Object.entries(model)) {
      if (['version', 'status', 'scope'].includes(key)) {
        $('model-content').append(element('p', 'quiet', `${titleCase(key)} · ${typeof value === 'string' ? value : JSON.stringify(value)}`));
        continue;
      }
      $('model-content').append(element('h3', '', titleCase(key)));
      if (Array.isArray(value)) {
        const list = element('ul');
        for (const entry of value) list.append(element('li', '', typeof entry === 'string' ? entry : JSON.stringify(entry)));
        $('model-content').append(list);
      } else if (value && typeof value === 'object') {
        const list = element('dl');
        for (const [label, detail] of Object.entries(value)) {
          const row = element('div');
          row.append(element('dt', '', titleCase(label)), element('dd', '', typeof detail === 'string' || typeof detail === 'number' ? detail : JSON.stringify(detail)));
          list.append(row);
        }
        $('model-content').append(list);
      } else $('model-content').append(element('p', '', value));
    }
    modelLoaded = true;
  } catch (error) {
    $('model-content').replaceChildren(element('p', 'quiet', error.message));
    modelLoaded = false;
  }
}

$('play-button').addEventListener('click', togglePlay);
$('speed-select').addEventListener('change', event => {
  const wanted = Number(event.target.value);
  pendingSpeed = wanted;
  mutate('/api/control', { speed: wanted }, {
    onSuccess: () => { if (pendingSpeed === wanted) pendingSpeed = null; },
    onError: () => { if (pendingSpeed === wanted) pendingSpeed = null; $('speed-select').value = String(state?.speed || 1); }
  }).catch(() => {});
});
$('rewind-button').addEventListener('click', () => {
  if (!state) return;
  const month = Math.max(Number($('timeline-slider').min), state.world.month - 1);
  mutate('/api/seek', { month }, { snap: true }).catch(() => {});
});
$('timeline-slider').addEventListener('input', event => {
  scrubbing = true;
  $('timeline-status').textContent = `Explore ${dateLabel(Number(event.target.value))}`;
});
$('timeline-slider').addEventListener('change', event => {
  const month = Number(event.target.value);
  mutate('/api/seek', { month }, { snap: true, onFinish: () => { scrubbing = false; if (state) applyState(state); } }).catch(() => {});
});
$('branch-select').addEventListener('change', event => {
  const id = event.target.value;
  mutate('/api/switch', { id }, { snap: true, onSuccess: data => toast(`Exploring ${data.label}.`), onError: () => { $('branch-select').value = state?.id || ''; } }).catch(() => {});
});
$('latest-button').addEventListener('click', () => {
  if (state) mutate('/api/switch', { id: state.id }, { snap: true, onSuccess: () => toast('Back at the latest saved month. Simulation paused.') }).catch(() => {});
});
$('branch-button').addEventListener('click', async () => {
  if (!state || mutationCount) return;
  $('branch-button').disabled = true;
  try {
    const data = await mutate('/api/control', { playing: false });
    branchOrigin = { id: data.id, month: data.world.month };
    $('branch-context').textContent = `From ${data.label} · ${dateLabel(data.world.month)}`;
    $('branch-name').value = `Scenario ${(data.branches || []).length + 1}`;
    $('branch-dialog').showModal();
    $('branch-name').select();
  } catch (_) { /* mutate displays the server error. */ }
  finally { $('branch-button').disabled = false; }
});
$('branch-cancel').addEventListener('click', () => $('branch-dialog').close());
$('branch-form').addEventListener('submit', event => {
  event.preventDefault();
  const label = $('branch-name').value.trim();
  if (!label || !branchOrigin || $('branch-create').disabled) return;
  if (state.id !== branchOrigin.id || state.world.month !== branchOrigin.month) {
    $('branch-dialog').close(); toast('The city has changed. Open a new scenario from the current moment.', true); return;
  }
  $('branch-create').disabled = true;
  mutate('/api/branch', { month: branchOrigin.month, label }, {
    snap: true,
    onSuccess: data => { $('branch-dialog').close(); toast(`Scenario created: ${data.label}. Ready when you are.`); },
    onFinish: () => { $('branch-create').disabled = false; }
  }).catch(() => {});
});
function setClearView(clear) {
  document.body.classList.toggle('clear-view', clear);
  $('scene-toggle').setAttribute('aria-pressed', String(clear));
  $('scene-toggle').textContent = clear ? 'Show controls' : 'Clear view';
  if (clear) {
    if (drawer) openDrawer(drawer);
    toggleObjectives(false);
    $('help-popover').classList.add('hidden');
    $('help-toggle').setAttribute('aria-expanded', 'false');
  }
}
$('scene-toggle').addEventListener('click', () => setClearView(!document.body.classList.contains('clear-view')));
$('render-style').addEventListener('change', event => city?.setRenderStyle(event.target.value));
$('quality-select').addEventListener('change', event => city?.setQuality(event.target.value));
$('policy-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('policy-input').value.trim();
  if (!text || !state || $('policy-submit').disabled) return;
  const oldEventIds = new Set((state.world.events || []).map(entry => entry.id));
  $('policy-submit').disabled = true;
  $('policy-submit').firstElementChild.textContent = 'Considering…';
  mutate('/api/intervention', { text }, {
    onSuccess: data => {
      const events = (data.world.events || []).filter(entry => !oldEventIds.has(entry.id));
      const result = events.find(entry => ['proposal_unrecognized', 'action_rejected'].includes(entry.type)) || events[events.length - 1];
      if (result?.type === 'proposal_unrecognized' || result?.type === 'action_rejected') {
        toast(`${result.title}: ${result.detail} Your text is kept for editing.`, true);
      } else {
        if ($('policy-input').value.trim() === text) $('policy-input').value = '';
        toast(result ? `${result.title}. ${result.detail || ''}` : `Your proposal is recorded in ${data.label}.`);
      }
    },
    onFinish: () => { $('policy-submit').disabled = false; $('policy-submit').firstElementChild.textContent = 'Set in motion'; }
  }).catch(() => {});
});
for (const button of document.querySelectorAll('[data-proposal]')) button.addEventListener('click', () => {
  $('policy-input').value = button.dataset.proposal;
  $('policy-input').focus();
});
for (const mode of ['rules', 'live']) $(`${mode}-mode`).addEventListener('click', () => {
  if (state?.mode === mode && !(mode === 'live' && state.ai?.status === 'error')) return;
  mutate('/api/mode', { mode }, { onSuccess: () => toast(mode === 'live' ? 'Live AI actors are active. The city clock runs independently.' : 'Rules engine actors are active.') }).catch(() => {});
});
for (const name of ['actors', 'model']) $(`${name}-toggle`).addEventListener('click', () => openDrawer(name));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => openDrawer(button.dataset.close));
$('help-toggle').addEventListener('click', () => workspaceNavigation?.toggle('help'));
$('objectives-toggle').addEventListener('click', () => toggleObjectives());
$('mobile-objectives').addEventListener('click', () => {
  $('help-popover').classList.add('hidden');
  $('help-toggle').setAttribute('aria-expanded', 'false');
  toggleObjectives(true);
});
$('mission-close').addEventListener('click', () => toggleObjectives(false));
for (const district of DISTRICTS) {
  const label = element('button', 'district-label hidden', district.name);
  label.setAttribute('aria-label', `Explore ${district.name}`);
  label.addEventListener('click', () => city?.focusDistrict(district.id));
  $('district-labels').append(label);
  districtLabels.set(district.id, label);
}
$('region-toggle').addEventListener('click', () => {
  const open = $('region-toggle').getAttribute('aria-expanded') !== 'true';
  $('region-toggle').setAttribute('aria-expanded', String(open));
  document.querySelector('.region-panel').classList.toggle('expanded', open);
});
for (const button of document.querySelectorAll('button[data-district]')) button.addEventListener('click', () => {
  city?.focusDistrict(button.dataset.district);
  $('region-toggle').setAttribute('aria-expanded', 'false');
  document.querySelector('.region-panel').classList.remove('expanded');
});
for (const mode of ['overview', 'street']) $(`view-${mode}`).addEventListener('click', () => city?.setView(mode));
for (const light of ['day', 'dusk']) $(`light-${light}`).addEventListener('click', () => {
  city?.setTimeOfDay(light);
  document.body.dataset.lighting = light;
  for (const candidate of ['day', 'dusk']) {
    $(`light-${candidate}`).classList.toggle('active', candidate === light);
    $(`light-${candidate}`).setAttribute('aria-pressed', String(candidate === light));
  }
});
$('recent-change').addEventListener('click', () => {
  if (latestChange?.buildingId) { city?.select(latestChange.buildingId); city?.focus(latestChange.buildingId); }
  else if (latestChange?.districtId) city?.focusDistrict(latestChange.districtId);
});
$('reset-camera').addEventListener('click', () => city?.resetCamera());
$('inspector-close').addEventListener('click', () => city?.select(null));
$('focus-building').addEventListener('click', () => city?.focus(selectedId));
$('backend-object-details').addEventListener('click',()=>{if(selectedId)analysis?.backend.inspect(selectedId).catch(e=>toast(e.message,true));});
$('reset-world').addEventListener('click', () => mutate('/api/reset', {}, { snap: true, onSuccess: () => { city?.select(null); city?.resetCamera(); toast('A new city has begun. Your other timelines are saved.'); } }).catch(() => {}));
const legends = { housing: 'Green · homes   /   Pale · other city places', mobility: 'Gold · transit   /   Teal · workplaces', climate: 'Green · clean energy & parks   /   Terracotta · industry' };
for (const button of document.querySelectorAll('button[data-layer]')) button.addEventListener('click', () => {
  const layer = button.dataset.layer;
  document.body.dataset.layer = layer;
  city?.setLayer(layer);
  for (const candidate of document.querySelectorAll('button[data-layer]')) {
    const active = candidate === button;
    candidate.classList.toggle('active', active);
    candidate.setAttribute('aria-pressed', String(active));
  }
  $('layer-legend').textContent = legends[layer] || '';
  $('layer-legend').classList.toggle('hidden', layer === 'city');
});
document.addEventListener('keydown', event => {
  if ($('branch-dialog').open) return;
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.code === 'Space' && !editing && document.activeElement?.tagName !== 'BUTTON') { event.preventDefault(); togglePlay(); }
  if (event.key === 'Escape') {
    workspaceNavigation?.closeMenus(true);
    setClearView(false);
    if (drawer) openDrawer(drawer);
    toggleObjectives(false);
    $('help-popover').classList.add('hidden');
    $('help-toggle').setAttribute('aria-expanded', 'false');
    city?.select(null);
  }
});

async function startCity() {
  try {
    const { CityView } = await import('./city.js');
    city = new CityView($('city-view'), {
      onViewChange: renderView,
      onDistrictChange: id => { activeDistrict = id; renderDistrict(); },
      onLabels: renderLabels,
      onSelect: building => { selectedId = building?.id || null; renderInspector(); },
      onHover: (building, x, y) => {
        $('building-tooltip').classList.toggle('hidden', !building);
        if (building && !city?.externalMapActive) {
          $('building-tooltip').textContent = `${kinds[building.kind]?.[0] || building.kind} · ${Math.round(building.progress * 100)}% complete`;
          $('building-tooltip').style.left = `${Math.min(window.innerWidth - 220, x + 14)}px`;
          $('building-tooltip').style.top = `${y - 32}px`;
        }
      },
      onQuality: (mode, level) => { $('quality-status').textContent = `${mode === 'auto' ? 'Auto' : 'Selected'} · ${titleCase(level)} detail`; },
      onReady: () => { document.body.dataset.webgl = 'ready'; },
      onError: message => { $('render-error').textContent = message; $('render-error').classList.remove('hidden'); document.body.dataset.webgl = 'error'; }
    });
    portStudy = new PortStudyUI(city, {pause: () => mutate('/api/control', {playing:false}), clearPanels: () => { if(drawer) openDrawer(drawer); toggleObjectives(false); setClearView(false); $('help-popover').classList.add('hidden'); $('help-toggle').setAttribute('aria-expanded','false'); city.select(null); }});
    analysis=new CompactAnalysisUI(city,portStudy,{getState:()=>state,applyState,request:(path,body,timeout)=>body===undefined?request(path,undefined,timeout):mutate(path,body)});portStudy.analysis=analysis;
    analysis.dashboard=new AnalysisDashboard(analysis);
    analysis.plan=new PlanAnalysis(analysis);
    workspaceNavigation=new WorkspaceNavigation(analysis,{clearView:()=>setClearView(false),closeDrawers:()=>{if(drawer)openDrawer(drawer);toggleObjectives(false);}});analysis.navigation=workspaceNavigation;
    renderView('overview');
    document.body.dataset.lighting = 'day';
    if (state) city.update(state.world, state.playing, true);
    await portStudy.open();await analysis.ready;
    await workspaceNavigation.openSandbox();workspaceNavigation.refreshHistory();
  } catch (error) {
    $('render-error').textContent = `The 3D city needs WebGL graphics support. ${error.message}. You can still explore the city history and use policy controls.`;
    $('render-error').classList.remove('hidden');
    document.body.dataset.webgl = 'error';
  }
}
startCity();
poll();
