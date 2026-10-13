from pathlib import Path
import re

def edit(path,old,new,count=1):
 p=Path(path);s=p.read_text()
 if s.count(old)!=count:raise ValueError(f'{path}: expected {count} matches, found {s.count(old)}: {old[:100]}')
 p.write_text(s.replace(old,new))

Path('map-models.js').write_text("""import {MODELS} from './data.js?v=20261010-ukv';
import {UKV} from './ukv-run-selection.js?v=20261011-live-runs';
// One UKV choice: 00/03/06/...Z main cycles; all hourly valid steps retained.
// Probability-only feeds are excluded, not relabelled as rainfall amounts.
export const MAP_MODELS = [...MODELS.map(model => model.id === UKV ?
 {...model,name:'UKV',runFamily:'main',sourceModel:UKV} : model),
 {id:'snowline_gefs_ensemble',name:'GEFS 0.5° · mean & spread',ensemble:true},
 {id:'snowline_ecmwf_ensemble',name:'ECMWF ENS 0.25° · mean & spread',ensemble:true}
];
""")
for p in [*Path('.').glob('map*.js'),Path('maps.html')]:
 s=p.read_text();s=re.sub(r'(map-models|map-sources|map-model-run-menu|map-ensemble)\.js\?v=[A-Za-z0-9-]+',r'\1.js?v=20261013-operational-feeds',s)
 if p.name=='maps.html':s=re.sub(r'src="maps\.js\?v=[^\"]+"','src="maps.js?v=20261013-operational-feeds"',s)
 p.write_text(s)
edit('maps.html','Newest published initialization per model or UKV group (UTC), including runs still arriving. UKV main runs and hourly nowcasts are separate; each map shows its own cycle.','Newest published initialization per model (UTC), including runs still arriving. UKV uses only 00, 03, 06, 09, 12, 15, 18 and 21Z main runs; every available hourly forecast step is retained.')
edit('maps.html','GEFS and ECMWF ENS offer precipitation probability, plus separate mean &amp; spread choices for','GEFS and ECMWF ENS provide official mean &amp; spread fields for')
edit('maps.js','Newest published cycle in each selected group: ','Newest published cycle for each selected model: ')
edit('maps.js',"if(MODELS.some(m=>m.id===params.get('model')))state.model=params.get('model');","if(params.get('model')==='ukmo_uk_deterministic_2km_nowcast')params.set('model','ukmo_uk_deterministic_2km');\nif(MODELS.some(m=>m.id===params.get('model')))state.model=params.get('model');")
p=Path('map-ensemble.js');p.write_text(p.read_text()+"""
// Publication health never changes the initialization time of actual pixels.
export function ensembleFreshnessWarning(meta,health,now=Date.now()){
 const checked=Date.parse(health?.checked_at),row=health?.models?.find(r=>r.model===meta?.domain);
 if(Number.isFinite(checked)&&now-checked>45*60000)return 'Ensemble publication check overdue';
 if(row?.status==='check-failed')return 'Official ensemble source check failed; showing verified data';
 if(row?.source_reference&&Date.parse(row.source_reference)>Date.parse(meta?.reference_time))return 'Newer official ensemble run awaits publication';
 const age=now-Date.parse(meta?.reference_time),limit=meta?.domain==='snowline_gefs_ensemble'?12:20;
 if(age>limit*3600000)return 'Ensemble initialization age exceeds the '+limit+' h review threshold';
 return null;
}
""")
edit('map-sources.js','import {ENSEMBLE_DOMAINS}','import {ENSEMBLE_DOMAINS,ensembleFreshnessWarning}')
edit('map-sources.js',"ownEnsembles.has(domain)?['latest.json']:['latest.json','in-progress.json']","ownEnsembles.has(domain)?['latest.json','../health.json']:['latest.json','in-progress.json']")
edit('map-sources.js',"if(ownEnsembles.has(domain)&&Date.now()-Date.parse(primary.reference_time)>36*3600000)warnings.push('Ensemble run is over 36 hours old. Checking for newer published hours.');","const freshnessWarning=ownEnsembles.has(domain)?ensembleFreshnessWarning(primary,results[1]?.status==='fulfilled'?results[1].value:null):null;\n if(freshnessWarning)warnings.push(freshnessWarning);")
edit('map-sources.js',"return {...combineSources(primary,other.filter(Boolean)),sourceWarnings:warnings};\n}\n\n// Deliberate","return {...combineSources(primary,other.filter(Boolean)),sourceWarnings:warnings,freshnessWarning};\n}\n\n// Deliberate")
edit('map-model-run-menu.js',"result.error ? ' · check failed' : result.meta.completed === false ? ' · updating' : ''","result.error ? ' · check failed' : result.meta.freshnessWarning ? ' · refresh overdue' : result.meta.completed === false ? ' · updating' : ''")
edit('scripts/check_map_feeds.mjs',"const models=MAP_MODELS.filter(m=>!m.id.startsWith('snowline_')),results=[];let index=0;","const models=MAP_MODELS,results=[];let index=0;")
edit('scripts/check_map_feeds.mjs','async function get(url){',"const deployed=url=>url.startsWith('file:')&&url.includes('/ensemble-data/')?'https://matthewhugo81-arch.github.io/snowline/ensemble-data/'+url.split('/ensemble-data/')[1]:url;\nasync function get(url){\n url=deployed(url);")
edit('scripts/check_map_feeds.mjs',"url=fieldDataURL(meta,'precipitation',end);if(!url)return null;","raw=fieldDataURL(meta,meta.domain?.startsWith('snowline_')?'pressure_msl_mean':'precipitation',end);if(!raw)return null;const url=deployed(raw)+(meta.domain?.startsWith('snowline_')?'.png':'');")
edit('scripts/check_map_feeds.mjs',"if(meta.variables.includes('precipitation'))","if(meta.variables.includes('precipitation')||meta.variables.includes('pressure_msl_mean'))")
edit('tests/ukv-map-integration.test.mjs','MAP_MODELS.filter(m=>m.id.startsWith(UKV)).length,2','MAP_MODELS.filter(m=>m.id.startsWith(UKV)).length,1')
edit('tests/ukv-map-integration.test.mjs',"assert.equal(MAP_MODELS.find(m=>m.id===UKV_NOWCAST).name,'UKV — latest hourly nowcast');","assert.equal(MAP_MODELS.some(m=>m.id===UKV_NOWCAST),false);")
edit('tests/ensemble-map-integration.test.mjs','assert.equal(MAP_MODELS.find(m=>m.id===id)?.ensemble,true);',"assert.equal(MAP_MODELS.some(m=>m.id===id),false,'Probability-only products must not be offered or polled by the map menu');")
edit('tests/map-interval.test.mjs',"assert.ok(regional.some(model=>model.id==='ukmo_uk_deterministic_2km_nowcast'));","assert.equal(regional.some(model=>model.id==='ukmo_uk_deterministic_2km_nowcast'),false);\n assert.ok(regional.some(model=>model.id==='ukmo_uk_deterministic_2km'));")
for p in Path('tests').glob('*'):
 if p.suffix in ['.mjs','.py']:p.write_text(p.read_text().replace('UKV — latest main run','UKV').replace('two map UKV choices do not duplicate','one map UKV choice does not duplicate'))
