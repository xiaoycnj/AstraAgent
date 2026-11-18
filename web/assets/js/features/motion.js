// Animate visibility changes once. Streaming text mutations never replay an entrance.
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const active = new Map();
  const visibility = new WeakMap();
  const seenMessages = new WeakSet();
  const surfaces = [
    '.view', '[data-panel]', '[role=menu]', '[role=listbox]', '[role=tooltip]', '[role=tabpanel]', '.floating-control', '.command-menu', '.session-context-menu',
    '.workbench-drawer', '.resource-panel', '.integration-pane', '.conversation-preview',
    '.token-tooltip', '.rail-tooltip', '.composer-options-panel', '.compact-app-menu-list',
    '.conversation-mode-menu', '.app-menu-panel', '.sidebar', '.welcome',
    '.destination-page', '.provider-expanded', '.activity-rail', '.composer-shelf',
    '.conversation-latest', '.execution-recovery', '#chat-error', '#voice-input-status',
  ].join(',');
  const reduced = () => preference.matches || root.dataset.motion === 'reduced';
  const visible = element => element.isConnected && !element.hidden &&
    !element.closest('[hidden], details:not([open]) > :not(summary)') &&
    !!element.getClientRects().length;

  function enter(element, {page = false, message = false} = {}) {
    if (reduced() || !visible(element) || typeof element.animate !== 'function') return;
    active.get(element)?.cancel();
    const styles = getComputedStyle(root);
    const duration = parseFloat(styles.getPropertyValue(page ? '--motion-page' : '--motion-panel'));
    const frames = message ? [{opacity: 0}, {opacity: 1}] :
      [{opacity: 0, translate: '0 4px'}, {opacity: 1, translate: '0 0'}];
    const animation = element.animate(frames, {
      duration: duration || 180, easing: styles.getPropertyValue('--motion-ease').trim(),
    });
    animation.id = 'astra-enter';
    active.set(element, animation);
    const clean = () => {if (active.get(element) === animation) active.delete(element);};
    animation.onfinish = clean;
    animation.oncancel = clean;
  }

  function sync(element) {
    const showing = visible(element);
    const previous = visibility.get(element);
    visibility.set(element, showing);
    if (showing && previous !== true) enter(element, {page: element.matches('.view,.destination-page')});
    else if (!showing) active.get(element)?.cancel();
  }
  for (const element of document.querySelectorAll(surfaces)) visibility.set(element, visible(element));
  for (const element of document.querySelectorAll('#messages > .message')) seenMessages.add(element);

  new MutationObserver(records => {
    const changed = new Set(), messages = new Set();
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target;
        if (target.matches(surfaces)) changed.add(target);
        if (record.attributeName === 'hidden')
          for (const child of target.querySelectorAll(surfaces)) changed.add(child);
        if (record.attributeName === 'open' && target.tagName === 'DETAILS') {
          for (const child of target.children) if (child.tagName !== 'SUMMARY') changed.add(child);
        }
        // Class changes include status updates. Only open/show changes affect visibility.
      } else {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('#messages > .message') && !seenMessages.has(node)) messages.add(node);
          if (node.matches(surfaces)) changed.add(node);
          // Rich Markdown may contain arbitrary elements. Its text is managed by the renderer.
          if (!node.closest('.markdown,.CodeMirror'))
            for (const child of node.querySelectorAll(surfaces)) changed.add(child);
        }
      }
    }
    for (const element of changed) sync(element);
    for (const element of messages) {
      seenMessages.add(element);
      if (messages.size <= 2) enter(element, {message: true});
    }
    for (const [element, animation] of active) if (!element.isConnected) animation.cancel();
  }).observe(document.body, {subtree: true, childList: true, attributes: true,
    attributeFilter: ['hidden', 'open', 'class']});

  function syncPreference() {
    if (reduced()) for (const animation of [...active.values()]) animation.cancel();
  }
  preference.addEventListener('change', syncPreference);
  new MutationObserver(syncPreference).observe(root, {attributes: true, attributeFilter: ['data-motion']});
})();
