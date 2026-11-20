// Animate visibility changes once. Streaming text mutations never replay an entrance.
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const active = new Map();
  const visibility = new WeakMap();
  const seenMessages = new WeakSet();
  const menus = CSS.supports('interactivity', 'inert') ?
    '#conversation-menu,#model-picker,#reasoning-popover,.rail-menu,.select-menu,[popover]' : '[popover]';
  const surfaces = [
    '.view', '[data-panel]', '[role=menu]', '[role=listbox]', '[role=tooltip]', '[role=tabpanel]', '.floating-control', '.command-menu', '.session-context-menu',
    '.workbench-drawer', '.resource-panel', '.integration-pane', '.conversation-preview',
    '.token-tooltip', '.rail-tooltip', '.composer-options-panel', '.compact-app-menu-list',
    '.conversation-mode-menu', '.app-menu-panel', '.welcome',
    '.destination-page', '.provider-expanded', '.activity-rail', '.composer-shelf',
    '.conversation-latest', '.execution-recovery', '#chat-error', '#voice-input-status',
  ].join(',');
  const elasticSurfaces = '[role=menu],[role=listbox],.floating-control,.composer-options-panel,.command-menu';
  const reduced = () => preference.matches || root.dataset.motion === 'reduced';
  const visible = element => element.isConnected && !element.hidden &&
    !element.closest('[hidden], details:not([open]) > :not(summary)') &&
    !!element.getClientRects().length;
  const canEnter = element => !reduced() && !element.closest('[data-reduced-motion="true"]') &&
    visible(element) && typeof element.animate === 'function';

  function play(element, frames, options, id = 'astra-enter') {
    active.get(element)?.cancel();
    const animation = element.animate(frames, options);
    animation.id = id;
    active.set(element, animation);
    const clean = () => {if (active.get(element) === animation) active.delete(element);};
    animation.onfinish = clean;
    animation.oncancel = clean;
    return animation;
  }

  function enter(element, {page = false, message = false} = {}) {
    if (!canEnter(element) || element.closest(`${menus},[popover]`)) return;
    const styles = getComputedStyle(root);
    if (message) {
      play(element, [{opacity: .35}, {opacity: 1}], {duration: parseFloat(styles.getPropertyValue('--motion-message')), easing: 'ease-out'});
      return;
    }
    const elastic = element.matches(elasticSurfaces);
    const offset = element.matches('.workbench-drawer') ? '26px 0' : page ? '0 16px' : elastic ? '0 9px' : '0 7px';
    // Spatial spring and opacity have separate curves: text gets readable before the settling tail.
    const spring = styles.getPropertyValue(page ? '--motion-spatial' : '--motion-spring').trim();
    let start = {translate: offset, easing: spring};
    let end = {translate: '0 0'};
    if (elastic) {
      start = {...start, scale: styles.getPropertyValue('--motion-scale-enter').trim()};
      end = {...end, scale: '1'};
    }
    play(element, [
      {...start, offset: 0},
      {opacity: page ? .52 : .42, easing: 'ease-out', offset: 0},
      {opacity: 1, offset: .52},
      {...end, offset: 1},
    ], {duration: parseFloat(styles.getPropertyValue(page ? '--motion-page' : '--motion-panel')) || 300});
  }

  const conversation = document.querySelector('#messages');
  conversation?.addEventListener('astra:session-enter', () => {
    // History and the empty state enter as a group, not again in the mutation observer.
    for (const node of conversation.children) {
      if (node.matches('.message')) seenMessages.add(node);
      if (node.matches('.welcome')) visibility.set(node, visible(node));
    }
    if (!canEnter(conversation)) return;
    // Keep the scroll viewport fixed and let rapid switches share the fade already in flight.
    const current = active.get(conversation);
    if (current?.pending || current?.playState === 'running') return;
    const styles = getComputedStyle(root);
    play(conversation, [{opacity: .72}, {opacity: 1}], {
      duration: parseFloat(styles.getPropertyValue('--motion-control')) || 140,
      easing: styles.getPropertyValue('--motion-ease').trim(),
    }, 'astra-session-enter');
  });

  // A single marker follows selection within each rail group. Do not fly across empty screen
  // space between top and bottom groups, or outside independently scrolling rail layouts.
  const rail = document.querySelector('.app-rail');
  const marker = document.createElement('i');
  marker.className = 'rail-motion-marker';
  marker.setAttribute('aria-hidden', 'true');
  marker.hidden = true;
  rail?.append(marker);
  let markerTarget, markerGroup, railButton, railFrame = 0, railAnimation;
  const round = n => +n.toFixed(4);
  const omega = 23, damping = 16, period = Math.sqrt(omega ** 2 - damping ** 2);
  // The sampled critically-near-damped response is handed to WAAPI, not ticked by JS.
  // On retarget, recover instantaneous position and velocity from the old trajectory.
  function springFor(from, to, velocity) {
    const delta = from - to;
    const tangent = (velocity + damping * delta) / period;
    return t => to + Math.exp(-damping * t) * (delta * Math.cos(period * t) + tangent * Math.sin(period * t));
  }
  function syncRail(animate) {
    if (!rail) return;
    const next = rail.querySelector('.rail-button[aria-current="page"]') || rail.querySelector('.rail-button.active');
    if (next !== railButton) {
      if (railButton) railResize.unobserve(railButton);
      railButton = next;
      if (next) railResize.observe(next);
    }
    const box = next?.getBoundingClientRect(), railBox = rail.getBoundingClientRect();
    const showing = !reduced() && !rail.closest('[data-reduced-motion="true"]') &&
      !document.body.classList.contains('layout-navigation-custom') && box?.width && box?.height && railBox.height;
    if (!showing) {
      active.get(marker)?.cancel();
      marker.hidden = true;
      markerTarget = markerGroup = railAnimation = undefined;
      return;
    }
    // Ignore hover and press transforms when the button is positioned relative to the rail.
    const y = (next.offsetParent === rail ? next.offsetTop + next.offsetHeight / 2 :
      box.top - railBox.top + box.height / 2) - 6;
    const group = next.parentElement;
    if (markerTarget != null && Math.abs(markerTarget - y) < .15) return;
    let from = markerTarget, velocity = 0;
    if (railAnimation?.animation.playState === 'running') {
      const t = Math.min(.42, Number(railAnimation.animation.currentTime) / 1000);
      from = railAnimation.at(t);
      velocity = (railAnimation.at(t + .001) - railAnimation.at(t - .001)) / .002;
    }
    marker.hidden = false;
    marker.style.translate = `0 ${y}px`;
    markerTarget = y;
    if (animate && group === markerGroup && Number.isFinite(from) && typeof marker.animate === 'function') {
      const styles = getComputedStyle(root);
      const duration = parseFloat(styles.getPropertyValue('--motion-rail'));
      if (!['spring', undefined].includes(root.dataset.motionStyle)) {
        const animation = play(marker, [{translate: `0 ${from}px`, scale: '1'}, {translate: `0 ${y}px`, scale: '1'}],
          {duration, easing: styles.getPropertyValue('--motion-spring').trim()}, 'astra-rail-spring');
        railAnimation = {animation, at: () => parseFloat(getComputedStyle(marker).translate.split(' ')[1])};
        markerGroup = group;
        return;
      }
      const at = springFor(from, y, velocity);
      const count = 28, direction = Math.sign(y - from);
      const frames = Array.from({length: count + 1}, (_, i) => {
        const t = i / count * .42;
        const speed = (at(t + .001) - at(t - .001)) / .002;
        const stretch = Math.min(.8, Math.abs(speed) / 1050);
        return {translate: `0 ${round(i === count ? y : at(t))}px`,
          scale: `1 ${round(i === count ? 1 : 1 + stretch)}`, transformOrigin: direction > 0 ? 'center top' : 'center bottom'};
      });
      railAnimation = {animation: play(marker, frames, {duration}, 'astra-rail-spring'), at};
    } else {
      active.get(marker)?.cancel();
      railAnimation = undefined;
    }
    markerGroup = group;
  }
  const scheduleRail = () => {
    if (!railFrame) railFrame = requestAnimationFrame(() => {railFrame = 0; syncRail(false);});
  };
  const railResize = new ResizeObserver(scheduleRail);
  if (rail) {
    railResize.observe(rail);
    new MutationObserver(() => syncRail(true)).observe(rail, {subtree: true, childList: true,
      attributes: true, attributeFilter: ['aria-current', 'class']});
    rail.addEventListener('scroll', scheduleRail, true);
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
  syncRail(false);

  new MutationObserver(records => {
    const changed = new Set(), messages = new Set();
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target;
        if (target.matches(surfaces)) changed.add(target);
        if (record.attributeName === 'hidden') {
          for (const child of target.querySelectorAll(surfaces)) changed.add(child);
        }
        if (record.attributeName === 'open' && target.tagName === 'DETAILS') {
          for (const child of target.children) if (child.tagName !== 'SUMMARY') changed.add(child);
        }
        if (target === document.body) scheduleRail();
      } else {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('#messages > .message') && !seenMessages.has(node)) messages.add(node);
          if (node.matches(surfaces)) changed.add(node);
          // Rich Markdown and CodeMirror should not start their own surface entrances.
          if (!node.closest('.markdown,.CodeMirror')) {
            for (const child of node.querySelectorAll(surfaces)) changed.add(child);
          }
        }
      }
    }
    for (const element of changed) sync(element);
    for (const element of messages) {
      seenMessages.add(element);
      if (messages.size <= 2) enter(element, {message: true});
    }
    for (const [element, animation] of active) {
      if (!element.isConnected) visibility.delete(element);
      if (!element.isConnected || element.closest('[data-reduced-motion="true"]')) animation.cancel();
    }
  }).observe(document.body, {subtree: true, childList: true, attributes: true,
    attributeFilter: ['hidden', 'open', 'class', 'data-reduced-motion']});

  function syncPreference() {
    if (reduced()) for (const animation of [...active.values()]) animation.cancel();
    syncRail(false);
  }
  preference.addEventListener('change', syncPreference);
  new MutationObserver(syncPreference).observe(root, {attributes: true, attributeFilter: ['data-motion', 'data-motion-style']});
})();
