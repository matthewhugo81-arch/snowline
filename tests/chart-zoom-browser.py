"""Offline browser regression checks. Run: python tests/chart-zoom-browser.py.
Requires Python Playwright and a Chromium executable (CHROMIUM_PATH optional).
All forecast responses are deterministic fixtures, not operational weather data.
"""
import csv
import io
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RESULTS = []

def check(name, condition):
    assert condition, name
    RESULTS.append(name)

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or None, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':1440,'height':1080}, accept_downloads=True)
        page = context.new_page()
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (ROOT/'index.html').read_text(encoding='utf-8'), flags=re.S)
        css=re.sub(r"@import[^\n]*\n", '', (ROOT/'styles.css').read_text(encoding='utf-8')) + (ROOT/'chart-zoom.css').read_text(encoding='utf-8')
        page.set_content(html)
        page.add_style_tag(content=css)
        sources={name:(ROOT/name).read_text(encoding='utf-8') for name in ['app.js','data.js','average.js','cache.js','export.js','dataset-dialog.js','chart-window.js','chart-zoom.js','chart-panels.js']}
        sources['app.js'] += '\nwindow.__inspectionMilliseconds=[];const measuredInspection=renderInspection;renderInspection=function(){const start=performance.now();try{return measuredInspection();}finally{window.__inspectionMilliseconds.push(performance.now()-start);}};'
        page.evaluate(r'''async (sources)=>{
          Date.now=()=>Date.UTC(2026,9,12,19);
          window.__forecastRequests=[];
          window.fetch=async url=>{
            if(url.includes('/v1/elevation?')) return new Response(JSON.stringify({elevation:[200]}));
            if(!url.includes('/v1/forecast?')) throw Error('Unexpected external request: '+url);
            window.__forecastRequests.push(url);
            const start=Math.floor(Date.now()/3600000)*3600000;
            const time=Array.from({length:192},(_,i)=>new Date(start+i*3600000).toISOString());
            const keys=['snowfall','snow_depth','temperature_2m','dew_point_2m','temperature_850hPa','precipitation','soil_temperature_0cm','relative_humidity_2m','cloud_cover','wind_speed_10m','wind_gusts_10m'];
            const hourly={time},hourly_units={};
            for(const key of keys){hourly[key]=time.map((_,i)=>key==='snowfall'?i/100:key==='snow_depth'?0:key==='cloud_cover'||key==='relative_humidity_2m'?50:key==='precipitation'?i/10:i/10-4);hourly_units[key]=key.includes('wind_')?'mph':key==='snow_depth'?'cm':'°C';}
            if(new URL(url).searchParams.get('models')==='gfs_global')hourly.temperature_2m[80]=null;
            return new Response(JSON.stringify({hourly,hourly_units,latitude:54,longitude:-2,elevation:200}));
          };
          const urls=new Map();
          function moduleURL(spec){
            if(urls.has(spec))return urls.get(spec);
            const name=spec.replace(/^\.\//,'').split('?')[0];
            if(!sources[name])throw Error('Missing local module '+name);
            const source=sources[name].replace(/from ['"](\.\/[^'"]+)['"]/g,(_,dep)=>`from '${moduleURL(dep)}'`);
            const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
            urls.set(spec,url);return url;
          }
          await import(moduleURL('app.js'));
        }''',sources)
        page.wait_for_function("document.querySelector('#refresh').disabled === false && document.querySelectorAll('.plot svg').length === 12")
        check('All eleven variable charts and agreement chart load', page.locator('.plot svg').count()==12)
        initial_requests=page.evaluate('window.__forecastRequests.length')
        expected_order=['snowfall','snow_depth','temperature_2m','dew_point_2m','precipitation','cloud_cover','wind_speed_10m','wind_gusts_10m','relative_humidity_2m','soil_temperature_0cm','temperature_850hPa']
        check('Panels follow the requested reading order',page.locator('#charts .plot').evaluate_all("els=>els.map(el=>el.id.replace('plot-',''))")==expected_order)
        def paired_layout():
            boxes=page.locator('#charts .chart-card').evaluate_all('els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}})')
            return all(boxes[i]['y']==boxes[i+1]['y'] and boxes[i]['x']<boxes[i+1]['x'] for i in range(0,10,2)) and boxes[10]['y']>boxes[9]['y']
        check('Desktop has five ordered pairs and a single final panel',paired_layout())
        check('Every chart including agreement has an accessible collapse control',page.locator('.chart-toggle[aria-expanded="true"][aria-controls]').count()==12)
        for toggle in page.locator('.chart-toggle').all():
            content=page.locator('#'+toggle.get_attribute('aria-controls'))
            toggle.click();page.wait_for_timeout(30)
            assert toggle.get_attribute('aria-expanded')=='false' and content.is_hidden()
            toggle.click();page.wait_for_timeout(30)
            assert toggle.get_attribute('aria-expanded')=='true' and content.is_visible()
        check('Every chart collapses and expands independently',page.locator('.chart-content[hidden]').count()==0)
        times=page.evaluate("()=>{const t=Math.floor(Date.now()/3600000)*3600000;return Array.from({length:168},(_,i)=>new Date(t+i*3600000).toISOString().replace('.000Z','Z'))}")
        def bounds():
            return page.locator('#time-slider').evaluate('(el)=>[+el.min,+el.max,+el.value]')
        def coords(selector, index):
            page.locator(selector).scroll_into_view_if_needed()
            return page.locator(selector).evaluate('''(el,i)=>{const s=el.querySelector('svg'),w=s.viewBox.baseVal.width,n=+document.querySelector('#time-slider').max-(+document.querySelector('#time-slider').min);const p=new DOMPoint(43+(w-55)*(i-(+document.querySelector('#time-slider').min))/n,55).matrixTransform(s.getScreenCTM());return {x:p.x,y:p.y}}''',index)
        def drag(selector,a,b,button='right',release=True):
            axy=coords(selector,a);bxy=coords(selector,b)
            page.mouse.move(**axy);page.mouse.down(button=button);page.mouse.move(**bxy,steps=5)
            if release:
                page.mouse.up(button=button);page.wait_for_timeout(70)
            return axy,bxy
        page.evaluate("window.__chartPaths=[...document.querySelectorAll('.plot path')]")
        page.locator('#time-slider').fill('80');page.wait_for_timeout(70)
        check('Missing forecast values hide their cursor point',page.locator('#plot-temperature_2m .cursor-point[display="none"]').count()==1)
        page.locator('#time-slider').fill('81');page.wait_for_timeout(70)
        check('Cursor points return after a forecast gap',page.locator('#plot-temperature_2m .cursor-point[display="none"]').count()==0)
        check('Slider values, table and map link follow the inspected hour',page.locator('#values-temperature_2m .average-value b').inner_text()=='4.1' and page.locator('#data-table tr').first.locator('td').nth(3).inner_text()=='4.1' and times[81] in unquote(page.locator('#nav-maps').get_attribute('href')))
        page.evaluate('''async ()=>{const slider=document.querySelector('#time-slider');for(let i=79;i>=0;i--){slider.value=i;slider.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);}}''')
        check('Rapid slider movement reuses all forecast paths',page.evaluate("window.__chartPaths.every((path,i)=>path===document.querySelectorAll('.plot path')[i])"))
        check('Rapid movement ends at the correct hour on every chart',bounds()==[0,167,0] and page.locator('.chart-time time').evaluate_all('(els)=>els.every(e=>e.dateTime===document.querySelector("#time-temperature_2m").dateTime)') and page.locator('#time-temperature_2m').get_attribute('datetime')==times[0])
        page.evaluate('''()=>{const model=document.querySelector('input[value="gfs_global"]'),slider=document.querySelector('#time-slider');model.checked=false;model.dispatchEvent(new Event('change',{bubbles:true}));slider.value=81;slider.dispatchEvent(new Event('input',{bubbles:true}));}''');page.wait_for_timeout(70)
        check('Model updates win over cursor-only updates in the same frame',page.evaluate("!window.__chartPaths[0].isConnected") and page.locator('#values-temperature_2m').inner_text().find('GFS global')==-1 and bounds()[2]==81)
        page.locator('input[value="gfs_global"]').check();page.locator('#time-slider').fill('0');page.wait_for_timeout(70)
        selector='#plot-temperature_2m'
        card=page.locator(selector).locator('xpath=ancestor::article')
        card.screenshot(path=str(ROOT.parent/'zoom-before.png'))
        drag(selector,24,60,release=False)
        check('A visible date-labelled selection appears during drag',page.locator('.zoom-selection').count()==1 and 'UTC' in page.locator('.zoom-selection text').text_content())
        card.screenshot(path=str(ROOT.parent/'zoom-selecting.png'))
        page.mouse.up(button='right');page.wait_for_timeout(100)
        check('Right-drag zooms to the selected inclusive time interval',bounds()==[24,60,24])
        check('The inspected timestamp is absolute, not reset to hour zero',page.locator('#time-temperature_2m').get_attribute('datetime')==times[24])
        check('Summary minimum and snowfall maximum use only the zoomed hours',page.locator('#temp-min').inner_text()=='-1.6°C' and page.locator('#snow-max').inner_text()=='0.60 cm')
        check('All graphs use hourly ticks after zooming', all(page.locator(f'{s} .time-tick').count()>1 for s in ['#agreement-chart',selector,'#plot-wind_speed_10m']))
        card.screenshot(path=str(ROOT.parent/'zoom-after.png'))
        xy=coords(selector,42);page.mouse.click(**xy);page.wait_for_timeout(70)
        check('Click inspection and legend values follow the zoomed position',bounds()==[24,60,42] and page.locator('#time-temperature_2m').get_attribute('datetime')==times[42] and page.locator('#values-temperature_2m .average-value b').inner_text()=='0.2')
        check('All chart inspected times stay synchronized',page.locator('.chart-time time').evaluate_all('(els)=>new Set(els.map(e=>e.dateTime)).size')==1)
        card.locator('.chart-toggle').click();page.wait_for_timeout(70)
        check('Collapse preserves the selected hour and synchronized time window',bounds()==[24,60,42] and card.locator('.chart-content').is_hidden())
        check('Collapsed cards shrink without moving their paired neighbour',card.bounding_box()['height']<120 and paired_layout())
        page.locator('[data-variable="temperature_2m"]').click()
        check('The Data dialog defaults to the zoomed range',page.locator('#dataset-table tbody tr').count()==37 and page.locator('#dataset-table tbody time').first.get_attribute('datetime')==times[24])
        with page.expect_download() as dl:
            page.locator('#download-csv').click()
        rows=list(csv.reader(io.StringIO(Path(dl.value.path()).read_text(encoding='utf-8-sig'))))
        check('CSV export contains only the visible zoomed rows',len(rows)==38 and rows[1][3]==times[24] and rows[-1][3]==times[60])
        with page.expect_download() as dl:
            page.locator('#download-table').click()
        exported=Path(dl.value.path()).read_text(encoding='utf-8')
        check('HTML export contains the same zoomed UTC period',times[24] in exported and times[60] in exported and times[23] not in exported)
        page.locator('#dataset-period').select_option('full')
        check('Full model dataset remains independently available',page.locator('#dataset-table tbody tr').count()==192)
        page.locator('.dataset-close').click()
        drag('#plot-wind_speed_10m',30,54)
        page.locator('#time-slider').fill('45');page.wait_for_timeout(70)
        card.locator('.chart-toggle').focus();page.keyboard.press('Enter');page.wait_for_timeout(70)
        check('Keyboard expansion uses zoom and inspection changes made while collapsed',bounds()==[30,54,45] and page.locator('#values-temperature_2m .average-value b').inner_text()=='0.5' and page.locator(selector+' svg').is_visible())
        check('Expanded graph uses its actual width',page.locator(selector).evaluate('el=>Math.abs(el.clientWidth-el.querySelector("svg").viewBox.baseVal.width)<1'))
        card.locator('[data-reset-zoom]').click();page.wait_for_timeout(70)
        drag(selector,24,60)
        page.locator('#time-slider').fill('42');page.wait_for_timeout(70)
        drag(selector,55,35)
        check('Reverse-direction nested zoom keeps the correct absolute hours',bounds()==[35,55,42])
        page.locator('#time-slider').fill('50');page.wait_for_timeout(70)
        check('Slider inspection stays inside the zoom window',page.locator('#time-temperature_2m').get_attribute('datetime')==times[50])
        page.locator('input[value="gfs_global"]').uncheck();page.wait_for_timeout(70)
        check('Changing the model selection preserves zoom',bounds()==[35,55,50])
        page.set_viewport_size({'width':1200,'height':950});page.wait_for_timeout(250)
        check('Resizing preserves zoom and slider limits',bounds()==[35,55,50])
        a,b=drag(selector,38,48,release=False)
        page.keyboard.press('Escape');page.mouse.up(button='right');page.wait_for_timeout(70)
        check('Escape cancels an unfinished selection without changing zoom',bounds()==[35,55,50] and page.locator('.zoom-selection').count()==0)
        page.locator(selector).focus();page.keyboard.press('Escape');page.wait_for_timeout(70)
        check('Escape on a focused chart resets the horizon',bounds()==[0,167,50])
        drag('#agreement-chart',40,80)
        check('The snowfall agreement chart supports the same zoom gesture',bounds()==[40,80,50])
        xy=coords('#agreement-chart',55);page.mouse.dblclick(**xy,delay=80);page.wait_for_timeout(100)
        check('Double-click resets every chart',bounds()[:2]==[0,167])
        drag(selector,25,50)
        card.locator('[data-reset-zoom]').click();page.wait_for_timeout(70)
        check('Compact reset button restores the chosen horizon',bounds()[:2]==[0,167])
        page.locator('#horizon').select_option('72');page.wait_for_timeout(70)
        drag(selector,20,40)
        page.locator('#horizon').select_option('24');page.wait_for_timeout(70)
        check('Changing horizon clears zoom and clamps inspection',bounds()[:2]==[0,23] and bounds()[2]<=23)
        xy=coords(selector,10);page.mouse.click(**xy,button='right');page.wait_for_timeout(70)
        check('Right-click without dragging does not zoom',bounds()[:2]==[0,23])
        drag(selector,8,8.1)
        check('An accidental tiny drag does not zoom',bounds()[:2]==[0,23])
        page.keyboard.down('Shift');drag(selector,3,12,button='left');page.keyboard.up('Shift')
        check('Shift-left-drag provides a trackpad alternative',bounds()[:2]==[3,12])
        check('Zooming and exporting do not request new forecast data',page.evaluate('window.__forecastRequests.length')==initial_requests)
        page.locator('#refresh').click();page.wait_for_function("document.querySelector('#refresh').disabled === false");page.wait_for_timeout(70)
        check('Refresh resets zoom for the newly loaded timeline',bounds()[:2]==[0,23])
        page.locator('#horizon').select_option('168');page.wait_for_timeout(70)
        drag(selector,30,60)
        # Resize to touch dimensions; no mouse zoom is added to touch gestures.
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250)
        check('Mobile layout has no horizontal page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        card.screenshot(path=str(ROOT.parent/'zoom-mobile.png'))
        check('Native vertical touch scrolling is retained',page.locator(selector+' svg').evaluate("el=>getComputedStyle(el).touchAction")=='pan-y')
        card.locator('[data-reset-zoom]').click();page.wait_for_timeout(70)
        check('Reset remains usable at mobile width',bounds()[:2]==[0,167])
        card.locator('.chart-toggle').click();page.wait_for_timeout(70)
        page.locator('#focus').select_option('wind');page.wait_for_timeout(70)
        check('Focus filters retain the paired wind charts',page.locator('#charts .chart-card:visible h2').all_text_contents()==['10 m wind speed','10 m wind gusts'])
        page.locator('#focus').select_option('all');page.wait_for_timeout(70)
        check('Returning from a focus filter preserves collapse state and order',card.locator('.chart-content').is_hidden() and page.locator('#charts .plot').evaluate_all("els=>els.map(el=>el.id.replace('plot-',''))")==expected_order)
        page.locator('#refresh').click();page.wait_for_function("document.querySelector('#refresh').disabled === false")
        check('Refreshing data preserves the chosen collapse state',card.locator('.chart-content').is_hidden())
        page.locator('#location-search').fill('54, -3');page.locator('#search-form button[type="submit"]').click()
        page.locator('#search-results button').first.click();page.wait_for_function("document.querySelector('#refresh').disabled === false")
        check('Changing location preserves collapse state and refreshes forecast coordinates','54.0000' in page.locator('#coordinates').inner_text() and card.locator('.chart-content').is_hidden())
        page.locator('#select-none').click();page.wait_for_timeout(70)
        card.locator('.chart-toggle').focus();page.keyboard.press('Space');page.wait_for_timeout(70)
        check('Reopening with no selected models shows the current empty state','Select a model' in page.locator(selector).inner_text())
        page.locator('#select-all').click();page.wait_for_timeout(70)
        for width in [320,390,768,900]:
            page.set_viewport_size({'width':width,'height':844});page.wait_for_timeout(180)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert page.locator('#charts .chart-card').evaluate_all('els=>new Set(els.map(el=>el.getBoundingClientRect().x)).size===1')
            assert page.locator('.chart-toggle').evaluate_all('els=>els.every(el=>{const r=el.getBoundingClientRect(),p=el.closest(".chart-card,.agreement-card").getBoundingClientRect();return r.x>=p.x&&r.right<=p.right})')
        check('Phone and tablet layouts keep all panels in one column with controls inside cards',True)
        page.set_viewport_size({'width':1440,'height':1080});page.wait_for_timeout(180)
        check('Returning to desktop restores the requested pairs',paired_layout())
        page.locator('#charts').screenshot(path=str(ROOT.parent/'panels-desktop.png'))
        check('No JavaScript errors during interaction tests',not errors)
        timings=page.evaluate('window.__inspectionMilliseconds.slice().sort((a,b)=>a-b)')
        print(json.dumps({'passed':len(RESULTS),'checks':RESULTS,'errors':errors,'inspection_ms':{'samples':len(timings),'median':round(timings[len(timings)//2],2),'p95':round(timings[int(len(timings)*.95)],2)}},indent=2))
        browser.close()

if __name__=='__main__':
    run()
