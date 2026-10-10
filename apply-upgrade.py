from pathlib import Path
import re
root=Path('.')
s=(root/'maps.js').read_text()
def replace(old,new,count=1):
 global s
 n=s.count(old)
 if n!=count: raise RuntimeError(f'Expected {count} matches, found {n}: {old[:100]}')
 s=s.replace(old,new)
replace("./map-frames.js?v=20261009-loading", "./map-frames.js?v=20261010-buffered-playback")
replace("import {ForecastFrames,frameWindow} from './map-frames.js?v=20261010-buffered-playback';", "import {ForecastFrames,frameWindow} from './map-frames.js?v=20261010-buffered-playback';\nimport {ForecastPlayback} from './map-playback.js?v=20261010-buffered-playback';\nimport {overlayGroups} from './map-overlay-specs.js?v=20261010-buffered-playback';")
replace("maxZoom:10,renderWorldCopies:false", "maxZoom:10,fadeDuration:0,renderWorldCopies:false")
replace("map.on('dataloading',viewportBounds);", '')
replace("map.on('movestart',()=>{panel.frameCache?.suspend(panel.requestedURL);clearGridValues(panel);});", "map.on('movestart',()=>{pauseAnimation();panel.frameCache?.suspend(panel.requestedURL);clearGridValues(panel);});")
replace("scheduleGridValues(panel);});map.on('movestart'", "scheduleGridValues(panel);queueViewportRefresh();});map.on('movestart'")
replace("new ResizeObserver(()=>map.resize()).observe($('map-'+key));", "let lastSize='';new ResizeObserver(entries=>{const r=entries[0].contentRect,size=Math.round(r.width)+'x'+Math.round(r.height);if(size!==lastSize){lastSize=size;map.resize();}}).observe($('map-'+key));")
replace("map.on('style.load',()=>{applyRoads(map);drawTerrain(map);", "map.on('style.load',()=>{panel.styleOrdered=false;applyRoads(map);drawTerrain(map);")
replace("function viewportBounds(){", "let viewportRefreshTimer;\nfunction queueViewportRefresh(){clearTimeout(viewportRefreshTimer);viewportRefreshTimer=setTimeout(()=>{if(state.times.length&&!playing)setTime();},120);}\nfunction viewportBounds(){")
start=s.index('function clearContours(');end=s.index('function pressureNote()',start)
s=s[:start]+s[end:]
start=s.index('function drawPressure(');end=s.index('function drawCoastline(',start)
s=s[:start]+s[end:]
start=s.index('let playing=false,playTimer=null,timeGeneration=0;');end=s.index('function setLegend()',start)
s=s[:start]+(root/'engine-replacement.txt').read_text()+s[end:]
s=re.sub(r'clearPressure\((p|panel)\);clearContours\(\1\);','',s)
replace("if(!note.hidden)note.textContent='Grid values loading…';", "if(!note.hidden)note.textContent=playing?'Grid values resume when playback is paused.':'Grid values loading…';")
replace("if(!state.overlays[panel.key].grid||panel.restyling)return;", "if(!panel||playing||!state.overlays[panel.key].grid||panel.restyling)return;")
replace("if(!state.overlays[panel.key].grid||!panel.loaded||panel.restyling||panel.displayedTime!==state.times[state.index])return;", "if(playing||!state.overlays[panel.key].grid||!panel.loaded||panel.restyling||panel.displayedTime!==state.times[state.index])return;")
replace("  el('legend-title').textContent=displayUnit(f);", "  if(panels[key].legendField!==field){\n  panels[key].legendField=field;\n  el('legend-title').textContent=displayUnit(f);")
replace("  let note=f.note,interval='';", "  }\n  let note=f.note,interval='';")
replace("idx=times.indexOf(state.times[state.index]);", "idx=times.findIndex(t=>Date.parse(t)===Date.parse(state.times[state.index]));")
replace("if(state.times.length)$('map-time-label').textContent=stamp(state.times[Number(e.target.value)]);", "pauseAnimation();if(state.times.length)$('animation-status').textContent='Preview '+stamp(state.times[Number(e.target.value)])+' UTC · release to load';")
start=s.index('function updateContourVisibility(');end=s.index("$('map-terrain').addEventListener",start)
s=s[:start]+'''for(const key of ['a','b']){
 for(const [control,setting]of [['contours','contours'],['mslp','isobars']]){
  $('map-'+control+'-'+key).addEventListener('change',event=>{pauseAnimation();state.overlays[key][setting]=event.target.checked;setTime();});
 }
 $('map-grid-'+key).addEventListener('change',event=>{state.overlays[key].grid=event.target.checked;const panel=panels[key];if(panel){clearGridValues(panel);scheduleGridValues(panel);}});
}
'''+s[end:]
start=s.index("$('play-map').addEventListener('click'");end=s.index("window.addEventListener('pagehide'",start)
s=s[:start]+'''$('play-map').addEventListener('click',()=>{
 if(playing){pauseAnimation();$('animation-status').textContent='Paused';return;}
 if(!state.times.length)return;
 for(const {key}of panelSelections(state))clearGridValues(panels[key]);
 playback.start();
});
'''+s[end:]
replace("  const prepared=await prepareSelection(index,valid);", "  viewportBounds();\n  const prepared=await prepareSelection(index,valid);")
replace("if(event.sourceId===panel.sourceId&&event.isSourceLoaded)", "if(event.sourceId===panel.sourceId&&event.isSourceLoaded&&panel.frameCache?.current?.loaded)")
(root/'maps.js').write_text(s)
h=(root/'maps.html').read_text()
h=h.replace('maps.js?v=20261010-latest-cycles','maps.js?v=20261010-buffered-playback')
h=h.replace('maps.css?v=20261009-portrait','maps.css?v=20261010-buffered-playback')
needle='<details class="control-details"><summary>Map appearance</summary>'
assert h.count(needle)==1
h=h.replace(needle,'<label for="map-playback-speed">Playback speed</label><select id="map-playback-speed"><option value="1200">Slow · 1.2 s per frame</option><option value="700" selected>Normal · 0.7 s per frame</option><option value="400">Fast · 0.4 s per frame</option></select><p class="small-note">Playback buffers complete native forecast frames. Grid values return when paused; forecast times are never blended.</p>'+needle)
(root/'maps.html').write_text(h)
with (root/'maps.css').open('a') as f:f.write('\n/* Keep playback controls steady as loading messages and dates change. */\n#animation-status{height:1.5em;min-height:1.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.time-heading>div{min-width:180px;font-variant-numeric:tabular-nums;text-align:center}\n.map-panel-label{font-variant-numeric:tabular-nums}\n@media(max-width:370px){.time-heading{gap:5px}.time-heading>div{min-width:155px}.time-heading strong{font-size:12px}}\n')
with (root/'README.md').open('a') as f:f.write('''\n\n## Buffered map playback\nWeather rasters and enabled contour/MSLP overlays are prepared as complete, cycle-specific frames. Playback buffers two upcoming frames before starting; a bounded rolling cache retains nearby frames for backwards/forwards analysis without cancelling useful in-flight downloads. Both comparison panels commit the same valid time together. Basemap ordering and colour-legend DOM are reused rather than rebuilt each hour. Playback speeds are 1.2, 0.7 and 0.4 seconds per native forecast frame. Missing frames stop playback rather than being skipped. While waiting, an existing image retains its own valid-time label. No cross-fades or temporal interpolation are used. Grid-value labels resume when playback is paused to avoid competing with image/overlay decoding. Forecast availability and upstream network speed still constrain loading.\n''')
(root/'tests/map-integration.test.mjs').write_text('''import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {readFileSync} from 'node:fs';\nconst source=readFileSync(new URL('../maps.js',import.meta.url),'utf8');\ntest('map integration has one buffered playback and no late overlay rebuilding',()=>{\n assert.match(source,/new ForecastPlayback/);\n assert.match(source,/decorate:url=>overlayGroups/);\n assert.doesNotMatch(source,/function drawPanel|function nextAnimation|function drawPressure|function drawContours/);\n assert.doesNotMatch(source,/clearPressure\\(|clearContours\\(/);\n assert.match(source,/syncTimeline\\(index\\);setLegend\\(\\);pressureNote\\(\\)/);\n assert.match(source,/legendField!==field/);\n});\n''')
