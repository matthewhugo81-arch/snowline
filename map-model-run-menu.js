import {UKV_PREVIOUS} from './map-ukv-runs.js?v=20261019-mogreps-uk';
// Decorate native model options only: model IDs and selections stay unchanged.
const runDate = new Intl.DateTimeFormat('en-GB', {day: '2-digit', month: 'short', timeZone: 'UTC'});

export function formatModelRun(meta) {
  const time = typeof meta?.reference_time === 'string' ? Date.parse(meta.reference_time) : NaN;
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const iso = date.toISOString();
  const cycle = iso.slice(14, 16) === '00' ? iso.slice(11, 13) : iso.slice(11, 16).replace(':', '');
  return `${runDate.format(date)} · ${cycle}Z`;
}

export function modelOptionLabel(model, result) {
  const run = formatModelRun(result?.meta);
  const label = run
    ? run + (result.error ? ' · check failed' : result.meta.publicationStatus ? ' · '+result.meta.publicationStatus.label : result.meta.freshnessWarning ? ' · source warning' : result.meta.completed === false ? ' · updating' : '')
    : result?.error ? 'run unavailable' : 'checking…';
  return `${model.name} (${label})`;
}

export function installModelRunMenu({models, loadModel, loadJSON, root = document, refreshMs = 60000, concurrency = 3}) {
  const selects = new Set();
  const knownModels = new Map(models.map(model => [model.id, model]));
  const results = new Map();
  let stopped = false;
  let inFlight = null;
  let timer = null;
  let lastAttempt = 0;

  function attachMenus() {
    for (const id of ['map-model', 'map-model-b', 'map-model-c', 'briefing-model', 'previous-model']) {
      const select = root.getElementById(id);
      if (!select || selects.has(select)) continue;
      selects.add(select);
      select.addEventListener('focus', refreshWhenDue);
      select.addEventListener('pointerdown', refreshWhenDue);
    }
  }
  function render() {
    if (stopped) return;
    attachMenus();
    for (const select of selects) {
      for (const option of select.options) {
        const model = knownModels.get(option.value);
        if (!model) continue;
        const result = results.get(model.id);
        if(model.id===UKV_PREVIOUS)option.disabled=!result?.meta;
        const text = modelOptionLabel(model, result);
        if (option.textContent !== text) option.textContent = text;
        const run = formatModelRun(result?.meta);
        option.title = run
          ? `Published initialization (UTC): ${new Date(result.meta.reference_time).toISOString()}.` +
            (result.error ? ' Latest-run check failed; showing the last verified initialization.' :
              result.meta.completed === false ? ' Forecast hours are still arriving.' : '') +
            (result.meta.sourceWarnings?.length ? ' ' + result.meta.sourceWarnings.join(' ') : '')
          : result?.error ? 'The published run could not be verified. The next check will retry.' : 'Checking published run metadata…';
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => { void refresh(); }, refreshMs);
  }

  async function collect(force) {
    // Metadata only, with a bounded queue. UKV latest/previous run choices
    // share the same verified pair and identical JSON requests within this check.
    const requests = new Map();
    const load = url => {
      if (!requests.has(url)) requests.set(url, Promise.resolve().then(() => loadJSON(url, {force})));
      return requests.get(url);
    };
    let index = 0;
    async function worker() {
      while (!stopped && (!root.hidden || force) && index < models.length) {
        const model = models[index++];
        try {
          const incoming = await loadModel(model.id, load);
          if (!formatModelRun(incoming)) throw new Error('No verified initialization in model metadata');
          const previous = results.get(model.id)?.meta;
          const older = previous && Date.parse(incoming.reference_time) < Date.parse(previous.reference_time);
          let meta = older ? previous : incoming;
          // Do not regress the cycle or completion flag on an out-of-order response.
          if (previous && Date.parse(incoming.reference_time) === Date.parse(previous.reference_time) && previous.completed === true) {
            meta = {...incoming, completed: true};
          }
          if (!stopped) {
            results.set(model.id, {meta, error: older ? 'Feed returned an older initialization' : null});
            root.dispatchEvent?.(new CustomEvent('snowline-model-run-available',{detail:{model:model.id,meta}}));
          }
        } catch (error) {
          if (!stopped) results.set(model.id, {meta: results.get(model.id)?.meta, error: error?.message || 'Run check failed'});
        }
        render();
      }
    }
    await Promise.all(Array.from({length: Math.min(models.length, Math.max(1, concurrency))}, worker));
  }

  function refresh(force = false) {
    if (stopped || !selects.size) return Promise.resolve();
    if (inFlight) return inFlight;
    clearTimeout(timer);
    if (root.hidden && !force) {
      schedule();
      return Promise.resolve();
    }
    lastAttempt = Date.now();
    inFlight = collect(force).finally(() => {
      inFlight = null;
      schedule();
    });
    return inFlight;
  }

  function refreshWhenDue() {
    if (!root.hidden && Date.now() - lastAttempt >= 15000) void refresh();
  }
  const manualRefresh = () => { void refresh(true); };
  const reload = root.getElementById('reload-maps');
  // Briefing is created lazily. Reuse already verified results immediately,
  // rather than opening a second polling loop or waiting for the next minute.
  const menuReady = () => { render(); refreshWhenDue(); };
  const verifiedRun = event => {
    const {model, meta} = event.detail ?? {};
    if (!knownModels.has(model) || !formatModelRun(meta)) return;
    const previous = results.get(model)?.meta;
    if (previous && Date.parse(meta.reference_time) < Date.parse(previous.reference_time)) return;
    const value = previous?.completed === true && Date.parse(meta.reference_time) === Date.parse(previous.reference_time)
      ? {...meta, completed: true} : meta;
    results.set(model, {meta: value, error: null});
    render();
  };
  root.addEventListener('snowline-model-menu-ready', menuReady);
  root.addEventListener('snowline-model-run-verified', verifiedRun);
  root.addEventListener('visibilitychange', refreshWhenDue);
  reload?.addEventListener('click', manualRefresh);
  render();
  void refresh();

  return {
    refresh,
    destroy() {
      stopped = true;
      clearTimeout(timer);
      for (const select of selects) {
        select.removeEventListener('focus', refreshWhenDue);
        select.removeEventListener('pointerdown', refreshWhenDue);
      }
      root.removeEventListener('visibilitychange', refreshWhenDue);
      root.removeEventListener('snowline-model-menu-ready', menuReady);
      root.removeEventListener('snowline-model-run-verified', verifiedRun);
      reload?.removeEventListener('click', manualRefresh);
    }
  };
}
