from pathlib import Path
p=Path('.')
css='''\n/* Combined cloud and precipitation need both scales; keep comparison maps aligned. */\n@media(min-width:651px){\n .map-canvases:has(.layer-legend .legend-gradient:not([hidden]) ~ .legend-bands:not([hidden])) .layer-legend{height:84px;min-height:84px}\n}\n'''
f=p/'maps.css'; f.write_text(f.read_text()+css)
f=p/'maps.html'; s=f.read_text(); assert 'maps.css?v=20261011-larger-imagery' in s; f.write_text(s.replace('maps.css?v=20261011-larger-imagery','maps.css?v=20261012-weather-composite-legend'))
f=p/'tests/map-browser.mjs'; s=f.read_text(); token="   await page.screenshot({path:'review-output/composite-'+viewport.width+'.png',fullPage:true});"
check='''   const legendLayout=await page.evaluate(()=>{
    const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {height:r.height,bottom:r.bottom,top:r.top};};
    const legend=document.getElementById('legend-bands-b').closest('.layer-legend').getBoundingClientRect();
    return {legendBottom:legend.bottom,bands:bounds('legend-bands-b'),a:bounds('map-a'),b:bounds('map-b')};
   });
   assert.ok(legendLayout.bands.bottom<=legendLayout.legendBottom,'Both cloud and rainfall scales fit inside the legend');
   if(viewport.width>1050)assert.equal(legendLayout.a.height,legendLayout.b.height,'Comparison imagery stays aligned with a combined legend');
'''
assert token in s;s=s.replace(token,check+token)
token="   const bitmapRoundTrip=await page.evaluate(async()=>{"
check='''   if(viewport.width>650)assert.equal(await page.locator('#legend-bands-a').evaluate(el=>el.closest('.layer-legend').getBoundingClientRect().height),58,'Ordinary layers retain the compact legend');
   if(process.env.SNOWLINE_COMPOSITE_SMOKE==='1'){console.log(JSON.stringify({viewport,compositeSmokePassed:true}));await page.close();continue;}
'''
assert token in s;s=s.replace(token,check+token);f.write_text(s)
