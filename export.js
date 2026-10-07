import {finite, valueAt} from './data.js?v=20261007-wind-mph';
import {averageSeries} from './average.js';

export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Fixed thresholds make the same temperature comparable across models and locations.
export const FROST_BANDS = [
  {limit:0, label:'Below 0°C', background:'#e0f2fe', color:'#0c4a6e'},
  {limit:-2, label:'≤ −2°C', background:'#bae6fd', color:'#0c4a6e'},
  {limit:-5, label:'≤ −5°C', background:'#60a5fa', color:'#102235'},
  {limit:-10, label:'≤ −10°C', background:'#1e40af', color:'#ffffff'},
  {limit:-15, label:'≤ −15°C', background:'#6b21a8', color:'#ffffff'}
];

// Display bands for hourly total precipitation, including snow water equivalent.
export const RAIN_BANDS = [
  {limit:0, label:'>0–<0.5', background:'#e8f5e9', color:'#14532d'},
  {limit:0.5, label:'0.5–<2', background:'#bbf7d0', color:'#14532d'},
  {limit:2, label:'2–<5', background:'#4ade80', color:'#143722'},
  {limit:5, label:'5–<10', background:'#15803d', color:'#ffffff'},
  {limit:10, label:'≥10', background:'#14532d', color:'#ffffff'}
];

export function rainBand(value, key){
  if(key !== 'precipitation' || !finite(value) || value <= 0) return null;
  return RAIN_BANDS.findLast(band => value >= band.limit);
}

export function frostBand(value, unit){
  if(unit !== '°C' || !finite(value) || value >= 0) return null;
  return FROST_BANDS.findLast(band => value <= band.limit);
}

export function temperatureAttributes(value, unit){
  return valueAttributes(value, {unit});
}

export function valueAttributes(value, variable, extraClass = '', extraTitle = ''){
  const frost = frostBand(value, variable.unit), rain = rainBand(value, variable.key);
  const band = frost ?? rain;
  const classes = [extraClass, frost ? 'frost-value' : rain ? 'rain-value' : ''].filter(Boolean).join(' ');
  const description = band ? `${value}${frost ? '°C' : ' mm/h'} — ${band.label}${rain ? ' mm/h' : ''}` : '';
  const title = [extraTitle, description].filter(Boolean).join(' · ');
  return [classes ? `class="${escapeHTML(classes)}"` : '', band ? `style="background-color:${band.background};color:${band.color}"` : '', title ? `title="${escapeHTML(title)}"` : ''].filter(Boolean).join(' ');
}

export function frostLegend(){
  return '<div class="frost-legend" aria-label="Sub-zero temperature colour scale"><span>Sub-zero scale</span>' + FROST_BANDS.map(band => `<span class="frost-key" style="background-color:${band.background};color:${band.color}">${band.label}</span>`).join('') + '</div>';
}

export function variableLegend(variable){
  if(variable.unit === '°C') return frostLegend();
  if(variable.key !== 'precipitation') return '';
  return '<div class="frost-legend" aria-label="Hourly precipitation colour scale"><span>Precipitation · mm/h</span>' + RAIN_BANDS.map(band => `<span class="frost-key" style="background-color:${band.background};color:${band.color}">${escapeHTML(band.label)}</span>`).join('') + '<span class="scale-note">Dry / missing: unshaded</span></div>';
}

export function formatValue(value, variable){
  if(!finite(value)) return '—';
  // Do not round a very small negative temperature to zero.
  if(variable.unit === '°C' && value < 0 && value > -0.1) return String(value);
  if(variable.key === 'precipitation' && value > 0 && value < 0.1) return String(Number(value.toPrecision(2)));
  return value.toFixed(['snowfall','precipitation'].includes(variable.key) ? 2 : 1);
}

export function buildDataset({variable, modelDefinitions, models, times, full, location, loading, errors}){
  const columns = modelDefinitions.map(model => ({...model, data:models.get(model.id)}));
  const rowTimes = full ? [...new Set(columns.flatMap(model => model.data?.time ?? []))].sort() : [...times];
  const series = columns.map(model => ({values:rowTimes.map(time => model.data ? valueAt(model.data, variable.key, time) : null)}));
  const averages = averageSeries(series, rowTimes.length);
  const rows = rowTimes.map((time, index) => ({time, values:series.map(model => model.values[index]), average:averages.values[index], averageCount:averages.counts[index]}));
  return {variable, columns, rows, location:{...location}, loading, errors:new Map(errors), full, hasData:rows.some(row => row.values.some(finite))};
}

