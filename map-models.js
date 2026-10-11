import {MODELS} from './data.js?v=20261010-ukv';
import {UKV,UKV_NOWCAST} from './ukv-run-selection.js?v=20261010-ukv-families';
// Spatial-only choices must not become point-API IDs or duplicate chart averages.
export const MAP_MODELS = [...MODELS.flatMap(model => model.id !== UKV ? [model] : [
 {...model, name:'UKV — latest main run', runFamily:'main', sourceModel:UKV},
 {...model, id:UKV_NOWCAST, name:'UKV — latest hourly nowcast', runFamily:'nowcast', sourceModel:UKV}
]),
 {id:'ncep_gefs025',name:'GEFS 0.25°',ensemble:true},
 {id:'ncep_gefs05',name:'GEFS 0.5° — extended range',ensemble:true},
 {id:'ecmwf_ifs025_ensemble',name:'ECMWF ENS 0.25° · precipitation probability',ensemble:true},
 {id:'snowline_gefs_ensemble',name:'GEFS 0.5° · mean & spread',ensemble:true},
 {id:'snowline_ecmwf_ensemble',name:'ECMWF ENS 0.25° · mean & spread',ensemble:true}
];
