const status = document.querySelector('#workspace-load-status');
const retry = document.querySelector('.workspace-load-retry');
const controls = document.querySelectorAll('[data-window-action]');
window.setWorkspaceLoading = (phase, message) => {
  status.textContent = message;
  retry.hidden = phase !== 'failed';
};
window.configureWorkspaceLoading = labels => {
  status.textContent = labels.status;
  retry.textContent = labels.retry;
  for (const button of controls) {
    const label = labels[button.dataset.windowAction];
    button.title = label;
    button.setAttribute('aria-label',label);
  }
};
for (const button of controls) button.onclick = () => window.pywebview?.api.window_control(button.dataset.windowAction);
retry.onclick = () => window.pywebview?.api.retry();
document.querySelector('.loading-chrome').addEventListener('mousedown', event => {
  if (event.button === 0 && event.target === event.currentTarget) window.pywebview?.api.window_drag();
});
