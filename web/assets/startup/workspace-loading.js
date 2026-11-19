(() => {
  const url = new URL(location.href);
  const desktopLaunch = url.searchParams.get('desktop-loading') === '1';
  const reloading = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  if (desktopLaunch) {
    url.searchParams.delete('desktop-loading');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  const root = document.documentElement, tasks = new Set();
  const bootLoading = desktopLaunch || reloading;
  const staticStartup = matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
  const reduceMotion = () => staticStartup.matches || root.dataset.motion === 'reduced';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const loader = () => document.getElementById('workspace-loading');
  const workspace = () => document.getElementById('app');
  const translate = text => typeof uiText === 'function' ? uiText(text) : text;
  let cycle;
  let navigating = false;

  function start(label, boot = false) {
    const app = workspace();
    const overlay = loader();
    overlay.querySelector('[role=status]').textContent = translate(label);
    const current = {started: performance.now(), pending: 0, generation: 0, boot,
      app, inert: app.inert, focus: document.activeElement};
    root.dataset.workspaceLoadingKind = boot ? 'boot' : 'reload';
    root.dataset.workspaceLoading = 'waiting';
    if (!boot) {
      app.inert = true;
      overlay.focus({preventScroll: true});
    }
    return cycle = current;
  }

  async function finish(current, generation) {
    const stillDone = () => cycle === current && !navigating && !current.pending && current.generation === generation;
    if (!reduceMotion()) {
      const remaining = 900 - (performance.now() - current.started);
      if (remaining > 0) await wait(remaining);
    }
    if (!stillDone()) return;
    if (!reduceMotion()) {
      root.dataset.workspaceLoading = 'leaving';
      await wait(430);
    }
    if (!stillDone()) return;
    delete root.dataset.workspaceLoading;
    delete root.dataset.workspaceLoadingKind;
    cycle = null;
    if (!current.boot) {
      current.app.inert = current.inert;
      if (document.activeElement === loader() || document.activeElement === document.body) {
        const menu = current.focus?.closest('details:not([open])');
        (menu?.querySelector(':scope > summary') ?? current.focus)?.focus({preventScroll: true});
      }
    }
  }

  window.workspaceLoading = {
    track(promise) {
      if (!bootLoading || !promise) return;
      const task = Promise.resolve(promise);
      tasks.add(task);
      const remove = () => tasks.delete(task);
      task.then(remove, remove);
    },
    async run(label, task) {
      const current = cycle ?? start(label);
      if (root.dataset.workspaceLoading === 'leaving') {
        current.started = performance.now();
        root.dataset.workspaceLoading = 'waiting';
      }
      current.pending++;
      current.generation++;
      try { return await task(); }
      finally {
        if (!--current.pending) await finish(current, current.generation);
      }
    },
    reload({cover = true} = {}) {
      if (navigating) return;
      if (cover) {
        loader().querySelector('[role=status]').textContent = translate('正在重新加载工作空间');
        if (!cycle) start('正在重新加载工作空间');
        root.dataset.workspaceLoading = 'waiting';
        navigating = true;
      }
      // A real reload keeps the current route and the browser's unsaved-work guard.
      location.reload();
    },
    get active() { return root.hasAttribute('data-workspace-loading'); },
  };

  // Keep global app shortcuts from operating on an inert workspace.
  document.addEventListener('keydown', event => {
    if (!root.hasAttribute('data-workspace-loading') || event.target.closest?.('.window-controls')) return;
    if (event.key !== 'Tab') event.stopImmediatePropagation();
  }, true);

  if (!bootLoading) return;
  root.dataset.workspaceLoadingKind = 'boot';
  root.dataset.workspaceLoading = 'preparing';
  document.addEventListener('DOMContentLoaded', async () => {
    const current = start(reloading ? '正在重新加载工作空间' : '正在准备工作空间', true);
    current.pending++;
    while (tasks.size) await Promise.allSettled([...tasks]);
    current.pending--;
    await finish(current, current.generation);
  },{once:true});
})();
