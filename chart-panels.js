// Keep each panel's DOM and forecast state intact while its contents are hidden.
export function setupChartPanels(root, onToggle) {
  for (const panel of root.querySelectorAll('.chart-card, .agreement-card')) {
    const heading = panel.querySelector('.chart-heading');
    const plot = panel.querySelector('.plot');
    const title = heading.querySelector('h2').textContent;
    const content = document.createElement('div');
    content.id = `${plot.id}-content`;
    content.className = 'chart-content';
    while (heading.nextSibling) content.append(heading.nextSibling);
    panel.append(content);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chart-toggle';
    button.setAttribute('aria-controls', content.id);
    button.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    function update() {
      const label = `${content.hidden ? 'Expand' : 'Collapse'} ${title}`;
      button.setAttribute('aria-expanded', String(!content.hidden));
      button.setAttribute('aria-label', label);
      button.title = label;
      panel.classList.toggle('is-collapsed', content.hidden);
    }
    button.addEventListener('click', () => {
      content.hidden = !content.hidden;
      update();
      onToggle();
    });
    update();
    if (panel.classList.contains('chart-card')) {
      const sizeButton = document.createElement('button');
      sizeButton.type = 'button';
      sizeButton.className = 'chart-size secondary';
      sizeButton.setAttribute('aria-controls', content.id);
      function updateSize() {
        const wide = panel.classList.contains('chart-wide');
        const label = wide ? `Restore standard width for ${title}` : `Show ${title} at full width`;
        sizeButton.setAttribute('aria-pressed', String(wide));
        sizeButton.setAttribute('aria-label', label);
        sizeButton.title = label;
        sizeButton.innerHTML = `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${wide ? 'M8 3v5H3m18 8h-5v5M3 3l5 5m13 13-5-5' : 'M8 3H3v5m13 13h5v-5M3 3l6 6m12 12-6-6'}"/></svg>`;
      }
      sizeButton.addEventListener('click', () => {
        panel.classList.toggle('chart-wide');
        updateSize();
        onToggle();
      });
      updateSize();
      heading.querySelector('.chart-tools').append(sizeButton);
    }
    heading.querySelector('.chart-tools').append(button);
  }
}
