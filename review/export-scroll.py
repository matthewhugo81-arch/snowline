from pathlib import Path
p=Path('tests/chart-image-browser.mjs')
s=p.read_text()
old="  const right=async(target=map)=>{await target.click({button:'right',position:{x:100,y:130}});await menu.waitFor({state:'visible'});};"
new="""  const right=async(target=map)=>{
   // Settle test-driven page scrolling before contextmenu: the actual menu
   // correctly closes on scroll. Click the visible centre so Playwright does
   // not initiate another scroll for an off-screen fixed canvas coordinate.
   await target.scrollIntoViewIfNeeded();
   await target.evaluate(async el=>{
    if(el instanceof HTMLImageElement)await el.decode();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   });
   const box=await target.boundingBox();assert.ok(box,'Chart must have a visible rectangle');
   const left=Math.max(0,box.x),right=Math.min(viewport.width,box.x+box.width);
   const top=Math.max(0,box.y),bottom=Math.min(viewport.height,box.y+box.height);
   assert.ok(right>left&&bottom>top,'Chart must intersect the viewport');
   await page.mouse.click((left+right)/2,(top+bottom)/2,{button:'right'});
   await menu.waitFor({state:'visible'});
  };"""
assert s.count(old)==1
s=s.replace(old,new)
old="   const event=page.waitForEvent('download');await save.click();const download=await event,path=resolve('review-output',name+'.png');await download.saveAs(path);"
new="   const [download]=await Promise.all([page.waitForEvent('download'),save.click()]);const path=resolve('review-output',name+'.png');await download.saveAs(path);"
assert s.count(old)==1
p.write_text(s.replace(old,new))
