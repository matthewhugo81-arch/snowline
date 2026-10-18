import {indexAtX, selectionRange, transformRange} from './chart-window.js?v=20261015-touch-zoom';

// Single-finger scrolling stays native. Only a two-finger gesture that starts
// inside one graph is consumed; wheel events and page zoom outside stay native.
export function createChartZoom({root, getLayout, getWindow, onZoom, onInspect, onReset, onFinish, onContextMenu, onDragStart}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const format = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'UTC'});
  const listeners = new AbortController();
  let drag = null, pinch = null, suppressClickUntil = 0, suppressContextUntil = 0, lastClick = null;
  const listen = (target, event, handler, options = {}) => target.addEventListener(event, handler, {...options, signal:listeners.signal});
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
  function clearPinch() {
    if (!pinch) return;
    pinch.chart.classList.remove('zoom-pinching');
    pinch = null;
    lastClick = null;
    suppressClickUntil = performance.now() + 500;
    onFinish();
  }
  function cancel() { clearDrag(true); clearPinch(); }
  function touchGeometry(chart, touches, layout) {
    const a = point(chart, touches[0]), b = point(chart, touches[1]);
    if (!a || !b) return null;
    return {midpoint:((a.x + b.x) / 2 - layout.left) / layout.inner,
      distance:Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY)};
  }
  listen(root, 'touchstart', event => {
    if (pinch) { if (event.cancelable) event.preventDefault(); return; }
    if (drag || event.touches.length !== 2 || !event.cancelable) return;
    const touches = [...event.touches], chart = chartFor(event), layout = chart && getLayout(chart.id);
    if (!layout || layout.n < 2 || !touches.every(t => chart.contains(t.target) && inside(point(chart, t), layout))) return;
    const geometry = touchGeometry(chart, touches, layout);
    if (!geometry || geometry.distance < 24) return;
    event.preventDefault();
    lastClick = null;
    pinch = {chart, layout, window:getWindow(), ids:touches.map(t => t.identifier), ...geometry, finished:false};
    chart.classList.add('zoom-pinching');
  }, {passive:false});
  listen(root, 'touchmove', event => {
    if (!pinch) return;
    if (!event.cancelable) { clearPinch(); return; }
    event.preventDefault();
    // Wait for all fingers to lift after either original finger is released.
    if (pinch.finished || event.touches.length !== 2) return;
    const touches = pinch.ids.map(id => [...event.touches].find(t => t.identifier === id));
    if (touches.some(t => !t)) return;
    const geometry = touchGeometry(pinch.chart, touches, pinch.layout);
    if (!geometry) return;
    const range = transformRange(pinch.window, {length:pinch.window.length, scale:geometry.distance / pinch.distance,
      anchor:pinch.midpoint, midpoint:geometry.midpoint});
    const current = getWindow();
    if (range && (range.start !== current.start || range.end !== current.end)) onZoom(range);
  }, {passive:false});
  listen(root, 'touchend', event => {
    if (!pinch) return;
    if (event.cancelable) event.preventDefault();
    if ([...event.changedTouches].some(t => pinch.ids.includes(t.identifier))) pinch.finished = true;
    if (!event.touches.length) clearPinch();
  }, {passive:false});
  listen(root, 'touchcancel', clearPinch);
  function clearDrag(suppressMenu = false) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (previous.button === 2 && (suppressMenu || previous.moved || previous.menuOpened)) suppressContextUntil = performance.now() + 500;
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
    if (drag || pinch || event.pointerType === 'touch') return;
    if (event.button === 2) suppressContextUntil = 0;
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
    drag = {chart, layout, band, anchor:p.x, clientX:event.clientX, clientY:event.clientY, moved:false, pointerId:event.pointerId, button:right ? 2 : 0};
    chart.classList.add('zoom-selecting');
    chart.focus({preventScroll:true});
    try { chart.setPointerCapture(event.pointerId); } catch { /* Window listeners also handle release outside the chart. */ }
    paint(p.x);
  });
  listen(window, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pressed = drag.button === 2 ? 2 : 1;
    if (!(event.buttons & pressed)) { clearDrag(); return; }
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 6) {
      drag.moved = true;
      // A browser can request its menu on mouse-down. If the user continues
      // dragging, dismiss that menu and retain the original zoom anchor.
      onDragStart?.();
    }
    const p = point(drag.chart, event);
    if (p) paint(p.x);
  });
  listen(window, 'pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const p = point(drag.chart, event);
    const range = p && Math.abs(event.clientX - drag.clientX) >= 6 ? selectionRange(drag.anchor, p.x, drag.layout) : null;
    const menuChart = drag.button === 2 && !drag.menuOpened && !drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 6 ? drag.chart : null;
    if (drag.button === 2) suppressContextUntil = performance.now() + 500;
    if (drag.button === 0) suppressClickUntil = performance.now() + 400;
    clearDrag();
    if (range) onZoom(range);
    else if (menuChart) onContextMenu?.(menuChart, {x:event.clientX, y:event.clientY});
  });
  listen(window, 'pointercancel', event => { if (drag?.pointerId === event.pointerId) clearDrag(); });
  listen(root, 'lostpointercapture', event => { if (drag?.pointerId === event.pointerId) clearDrag(); });
  listen(window, 'blur', cancel);
  listen(window, 'resize', cancel);
  listen(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
  listen(root, 'contextmenu', event => {
    // The title, legend and totals are part of the chart too. Zoom gestures
    // remain restricted to the plot, while export works across its panel.
    const chart = chartFor(event) ?? event.target.closest?.('.chart-card, .agreement-card')?.querySelector('.plot');
    if (!chart || !root.contains(chart)) return;
    if (event.pointerType === 'touch' || event.shiftKey) return;
    event.preventDefault();
    // Honour the contextmenu request itself: some browsers follow it with
    // pointercancel/lostpointercapture, so waiting for pointerup loses clicks.
    if (drag ? drag.button !== 2 || drag.moved || drag.menuOpened : performance.now() < suppressContextUntil) return;
    if (drag) drag.menuOpened = true;
    onContextMenu?.(chart, event.clientX || event.clientY ? {x:event.clientX, y:event.clientY} : null);
  });
  listen(root, 'click', event => {
    if (event.target.closest?.('[data-reset-zoom]')) { cancel(); lastClick = null; onReset(); return; }
    const chart = chartFor(event);
    if (!chart || event.button !== 0 || drag || pinch || performance.now() < suppressClickUntil) return;
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
    const chart = document.activeElement;
    if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && chart?.matches('.plot') && root.contains(chart)) {
      event.preventDefault(); suppressContextUntil = performance.now() + 500; onContextMenu?.(chart, null); return;
    }
    if (event.key !== 'Escape') return;
    if (drag || pinch) { event.preventDefault(); cancel(); return; }
    if (document.activeElement?.matches('.plot') && root.contains(document.activeElement)) onReset();
  });
  // Touch targets are the stable .plot containers, so pinch can render live.
  // Mouse selection keeps its original SVG/band until release.
  return {get active() { return Boolean(drag); }, cancel, destroy() { cancel(); listeners.abort(); }};
}
