from pathlib import Path
p=Path('tests/accumulation-history-browser.mjs')
s=p.read_text()
old="   const saved=page.waitForEvent('download');await page.locator('#previous-grid img').first().click({button:'right'});await page.getByRole('menuitem',{name:'Save image'}).click();const download=await saved;await download.saveAs(`review-output/history-export-${viewport.width}.png`);assert.match(download.suggestedFilename(),/precipitation/);await page.keyboard.press('Escape');"
new="""   const exportImage=page.locator('#previous-grid img').first();await exportImage.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>{const img=document.querySelector('#previous-grid img');return img?.complete&&img.naturalWidth>0;});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await exportImage.click({button:'right'});await page.getByRole('menuitem',{name:'Save image'}).waitFor({state:'visible'});
   await page.screenshot({path:`review-output/history-menu-${viewport.width}.png`});
   const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('menuitem',{name:'Save image'}).click()]);
   await download.saveAs(`review-output/history-export-${viewport.width}.png`);assert.match(download.suggestedFilename(),/precipitation/);await page.keyboard.press('Escape');"""
assert s.count(old)==1
p.write_text(s.replace(old,new))
