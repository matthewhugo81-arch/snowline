import test from 'node:test';
import assert from 'node:assert/strict';
import {formatModelRun, modelOptionLabel, installModelRunMenu} from '../map-model-run-menu.js';

const ifs = {id: 'ecmwf_ifs', name: 'IFS 9 km'};
const main = {id: 'ukmo_uk_deterministic_2km', name: 'UKV'};
const nowcast = {id: 'ukmo_uk_deterministic_2km_nowcast', name: 'UKV — latest hourly nowcast'};
const run = (reference_time, completed = true) => ({reference_time, completed});

class Target {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, event = {}) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
}
function dom(models) {
  const root = new Target();
  root.hidden = false;
  const select = () => Object.assign(new Target(), {
    options: models.map(model => ({value: model.id, textContent: model.name, title: ''})),
    value: models[0]?.id
  });
  root.elements = {'map-model': select(), 'map-model-b': select(), 'reload-maps': new Target()};
  root.getElementById = id => root.elements[id] ?? null;
  return root;
}
function setup(t, {models = [ifs], loadModel = async () => run('2026-10-12T00:00:00Z'), loadJSON = async () => ({}), ...options} = {}) {
  const root = options.root ?? dom(models);
  const menu = installModelRunMenu({models, loadModel, loadJSON, root, ...options});
  t.after(() => menu.destroy());
  return {menu, root, first: () => root.elements['map-model'].options[0].textContent};
}

test('formats the initialization date and cycle in UTC, not the forecast valid time or browser zone', () => {
  assert.equal(formatModelRun({...run('2026-10-12T00:00:00Z'), valid_times: ['2026-10-27T00:00:00Z']}), '12 Oct · 00Z');
  assert.equal(formatModelRun(run('2026-10-12T01:00:00+01:00')), '12 Oct · 00Z');
  assert.equal(formatModelRun(run('2026-01-01T00:30:00+01:00')), '31 Dec · 2330Z');
});

test('never invents a cycle from missing or malformed metadata', () => {
  for (const meta of [null, {}, {reference_time: null}, {reference_time: 0}, {reference_time: 'invalid'}]) {
    assert.equal(formatModelRun(meta), null);
  }
  assert.equal(modelOptionLabel(ifs), 'IFS 9 km (checking…)');
  assert.equal(modelOptionLabel(ifs, {error: 'offline'}), 'IFS 9 km (run unavailable)');
});

test('marks an incoming run and a failed refresh without hiding the verified date', () => {
  assert.equal(modelOptionLabel(ifs, {meta: run('2026-10-12T06:00:00Z', false)}), 'IFS 9 km (12 Oct · 06Z · updating)');
  assert.equal(modelOptionLabel(ifs, {meta: run('2026-10-11T18:00:00Z'), error: 'offline'}), 'IFS 9 km (11 Oct · 18Z · check failed)');
});

test('updates all options in both panels without changing names, values, order or selections', async t => {
  const models = [ifs, main, nowcast];
  const references = ['2026-10-12T00:00:00Z', '2026-10-12T03:00:00Z', '2026-10-12T05:00:00Z'];
  const calls = [];
  const {menu, root} = setup(t, {models, loadModel: async id => {
    calls.push(id);
    return run(references[models.findIndex(model => model.id === id)]);
  }});
  const options = [...root.elements['map-model'].options];
  root.elements['map-model-b'].value = nowcast.id;
  await menu.refresh();
  for (const id of ['map-model', 'map-model-b']) {
    assert.deepEqual(root.elements[id].options.map(option => option.value), models.map(model => model.id));
    assert.match(root.elements[id].options[1].textContent, /12 Oct · 03Z/);
    assert.match(root.elements[id].options[2].textContent, /12 Oct · 05Z/);
  }
  assert.equal(root.elements['map-model'].value, ifs.id);
  assert.equal(root.elements['map-model-b'].value, nowcast.id);
  assert.equal(root.elements['map-model'].options[0], options[0]);
  assert.deepEqual(new Set(calls), new Set(models.map(model => model.id)));
});

test('shows a newer published run on refresh and never regresses to a stale cycle', async t => {
  let reference = '2026-10-11T18:00:00Z';
  const {menu, first} = setup(t, {loadModel: async () => run(reference)});
  await menu.refresh();
  assert.match(first(), /11 Oct · 18Z/);
  reference = '2026-10-12T00:00:00Z';
  await menu.refresh();
  assert.equal(first(), 'IFS 9 km (12 Oct · 00Z)');
  reference = '2026-10-11T18:00:00Z';
  await menu.refresh();
  assert.equal(first(), 'IFS 9 km (12 Oct · 00Z · check failed)');
});

test('retains completion within a cycle but marks a newer incomplete cycle as updating', async t => {
  let meta = run('2026-10-12T00:00:00Z');
  const {menu, first} = setup(t, {loadModel: async () => meta});
  await menu.refresh();
  meta = run('2026-10-12T00:00:00Z', false);
  await menu.refresh();
  assert.equal(first(), 'IFS 9 km (12 Oct · 00Z)');
  meta = run('2026-10-12T06:00:00Z', false);
  await menu.refresh();
  assert.match(first(), /06Z · updating/);
});

