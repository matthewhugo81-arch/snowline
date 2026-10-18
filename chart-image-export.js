// Export the rendered SVG, with its resolved theme colours and visible window.
// No forecast requests, external assets or HTML-in-SVG rendering are needed.
const FONT = 'Arial, sans-serif';
const SVG_STYLES = ['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','display','font-size','font-weight','text-anchor','dominant-baseline','paint-order','vector-effect'];

export function captureChartImage(chart, info) {
  const source = chart.querySelector('svg');
  if (!source || chart.closest('[hidden]') || !info) throw Error('Open a chart with forecast data first.');
  const panel = chart.closest('.chart-card, .agreement-card');
  const svg = source.cloneNode(true);
  const originals = [source, ...source.querySelectorAll('*')];
  [svg, ...svg.querySelectorAll('*')].forEach((element, index) => {
    const style = getComputedStyle(originals[index]);
    element.removeAttribute('class');
    for (const property of SVG_STYLES) { element.removeAttribute(property); element.style.setProperty(property, style.getPropertyValue(property)); }
    element.style.fontFamily = FONT;
  });
  // Drag selection is a UI control, not forecast evidence.
  [...source.querySelectorAll('.zoom-selection')].forEach(node => svg.children[Array.from(source.children).indexOf(node)]?.remove());
  const {width, height} = source.viewBox.baseVal;
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.width = width + 'px';
  svg.style.height = height + 'px';
  const probe = document.createElement('span');
  panel.append(probe);
  const legend = info.legend.map(entry => {
    probe.style.color = entry.color;
    return {...entry, color:getComputedStyle(probe).color};
  });
  probe.remove();
  const title = panel.querySelector('h2').textContent;
  return {
    ...info, title, legend, width, height,
    svg:new XMLSerializer().serializeToString(svg),
    background:getComputedStyle(panel).backgroundColor,
    ink:getComputedStyle(panel).color,
    muted:getComputedStyle(panel.querySelector('.chart-note, .chart-description')).color,
    unit:panel.querySelector('.unit')?.textContent || '%',
    note:panel.querySelector('.chart-note, .chart-description')?.textContent || '',
    inspection:panel.querySelector('.chart-time, .readout')?.textContent || '',
    total:panel.querySelector('.precipitation-total')?.textContent || '',
    filename:`Snowline-${info.location}-${title}-${info.firstTime.slice(0,10)}`.replace(/[^a-z0-9._-]+/gi,'-').slice(0,180)+'.png'
  };
}

