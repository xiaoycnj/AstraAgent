// Automatic statistics read the local usage ledger; opening this page sends no model requests.
(() => {
  const panel = settingPanel('performance', '性能统计', '自动记录每次模型调用，查看历史速度、延迟与模型标识。');
  panel.id = 'performance-panel';
  const nav = actionButton('性能统计', () => selectSettingsTab('performance'));
  nav.dataset.settingsTab = 'performance';
  nav.prepend(svgIcon('review'));
  $('[data-settings-tab=profile]').after(nav);
  const shortcut = actionButton('查看性能统计', () => selectSettingsTab('performance'), 'secondary');
  usageSection.append(shortcut);
  const filters = elem('form', 'performance-filters');
  function select(label, id, values) {
    const field = elem('label', '', label), control = elem('select');
    control.id = 'performance-' + id;
    control.setAttribute('aria-label', label);
    for (const [value, text] of values) control.append(new Option(uiText(text), value));
    field.append(control); filters.append(field); return control;
  }
  const range = select('统计范围', 'range', [['all', '全部历史'], ['7', '最近 7 天'], ['30', '最近 30 天'], ['90', '最近 90 天'], ['custom', '自定义日期']]);
  const dates = [];
  for (const [id, label] of [['start', '开始日期'], ['end', '结束日期']]) {
    const field = elem('label', '', label), input = elem('input');
    input.id = 'performance-' + id; input.type = 'date'; input.setAttribute('aria-label', label);
    field.append(input); field.hidden = true; filters.append(field); dates.push(input);
  }
  const model = select('目标模型', 'model', [['', '全部模型']]);
  const provider = select('服务商', 'provider', [['', '全部服务商']]);
  const identity = select('模型标识', 'identity', [['', '全部标识'], ['same', '标识相同'], ['different', '标识不同'], ['unknown', '未上报']]);
  const status = select('调用状态', 'status', [['', '全部状态'], ['completed', '成功'], ['failed', '失败'], ['cancelled', '已取消']]);
  const actions = elem('div', 'performance-actions');
  const refresh = actionButton('刷新统计', () => load(), 'secondary');
  const reset = actionButton('重置筛选', () => {
    range.value = 'all'; model.value = provider.value = identity.value = status.value = '';
    dates.forEach(input => {input.value = ''; input.parentElement.hidden = true;});
    page = 0; load();
  }, 'secondary');
  const auto = elem('input'); auto.type = 'checkbox'; auto.checked = true;
  auto.id = 'performance-auto'; auto.setAttribute('role', 'switch');
  const autoLabel = elem('label', 'switch-pill'); autoLabel.append(elem('span', '', '自动刷新'), auto);
  actions.append(refresh, reset, autoLabel);
  const notice = elem('p', 'hint'); notice.setAttribute('role', 'status'); notice.id = 'performance-status';
  const content = elem('div', 'performance-results');
  panel.append(filters, actions, notice, content);
  const note = elem('details', 'settings-disclosure performance-method');
  note.append(elem('summary', '', '统计口径与限制'));
  for (const text of [
    '输出吞吐量 = 成功调用的已上报输出 Token ÷ 请求总耗时，包含连接、排队和推理等待。汇总采用总 Token ÷ 总耗时。',
    '流式生成速度 = 已上报输出 Token ÷ 首段输出至调用完成的耗时。至少收到两段非空输出才计入，属于近似值，可能包含不可见推理 Token。',
    '首段延迟从请求开始计时，首段文本、推理或工具参数均视为输出。非流式调用不提供首段延迟。',
    '模型标识比较目标模型与服务商上报的 model 字段，严格区分别名和版本后缀；标识不同不代表模型造假，标识相同也不能验证真实模型身份。',
    '历史用量会保留；旧记录缺少耗时或模型标识时显示未知，不参与速度计算。失败和取消调用保留用量，排除在速度平均值之外。',
    '包含对话、工具循环、Judge、压缩、记忆和连接测试等文本模型子请求；图片与视频生成不计入。仅保存用量、计时与模型元数据。',
    '缺少用量时，可在服务商的开发者设置中开启“请求流式 Token 用量”；需上游支持。'
  ]) note.append(elem('p', 'hint', text));
  panel.append(note);
  let page = 0, request = 0, loading = false;
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function query() {
    const params = new URLSearchParams({page: String(page), offset: String(-new Date().getTimezoneOffset())});
    for (const [key, input] of [['model', model], ['provider', provider], ['identity', identity], ['status', status]]) if (input.value) params.set(key, input.value);
    if (range.value === 'custom') {
      if (dates[0].value && dates[1].value && dates[0].value > dates[1].value) throw new Error(uiText('开始日期不能晚于结束日期'));
      if (dates[0].value) params.set('start', dates[0].value);
      if (dates[1].value) params.set('end', dates[1].value);
    } else if (range.value !== 'all') {
      const end = new Date(), start = new Date(); start.setDate(end.getDate() - Number(range.value) + 1);
      params.set('start', dateKey(start)); params.set('end', dateKey(end));
    }
    return params.toString();
  }
  function number(value, digits = 1) { return value == null ? '—' : Number(value).toLocaleString(resolvedLanguage, {maximumFractionDigits: digits}); }
  function duration(value) { return value == null ? '—' : number(value / 1000, 2) + ' s'; }
  function literal(tag, text, cls = '') { const node = elem(tag, cls, text); node.dataset.i18nIgnore = ''; return node; }
  function metric(label, value, hint) { const box = elem('div', 'performance-metric'); box.append(elem('span', '', label), literal('strong', value), elem('small', 'hint', hint)); return box; }
  function table(title, headers, rows) {
    const section = elem('section', 'performance-section'), wrap = elem('div', 'performance-table-wrap');
    wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', title);
    const grid = elem('table'), caption = elem('caption', '', title), head = elem('thead'), tr = elem('tr');
    for (const label of headers) { const th = elem('th', '', label); th.scope = 'col'; tr.append(th); }
    head.append(tr); const body = elem('tbody');
    if (!rows.length) { const row = elem('tr'), cell = elem('td', 'hint', '没有符合条件的记录'); cell.colSpan = headers.length; row.append(cell); body.append(row); }
    for (const cells of rows) { const row = elem('tr'); for (const value of cells) { const cell = elem('td'); cell.append(value instanceof Node ? value : literal('span', String(value))); row.append(cell); } body.append(row); }
    grid.append(caption, head, body); wrap.append(grid); section.append(wrap); return section;
  }
  function modelText(value) { return literal('code', value || uiText('未知')); }
  function providerName(id, name) { return providerRows?.find(row => row.id === id)?.name || name || id || uiText('默认 / 历史服务商'); }
  function choices(control, options, label) {
    const selected = control.value, entries = [['', uiText(label)], ...options];
    if (selected && !entries.some(([id]) => id === selected)) entries.push([selected, selected]);
    const signature = JSON.stringify(entries);
    if (control.dataset.options === signature) return;
    control.replaceChildren(...entries.map(([id, name]) => {const option = new Option(name, id); if (id) option.dataset.i18nIgnore = ''; return option;})); control.value = selected; control.dataset.options = signature;
  }
  function render(data) {
    page = data.page; content.replaceChildren();
    choices(model, [...new Set(data.options.map(row => row.model))].map(id => [id, id]), '全部模型');
    choices(provider, [...new Set(data.options.map(row => row.provider_id))].filter(Boolean).map(id => [id, providerName(id, data.options.find(row => row.provider_id === id)?.provider_name)]), '全部服务商');
    const sum = data.summary, cards = elem('div', 'performance-metrics');
    cards.append(
      metric('输出吞吐量（含等待）', number(sum.tokens_per_second) + ' tok/s', uiText('有效样本') + ' ' + sum.speed_samples),
      metric('流式生成速度（近似）', number(sum.generation_tokens_per_second) + ' tok/s', uiText('有效样本') + ' ' + sum.generation_samples),
      metric('首段延迟 P50 / P95', duration(sum.p50_ttft_ms) + ' / ' + duration(sum.p95_ttft_ms), uiText('有效样本') + ' ' + sum.ttft_samples),
      metric('调用成功率', sum.calls ? number(sum.completed / sum.calls * 100) + '%' : '—', `${uiText('成功')} ${sum.completed} · ${uiText('失败')} ${sum.failed} · ${uiText('已取消')} ${sum.cancelled}`),
      metric('模型标识一致率', sum.identity_rate == null ? '—' : number(sum.identity_rate * 100) + '%', `${uiText('标识不同')} ${sum.different} · ${uiText('未上报')} ${sum.unknown}`),
      metric('已上报输出 Token', number(sum.output_tokens, 0), `${uiText('调用总数')} ${sum.calls} · ${uiText('有计时')} ${sum.timed}`)
    );
    content.append(cards);
    const trend = elem('section', 'performance-section'); trend.append(elem('h3', '', '历史速度趋势'));
    const chart = elem('div', 'performance-chart'), tip = elem('p', 'hint', '悬停或聚焦柱形查看速度与样本数'); tip.setAttribute('role', 'status');
    chart.setAttribute('role', 'group'); chart.setAttribute('aria-label', uiText('历史速度趋势'));
    const max = Math.max(1, ...data.trend.map(row => row.tokens_per_second || 0));
    for (const row of data.trend) {
      const label = `${row.period} · ${number(row.tokens_per_second)} tok/s · ${uiText('有效样本')} ${row.speed_samples}`;
      const bar = actionButton(label, () => {tip.textContent = label;}, 'performance-bar');
      bar.replaceChildren(); bar.setAttribute('aria-label', label); bar.title = label;
      const stick = elem('span', 'performance-stick'); stick.style.height = row.tokens_per_second == null ? '2px' : Math.max(3, row.tokens_per_second / max * 100) + '%';
      if (row.tokens_per_second == null) stick.classList.add('unknown');
      bar.append(stick, literal('small', row.period)); bar.onfocus = bar.onmouseenter = () => {tip.textContent = label;}; chart.append(bar);
    }
    if (!data.trend.length) chart.append(elem('p', 'hint', '没有符合条件的记录'));
    trend.append(chart, tip); content.append(trend);
    content.append(table('各模型性能', ['目标模型 / 服务商', '调用总数', '输出吞吐量', '流式速度', '首段延迟（平均）', '总耗时（平均）', '标识不同 / 未上报', '有效速度样本'], data.models.map(row => {
      const name = elem('div', 'performance-model');
      const filter = actionButton(row.model, () => {model.value = row.model; provider.value = row.provider_id || ''; page = 0; load();}, 'secondary'); filter.dataset.i18nIgnore = '';
      name.append(filter, literal('small', providerName(row.provider_id, row.provider_name)));
      return [name, number(row.calls, 0), number(row.tokens_per_second) + ' tok/s', number(row.generation_tokens_per_second) + ' tok/s', duration(row.avg_ttft_ms), duration(row.avg_duration_ms), `${row.different} / ${row.unknown}`, number(row.speed_samples, 0)];
    })));
    content.append(table('逐次调用明细', ['调用时间 / 状态', '选择 → 目标 → 上报', '模型标识', '输出 Token', '总耗时', '首段延迟', '输出吞吐量', '流式速度'], data.rows.map(row => {
      const when = elem('div'); when.append(literal('span', new Date(row.stamp * 1000).toLocaleString(resolvedLanguage)), elem('small', 'performance-state', ({completed:'成功', failed:'失败', cancelled:'已取消'})[row.status] || row.status));
      const route = elem('div', 'performance-route');
      route.append(modelText(row.requested_model), literal('span', '→ ' + row.model), literal('span', '→ ' + (row.response_model || uiText('未上报'))), literal('small', providerName(row.provider_id, row.provider_name)));
      if (row.model_changed) route.append(elem('small', 'performance-different', '流内模型标识变化'));
      const badge = elem('span', 'performance-badge performance-' + row.identity, ({same:'标识相同', different:'标识不同', unknown:'未上报'})[row.identity]);
      return [when, route, badge, number(row.output, 0), duration(row.duration_ms), duration(row.ttft_ms), number(row.tokens_per_second) + ' tok/s', number(row.generation_tokens_per_second) + ' tok/s'];
    })));
    const pager = elem('div', 'performance-pager');
    const previous = actionButton('上一页', () => {page--; load();}, 'secondary'), next = actionButton('下一页', () => {page++; load();}, 'secondary');
    previous.disabled = page === 0; next.disabled = page + 1 >= data.pages;
    pager.append(previous, literal('span', `${page + 1} / ${data.pages}`), next); content.append(pager);
  }
  async function load() {
    const serial = ++request; loading = true; refresh.disabled = true; panel.setAttribute('aria-busy', 'true');
    notice.classList.remove('error'); notice.textContent = uiText('正在读取性能统计…');
    try {
      const data = await api('/api/performance?' + query());
      if (serial !== request) return;
      render(data);
      notice.textContent = uiText('更新于') + ' ' + new Date(data.generated_at * 1000).toLocaleTimeString(resolvedLanguage) + ' · ' + (data.since ? uiText('最早记录') + ' ' + new Date(data.since * 1000).toLocaleDateString(resolvedLanguage) : uiText('尚无调用记录。发送消息后会自动采集。'));
    } catch (error) {
      if (serial !== request) return;
      content.replaceChildren(); notice.textContent = uiText('统计读取失败，请重试。') + ' ' + error.message; notice.classList.add('error');
    } finally {
      if (serial === request) {loading = false; refresh.disabled = false; panel.setAttribute('aria-busy', 'false');}
    }
  }
  filters.onsubmit = event => {event.preventDefault(); page = 0; load();};
  filters.onchange = () => {dates.forEach(input => input.parentElement.hidden = range.value !== 'custom'); page = 0; load();};
  const beforeTab = selectSettingsTab;
  selectSettingsTab = function(name) {beforeTab(name); if (name === 'performance') load();};
  const visible = () => !document.hidden && !$('#settings').hidden && !panel.hidden;
  setInterval(() => {if (visible() && auto.checked && !loading) load();}, 15000);
  document.addEventListener('visibilitychange', () => {if (visible() && auto.checked && !loading) load();});
})();
