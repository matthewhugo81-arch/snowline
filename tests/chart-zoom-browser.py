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
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RESULTS = []

def check(name, condition):
    assert condition, name
    RESULTS.append(name)

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH','/usr/bin/chromium'), args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':1440,'height':1080}, accept_downloads=True)
        page = context.new_page()
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        html=re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', (ROOT/'index.html').read_text(), flags=re.S)
        css=re.sub(r"@import[^\n]*\n", '', (ROOT/'styles.css').read_text()) + (ROOT/'chart-zoom.css').read_text()
        page.set_content(html)
        page.add_style_tag(content=css)
        sources={name:(ROOT/name).read_text() for name in ['app.js','data.js','average.js','cache.js','export.js','dataset-dialog.js','chart-window.js','chart-zoom.js']}
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
        selector='#plot-temperature_2m'
        card=page.locator(selector).locator('..')
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
        page.locator('[data-variable="temperature_2m"]').click()
        check('The Data dialog defaults to the zoomed range',page.locator('#dataset-table tbody tr').count()==37 and page.locator('#dataset-table tbody time').first.get_attribute('datetime')==times[24])
        with page.expect_download() as dl:
            page.locator('#download-csv').click()
        rows=list(csv.reader(io.StringIO(Path(dl.value.path()).read_text(encoding='utf-8-sig'))))
        check('CSV export contains only the visible zoomed rows',len(rows)==38 and rows[1][3]==times[24] and rows[-1][3]==times[60])
        with page.expect_download() as dl:
            page.locator('#download-table').click()
        exported=Path(dl.value.path()).read_text()
        check('HTML export contains the same zoomed UTC period',times[24] in exported and times[60] in exported and times[23] not in exported)
        page.locator('#dataset-period').select_option('full')
        check('Full model dataset remains independently available',page.locator('#dataset-table tbody tr').count()==192)
        page.locator('.dataset-close').click()
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
        page.locator(selector).locator('..').locator('[data-reset-zoom]').click();page.wait_for_timeout(70)
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
        page.locator(selector).locator('..').locator('[data-reset-zoom]').click();page.wait_for_timeout(70)
        check('Reset remains usable at mobile width',bounds()[:2]==[0,167])
        check('No JavaScript errors during interaction tests',not errors)
        print(json.dumps({'passed':len(RESULTS),'checks':RESULTS,'errors':errors},indent=2))
        browser.close()

if __name__=='__main__':
    run()
