// Real app and image export, deterministic offline weather. No system clipboard
// is read or changed: the clipboard boundary records the generated PNG instead.
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium, webkit, devices} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd(), out = resolve(process.env.SNOWLINE_TEST_OUTPUT || '../chart-image-checks');
await mkdir(out, {recursive:true});
const types = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
const server = createServer(async (req,res) => {
  try {
    const path = resolve(root, '.' + (new URL(req.url, 'http://local').pathname === '/' ? '/index.html' : new URL(req.url, 'http://local').pathname));
    if (!path.startsWith(root + sep)) throw Error('Invalid path');
    res.writeHead(200, {'Content-Type':types[extname(path)] || 'application/octet-stream'}); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port, report = [];
try {
  for (const kind of (process.env.SNOWLINE_TEST_BROWSERS || 'desktop,webkit,iphone').split(',')) {
    const browser = await (kind === 'desktop' ? chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})}) : webkit.launch());
    try {
      const context = await browser.newContext(kind === 'iphone' ? {...devices['iPhone 13'], acceptDownloads:true} : {viewport:{width:1440,height:1000}, acceptDownloads:true});
      await context.addInitScript(() => {
        Date.now = () => Date.UTC(2026,9,18,6);
        window.copyResults = []; window.denyClipboard = false;
        Object.defineProperty(navigator, 'clipboard', {value:{write:async items => {
          if (window.denyClipboard) throw new DOMException('Test permission denied', 'NotAllowedError');
          const active = navigator.userActivation?.isActive;
          const blob = await items[0].getType('image/png');
          window.copyResults.push({active,type:blob.type,size:blob.size});
        }}, configurable:true});
      });
      const page = await context.newPage(), errors = []; let requests = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        // Native-source outage is intentional here; native values have dedicated tests.
        if (url.pathname.endsWith('/mogreps/latest.json')) return route.fulfill({status:503, body:'{}'});
        if (url.pathname.includes('/point-data/')) return route.fulfill({status:404, body:''});
        if (url.pathname === '/forecast') {
          requests++;
          const time = Array.from({length:192}, (_,i) => new Date(Date.UTC(2026,9,18,6+i)).toISOString());
          const hourly = {time}, hourly_units = {};
          const variables = ['snowfall','snow_depth','temperature_2m','dew_point_2m','temperature_850hPa','temperature_500hPa','precipitation','soil_temperature_0cm','relative_humidity_2m','cloud_cover','wind_speed_10m','wind_gusts_10m','wind_direction_10m','pressure_msl'];
          const model = url.searchParams.get('model'), offset = model === 'gfs_global' ? 3 : 0;
          for (const key of variables) {
            hourly[key] = time.map((_,i) => key === 'pressure_msl' ? 1000 + Math.sin(i / 12) * 12 + offset : key === 'precipitation' ? i % 12 / 10 + offset : key === 'wind_direction_10m' ? i * 5 % 360 : key === 'snowfall' ? .1 : key === 'snow_depth' ? 0 : 5 + Math.sin(i / 8) * 7 + offset);
            hourly_units[key] = key === 'pressure_msl' ? 'hPa' : key === 'snow_depth' ? 'cm' : key.includes('wind_') ? 'mph' : '°C';
          }
          return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{hourly,hourly_units,elevation:200,_retrievedAt:Date.UTC(2026,9,18,6),_source:'shared cache'}});
        }
        if (url.origin === origin) return route.continue();
        return route.abort();
      });
      await page.goto(origin);
      await page.waitForFunction(() => !document.querySelector('#refresh').disabled && document.querySelectorAll('.plot svg').length === 15).catch(async error => { console.log({kind,requests,errors,status:await page.locator('#status').textContent(),models:await page.locator('#data-table').textContent()}); throw error; });
      const count = requests;
      const plot = page.locator('#plot-precipitation'), card = page.locator('.chart-card').filter({has:plot});
      const menu = page.getByRole('menu', {name:'Chart image'});
      const bounds = () => page.locator('#time-slider').evaluate(el => [+el.min,+el.max]);
      const open = async () => {
        await card.locator('.chart-image-button').click(); await menu.waitFor({state:'visible'});
        assert.equal(await menu.evaluate(el => {const r=el.getBoundingClientRect();return r.left>=0 && r.right<=document.documentElement.clientWidth;}),true);
      };
      const save = async name => {
        const pending = page.waitForEvent('download'); await menu.getByRole('menuitem', {name:'Save PNG',exact:true}).click();
        const file = await pending; assert.match(file.suggestedFilename(), /^Snowline-.*\.png$/);
        await file.saveAs(resolve(out, kind + '-' + name + '.png'));
        const bytes = await readFile(resolve(out, kind + '-' + name + '.png'));
        assert.equal(bytes.subarray(1,4).toString(), 'PNG'); assert.ok(bytes.length > 10000);
        await page.keyboard.press('Escape');
      };
      if (kind !== 'iphone') {
        await plot.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
        // Some browsers terminate pointer tracking when requesting a context
        // menu. There may be no pointerup after the contextmenu event.
        for (const ending of ['pointercancel','lostpointercapture']) for (const contextFirst of [true,false]) {
          await plot.evaluate((el,{ending,contextFirst}) => {
            const r=el.getBoundingClientRect(), init={bubbles:true,cancelable:true,pointerType:'mouse',pointerId:77,button:2,buttons:2,clientX:r.x+150,clientY:r.y+80};
            el.dispatchEvent(new PointerEvent('pointerdown',init));
            if (contextFirst) el.dispatchEvent(new MouseEvent('contextmenu',init));
            el.dispatchEvent(new PointerEvent(ending,{...init,buttons:0}));
            if (!contextFirst) el.dispatchEvent(new MouseEvent('contextmenu',init));
          },{ending,contextFirst});
          assert.equal(await menu.isVisible(),true,`Contextmenu with ${ending} (contextFirst=${contextFirst}) must still open the image menu`);
          await page.keyboard.press('Escape');
        }
        // Whole-panel right-clicks should offer the same image actions.
        for (const target of [card.locator('h2'),card.locator('.chart-values'),card.locator('.precipitation-total')]) {
          await target.click({button:'right'}); assert.equal(await menu.isVisible(),true,'Panel title, legend and total open the menu');
          await page.keyboard.press('Escape');
        }
        await plot.click({button:'right',position:{x:150,y:80}});
        await menu.waitFor({state:'visible'}); assert.deepEqual(await bounds(),[0,167]);
        await save('rainfall');
        // Native right drag retains synchronized zoom and opens no menu.
        await plot.scrollIntoViewIfNeeded(); const box = await plot.boundingBox();
        await page.mouse.move(box.x+120,box.y+80); await page.mouse.down({button:'right'});
        await page.mouse.move(box.x+280,box.y+80,{steps:8}); await page.mouse.up({button:'right'});
        await page.waitForTimeout(100); assert.equal(await menu.isVisible(),false); assert.ok((await bounds())[1] < 167);
        const zoom = await bounds();
        await plot.focus(); await page.keyboard.press('Shift+F10'); await menu.waitFor({state:'visible'});
        await page.keyboard.press('Escape'); assert.deepEqual(await bounds(), zoom);
      }
      await page.locator('#horizon').selectOption('24');
      await page.waitForFunction(() => document.querySelector('#time-slider').max === '23');
      // Sixteen models share 13.2 mm; GFS has 85.2 mm. The average
      // line totals 17.4 mm, never the 296.4 mm sum of all model totals.
      assert.match(await page.locator('#precipitation-total').textContent(),/Accumulated precipitation: 17\.4 mm/);
      const averageSnapshot = await plot.evaluate(async el => {
        const {captureChartImage} = await import('/chart-image-export.js');
        return captureChartImage(el, {location:'Test location',coordinates:'54N 2W',period:'fixture',firstTime:'2026-10-18',legend:[]});
      });
      assert.match(averageSnapshot.total,/Accumulated precipitation: 17\.4 mm/,'Export preserves the displayed average-line total');
      await page.locator('#select-none').click(); await page.locator('input[value="gfs_global"]').check();
      await page.waitForTimeout(100);
      const snapshot = await plot.evaluate(async el => {
        const {captureChartImage} = await import('/chart-image-export.js');
        return captureChartImage(el, {location:document.querySelector('#place').textContent,coordinates:'54N 2W',period:'fixture',firstTime:'2026-10-18',legend:[]});
      });
      assert.ok(snapshot.total.includes('85.2 mm'), snapshot.total);
      assert.ok(snapshot.svg.includes('rgb(')); assert.ok(!snapshot.svg.includes('var(--'));
      await open(); await save('selected-model');
      await open(); await menu.getByRole('menuitem', {name:'Copy image',exact:true}).click();
      await page.waitForFunction(() => window.copyResults.length === 1);
      assert.deepEqual(await page.evaluate(() => ({...copyResults[0],size:copyResults[0].size>10000})), {active:true,type:'image/png',size:true});
      await page.keyboard.press('Escape');
      // Clipboard denial has a usable image preview and an ordinary download link.
      await page.evaluate(() => { window.denyClipboard = true; });
      await open(); await menu.getByRole('menuitem', {name:'Copy image',exact:true}).click();
      const preview = page.getByRole('dialog', {name:'Chart image preview'});
      await preview.waitFor({state:'visible'});
      await page.waitForFunction(() => document.querySelector('.meteogram-image-preview img').naturalWidth > 0);
      const pixels = await preview.locator('img').evaluate(image => {
        const c = document.createElement('canvas'); c.width=image.naturalWidth; c.height=image.naturalHeight;
        const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;
        let coloured=0;for(let i=0;i<data.length;i+=4)if(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>40)coloured++;
        return {width:c.width,height:c.height,coloured};
      });
      assert.ok(pixels.coloured>1500); assert.ok(pixels.height>600);
      await preview.getByRole('button', {name:'Close',exact:true}).click();
      await page.locator('[data-theme-select]').selectOption('dark');
      await open(); await save('dark');
      if (kind === 'iphone') {
        for (const width of [320,390,768]) {
          await page.setViewportSize({width,height:844}); await page.waitForTimeout(200); await open();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          const m = await menu.boundingBox(); assert.ok(m.x>=0 && m.x+m.width<=width); await page.keyboard.press('Escape');
        }
        await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(200);
      }
      await page.locator('[data-theme-select]').selectOption('light');
      for (const title of ['Mean sea-level pressure','10 m wind direction','Models forecasting snowfall']) {
        await page.getByRole('button', {name:'Copy or save '+title+' image',exact:true}).click(); await menu.waitFor({state:'visible'});
        await save(title.replaceAll(' ','-'));
      }
      await open(); await page.screenshot({path:resolve(out,kind+'-menu.png')}); await page.keyboard.press('Escape');
      if (kind !== 'iphone') {
        await page.locator('#select-none').click(); await page.waitForTimeout(80);
        await card.locator('h2').click({button:'right'}); assert.equal(await menu.isVisible(),true);
        assert.match(await menu.getByRole('status').textContent(),/forecast data first/);
        assert.equal(await menu.getByRole('menuitem',{name:'Save PNG',exact:true}).isDisabled(),true);
      }
      assert.equal(requests,count,'Exports must not fetch weather'); assert.deepEqual(errors,[]);
      report.push({browser:kind,copy:'PNG generated during user activation',save:'PNG downloaded',fallback:'image preview',pixels,forecastRequests:count,errors});
    } finally { await browser.close(); }
  }
  await writeFile(resolve(out,'verification.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
} finally { await new Promise(resolve => server.close(resolve)); }
