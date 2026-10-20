// Browser fixtures expose internals only in the intercepted test response.
// Keep the hook inside the caught startup scope without production globals.
export const MAP_TEST_HOOK='// SNOWLINE_BROWSER_TEST_HOOK';
export function injectMapTestHook(source,fixture){
 if(source.includes(MAP_TEST_HOOK)){
  if(source.split(MAP_TEST_HOOK).length!==2)throw Error('The map test hook must be unique');
  return source.replace(MAP_TEST_HOOK,MAP_TEST_HOOK+'\n'+fixture);
 }
 if(source.includes('await runMapStartup('))throw Error('Caught map startup is missing its browser test hook');
 // Manual live tests may still read the prior deployed, module-scoped version.
 return source+'\n'+fixture;
}
