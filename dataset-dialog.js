import {MODELS, VARIABLES} from './data.js';
import {buildDataset, datasetTable, datasetCoverage, datasetCSV, datasetHTML, datasetFilename, variableLegend, escapeHTML} from './export.js?v=20261007-average-rain';

export function createDatasetDialog(state){
  const dialog = document.createElement('dialog');
  dialog.className = 'dataset-dialog';
  dialog.setAttribute('aria-labelledby','dataset-title');
  dialog.setAttribute('aria-describedby','dataset-context');
  dialog.innerHTML = `<div class="dataset-header"><div><p class="eyebrow">FORECAST DATA</p><h2 id="dataset-title"></h2></div><button type="button" class="secondary dataset-close" aria-label="Close forecast data" autofocus>✕</button></div><p id="dataset-context" class="dataset-context"></p><div class="dataset-controls"><label>Models <select id="dataset-model"><option value="selected">Selected chart models</option><option value="all">All models</option>${MODELS.map(model => `<option value="${model.id}">${escapeHTML(model.name)}</option>`).join('')}</select></label><label>Period <select id="dataset-period"><option value="view">Chart time window</option><option value="full">Full model dataset</option></select></label><div class="dataset-downloads"><button type="button" id="download-csv">Download CSV</button><button type="button" class="secondary" id="download-table">Download table</button></div></div><p id="dataset-summary" role="status"></p><p class="dataset-hint">CSV opens in Excel or Google Sheets with the supplied numeric precision. Download table saves a colour-coded HTML table. A dash means unavailable; CSV leaves those cells blank. All times UTC.</p><p class="dataset-hint">Average uses the available model values in each row, including zeroes and excluding missing values. It recalculates for the models shown.</p><div id="dataset-legend"></div><div id="dataset-table" class="table-wrap dataset-table-wrap" tabindex="0" role="region" aria-label="Hourly forecast values"></div><details class="dataset-availability"><summary>Data availability and retrieval times</summary><ul id="dataset-coverage"></ul></details><p class="dataset-credit">Weather data: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></p>`;
  document.body.append(dialog);
  const get = id => dialog.querySelector('#'+id);
  let variable, dataset, opener;

  function render(){
    if(!dialog.open || !variable) return;
    const selection = get('dataset-model').value;
    const modelDefinitions = MODELS.filter(model => selection === 'all' || (selection === 'selected' ? state.selected.has(model.id) : model.id === selection));
    dataset = buildDataset({variable, modelDefinitions, models:state.models, times:state.times.slice(0,state.hours), full:get('dataset-period').value === 'full', location:state.location, loading:state.loading, errors:state.errors});
    get('dataset-title').textContent = variable.title + ' (' + variable.unit + ')';
    get('dataset-context').textContent = `${state.location.name} · ${state.location.latitude.toFixed(4)}, ${state.location.longitude.toFixed(4)} · ${variable.note}`;
    const rows = dataset.rows;
    get('dataset-summary').textContent = `${rows.length} hourly rows · ${dataset.columns.length} ${dataset.columns.length === 1 ? 'model' : 'models'}${rows.length ? ` · ${rows[0].time.replace('T',' ').replace(':00Z',' UTC')} to ${rows.at(-1).time.replace('T',' ').replace(':00Z',' UTC')}` : ''}${state.loading ? ' · Forecasts are still loading; available values update here.' : ''}${!dataset.hasData ? ' · No values available for this selection.' : ''}`;
    get('dataset-legend').innerHTML = variableLegend(variable);
    const table = get('dataset-table'), top = table.scrollTop, left = table.scrollLeft;
    table.innerHTML = datasetTable(dataset);
    table.scrollTop = top; table.scrollLeft = left;
    get('dataset-coverage').innerHTML = datasetCoverage(dataset);
    get('download-csv').disabled = get('download-table').disabled = !dataset.hasData;
  }

  function download(kind){
    // Read the current controls again so a download cannot lag behind a selection change.
    render();
    if(!dataset?.hasData) return;
    const csv = kind === 'csv';
    const blob = new Blob([csv ? datasetCSV(dataset) : datasetHTML(dataset)], {type:csv ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = datasetFilename(dataset, csv ? 'csv' : 'html');
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  dialog.querySelector('.dataset-close').addEventListener('click',() => dialog.close());
  dialog.addEventListener('click',event => {if(event.target === dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
  dialog.addEventListener('close',() => {document.body.classList.remove('dataset-open');opener?.focus();});
  get('dataset-model').addEventListener('change',render);
  get('dataset-period').addEventListener('change',render);
  get('download-csv').addEventListener('click',() => download('csv'));
  get('download-table').addEventListener('click',() => download('html'));
  return {render, close:() => dialog.close(), open(key, button){
    variable = VARIABLES.find(item => item.key === key);
    if(!variable) return;
    opener = button;
    get('dataset-model').value = 'selected'; get('dataset-period').value = 'view';
    get('dataset-table').scrollTop = 0; get('dataset-table').scrollLeft = 0;
    dialog.showModal();document.body.classList.add('dataset-open');render();
  }};
}
