// Native Open-Meteo spatial products. The point Ensemble API exposes more
// variables, but only precipitation_probability is currently published here.
export const MOGREPS_MODELS = [
 {id:'ukmo_global_ensemble_20km',name:'MOGREPS-G 20 km · precipitation probability',ensemble:true,
  ensembleNote:'MOGREPS-G uses 18 members from this run. This is the chance of precipitation of any type, not a snow probability.'},
 {id:'ukmo_uk_ensemble_2km',name:'MOGREPS-UK 2 km · precipitation probability',ensemble:true,regional:true,
  ensembleNote:'MOGREPS-UK uses only 3 members from this hourly run: native-grid probabilities are 0, 33, 67 or 100%. This is the chance of precipitation of any type, not a snow probability.'}
];
