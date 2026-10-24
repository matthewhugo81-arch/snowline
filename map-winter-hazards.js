import {WINTER_ADDITION_KEYS} from './map-winter-additions.js';
// Explicit allow-list: new general-purpose layers never leak into this workspace.
export const WINTER_FIELDS = new Set([
 ...WINTER_ADDITION_KEYS,'visibility','cloud_cover_2m',
 'temperature_2m','temperature_2m_min','surface_temperature',
 'soil_temperature_0cm','soil_temperature_0_to_7cm','soil_temperature_0_to_10cm','dew_point_2m',
 'snowfall_water_equivalent','snow_depth','snow_depth_water_equivalent',
 'snowfall_probability','freezing_level_height','snowfall_height',
 'ukv_precipitation_type','native_precipitation_type_intensity',
 'temperature_850hPa','wet_bulb_potential_temperature_850hPa',
 'theta_w_precipitation_symbols',
 'temperature_2m_mean','temperature_2m_spread',
 'temperature_850hPa_mean','temperature_850hPa_spread',
 'dew_point_2m_mean','dew_point_2m_spread','snow_depth_mean','snow_depth_spread',
 'snowfall_water_equivalent_mean','snowfall_water_equivalent_spread'
]);
export function isWinterField(field){
 const key=typeof field==='string'?field:field.key;
 return WINTER_FIELDS.has(key)||/^ens_temperature_le(?:0|m2|m5|m10)c_24h$/.test(key)||
 /^ens_snow_ge(?:0p1|1|5|10)mm_(?:6|12|24)h$/.test(key)||
 /^ens_snow_occurrence_(?:6|12|24)h$/.test(key);
}
export const WINTER_DEFAULTS={compare:true,comparisonCount:3,
 model:'ukmo_uk_deterministic_2km',field:'surface_temperature',
 modelB:'icon_global',fieldB:'snowfall_water_equivalent',
 modelC:'ukmo_uk_ensemble_2km',fieldC:'ens_temperature_le0c_24h'};
