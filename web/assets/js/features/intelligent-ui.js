// Native, session-owned interactive documents. Model text never becomes executable code.
const iuiDocuments = new Map();
let iuiViewNumber = 0;

function iuiText(value) { return uiText(value); }
function iuiButton(label, callback, className = '') {
  const button = actionButton(iuiText(label), callback, className);
  button.type = 'button';
  return button;
}
function iuiNumber(value) {
  return typeof value === 'number' ? new Intl.NumberFormat(document.documentElement.lang, {maximumFractionDigits: 6}).format(value) : String(value ?? '');
}
async function iuiSave(entry) {
  clearTimeout(entry.timer);
  if (entry.saving) {
    await entry.saving;
    if (!entry.error) return iuiSave(entry);
    return;
  }
  if (!Object.keys(entry.pending).length) return;
  const patch = entry.pending;
  entry.pending = {};
  entry.inFlight = patch;
  entry.error = null;
  entry.saving = (async () => {
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch('/api/iui/' + entry.id + '/state', {
          method: 'POST', headers: {'Content-Type': 'application/json', 'X-App-Token': state.token},
          body: JSON.stringify({session_id: entry.session, revision: entry.data.revision, patch}),
        });
        const result = await response.json();
        if (response.status === 409 && result.current) { entry.data = result.current; continue; }
        if (!response.ok) throw new Error(result.error || iuiText('保存失败，点击重试'));
        entry.data = result;
        return;
      }
      throw new Error(iuiText('交互状态已更新，请重试'));
    } catch (error) {
      entry.pending = {...patch, ...entry.pending};
      entry.error = error;
    } finally {
      entry.inFlight = {};
    }
  })();
  iuiRefresh(entry);
  await entry.saving;
  entry.saving = null;
  iuiRefresh(entry);
  if (!entry.error && Object.keys(entry.pending).length) return iuiSave(entry);
}
function iuiRefresh(entry) {
  for (const view of entry.views) {
    if (!view.host.isConnected) { entry.views.delete(view); continue; }
    view.status.textContent = iuiText(entry.error ? '保存失败，点击重试' : entry.saving || Object.keys(entry.pending).length ? '正在保存…' : '已保存到此会话');
    view.retry.hidden = !entry.error;
    for (const button of view.submitButtons || []) button.disabled = !!entry.responding || submitting || state.pending.has(entry.session);
    if (view.responseFeedback) view.responseFeedback.textContent = entry.responseError || '';
    for (const control of view.controls) {
      const value = entry.pending[control.path] ?? entry.inFlight?.[control.path] ?? entry.data.state[control.path];
      if (control.input !== document.activeElement) {
        if (control.input.type === 'checkbox' || control.input.type === 'radio') control.input.checked = control.option === undefined ? value : value === control.option;
        else control.input.value = value;
      }
      if (control.output) control.output.textContent = iuiNumber(value);
      if (control.feedback) {
        const block = control.block;
        const chosen = block.items.find(item => item.id === value);
        control.feedback.textContent = !chosen ? '' : iuiText(chosen.correct ? '回答正确' : '再想一想') + (chosen.description ? ' · ' + chosen.description : '');
      }
    }
    for (const [id, outputs] of view.outputs) {
      const values = entry.data.outputs[id] || [];
      outputs.forEach((output, index) => {
        const result = values[index];
        output.textContent = !result || result.value === null ? iuiText('填写有效数值后显示结果') : iuiNumber(result.value) + (result.unit ? ' ' + result.unit : '');
      });
    }
  }
}
function iuiChange(entry, path, value) {
  entry.pending[path] = value;
  entry.error = null;
  entry.responseError = '';
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => iuiSave(entry), 300);
  iuiRefresh(entry);
}
function iuiLabel(label, input) {
  const field = elem('label', 'iui-field');
  field.append(elem('span', '', label), input);
  return field;
}
function iuiTable(block, section) {
  const filter = elem('input');
  filter.type = 'search'; filter.placeholder = iuiText('筛选表格'); filter.setAttribute('aria-label', filter.placeholder);
  const scroll = elem('div', 'iui-table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', block.title || iuiText('数据表格'));
  const table = elem('table'), head = elem('thead'), heading = elem('tr'), body = elem('tbody');
  const caption = elem('caption', 'sr-only', block.title || iuiText('数据表格'));
  let sort = -1, ascending = true;
  function draw() {
    let rows = block.rows.filter(row => row.some(cell => String(cell ?? '').toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())));
    if (sort >= 0) rows = rows.slice().sort((a, b) => (typeof a[sort] === 'number' && typeof b[sort] === 'number' ? a[sort] - b[sort] : String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''), document.documentElement.lang, {numeric: true})) * (ascending ? 1 : -1));
    body.replaceChildren();
    for (const row of rows) { const tr = elem('tr'); for (const cell of row) tr.append(elem('td', '', iuiNumber(cell))); body.append(tr); }
    if (!rows.length) { const cell = elem('td', '', iuiText('没有匹配结果')); cell.colSpan = block.columns.length; const row = elem('tr'); row.append(cell); body.append(row); }
    [...heading.children].forEach((cell, index) => {
      if (sort === index) cell.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
      else cell.removeAttribute('aria-sort');
    });
  }
  block.columns.forEach((column, index) => {
    const cell = elem('th'); cell.scope = 'col';
    const button = iuiButton(column, () => { ascending = sort === index ? !ascending : true; sort = index; draw(); });
    button.setAttribute('aria-label', column); cell.append(button); heading.append(cell);
  });
  filter.oninput = draw;
  head.append(heading); table.append(caption, head, body); scroll.append(table); section.append(filter, scroll); draw();
}
function iuiChart(block, section) {
  const toggles = elem('div', 'iui-chart-legend'), plot = elem('div', 'iui-chart');
  const visible = new Set(block.series.map((_, index) => index));
  function draw() {
    plot.replaceChildren();
    const maximum = Math.max(1, ...block.series.flatMap((series, index) => visible.has(index) ? series.values.map(Math.abs) : []));
    block.labels.forEach((label, index) => {
      const row = elem('div', 'iui-chart-row'); row.append(elem('span', 'iui-chart-label', label));
      const bars = elem('div', 'iui-chart-bars');
      block.series.forEach((series, number) => {
        if (!visible.has(number)) return;
        const value = series.values[index], line = elem('div', 'iui-chart-line');
        const track = elem('div', 'iui-chart-track'), bar = elem('span', 'iui-chart-bar');
        bar.style.setProperty('--bar-width', Math.abs(value) / maximum * 50 + '%');
        bar.dataset.negative = String(value < 0); bar.dataset.series = number % 6;
        track.append(bar); line.append(track, elem('span', 'iui-chart-value', series.label + ' ' + iuiNumber(value))); bars.append(line);
      });
      row.append(bars); plot.append(row);
    });
  }
  block.series.forEach((series, index) => {
    const button = iuiButton(series.label, () => { if (visible.has(index)) visible.delete(index); else visible.add(index); button.setAttribute('aria-pressed', String(visible.has(index))); plot.dataset.updated = ''; draw(); });
    button.setAttribute('aria-pressed', 'true'); toggles.append(button);
  });
  section.append(toggles, plot); draw();
}
function iuiBlock(block, entry, view) {
  const section = elem('section', 'iui-block iui-' + block.type);
  if (block.title) section.append(elem('h4', '', block.title));
  if (block.text) section.append(elem('p', 'iui-description', block.text));
  if (block.type === 'text') return section;
  if (block.type === 'table') { iuiTable(block, section); return section; }
  if (block.type === 'chart') { iuiChart(block, section); return section; }
  if (block.type === 'metrics' || block.type === 'cards') {
    const grid = elem('div', 'iui-card-grid');
    for (const item of block.items) {
      const card = elem('div', 'iui-card'); card.append(elem('strong', '', item.label));
      if (item.value !== '') card.append(elem('span', 'iui-metric', iuiNumber(item.value)));
      if (item.description) card.append(elem('p', '', item.description)); grid.append(card);
    }
    section.append(grid); return section;
  }
  if (['checklist', 'choices', 'quiz'].includes(block.type)) {
    const group = elem('fieldset', 'iui-options');
    group.append(elem('legend', 'sr-only', block.title || entry.data.document.title));
    const feedback = elem('p', 'iui-quiz-feedback'); feedback.setAttribute('role', 'status');
    for (const item of block.items) {
      const input = elem('input'); input.type = block.type === 'checklist' ? 'checkbox' : 'radio';
      if (input.type === 'checkbox') input.dataset.nativeCheckbox = '';
      input.name = 'iui-' + view.number + '-' + block.id; input.value = item.id;
      const path = block.type === 'checklist' ? block.id + '/' + item.id : block.id;
      input.onchange = () => iuiChange(entry, path, input.type === 'checkbox' ? input.checked : item.id);
      const label = elem('label', 'iui-option'), copy = elem('span'); copy.append(elem('strong', '', item.label));
      if (item.description && block.type !== 'quiz') copy.append(elem('small', '', item.description));
      label.append(input, copy); group.append(label);
      view.controls.push({input, path, option: input.type === 'radio' ? item.id : undefined, feedback: block.type === 'quiz' ? feedback : null, block});
    }
    section.append(group); if (block.type === 'quiz') section.append(feedback);
    return section;
  }
  if (block.type === 'form') {
    const form = elem('div', 'iui-fields');
    for (const field of block.fields) {
      const input = elem(field.type === 'select' ? 'select' : 'input');
      if (field.type === 'select') for (const option of field.options) input.append(new Option(option, option));
      else input.type = field.type;
      if (field.type === 'checkbox') input.dataset.nativeCheckbox = '';
      input.required = field.required;
      if (field.type === 'text') input.maxLength = 4000;
      if (field.type === 'number' || field.type === 'range') { input.min = field.min; input.max = field.max; input.step = field.step; }
      const output = field.type === 'range' ? elem('output') : null;
      const label = iuiLabel(field.label + (field.required ? ' *' : ''), input);
      if (output) label.append(output);
      const path = block.id + '/' + field.id;
      input.oninput = () => {
        if (!input.validity.valid && input.value !== '') { view.status.textContent = input.validationMessage; return; }
        const value = field.type === 'checkbox' ? input.checked : ['number', 'range'].includes(field.type) && input.value !== '' ? Number(input.value) : input.value;
        iuiChange(entry, path, value);
      };
      view.controls.push({input, path, output}); form.append(label);
    }
    section.append(form);
    const outputs = [];
    for (const result of block.outputs) { const value = elem('output', 'iui-result-value'); const resultRow = elem('div', 'iui-result'); resultRow.append(elem('span', '', result.label), value); section.append(resultRow); outputs.push(value); }
    view.outputs.set(block.id, outputs);
  }
  return section;
}
function iuiResultText(entry) {
  const lines = [entry.data.document.title];
  for (const block of entry.data.document.blocks) {
    if (block.type === 'checklist') for (const item of block.items) lines.push((entry.data.state[block.id + '/' + item.id] ? '[x] ' : '[ ] ') + item.label);
    if (block.type === 'choices' || block.type === 'quiz') { const item = block.items.find(item => item.id === entry.data.state[block.id]); if (item) lines.push((block.title || entry.data.document.title) + ' · ' + item.label); }
    if (block.type === 'form') {
      for (const field of block.fields) lines.push(field.label + ' = ' + iuiNumber(entry.data.state[block.id + '/' + field.id]));
      for (const output of entry.data.outputs[block.id] || []) if (output.value !== null) lines.push(output.label + ' = ' + iuiNumber(output.value) + ' ' + output.unit);
    }
    if (block.prompt) lines.push(block.prompt);
  }
  return lines.join('\n');
}
async function iuiSubmitAnswer(entry, decision) {
  if (entry.responding || submitting || state.pending.has(entry.session) || state.session?.id !== entry.session) return;
  if (!hasModelConnection()) { showSettings(); return; }
  entry.responding = true; entry.responseError = ''; iuiRefresh(entry);
  try {
    if (decision) iuiChange(entry, '$decision', decision);
    await iuiSave(entry);
    if (entry.error) throw entry.error;
    const response = await fetch('/api/iui/' + entry.id + '/respond', {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-App-Token': state.token},
      body: JSON.stringify({session_id: entry.session, revision: entry.data.revision}),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.current) entry.data = result.current;
      throw new Error(result.error || iuiText('提交失败，请重试'));
    }
    if (state.session?.id !== entry.session) return;
    const sent = await sendMessage({preventDefault() {}}, result.content);
    if (!sent) entry.responseError = iuiText('回答尚未发送，请查看消息错误后重试');
  } catch (error) { entry.responseError = error.message; }
  finally { entry.responding = false; iuiRefresh(entry); }
}
function iuiMount(host, entry) {
  const view = {host, number: ++iuiViewNumber, controls: [], outputs: new Map()};
  host.replaceChildren(); host.dataset.iuiReady = 'true'; host.removeAttribute('aria-busy');
  const document = entry.data.document, heading = elem('header', 'iui-heading');
  const purpose = document.purpose || 'display'; host.dataset.iuiPurpose = purpose;
  heading.append(elem('h3', '', document.title)); host.append(heading);
  if (document.description) host.append(elem('p', 'iui-description', document.description));
  const blocks = elem('div', 'iui-blocks'); blocks.dataset.layout = document.layout;
  for (const block of document.blocks) blocks.append(iuiBlock(block, entry, view)); host.append(blocks);
  if (purpose !== 'display') {
    const reply = elem('textarea'); reply.rows = 2; reply.maxLength = 4000;
    reply.setAttribute('aria-label', iuiText('补充回答'));
    reply.oninput = () => iuiChange(entry, '$reply', reply.value);
    host.append(iuiLabel(iuiText('补充回答（可选）'), reply));
    view.controls.push({input: reply, path: '$reply'});
    view.responseFeedback = elem('p', 'iui-response-feedback'); view.responseFeedback.setAttribute('role', 'alert');
    host.append(view.responseFeedback);
  }
  const footer = elem('footer', 'iui-footer');
  view.status = elem('span', 'iui-status'); view.status.setAttribute('role', 'status');
  view.retry = iuiButton('重试', () => iuiSave(entry));
  const followup = iuiButton('将结果加入输入框', async () => {
    await iuiSave(entry);
    if (entry.error) { toast(entry.error.message); return; }
    if (state.session?.id !== entry.session) return;
    const input = $('#chat-input'), previous = input.value.trimEnd();
    input.value = (previous ? previous + '\n\n' : '') + iuiResultText(entry);
    input.dispatchEvent(new Event('input', {bubbles: true})); input.focus();
  });
  footer.append(view.status, view.retry);
  view.submitButtons = [];
  if (purpose === 'display') footer.append(followup);
  else {
    const actions = purpose === 'confirmation' ? [['取消', 'cancel'], ['确认并继续', 'confirm']] : [['提交回答', null]];
    for (const [label, decision] of actions) {
      const button = iuiButton(label, () => iuiSubmitAnswer(entry, decision));
      button.classList.toggle('iui-primary-action', decision !== 'cancel');
      view.submitButtons.push(button); footer.append(button);
    }
  }
  host.append(footer); entry.views.add(view);
  // Mount happens before the Markdown fragment is inserted into the message.
  queueMicrotask(() => iuiRefresh(entry));
}
async function iuiHydrate(host, id, session) {
  const key = session + '/' + id;
  let entry = iuiDocuments.get(key);
  if (!entry) {
    entry = {id, session, views: new Set(), pending: {}, saving: null, error: null};
    entry.loading = api('/api/iui/' + id + '?session=' + encodeURIComponent(session)).then(data => { entry.data = data; });
    iuiDocuments.set(key, entry);
    if (iuiDocuments.size > 100) for (const [oldKey, old] of iuiDocuments) if (oldKey !== key && !old.saving && !Object.keys(old.pending).length && ![...old.views].some(view => view.host.isConnected)) { iuiDocuments.delete(oldKey); break; }
  }
  try { await entry.loading; iuiMount(host, entry); }
  catch (error) {
    iuiDocuments.delete(key); host.removeAttribute('aria-busy'); host.replaceChildren(elem('p', '', iuiText('智能界面暂时无法加载')), iuiButton('重试', () => iuiHydrate(host, id, session)));
  }
}
const markdownBeforeIui = markdown;
markdown = function(text) {
  const root = markdownBeforeIui(text), session = state.session?.id;
  if (!session || !text.includes('[[iui:')) return root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('pre,code') && /\[\[iui:[a-f0-9]{32}\]\]/.test(walker.currentNode.textContent)) nodes.push(walker.currentNode);
  const seen = new Set();
  for (const node of nodes) {
    const fragment = document.createDocumentFragment(), parts = node.textContent.split(/(\[\[iui:[a-f0-9]{32}\]\])/);
    for (const part of parts) {
      const match = /^\[\[iui:([a-f0-9]{32})\]\]$/.exec(part);
      if (!match) { fragment.append(document.createTextNode(part)); continue; }
      if (seen.has(match[1])) continue; seen.add(match[1]);
      const host = elem('section', 'intelligent-ui'); host.dataset.iuiId = match[1]; host.setAttribute('aria-label', iuiText('智能交互界面')); host.setAttribute('aria-busy', 'true');
      host.append(elem('p', 'iui-status', iuiText('正在加载智能界面…'))); fragment.append(host); iuiHydrate(host, match[1], session);
    }
    if (node.parentElement.tagName === 'P' && node.parentElement.childNodes.length === 1) node.parentElement.replaceWith(fragment);
    else node.replaceWith(fragment);
  }
  return root;
};
const iuiPreference = elem('div', 'preference-row'), iuiPreferenceCopy = elem('div'), iuiToggle = elem('input');
iuiPreferenceCopy.append(elem('h3', '', iuiText('智能交互界面')), elem('p', '', iuiText('允许模型在合适时生成图表、选择题和计算表单。交互结果由你决定何时发送。')));
iuiToggle.type = 'checkbox'; iuiToggle.setAttribute('role', 'switch'); iuiToggle.setAttribute('aria-label', iuiText('智能交互界面'));
iuiToggle.checked = localStorage.getItem('astra-iui-enabled') !== 'false';
iuiToggle.onchange = () => localStorage.setItem('astra-iui-enabled', String(iuiToggle.checked));
iuiPreference.append(iuiPreferenceCopy, iuiToggle); $('[data-panel="general"]').append(iuiPreference);
const runtimeOptionsBeforeIui = runtimeOptions;
runtimeOptions = function() { return {...runtimeOptionsBeforeIui(), iui_enabled: iuiToggle.checked}; };
const agentEventBeforeIui = handleAgentEvent;
handleAgentEvent = function(session, event) {
  agentEventBeforeIui(session, event);
  if (event.type !== 'tool' || event.name !== 'render_iui' || !event.result?.iui_id) return;
  const entry = iuiDocuments.get(session + '/' + event.result.iui_id);
  if (!entry) return;
  api('/api/iui/' + entry.id + '?session=' + encodeURIComponent(session)).then(data => {
    entry.data = data;
    const views = [...entry.views]; entry.views.clear();
    for (const view of views) if (view.host.isConnected) iuiMount(view.host, entry);
  }).catch(() => {});
};
// Boot may have rendered history while this feature script was still loading.
renderMessages();