p=Path('tests/map-browser.mjs');s=p.read_text()
a=s.index("   await page.locator('#map-model-b').selectOption(nowcast);");b=s.index('   // Playback must wrap both panels',a)
s=s[:a]+"""   assert.deepEqual(await page.locator('#map-model option').evaluateAll(os=>os.filter(o=>o.value.startsWith('ukmo_uk_deterministic_2km')).map(o=>o.value)),[main]);
   assert.equal(await page.locator('#map-model-b option[value="'+nowcast+'"]').count(),0);
   await page.locator('#map-model-b').selectOption(main);
   await page.waitForFunction(()=>document.getElementById('panel-label-b').textContent.includes('0600Z'));
"""+s[b:]
a=s.index('   // Ensembles auto-select only their supplied layer');b=s.index("   await page.locator('#map-model').selectOption('snowline_gefs_ensemble');",a)
s=s[:a]+"""   // Removed menu products must also stop their metadata polling. Existing
   // mean/spread layer, buffering and comparison tests continue below.
   const ensembleOptions=await page.locator('#map-model optgroup[label="Ensemble models"] option').evaluateAll(os=>os.map(o=>o.value));
   for(const id of Object.keys(ensembleFixtures))assert.equal(ensembleOptions.includes(id),false);
   assert.ok(ensembleOptions.includes('ncep_hgefs025_ensemble_mean'));
   assert.ok(ensembleOptions.includes('snowline_gefs_ensemble'));
   assert.ok(ensembleOptions.includes('snowline_ecmwf_ensemble'));
   assert.equal(metadata.some(url=>/\\/(ncep_gefs025|ncep_gefs05|ecmwf_ifs025_ensemble)\\//.test(url)),false,'Removed feeds are not polled');
   await page.locator('#compare-maps').evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
"""+s[b:]
s=s.replace('for(const selectedModel of [main,nowcast])','for(const selectedModel of [main])');p.write_text(s)
print('Single UKV choice, probability-only feed removal, and ensemble publication health applied. Native grids and hourly valid steps are unchanged.')
