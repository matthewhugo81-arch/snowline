import {MODELS} from './data.js?v=20261010-ukv';
import {UKV} from './ukv-run-selection.js?v=20261011-live-runs';
// One UKV choice: 00/03/06/...Z main cycles; all hourly valid steps retained.
// Probability-only feeds are excluded, not relabelled as rainfall amounts.
export const MAP_MODELS = [...MODELS.map(model => model.id === UKV ?
 {...model,name:'UKV',runFamily:'main',sourceModel:UKV} : model),
 {id:'snowline_gefs_ensemble',name:'GEFS 0.5° · mean & spread',ensemble:true},
 {id:'snowline_ecmwf_ensemble',name:'ECMWF ENS 0.25° · mean & spread',ensemble:true}
];
