import {MODELS} from './data.js?v=20261010-ukv';
import {UKV,UKV_NOWCAST} from './ukv-run-selection.js?v=20261010-ukv-families';
// Map-only choices: do not duplicate UKV in location-chart multi-model averages.
export const MAP_MODELS = MODELS.flatMap(model => model.id !== UKV ? [model] : [
 {...model, name:'UKV — latest main run', runFamily:'main', sourceModel:UKV},
 {...model, id:UKV_NOWCAST, name:'UKV — latest hourly nowcast', runFamily:'nowcast', sourceModel:UKV}
]);
