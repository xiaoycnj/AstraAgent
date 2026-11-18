const statusText = document.getElementById('status');
const progress = document.querySelector('progress');
const startup = document.body.dataset.window === 'startup';
const closeButton = document.querySelector('.close');

function configureWindow(labels) {
  for (const node of document.querySelectorAll('[data-label]')) {
    if (labels[node.dataset.label]) node.textContent = labels[node.dataset.label];
  }
  if (labels.close) {
    closeButton.title = labels.close;
    closeButton.setAttribute('aria-label', labels.close);
  }
  if (labels.progress) progress.setAttribute('aria-label', labels.progress);
  if (startup) {
    if (labels.retry) document.querySelector('.retry').textContent = labels.retry;
    if (labels.version) document.getElementById('version').textContent = labels.version;
  } else if (labels.steps) {
    document.querySelector('.steps').setAttribute('aria-label', labels.steps);
  }
}

function setStartupState(phase, text) {
  if (!startup || !['waiting', 'loading', 'failed'].includes(phase)) return;
  document.body.dataset.phase = phase;
  document.body.classList.toggle('failed', phase === 'failed');
  statusText.textContent = text;
  const retry = document.querySelector('.retry');
  if (phase !== 'failed' && document.activeElement === retry) closeButton.focus();
  retry.hidden = phase !== 'failed';
}

function setUpdateState(phase, text, received, total) {
  if (startup || !['waiting', 'download', 'install', 'restart'].includes(phase)) return;
  document.body.classList.remove('failed');
  document.body.dataset.phase = phase;
  if (statusText.textContent !== text) statusText.textContent = text;
  closeButton.hidden = true;
  const details = document.getElementById('error-details');
  details.hidden = true;
  details.open = false;
  const amount = document.getElementById('amount');
  const measured = phase === 'download' && Number.isSafeInteger(total) && total > 0 &&
    Number.isSafeInteger(received) && received >= 0 && received <= total;
  amount.hidden = !measured;
  if (measured) {
    progress.max = total;
    progress.value = received;
    amount.textContent = `${Math.floor(100 * received / total)}%`;
  } else {
    progress.removeAttribute('value');
    progress.removeAttribute('max');
  }
  for (const step of document.querySelectorAll('[data-step]')) {
    if (step.dataset.step === phase) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
}

function setUpdateFailure(message, detail) {
  if (startup) return;
  document.body.classList.add('failed');
  document.getElementById('amount').hidden = true;
  document.getElementById('error-text').textContent = detail;
  document.getElementById('error-details').hidden = !detail;
  closeButton.hidden = false;
  statusText.textContent = message;
}

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => window.pywebview?.api[button.dataset.action]?.());
}
