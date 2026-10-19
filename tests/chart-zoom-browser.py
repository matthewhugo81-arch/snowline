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
        context = browser.new_context(viewport={'width':1440,'height':1080}, accept_downloads=True, has_touch=True)
        page = context.new_page()
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (ROOT/'index.html').read_text(encoding='utf-8'), flags=re.S)
        css=re.sub(r"@import[^\n]*\n", '', (ROOT/'styles.css').read_text(encoding='utf-8')) + (ROOT/'chart-zoom.css').read_text(encoding='utf-8')
        page.set_content(html)
        page.add_style_tag(content=css)
        sources={name:(ROOT/name).read_text(encoding='utf-8') for name in ['app.js','data.js','average.js','cache.js','point-forecasts.js','mogreps-point.js','mogreps-client.js','forecast-service.js','point-snapshots.js','export.js','dataset-dialog.js','chart-window.js','chart-zoom.js','chart-panels.js','chart-image-export.js']}
        sources['app.js'] += '\nwindow.__inspectionMilliseconds=[];const measuredInspection=renderInspection;renderInspection=function(){const start=performance.now();try{return measuredInspection();}finally{window.__inspectionMilliseconds.push(performance.now()-start);}};'
        page.evaluate(r'''async (sources)=>{
          Date.now=()=>Date.UTC(2026,9,12,19);
          window.__forecastRequests=[];
          window.fetch=async url=>{
            // Native-source outage is intentional in this shared-cache regression fixture.
            if(url.includes('/mogreps/latest.json')) return new Response('{}',{status:503});
            if(url.includes('/v1/elevation?')) return new Response(JSON.stringify({elevation:[200]}));
            if(!url.startsWith('https://snowline-forecast-cache.matthewhugo81.workers.dev/forecast?')) throw Error('Unexpected external request: '+url);
            window.__forecastRequests.push(url);
            const start=Math.floor(Date.now()/3600000)*3600000;
            const time=Array.from({length:192},(_,i)=>new Date(start+i*3600000).toISOString());
            const keys=['snowfall','snow_depth','temperature_2m','dew_point_2m','temperature_850hPa','temperature_500hPa','precipitation','soil_temperature_0cm','relative_humidity_2m','cloud_cover','wind_speed_10m','wind_gusts_10m','wind_direction_10m','pressure_msl'];
            const hourly={time},hourly_units={};
            for(const key of keys){hourly[key]=time.map((_,i)=>key==='pressure_msl'?1000+i/10:key==='wind_direction_10m'?(350+i*5)%360:key==='snowfall'?i/100:key==='snow_depth'?0:key==='cloud_cover'||key==='relative_humidity_2m'?50:key==='precipitation'?i/10:i/10-4);hourly_units[key]=key==='pressure_msl'?'hPa':key.includes('wind_')?'mph':key==='snow_depth'?'cm':'°C';}
            if(new URL(url).searchParams.get('model')==='gfs_global')hourly.temperature_2m[80]=null;
            return new Response(JSON.stringify({hourly,hourly_units,latitude:54,longitude:-2,elevation:200,_retrievedAt:Date.now(),_source:'shared cache'}));
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
        page.wait_for_function("document.querySelector('#refresh').disabled === false && document.querySelectorAll('.plot svg').length === 15")
        check('All fourteen variable charts and agreement chart load', page.locator('.plot svg').count()==15)
        check('Direction plots hourly dots without connecting paths',page.locator('#plot-wind_direction_10m .direction-dot').count()>100 and page.locator('#plot-wind_direction_10m path').count()==0)
        check('Direction compass runs north clockwise to north',page.locator('#plot-wind_direction_10m text').all_text_contents()[:9]==['N','NE','E','SE','S','SW','W','NW','N'])
        initial_requests=page.evaluate('window.__forecastRequests.length')
        check('All sixteen forecasts use the shared service',initial_requests==16 and page.evaluate("window.__forecastRequests.every(url=>url.startsWith('https://snowline-forecast-cache.matthewhugo81.workers.dev/forecast?'))"))
        ec_toggle=page.locator('input[value="ecmwf_ifs025_ensemble_mean"]')
        check('EC ENS is selected and both ensemble means have dashed lines and legend samples',ec_toggle.is_checked() and page.locator('#plot-temperature_2m path[stroke-dasharray]').count()==2 and page.locator('#values-temperature_2m .ensemble-swatch').count()==2)
        ec_toggle.uncheck()
        page.wait_for_function("document.querySelectorAll('#plot-temperature_2m path[stroke-dasharray]').length === 1")
        check('EC ENS can be hidden independently of HGEFS','EC ENS mean' not in page.locator('#values-temperature_2m').inner_text() and 'HGEFS mean' in page.locator('#values-temperature_2m').inner_text())
        ec_toggle.check()
        page.wait_for_function("document.querySelectorAll('#plot-temperature_2m path[stroke-dasharray]').length === 2")
        expected_order=['temperature_2m','dew_point_2m','precipitation','cloud_cover','wind_speed_10m','wind_gusts_10m','wind_direction_10m','relative_humidity_2m','soil_temperature_0cm','pressure_msl','temperature_850hPa','temperature_500hPa','snowfall','snow_depth']
        check('Panels follow the requested reading order',page.locator('#charts .plot').evaluate_all("els=>els.map(el=>el.id.replace('plot-',''))")==expected_order)
        def paired_layout():
            boxes=page.locator('#charts .chart-card').evaluate_all('els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}})')
            pairs=[(i,i+1) for i in range(0,len(boxes)-1,2)]
            return all(boxes[a]['y']==boxes[b]['y'] and boxes[a]['x']<boxes[b]['x'] for a,b in pairs) and all(abs(box['width']-boxes[0]['width'])<1 for box in boxes)
        check('All desktop charts use the same standard width in two columns',paired_layout())
        check('Every chart including agreement has an accessible collapse control',page.locator('.chart-toggle[aria-expanded="true"][aria-controls]').count()==15)
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
        def check_total():
            first,last,_=bounds()
            expected=sum(i/10 for i in range(first,last+1))
            assert f'{expected:.1f} mm' in page.locator('#precipitation-total').inner_text()
        check_total()
        check('Pressure shows each model and its average on an absolute hPa axis',page.locator('#plot-pressure_msl path').count()==18 and float(page.locator('#plot-pressure_msl text').first.text_content())>900)
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
        check('Slider values, table and map link follow the inspected hour',page.locator('#values-temperature_2m .average-value b').inner_text()=='4.1' and page.locator('#data-table tr').first.locator('td').nth(3).text_content()=='4.1' and times[81] in unquote(page.locator('#nav-maps').get_attribute('href')))
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
        check_total()
        check('Right-drag zooms to the selected inclusive time interval',bounds()==[24,60,24])
        check('The inspected timestamp is absolute, not reset to hour zero',page.locator('#time-temperature_2m').get_attribute('datetime')==times[24])
        check('Summary minimum and snowfall maximum use only the zoomed hours',page.locator('#temp-min').inner_text()=='-1.6°C' and page.locator('#snow-max').inner_text()=='0.60 cm/h')
        check('All graphs use hourly ticks after zooming', all(page.locator(f'{s} .time-tick').count()>1 for s in ['#agreement-chart',selector,'#plot-wind_speed_10m']))
        card.screenshot(path=str(ROOT.parent/'zoom-after.png'))
        xy=coords(selector,42);page.mouse.click(**xy);page.wait_for_timeout(70)
        check('Click inspection and legend values follow the zoomed position',bounds()==[24,60,42] and page.locator('#time-temperature_2m').get_attribute('datetime')==times[42] and page.locator('#values-temperature_2m .average-value b').inner_text()=='0.2')
        before_size=bounds();before_total=page.locator('#precipitation-total').inner_text()
        for key in ['wind_direction_10m','pressure_msl','temperature_850hPa']:
            sized=page.locator('#plot-'+key).locator('xpath=ancestor::article')
            normal_width=sized.bounding_box()['width']
            size_button=sized.locator('.chart-size')
            size_button.click();page.wait_for_timeout(100)
            assert size_button.get_attribute('aria-pressed')=='true' and sized.bounding_box()['width']>normal_width*1.8
            assert bounds()==before_size and page.locator('#precipitation-total').inner_text()==before_total
            assert page.locator('#plot-'+key).evaluate('el=>Math.abs(el.clientWidth-el.querySelector("svg").viewBox.baseVal.width)<1')
            sized.locator('.chart-toggle').click();page.wait_for_timeout(70)
            assert sized.locator('.chart-content').is_hidden() and size_button.get_attribute('aria-pressed')=='true'
            sized.locator('.chart-toggle').click();page.wait_for_timeout(70)
            size_button.focus();page.keyboard.press('Enter');page.wait_for_timeout(100)
            assert size_button.get_attribute('aria-pressed')=='false' and abs(sized.bounding_box()['width']-normal_width)<1
        check('Optional full-width charts preserve zoom, totals, collapse and keyboard restore',paired_layout() and bounds()==before_size)
        check('Resizing panels does not request forecast data',page.evaluate('window.__forecastRequests.length')==initial_requests)
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
        check_total()
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
        # Check the existing mouse controls at mobile dimensions before native touch input.
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250)
        check('Phone layouts hide the unnecessary width controls',page.locator('.chart-size:visible').count()==0)
        check('Mobile layout has no horizontal page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        card.screenshot(path=str(ROOT.parent/'zoom-mobile.png'))
        check('Native vertical touch scrolling is retained',page.locator(selector+' svg').evaluate("el=>getComputedStyle(el).touchAction")=='pan-y')
        card.locator('[data-reset-zoom]').click();page.wait_for_timeout(70)
        check('Reset remains usable at mobile width',bounds()[:2]==[0,167])
        # CDP dispatches browser-native multi-touch events, including scrolling
        # arbitration and compatibility clicks, rather than JS-only event mocks.
        cdp=context.new_cdp_session(page)
        cdp.send('Emulation.setTouchEmulationEnabled',{'enabled':True,'maxTouchPoints':5})
        def touch(kind, points):
            cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[dict(x=x,y=y,id=i+1) for i,(x,y) in enumerate(points)]})
            page.wait_for_timeout(45)
        def touch_center(target=selector):
            page.locator(target).evaluate("el=>el.scrollIntoView({block:'center'})")
            page.wait_for_timeout(100)
            return page.locator(target).evaluate("el=>{const svg=el.querySelector('svg'),w=svg.viewBox.baseVal.width,p=new DOMPoint(43+(w-55)/2,65).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y}}")
        def pinch_gesture(start_gap,end_gap,shift=0,target=selector,finish=True):
            c=touch_center(target)
            touch('touchStart',[(c['x']-start_gap/2,c['y']),(c['x']+start_gap/2,c['y'])])
            for step in range(1,7):
                gap=start_gap+(end_gap-start_gap)*step/6
                x=c['x']+shift*step/6
                touch('touchMove',[(x-gap/2,c['y']),(x+gap/2,c['y'])])
            if finish:
                touch('touchEnd',[])
            return c
        check('The plus/minus buttons and separate toolbar are removed',page.locator('[data-zoom-in], [data-zoom-out], .chart-zoom-controls').count()==0)
        check('Reset is hidden at the full horizon as before',card.locator('[data-reset-zoom]').is_hidden())
        pinch_gesture(64,128,finish=False)
        check_total()
        check('Spreading two fingers zooms live before release',bounds()[:2]==[42,126])
        check('Every graph redraws to the same pinch time range',page.locator('.plot svg').evaluate_all('els=>new Set(els.map(el=>[el.querySelector(".time-tick")?.textContent,[...el.querySelectorAll(".time-tick")].at(-1)?.textContent,[...el.querySelectorAll(".date-tick")].map(t=>t.textContent).join() ].join("|"))).size===1'))
        touch('touchEnd',[])
        check('Finger release preserves zoom without inspecting or resetting',bounds()==[42,126,42] and page.locator('.zoom-pinching').count()==0)
        check('Pinch updates overview statistics and all inspected times',page.locator('#snow-max').inner_text()=='1.26 cm' and page.locator('#temp-min').inner_text()=='0.2°C' and page.locator('.chart-time time').evaluate_all('(els)=>new Set(els.map(e=>e.dateTime)).size')==1)
        check('Time labels remain separated at intermediate pinch ranges',page.locator(selector+' .time-tick').evaluate_all('els=>els.every((el,i)=>!i||els[i-1].getBoundingClientRect().right+2<=el.getBoundingClientRect().left)'))
        check('Reset returns to the original compact size in each chart heading',page.locator('.chart-heading [data-reset-zoom]').count()==15 and card.locator('[data-reset-zoom]').evaluate('el=>{const s=getComputedStyle(el);return s.fontSize==="11px"&&s.padding==="5px 8px"&&el.getBoundingClientRect().height===30}'))
        card.screenshot(path=str(ROOT.parent/'zoom-mobile-pinch.png'))
        page.locator('[data-variable="temperature_2m"]').click()
        check('Pinch updates the exported chart window',page.locator('#dataset-table tbody tr').count()==85 and page.locator('#dataset-table tbody time').first.get_attribute('datetime')==times[42])
        page.locator('.dataset-close').click()
        pinch_gesture(128,64)
        check('Pinching inward restores the full selected horizon',bounds()[:2]==[0,167] and card.locator('[data-reset-zoom]').is_hidden())
        pinch_gesture(64,128)
        check('A fresh pinch zooms all graphs again',bounds()[:2]==[42,126])
        before=bounds();pinch_gesture(80,80,shift=24)
        check_total()
        check('Two fingers pan through time without changing zoom span',bounds()[0]<before[0] and bounds()[1]-bounds()[0]==84)
        pinch_gesture(80,80,shift=-48)
        check_total()
        check('Two-finger panning works in the opposite direction',bounds()[0]>before[0] and bounds()[1]-bounds()[0]==84)
        pinch_gesture(128,64)
        check('Pinching out after panning restores the full horizon',bounds()[:2]==[0,167])
        # A staggered two-finger start must also survive SVG replacements.
        c=touch_center()
        touch('touchStart',[(c['x']-32,c['y'])])
        touch('touchStart',[(c['x']-32,c['y']),(c['x']+32,c['y'])])
        touch('touchMove',[(c['x']-64,c['y']),(c['x']+64,c['y'])])
        check('Staggered fingers activate pinch zoom',bounds()[:2]==[42,126])
        before=bounds()
        touch('touchEnd',[(c['x']-64,c['y'])]);touch('touchMove',[(c['x']-40,c['y'])]);touch('touchEnd',[])
        check('Lifting fingers separately does not inspect a new hour',bounds()==before)
        card.locator('[data-reset-zoom]').tap();page.wait_for_timeout(100)
        check('Touch Reset zoom restores all graphs',bounds()[:2]==[0,167])
        pinch_gesture(64,128,finish=False);touch('touchCancel',[])
        check('Browser cancellation clears the gesture and leaves a valid window',page.locator('.zoom-pinching').count()==0 and bounds()[:2]==[42,126])
        card.locator('[data-reset-zoom]').tap();page.wait_for_timeout(100)
        pinch_gesture(64,128,target='#agreement-chart')
        check('The agreement graph supports native pinch zoom too',bounds()[:2]==[42,126])
        page.locator('.agreement-card [data-reset-zoom]').tap();page.wait_for_timeout(100)
        for _ in range(12):
            if bounds()[1]-bounds()[0]==1: break
            pinch_gesture(48,160)
        check('Repeated pinch stops at two hourly samples',bounds()[1]-bounds()[0]==1)
        card.locator('[data-reset-zoom]').tap();page.wait_for_timeout(100)
        page.locator('#horizon').select_option('24');page.wait_for_timeout(100)
        pinch_gesture(64,128)
        check('Pinch respects the chosen one-day horizon',bounds()[:2]==[6,18])
        card.locator('[data-reset-zoom]').tap();page.wait_for_timeout(100)
        check('Reset restores the chosen one-day horizon',bounds()[:2]==[0,23])
        page.locator('#horizon').select_option('168');page.wait_for_timeout(100)
        # Single-finger gestures must retain native scrolling and tap inspection.
        c=touch_center();scroll=page.evaluate('scrollY');before=bounds()
        touch('touchStart',[(c['x'],c['y'])])
        for step in range(1,9): touch('touchMove',[(c['x'],c['y']-step*15)])
        touch('touchEnd',[]);page.wait_for_timeout(350)
        check('One finger scrolls the page naturally over a graph',page.evaluate('scrollY')>scroll+40 and bounds()==before)
        c=touch_center();page.wait_for_timeout(550)
        page.touchscreen.tap(c['x'],c['y']);page.wait_for_timeout(100)
        check('A single tap still inspects an hour across all graphs',bounds()[2] in [83,84] and page.locator('.chart-time time').evaluate_all('(els)=>new Set(els.map(e=>e.dateTime)).size')==1)
        check('Pinch never magnifies the page or fetches more forecasts',page.evaluate('visualViewport.scale')==1 and page.evaluate('window.__forecastRequests.length')==initial_requests)
        card.locator('.chart-toggle').click();page.wait_for_timeout(70)
        page.locator('#focus').select_option('wind');page.wait_for_timeout(70)
        check('Focus filters retain the paired wind charts',page.locator('#charts .chart-card:visible h2').all_text_contents()==['10 m wind speed','10 m wind gusts','10 m wind direction'])
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
        # The same UI must retain usable data when a forced refresh encounters a
        # real 429 response. Advance beyond the fresh-cache window, not its horizon.
        page.evaluate('''()=>{Date.now=()=>Date.UTC(2026,9,12,21);window.__quotaCalls=0;window.__quotaForecastCalls=0;window.fetch=async url=>{if(url.includes('/mogreps/latest.json'))return new Response('{}',{status:503});window.__quotaCalls++;if(url.includes('/forecast?'))window.__quotaForecastCalls++;return new Response(JSON.stringify({error:true,reason:'Daily API request limit exceeded. Please try again tomorrow.'}),{status:429});};}''')
        page.locator('#refresh').click();page.wait_for_function("document.querySelector('#refresh').disabled === false")
        check('Quota failure retains all fifteen charts and altitude',page.locator('.plot svg').count()==15 and 'approximately 200' in page.locator('#altitude').inner_text())
        check('Fallback is explicitly dated and labelled as cached', 'Cached forecasts' in page.locator('#status').inner_text() and '19:00' in page.locator('#status').inner_text() and 'request limit' in page.locator('#status').inner_text())
        quota_calls=page.evaluate('window.__quotaForecastCalls')
        check('Quota response stops the remaining model queue',0 < quota_calls <= 3)
        page.locator('#refresh').click();page.wait_for_function("document.querySelector('#refresh').disabled === false")
        check('Repeated Refresh honours quota cooldown without more requests',page.evaluate('window.__quotaForecastCalls')==quota_calls)
        drag(selector,10,30)
        check('Synchronized right-drag remains usable on fallback forecasts',bounds()[:2]==[10,30])
        page.locator('#location-search').fill('55, -4');page.locator('#search-form button[type="submit"]').click()
        page.locator('#search-results button').first.click();page.wait_for_function("document.querySelector('#refresh').disabled === false")
        check('Uncached locations show the provider limit, never another location forecast','No usable cached forecast exists for this location' in page.locator('#status').inner_text() and page.locator('.plot svg').count()==0)
        check('New-location forecasts respect backend cooldown; separate elevation stays independent',page.evaluate('window.__quotaForecastCalls')==quota_calls and page.evaluate('window.__quotaCalls')<=quota_calls+1)
        check('No JavaScript errors during interaction tests',not errors)
        timings=page.evaluate('window.__inspectionMilliseconds.slice().sort((a,b)=>a-b)')
        print(json.dumps({'passed':len(RESULTS),'checks':RESULTS,'errors':errors,'inspection_ms':{'samples':len(timings),'median':round(timings[len(timings)//2],2),'p95':round(timings[int(len(timings)*.95)],2)}},indent=2))
        browser.close()

if __name__=='__main__':
    run()