export function datasetTable(dataset){
  const {variable, columns, rows} = dataset;
  if(!columns.length) return '<p class="dataset-empty">Select at least one model, or choose All models above.</p>';
  if(!rows.length) return '<p class="dataset-empty">No forecast hours available for this selection.</p>';
  return `<table class="forecast-table"><caption>${escapeHTML(variable.title)} (${escapeHTML(variable.unit)}) · hourly model values</caption><thead><tr><th scope="col">Date &amp; time (UTC)</th>${columns.map(model => `<th scope="col">${escapeHTML(model.name)}${model.ensemble ? '<br><small>Ensemble mean</small>' : ''}<br><small>${escapeHTML(variable.unit)}</small></th>`).join('')}<th scope="col" class="average-column">Average<br><small>${escapeHTML(variable.unit)}</small></th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row"><time datetime="${escapeHTML(row.time)}">${escapeHTML(row.time.replace('T',' ').replace(/Z$/, ''))}</time></th>${row.values.map(value => `<td ${valueAttributes(value, variable)}>${formatValue(value, variable)}</td>`).join('')}<td ${valueAttributes(row.average, variable, 'average-column', row.averageCount ? `Mean of ${row.averageCount} available ${row.averageCount === 1 ? 'model' : 'models'}` : 'No available model values')}>${formatValue(row.average, variable)}</td></tr>`).join('')}</tbody></table>`;
}

export function datasetCoverage(dataset){
  return dataset.columns.map(model => {
    const count = dataset.rows.filter(row => finite(valueAt(model.data ?? {}, dataset.variable.key, row.time))).length;
    const retrieved = finite(model.data?.fetchedAt) ? `; retrieved ${new Date(model.data.fetchedAt).toISOString()}` : '';
    const status = count ? `${count} of ${dataset.rows.length} hours${retrieved}` : dataset.errors.get(model.id) ?? (dataset.loading && !model.data ? 'Loading…' : 'No values for this variable and period');
    return `<li><strong>${escapeHTML(model.name)}</strong>: ${escapeHTML(status)}</li>`;
  }).join('');
}

function csvCell(value){
  if(value === null || value === undefined || (typeof value === 'number' && !finite(value))) return '';
  let text = String(value);
  // Only text is guarded; negative forecast numbers remain numeric in spreadsheets.
  if(typeof value === 'string' && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function datasetCSV(dataset){
  const {variable, columns, rows, location} = dataset;
  const header = ['Location','Latitude','Longitude','Time (UTC)',...columns.map(model => `${model.name} — ${variable.title} (${variable.unit})`),`Average — ${variable.title} (${variable.unit})`];
  const values = rows.map(row => [location.name,location.latitude,location.longitude,row.time,...row.values,row.average]);
  return '\ufeff' + [header,...values].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function datasetHTML(dataset){
  const {variable, location, rows, full} = dataset;
  const range = rows.length ? `${rows[0].time} to ${rows.at(-1).time}` : 'No forecast hours';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Snowline · ${escapeHTML(variable.title)}</title><style>body{font:14px system-ui,sans-serif;color:#162b40;margin:24px}h1{font-size:24px}p{line-height:1.6}.table-wrap{overflow:auto}table{border-collapse:collapse;font-variant-numeric:tabular-nums}caption{text-align:left;padding:12px 0;font-weight:bold}th,td{border:1px solid #dbe4ec;padding:9px 12px;white-space:nowrap;text-align:right}th{background:#f3f6fa}th:first-child{text-align:left}.average-column{font-weight:700;background:#edf3f8;border-left:2px solid #8fa4b7}.frost-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0}.frost-key{padding:5px 8px;border-radius:4px}li{margin:6px 0}@media print{.table-wrap{overflow:visible}body{margin:0}th,td,.frost-key{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><h1>${escapeHTML(variable.title)} (${escapeHTML(variable.unit)})</h1><p><strong>${escapeHTML(location.name)}</strong> · ${location.latitude}, ${location.longitude}<br>${escapeHTML(range)} · ${full ? 'Full model dataset' : 'Chart time window'}<br>${escapeHTML(variable.note)}</p><p>A dash means unavailable, never zero. Values are shown at display precision. CSV exports retain the supplied numeric precision. Average is the arithmetic mean of available model values in each row; zeroes are included and missing values are excluded.${dataset.loading ? ' Forecasts were still loading when this table was saved.' : ''}</p>${variableLegend(variable)}<div class="table-wrap">${datasetTable(dataset)}</div><h2>Data availability and retrieval times</h2><ul>${datasetCoverage(dataset)}</ul><p>Weather data: <a href="https://open-meteo.com/">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Exported from Snowline. All times UTC.</p></body></html>`;
}

export function datasetFilename(dataset, extension){
  const place = dataset.location.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'location';
  const model = dataset.columns.length === 1 ? dataset.columns[0].id : 'models';
  const day = dataset.rows[0]?.time.slice(0,10) ?? 'forecast';
  return `snowline-${place}-${dataset.variable.key}-${model}-${day}.${extension}`;
}
