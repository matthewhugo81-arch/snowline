// Normal maps use these no-op hooks. The winter workspace alone loads and
// registers its optional diagnostics before creating the catalogue or reader.
export const WET_BULB='wet_bulb_temperature_2m';
export let WINTER_ADDITION_KEYS=[];
let implementation={};
export function registerWinterAdditions(api){implementation=api;WINTER_ADDITION_KEYS=api.WINTER_ADDITION_KEYS;}
export const winterHours=key=>implementation.winterHours?.(key)??null;
export const winterPeriodSource=(...args)=>implementation.winterPeriodSource?.(...args)??null;
export const winterVariable=(...args)=>implementation.winterVariable?.(...args)??null;
export const winterAdditionField=(...args)=>implementation.winterAdditionField?.(...args)??null;
export const wetBulbInputs=(...args)=>implementation.wetBulbInputs?.(...args)??null;