test('isolates a failing model, retains a last-verified run and clears errors on recovery', async t => {
  let fail = false;
  const {menu, root, first} = setup(t, {models: [ifs, main], loadModel: async id => {
    if (id === main.id || fail) throw new Error('offline');
    return run('2026-10-12T00:00:00Z');
  }});
  await menu.refresh();
  assert.equal(first(), 'IFS 9 km (12 Oct · 00Z)');
  assert.match(root.elements['map-model'].options[1].textContent, /run unavailable/);
  fail = true;
  await menu.refresh();
  assert.match(first(), /00Z · check failed/);
  fail = false;
  await menu.refresh();
  assert.equal(first(), 'IFS 9 km (12 Oct · 00Z)');
});

test('rejects a successful response without a valid reference_time', async t => {
  const {menu, first} = setup(t, {loadModel: async () => ({reference_time: null})});
  await menu.refresh();
  assert.match(first(), /run unavailable/);
});

test('coalesces shared JSON requests per check, refreshing them on the next check', async t => {
  const calls = [];
  const {menu} = setup(t, {models: [main, nowcast],
    loadModel: async (id, load) => { await Promise.all([load('shared/latest.json'), load('shared/in-progress.json')]); return run('2026-10-12T00:00:00Z'); },
    loadJSON: async (url, {force}) => { calls.push({url, force}); return {}; }
  });
  await menu.refresh();
  assert.equal(calls.length, 2);
  await menu.refresh(true);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.slice(2).map(call => call.force), [true, true]);
});

test('bounds background work and coalesces overlapping refreshes', async t => {
  const models = Array.from({length: 8}, (_, i) => ({id: String(i), name: `Model ${i}`}));
  let active = 0, peak = 0, calls = 0;
  const {menu} = setup(t, {models, concurrency: 3, loadModel: async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--; return run('2026-10-12T00:00:00Z');
  }});
  await Promise.all([menu.refresh(), menu.refresh()]);
  assert.equal(calls, 8);
  assert.equal(peak, 3);
});

test('pauses metadata requests in hidden tabs and checks on returning to the page', async t => {
  const root = dom([ifs]); root.hidden = true;
  let calls = 0;
  const {menu} = setup(t, {root, loadModel: async () => { calls++; return run('2026-10-12T00:00:00Z'); }});
  await menu.refresh();
  assert.equal(calls, 0);
  root.hidden = false;
  root.emit('visibilitychange');
  await menu.refresh();
  assert.equal(calls, 1);
});

test('Check latest runs refreshes labels; destroying the menu removes listeners', async t => {
  let calls = 0;
  const {menu, root} = setup(t, {loadModel: async () => { calls++; return run('2026-10-12T00:00:00Z'); }});
  await menu.refresh();
  root.elements['reload-maps'].emit('click');
  await menu.refresh();
  assert.equal(calls, 2);
  menu.destroy();
  root.elements['reload-maps'].emit('click');
  await menu.refresh();
  assert.equal(calls, 2);
  assert.equal(root.elements['map-model'].listeners.get('focus').size, 0);
});


test('a lazily created briefing selector shares verified labels without a second poller', async t => {
  let calls = 0;
  const {menu, root} = setup(t, {models: [ifs, main, nowcast], loadModel: async id => {
    calls++;
    return run(id === main.id ? '2026-10-12T03:00:00Z' : id === nowcast.id ? '2026-10-12T05:00:00Z' : '2026-10-12T00:00:00Z');
  }});
  await menu.refresh();
  const briefing = dom([ifs, main, nowcast]).elements['map-model'];
  briefing.value = nowcast.id;
  root.elements['briefing-model'] = briefing;
  root.emit('snowline-model-menu-ready');
  assert.deepEqual(briefing.options.map(o => o.textContent), root.elements['map-model'].options.map(o => o.textContent));
  assert.equal(briefing.value, nowcast.id);
  assert.equal(calls, 3);
  root.emit('snowline-model-run-verified', {detail: {model: ifs.id, meta: run('2026-10-12T06:00:00Z', false)}});
  for (const id of ['map-model', 'map-model-b', 'briefing-model']) {
    assert.equal(root.elements[id].options[0].textContent, 'IFS 9 km (12 Oct · 06Z · updating)');
  }
  root.emit('snowline-model-run-verified', {detail: {model: ifs.id, meta: run('2026-10-12T00:00:00Z')}});
  assert.match(briefing.options[0].textContent, /06Z/);
  root.emit('snowline-model-menu-ready');
  assert.equal(briefing.listeners.get('focus').size, 1);
  menu.destroy();
  assert.equal(briefing.listeners.get('focus').size, 0);
  assert.equal(root.listeners.get('snowline-model-run-verified').size, 0);
});