export async function renderChartImage(snapshot) {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([snapshot.svg], {type:'image/svg+xml;charset=utf-8'}));
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error('Unable to render this chart image.'));
      image.src = url;
    });
    const pad = 20, width = Math.ceil(snapshot.width) + pad * 2, scale = 2;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    const rows = [];
    let y = pad;
    function paragraph(text, size = 12, bold = false, color = snapshot.muted) {
      if (!text) return;
      const font = `${bold ? '700 ' : ''}${size}px ${FONT}`;
      ctx.font = font;
      let line = '';
      // Break exceptionally long location names too, keeping mobile exports bounded.
      for (const word of text.split(/\s+/)) {
        if (line && ctx.measureText(line + ' ' + word).width > width - pad * 2) {
          rows.push({text:line, x:pad, y:y + size, font, color}); y += size + 5; line = '';
        }
        for (const char of (line ? ' ' : '') + word) {
          if (ctx.measureText(line + char).width > width - pad * 2) {
            rows.push({text:line, x:pad, y:y + size, font, color}); y += size + 5; line = '';
          }
          line += char;
        }
      }
      rows.push({text:line, x:pad, y:y + size, font, color}); y += size + 8;
    }
    paragraph(`Snowline · ${snapshot.title} (${snapshot.unit})`, 18, true, snapshot.ink);
    paragraph(`${snapshot.location} · ${snapshot.coordinates}`, 12, true, snapshot.ink);
    paragraph(snapshot.period);
    paragraph(snapshot.note);
    paragraph(snapshot.inspection);
    const chartY = y + 4; y = chartY + snapshot.height + 12;
    const legendFont = '12px ' + FONT;
    ctx.font = legendFont;
    let x = pad;
    for (const item of snapshot.legend) {
      const itemWidth = ctx.measureText(item.name).width + 34;
      if (x > pad && x + itemWidth > width - pad) { x = pad; y += 22; }
      rows.push({text:item.name, x:x + 22, y:y + 12, font:legendFont, color:snapshot.ink, swatch:item.color, average:item.average, dashed:item.ensemble, dots:item.dots});
      x += itemWidth;
    }
    if (snapshot.legend.length) y += 30;
    paragraph(snapshot.total, 12, true, snapshot.ink);
    paragraph(snapshot.status, 11);
    paragraph('Weather data: Open-Meteo · CC BY 4.0', 10);
    canvas.width = width * scale; canvas.height = Math.ceil(y + pad) * scale;
    ctx.scale(scale, scale);
    ctx.fillStyle = snapshot.background; ctx.fillRect(0, 0, width, canvas.height / scale);
    ctx.drawImage(image, pad, chartY, snapshot.width, snapshot.height);
    for (const row of rows) {
      ctx.fillStyle = row.color; ctx.font = row.font; ctx.fillText(row.text, row.x, row.y);
      if (row.swatch) {
        ctx.strokeStyle = row.swatch; ctx.lineWidth = row.average ? 3 : 2;
        ctx.setLineDash(row.dashed ? [4,3] : []);
        ctx.beginPath();
        if (row.dots) { ctx.fillStyle = row.swatch; ctx.arc(row.x - 14, row.y - 4, 3, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.moveTo(row.x - 22, row.y - 4); ctx.lineTo(row.x - 6, row.y - 4); ctx.stroke(); }
      }
    }
    return {blob:await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Unable to create PNG.')), 'image/png')), filename:snapshot.filename};
  } finally { URL.revokeObjectURL(url); }
}

