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
    heading.querySelector('.chart-tools').append(button);
  }
}
