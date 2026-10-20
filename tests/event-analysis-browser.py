"""Actual event form + shared point loader/cache, with deterministic transport."""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or None,args=['--no-sandbox'])
    page=browser.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    html=(ROOT/'maps.html').read_text(encoding='utf8')
    fixture=re.search(r'<section id="event-analysis".*?</section>',html,re.S).group()
    def serve(route):
        name=route.request.url.split('https://snowline.test/',1)[1].split('?')[0]
        route.fulfill(content_type='text/html' if name=='fixture' else 'text/javascript',body=fixture if name=='fixture' else (ROOT/name).read_text(encoding='utf8'))
    page.route('https://snowline.test/**',serve)
    page.goto('https://snowline.test/fixture')
    page.evaluate(r'''async ()=>{
      window.fixtureNow=Date.UTC(2026,9,15,12);Date.now=()=>window.fixtureNow;
      window.fixtureRequests=[];window.fixturePending=[];window.fixtureMode='fresh';
      const {MODELS}=await import('/data.js?v=20261015-shared-cache');
      const forecast=model=>{
        const time=Array.from({length:48},(_,i)=>new Date(Date.UTC(2026,9,15,12+i)).toISOString());
        const hourly={time,snowfall:time.map((_,i)=>model==='gfs_global'&&i===2?null:.1),precipitation:time.map(()=>1),temperature_2m:time.map(()=>-1),soil_temperature_0cm:time.map(()=>-1),snow_depth:time.map(()=>0)};
        return {hourly,hourly_units:{snowfall:'cm',snow_depth:'m'},_retrievedAt:Date.UTC(2026,9,15,12),_source:'shared cache'};
      };
      window.fetch=async(url,{signal}={})=>{
        // Exercise native-source failure independently of the shared-cache fixture.
        if(url.includes('/mogreps/latest.json'))return new Response('{}',{status:503});
        window.fixtureRequests.push(url);
        if(window.fixtureMode==='slow')await new Promise((resolve,reject)=>{window.fixturePending.push(resolve);signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
        if(url.startsWith('./point-data/'))return new Response(JSON.stringify({version:1,location:{latitude:53.9239,longitude:-2.1949},models:Object.fromEntries(MODELS.map(m=>[m.id,forecast(m.id)]))}));
        if(!url.startsWith('https://snowline-forecast-cache.matthewhugo81.workers.dev/forecast?'))throw Error('Unexpected direct API request '+url);
        if(window.fixtureMode==='offline')return new Response('{}',{status:503});
        return new Response(JSON.stringify(forecast(new URL(url).searchParams.get('model'))));
      };
      window.selectPoint=(await import('/event-analysis.js')).selectEventPoint;
      window.selectPoint({latitude:53.9239,longitude:-2.1949},'2026-10-15T12:00:00Z');
    }''')
    def calculate():
        page.locator('#calculate-event').click()
        page.wait_for_function("!document.querySelector('#calculate-event').disabled")
    calculate()
    assert page.locator('#event-results tr').count()==18
    native_row=page.locator('#event-results tr').filter(has_text='MOGREPS-G')
    native_status=native_row.locator('td').nth(1)
    assert native_row.locator('td').count()==2 and native_status.get_attribute('colspan')=='7', 'Unavailable native data must show an error, never numeric forecast totals'
    native_message=native_status.inner_text()
    assert '503' in native_message and 'retry' in native_message.lower(), f'Native outage should explain the service status and recovery: {native_message}'
    assert page.evaluate('fixtureRequests.length')==1, 'Known location uses the shared snapshot'
    gfs=page.locator('#event-results tr').filter(has_text='GFS global')
    assert gfs.locator('td').nth(1).inner_text()=='—', 'A missing hour cannot become a complete snow total'
    assert 'Incomplete' in gfs.inner_text()
    calculate();assert page.evaluate('fixtureRequests.length')==1, 'Repeated event calculation reuses the browser cache'
    page.locator('#event-end').fill('2026-10-15T18:00');page.locator('#event-end').dispatch_event('change')
    assert page.evaluate('fixtureRequests.length')==1, 'Editing the period performs no extra requests'
    page.evaluate("fixtureNow+=7200000;fixtureMode='offline'")
    calculate();assert 'Cached forecasts' in page.locator('#event-status').inner_text()
    assert 'retrieved 15 Oct, 12:00' in page.locator('#event-status').inner_text(), 'Stale fallback retains original retrieval time'
    page.evaluate("fixtureMode='slow';selectPoint({latitude:51.5,longitude:-.1},'2026-10-15T12:00:00Z')")
    page.locator('#calculate-event').click();page.wait_for_function('fixturePending.length>0')
    page.evaluate("selectPoint({latitude:55,longitude:-4},'2026-10-15T12:00:00Z');fixturePending.forEach(resolve=>resolve())")
    page.wait_for_timeout(100)
    assert page.locator('#event-results tr').count()==0, 'Cancelled old-location results never appear'
    assert page.locator('#calculate-event').is_enabled()
    page.evaluate("fixtureMode='offline'");calculate()
    assert 'No point forecasts available' in page.locator('#event-status').inner_text()
    assert '24.00' not in page.locator('#event-results').inner_text(), 'Another location never inherits a cached total'
    assert not errors,errors
    print(json.dumps({'passed':10,'errors':errors,'checks':'shared snapshot, browser reuse, edited period, missing hours, stale timestamp, cancellation and exact-location isolation'}))
    browser.close()