export function createChartImageMenu({root, getInfo}) {
  const menu = document.createElement('div');
  menu.className = 'meteogram-image-menu'; menu.id = 'meteogram-image-menu'; menu.hidden = true;
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Chart image');
  const copy = document.createElement('button'), save = document.createElement('button'), message = document.createElement('p');
  copy.type = save.type = 'button'; copy.textContent = 'Copy image'; save.textContent = 'Save PNG';
  copy.setAttribute('role', 'menuitem'); save.setAttribute('role', 'menuitem');
  message.setAttribute('role', 'status'); menu.append(copy, save, message); document.body.append(menu);
  let job = null, serial = 0, focusBack = null, closeTimer, preview = null, previewURL = null, openedScroll = null;
  function close(restore = false) {
    serial++; clearTimeout(closeTimer); menu.hidden = true; job = null;
    focusBack?.setAttribute('aria-expanded', 'false');
    if (restore && focusBack?.isConnected) focusBack.focus({preventScroll:true});
  }
  function previewImage(result) {
    if (!preview) {
      preview = document.createElement('dialog'); preview.className = 'meteogram-image-preview'; preview.setAttribute('aria-label', 'Chart image preview');
      const dismiss = document.createElement('button'), note = document.createElement('p'), link = document.createElement('a'), image = document.createElement('img');
      dismiss.type = 'button'; dismiss.textContent = 'Close'; dismiss.onclick = () => preview.close();
      note.textContent = 'Direct copying is unavailable in this browser. Hold or right-click the image to copy it, or use Save PNG.';
      link.textContent = 'Save PNG'; image.alt = 'Snowline meteogram with location, forecast period and model legend';
      preview.append(dismiss, note, link, image); document.body.append(preview);
      preview.addEventListener('close', () => { URL.revokeObjectURL(previewURL); previewURL = null; image.removeAttribute('src'); focusBack?.focus({preventScroll:true}); });
    }
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = URL.createObjectURL(result.blob);
    preview.querySelector('img').src = previewURL;
    const link = preview.querySelector('a'); link.href = previewURL; link.download = result.filename;
    preview.showModal();
  }
  async function perform(kind) {
    if (!job) return;
    const pending = job, token = serial;
    copy.disabled = save.disabled = true; message.textContent = kind === 'copy' ? 'Copying image…' : 'Preparing PNG…';
    try {
      if (kind === 'copy') {
        try {
          if (!navigator.clipboard?.write || !globalThis.ClipboardItem) throw Error('Clipboard unavailable');
          // Start the write during the click. Safari requires user activation even
          // when producing PNG bytes asynchronously; ClipboardItem accepts a promise.
          await navigator.clipboard.write([new ClipboardItem({'image/png':pending.then(result => result.blob)})]);
        } catch {
          const result = await pending;
          if (token !== serial) return;
          close(); previewImage(result); return;
        }
      } else {
        const result = await pending;
        if (token !== serial) return;
        const url = URL.createObjectURL(result.blob), link = document.createElement('a');
        link.href = url; link.download = result.filename; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      if (token === serial) { message.textContent = kind === 'copy' ? 'Image copied.' : 'PNG download started.'; closeTimer = setTimeout(() => close(true), 1200); }
    } catch (error) { if (token === serial) message.textContent = error.message || 'Unable to prepare this chart image.'; }
    finally { if (token === serial) copy.disabled = save.disabled = false; }
  }
  copy.addEventListener('click', () => { void perform('copy'); });
  save.addEventListener('click', () => { void perform('save'); });
  function open(chart, position, trigger = chart) {
    close(); focusBack = trigger; const token = serial;
    message.textContent = ''; copy.disabled = save.disabled = false;
    try { job = renderChartImage(captureChartImage(chart, getInfo(chart.id))); }
    catch (error) { job = Promise.reject(error); }
    job.catch(error => { if (token === serial) { message.textContent = error.message; copy.disabled = save.disabled = true; } });
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    openedScroll = {x:scrollX,y:scrollY};
    const box = menu.getBoundingClientRect(), anchor = trigger.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(position?.x ?? anchor.left, document.documentElement.clientWidth - box.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(position?.y ?? anchor.bottom, document.documentElement.clientHeight - box.height - 8)) + 'px';
    copy.focus({preventScroll:true});
  }
  function setup() {
    for (const panel of root.querySelectorAll('.chart-card, .agreement-card')) {
      const chart = panel.querySelector('.plot'), button = document.createElement('button');
      button.type = 'button'; button.className = 'chart-image-button secondary';
      button.setAttribute('aria-label', 'Copy or save ' + panel.querySelector('h2').textContent + ' image');
      button.title = 'Copy or save chart image'; button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', menu.id);
      button.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
      const controls = panel.querySelector('.chart-tools'); controls.insertBefore(button, controls.querySelector('.chart-size, .chart-toggle'));
      button.addEventListener('click', () => open(chart, null, button));
      chart.setAttribute('aria-haspopup', 'menu'); chart.setAttribute('aria-controls', menu.id);
    }
  }
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target)) close(); }, true);
  document.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); (event.key === 'Home' ? copy : event.key === 'End' ? save : document.activeElement === copy ? save : copy).focus(); }
    else if (event.key === 'Tab') close();
  }, true);
  window.addEventListener('resize', () => close());
  // Scrolling a button into view can queue a scroll event before the menu opens.
  // Close only when the viewport has actually moved since positioning the menu.
  window.addEventListener('scroll', () => { if (openedScroll && (scrollX !== openedScroll.x || scrollY !== openedScroll.y)) close(); }, true);
  return {open, close, setup};
}
