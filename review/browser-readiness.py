from pathlib import Path
p=Path('tests/chart-image-browser.mjs')
s=p.read_text()
old="await page.waitForFunction(()=>!document.querySelector('#briefing-preset').disabled);"
new="await page.waitForFunction(()=>document.querySelector('#briefing-preset')&&!document.querySelector('#briefing-preset').disabled);"
assert old in s
p.write_text(s.replace(old,new))
