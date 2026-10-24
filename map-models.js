import {MODELS} from './data.js?v=20261024-loading-verified1';
import {UKV} from './ukv-run-selection.js?v=20261011-live-runs';
import {UKV_PREVIOUS} from './map-ukv-runs.js?v=20261024-rain-colours1';
import {MOGREPS_MODELS} from './map-mogreps.js?v=20261022-attribution';
// One UKV choice: 00/03/06/...Z main cycles; all hourly valid steps retained.
// Probability products are explicitly labelled and retain percentage units.
// Point-only ensemble feeds have separate, already-published spatial products below.
export const MAP_MODELS = [...MODELS.filter(model=>model.api==='forecast').map(model => model.id === UKV ?
 {...model,name:'UKV',runFamily:'main',sourceModel:UKV} : model),
 {id:'snowline_gefs_ensemble',name:'GEFS 0.5°',ensemble:true},
 {id:'snowline_ecmwf_ensemble',name:'ECMWF ENS 0.25°',ensemble:true},
 {id:'snowline_mogreps_global',name:'MOGREPS-G 20 km',ensemble:true},
 ...MOGREPS_MODELS
];
// Menus expose two runs of the same UKV model. The operational catalogue and
// location charts still contain exactly one UKV model.
export const MAP_RUN_CHOICES=MAP_MODELS.flatMap(model=>model.id===UKV?
 [{...model,name:'UKV · latest'},{...model,id:UKV_PREVIOUS,name:'UKV · previous completed',runRole:'previous'}]:[model]);
