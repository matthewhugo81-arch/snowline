from pathlib import Path

def edit(file,old,new):
 p=Path(file);s=p.read_text();assert s.count(old)==1,(file,s.count(old),old[:80]);p.write_text(s.replace(old,new))

edit('map-previous-runs.js','</p></div><button type="button" class="secondary" id="previous-close">Back to maps</button></div>','</p></div><div class="briefing-heading-actions"><button type="button" class="secondary" id="previous-toggle-controls" aria-expanded="true" aria-controls="previous-control-section">Hide controls</button><button type="button" class="secondary" id="previous-close">Back to maps</button></div></div>')
edit('map-previous-runs.js',' <div class="previous-controls">',' <div id="previous-control-section"><div class="previous-controls">')
edit('map-previous-runs.js',' <p id="previous-new" class="previous-notice" hidden>A newer run is available. Your comparison is unchanged. Use Load latest three runs to update it.</p>\n','')
edit('map-previous-runs.js',' <p id="previous-note" class="small-note"></p><div id="previous-legend" class="briefing-legend"></div>',' <p id="previous-note" class="small-note"></p></div>\n <p id="previous-new" class="previous-notice" hidden>A newer run is available. Your comparison is unchanged. Show controls and use Load latest three runs to update it.</p>\n <div id="previous-legend" class="briefing-legend"></div>')
edit('map-previous-runs.js'," $('close').addEventListener('click',onClose);", " $('toggle-controls').addEventListener('click',()=>{\n  const hidden=!$('control-section').hidden;$('control-section').hidden=hidden;\n  for(const c of cards)c.select.closest('.previous-run-label').hidden=hidden;\n  $('toggle-controls').textContent=hidden?'Show controls':'Hide controls';\n  $('toggle-controls').setAttribute('aria-expanded',String(!hidden));\n });\n $('close').addEventListener('click',onClose);")
edit('map-previous-runs.js',"c.button.replaceChildren('Preparing this run…');c.button.disabled=true;", "c.button.replaceChildren(accumulationHours(p.field)?'Queued · waiting to prepare this total…':'Preparing this run…');c.button.disabled=true;")
edit('map-previous-runs.js',"try{const src=await renderer.render({...opts,meta:item.meta,time,signal});", "try{const src=await renderer.render({...opts,meta:item.meta,time,signal,onProgress:({done,total})=>{\n     if(signal.aborted)return;item.c.button.textContent=done<total?'Preparing '+accumulationHours(p.field)+' h total · '+done+'/'+total+' native intervals':'Drawing map and grid values…';\n    }});")
p=Path('map-previous-runs.css');p.write_text(p.read_text()+'\n/* Collapse settings without changing chart extent, run identity or forecast time. */\n#previous-control-section[hidden],.previous-run-label[hidden]{display:none!important}\n')
edit('map-briefing-renderer.js','import {hasFieldTime}', 'import {hasFieldTime,fieldDataURL}')
edit('map-briefing-renderer.js','  installAccumulations(OM,this.settings);','  this.accumulations=installAccumulations(OM,this.settings);')
edit('map-briefing-renderer.js','time,signal,overlays={}}){','time,signal,overlays={},onProgress}){')
edit('map-briefing-renderer.js',"  try{\n   const frame=await frames.acquire", "  const dataURL=fieldDataURL(meta,preset.field,time);\n  const unsubscribe=onProgress&&accumulationHours(preset.field)?this.accumulations.subscribe(update=>{if(!signal.aborted&&update.url===dataURL&&update.key===preset.field)onProgress(update);}):null;\n  try{\n   const frame=await frames.acquire")
edit('map-briefing-renderer.js',"  }finally{signal.removeEventListener('abort',cancel);frames.clear();}","  }finally{unsubscribe?.();signal.removeEventListener('abort',cancel);frames.clear();}")
for f,dep in [('maps.js','map-accumulation-reader.js'),('map-briefing-renderer.js','map-accumulation-reader.js'),('map-briefing.js','map-briefing-renderer.js'),('map-previous-runs.js','map-briefing-renderer.js'),('map-briefing.js','map-previous-runs.js'),('maps.js','map-briefing.js'),('maps.html','maps.js'),('maps.html','map-previous-runs.css')]:
 p=Path(f);s=p.read_text();old=dep+'?v=20261012-accum-history';assert old in s,(f,dep);p.write_text(s.replace(old,dep+'?v=20261012-accum-speed'))
p=Path('tests/accumulation-history-browser.mjs');s=p.read_text();match='   const initial=await page.locator';i=s.index(match);s=s[:i]+'''   const savedImages=await page.locator('#previous-grid img').evaluateAll(imgs=>imgs.map(i=>i.src));
   const savedControls=await page.locator('#previous-control-section select').evaluateAll(ss=>ss.map(s=>s.value));
   await page.locator('#previous-toggle-controls').click();
   assert.equal(await page.locator('#previous-control-section').isVisible(),false);
   assert.equal(await page.locator('#previous-toggle-controls').textContent(),'Show controls');
   assert.equal(await page.locator('#previous-toggle-controls').getAttribute('aria-expanded'),'false');
   assert.equal(await page.locator('#previous-grid .previous-run-label:visible').count(),0);
   assert.equal(await page.locator('#previous-grid h3:visible').count(),3);
   assert.equal(await page.locator('#previous-legend').isVisible(),true);
   assert.equal(await page.locator('#previous-forward').isVisible(),true);
   assert.deepEqual(await page.locator('#previous-grid img').evaluateAll(imgs=>imgs.map(i=>i.src)),savedImages,'Hiding settings must not rerender charts');
   await page.screenshot({path:`review-output/previous-controls-hidden-${viewport.width}.png`,fullPage:true});
   await page.locator('#previous-toggle-controls').click();
   assert.equal(await page.locator('#previous-control-section').isVisible(),true);
   assert.equal(await page.locator('#previous-toggle-controls').getAttribute('aria-expanded'),'true');
   assert.deepEqual(await page.locator('#previous-control-section select').evaluateAll(ss=>ss.map(s=>s.value)),savedControls);
''' +s[i:];p.write_text(s)
