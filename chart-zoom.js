import {indexAtX, selectionRange} from './chart-window.js?v=20261012-zoom';

// No wheel or touch-drag interception: normal scrolling and tap-to-inspect remain.
export function createChartZoom({root, getLayout, onZoom, onInspect, onReset, onFinish}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const format = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'UTC'});
  const listeners = new AbortController();
  let drag = null, suppressClickUntil = 0, lastClick = null;
  const listen = (target, event, handler) => target.addEventListener(event, handler, {signal:listeners.signal});
  function chartFor(event) {
    const chart = event.target.closest?.('.plot');
    return chart && root.contains(chart) && getLayout(chart.id) ? chart : null;
  }
  function point(chart, event) {
    const matrix = chart.querySelector('svg')?.getScreenCTM();
    if (!matrix) return null;
    // Accounts for SVG letterboxing, mobile CSS heights and browser scaling.
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  function inside(p, layout) {
    return p && p.x >= layout.left && p.x <= layout.left + layout.inner && p.y >= layout.top && p.y <= layout.height - layout.bottom;
  }
  function clearDrag() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    previous.band.remove();
    previous.chart.classList.remove('zoom-selecting');
    try { if (previous.chart.hasPointerCapture(previous.pointerId)) previous.chart.releasePointerCapture(previous.pointerId); } catch {}
    onFinish();
  }
  function paint(x) {
    const {layout, band, anchor} = drag;
    const first = indexAtX(anchor, layout), last = indexAtX(x, layout);
    const px = index => layout.left + (index - layout.start) / Math.max(1, layout.n - 1) * layout.inner;
    const lo = Math.min(first, last), hi = Math.max(first, last);
    const rect = band.firstElementChild;
    rect.setAttribute('x', px(lo));
    rect.setAttribute('width', Math.max(1, px(hi) - px(lo)));
    const label = band.lastElementChild;
    label.textContent = `${format.format(new Date(layout.times[lo - layout.start]))} → ${format.format(new Date(layout.times[hi - layout.start]))} UTC`;
  }
  listen(root, 'pointerdown', event => {
    if (drag || event.pointerType === 'touch') return;
    const right = event.button === 2 && !event.shiftKey;
    const alternate = event.button === 0 && event.shiftKey;
    if (!right && !alternate) return;
    const chart = chartFor(event), layout = chart && getLayout(chart.id);
    const p = chart && point(chart, event);
    if (!layout || layout.n < 2 || !inside(p, layout)) return;
    event.preventDefault();
    lastClick = null;
    const band = document.createElementNS(svgNS, 'g');
    band.setAttribute('class', 'zoom-selection');
    band.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('y', layout.top);
    rect.setAttribute('height', layout.height - layout.bottom - layout.top);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', layout.left + layout.inner / 2);
    label.setAttribute('y', layout.top + 14);
    label.setAttribute('text-anchor', 'middle');
    band.append(rect, label);
    chart.querySelector('svg').append(band);
    drag = {chart, layout, band, anchor:p.x, clientX:event.clientX, pointerId:event.pointerId, button:right ? 2 : 0};
    chart.classList.add('zoom-selecting');
    chart.focus({preventScroll:true});
    try { chart.setPointerCapture(event.pointerId); } catch { /* Window listeners also handle release outside the chart. */ }
    paint(p.x);
  });
  listen(window, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pressed = drag.button === 2 ? 2 : 1;
    if (!(event.buttons & pressed)) { clearDrag(); return; }
    const p = point(drag.chart, event);
    if (p) paint(p.x);
  });
  listen(window, 'pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const p = point(drag.chart, event);
    const range = p && Math.abs(event.clientX - drag.clientX) >= 6 ? selectionRange(drag.anchor, p.x, drag.layout) : null;
    if (drag.button === 0) suppressClickUntil = performance.now() + 400;
    clearDrag();
    if (range) onZoom(range);
  });
  listen(window, 'pointercancel', event => { if (drag?.pointerId === event.pointerId) clearDrag(); });
  listen(root, 'lostpointercapture', event => { if (drag?.pointerId === event.pointerId) clearDrag(); });
  listen(window, 'blur', clearDrag);
  listen(window, 'resize', clearDrag);
  listen(document, 'visibilitychange', () => { if (document.hidden) clearDrag(); });
  listen(root, 'contextmenu', event => {
    if (chartFor(event) && event.pointerType !== 'touch' && !event.shiftKey && (event.button === 2 || drag)) event.preventDefault();
  });
  listen(root, 'click', event => {
    if (event.target.closest?.('[data-reset-zoom]')) { onReset(); return; }
    const chart = chartFor(event);
    if (!chart || event.button !== 0 || drag || performance.now() < suppressClickUntil) return;
    // Re-rendering replaces the SVG after inspection; track the stable plot for double-click reset.
    const now = performance.now();
    if (lastClick?.chart === chart && now - lastClick.at < 350 && Math.abs(event.clientX - lastClick.x) < 6 && Math.abs(event.clientY - lastClick.y) < 6) {
      lastClick = null; onReset(); return;
    }
    lastClick = {chart, at:now, x:event.clientX, y:event.clientY};
    const p = point(chart, event), layout = getLayout(chart.id);
    if (p) onInspect(indexAtX(p.x, layout));
  });
  listen(root, 'dblclick', event => { if (chartFor(event) && !event.shiftKey) { event.preventDefault(); onReset(); } });
  listen(document, 'keydown', event => {
    if (event.key !== 'Escape') return;
    if (drag) { event.preventDefault(); clearDrag(); return; }
    if (document.activeElement?.matches('.plot') && root.contains(document.activeElement)) onReset();
  });
  return {get active() { return Boolean(drag); }, cancel:clearDrag, destroy() { clearDrag(); listeners.abort(); }};
}
