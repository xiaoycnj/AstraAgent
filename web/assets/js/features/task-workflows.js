// Project acceptance and isolation reuse the normal chat/permission workflow.
(() => {
  const isolation = elem('details', 'settings-group');
  isolation.id = 'container-settings';
  const image = elem('input');
  image.id = 'container-image';
  image.placeholder = 'sha256:…';
  const memory = elem('input');
  memory.id = 'container-memory';
  memory.type = 'number';
  memory.min = '128';
  memory.max = '8192';
  const network = elem('input');
  network.id = 'container-network';
  network.type = 'checkbox';
  const networkRow = elem('label', 'switch-pill');
  networkRow.append(elem('span', '', '允许容器联网'), network);
  upgradeSwitches(networkRow);
  const isolationStatus = elem('p', 'hint');
  isolationStatus.setAttribute('role', 'status');
  isolation.append(elem('summary', '', '隔离执行环境'),
    elem('p', 'hint', '使用本地 Docker Linux 容器。挂载当前工作区，限制内存和进程，默认关闭网络。需预先安装镜像，使用 docker image ls --no-trunc 查看镜像 ID。'),
    projectField('本地镜像 ID', image), projectField('容器内存（MB）', memory), networkRow,
    actionButton('检查运行环境', async () => {
      isolationStatus.textContent = '正在检查…';
      const result = await api('/api/runtime/isolation');
      isolationStatus.textContent = result.available ? '本地 Docker Linux 引擎可用' : result.reason;
    }, 'secondary'),
    actionButton('保存隔离设置', async () => {
      if (network.checked && !await appConfirm('允许容器访问网络？工作区内的内容可能通过容器中的程序发送出去。')) return;
      executionSettings = await api('/api/runtime', 'PUT', {
        container_image: image.value.trim(), container_memory_mb: Number(memory.value), container_network: network.checked
      });
      renderExecutionSettings();
      toast('隔离设置已保存，请在命令模式中选择 Docker 隔离执行');
    }, 'secondary'), isolationStatus);
  generalPanel.append(isolation);
  const beforeRender = renderExecutionSettings;
  renderExecutionSettings = function () {
    beforeRender();
    image.value = executionSettings.container_image || '';
    memory.value = executionSettings.container_memory_mb || 512;
    network.checked = executionSettings.container_network === true;
  };
  executionSettingsReady.then(renderExecutionSettings);

  const pane = elem('section', 'workspace-pane project-pane');
  pane.id = 'task-evaluations';
  pane.hidden = true;
  const head = elem('div', 'project-row');
  head.append(elem('h2', '', '任务验收'), actionButton('刷新', load, 'secondary'));
  const templates = elem('div', 'project-row');
  const form = elem('form', 'project-form');
  const name = elem('input');
  name.id = 'evaluation-name';
  name.required = true;
  name.maxLength = 100;
  const prompt = elem('textarea');
  prompt.id = 'evaluation-prompt';
  prompt.rows = 5;
  prompt.required = true;
  prompt.maxLength = 16000;
  const project = elem('select');
  project.id = 'evaluation-project';
  const assertions = elem('textarea');
  assertions.id = 'evaluation-files';
  assertions.rows = 5;
  const outputs = elem('select');
  outputs.id = 'evaluation-outputs';
  outputs.append(new Option('无需输出附件', ''), new Option('文档附件', 'document'), new Option('图片附件', 'image'));
  const checks = elem('input');
  checks.type = 'checkbox';
  checks.id = 'evaluation-checks';
  const human = elem('input');
  human.type = 'checkbox';
  human.id = 'evaluation-human';
  function toggle(label, input) {
    const row = elem('label', 'switch-pill');
    row.append(elem('span', '', label), input);
    upgradeSwitches(row);
    return row;
  }
  const advanced = elem('details', 'project-change');
  advanced.append(elem('summary', '', '验收条件'), projectField('文件断言（JSON 数组）', assertions),
    elem('p', 'hint', '文件默认要求本轮发生变化。可填写 contains 文本数组，或设置 require_changed 为 false。'),
    projectField('预期交付', outputs), toggle('要求项目验收命令通过', checks), toggle('完成后人工复核质量', human));
  const save = elem('button', 'primary', '保存验收任务');
  save.type = 'submit';
  const feedback = elem('p', 'hint');
  feedback.setAttribute('role', 'status');
  form.append(projectField('任务名称', name), projectField('任务要求', prompt), projectField('项目工作区', project), advanced, save, feedback);
  const cases = elem('section', 'project-history');
  const runs = elem('section', 'project-history');
  const labels = {queued: '待发送', running: '运行中', needs_review: '等待人工复核', passed: '通过', failed: '未通过'};
  const categoryNames = {coding: 'Coding', creator: 'Creator', image: 'Image', story: 'Story'};
  let selected = null, data = null, ticket = 0;
  function edit(spec) {
    selected = spec;
    name.value = spec.name;
    prompt.value = spec.prompt;
    project.value = spec.project_id || selectedProjectId || '';
    project._refresh?.();
    assertions.value = JSON.stringify(spec.expected_files, null, 2);
    outputs.value = spec.expected_outputs[0] || '';
    outputs._refresh?.();
    checks.checked = spec.require_checks;
    human.checked = spec.manual_review;
    feedback.textContent = '';
  }
  form.onsubmit = async event => {
    event.preventDefault();
    if (!selected) return;
    busyButton(save, true, '保存中…');
    try {
      const spec = await api('/api/evaluations', 'PUT', {...selected, name: name.value, prompt: prompt.value,
        project_id: project.value, expected_files: JSON.parse(assertions.value),
        expected_outputs: outputs.value ? [outputs.value] : [], require_checks: checks.checked, manual_review: human.checked});
      await load();
      edit(spec);
      feedback.textContent = '验收任务已保存';
    } catch (error) { feedback.textContent = error.message; }
    finally { busyButton(save, false); }
  };
  async function start(spec) {
    if (!await confirmEditorChange()) return;
    if (!await navigatePage('home')) return;
    const result = await api('/api/evaluations/' + spec.id + '/start', 'POST', {});
    await switchMode('chat');
    await refreshList();
    await openSession(result.session);
    $('#chat-input').value = result.prompt;
    $('#chat-input').dispatchEvent(new Event('input', {bubbles: true}));
    await closeWorkbench();
    $('#chat-input').focus();
    toast('检查任务和参考附件后发送，结果将自动进入任务验收');
  }
  async function review(run, outcome) {
    const note = await appPrompt('填写人工复核意见', '');
    if (note === null) return;
    await api('/api/evaluations/' + run.id + '/review', 'POST', {outcome, note});
    await load();
  }
  async function load() {
    const current = ++ticket;
    await refreshProjects();
    const response = await api('/api/evaluations');
    if (current !== ticket) return;
    data = response;
    const chosenProject = project.value;
    project.replaceChildren(new Option('应用工作区', ''), ...projectCatalog.map(item => new Option(item.name, item.id)));
    project.value = chosenProject;
    project._refresh?.();
    templates.replaceChildren(...data.templates.map(spec => actionButton(categoryNames[spec.category], () => edit({...spec, project_id: selectedProjectId}), 'secondary')));
    cases.replaceChildren(elem('h3', '', '已保存任务'));
    if (!data.cases.length) cases.append(elem('p', 'hint', '选择模板，填写任务要求并保存。'));
    for (const spec of data.cases) {
      const card = elem('article', 'project-change');
      card.append(elem('strong', '', spec.name), elem('p', 'hint', categoryNames[spec.category]),
        actionButton('编辑', () => edit(spec), 'secondary'), actionButton('创建验收会话', () => start(spec), 'secondary'));
      cases.append(card);
    }
    runs.replaceChildren(elem('h3', '', '运行记录'));
    if (!data.runs.length) runs.append(elem('p', 'hint', '通过验收会话完成任务后，会自动记录文件、交付物和项目验证结果。'));
    for (const run of data.runs) {
      const detail = elem('details', 'project-change');
      detail.append(elem('summary', '', run.spec.name + ' · ' + labels[run.status]),
        elem('p', 'hint', (run.result.duration_seconds ?? 0) + 's · ' + new Date(run.started * 1000).toLocaleString()),
        actionButton('打开任务会话', async () => {
          await navigatePage('home');
          await switchMode('chat');
          await refreshList();
          await openSession(state.sessions.find(item => item.id === run.session_id) || {id: run.session_id, title: run.spec.name, project_id: run.spec.project_id});
        }, 'secondary'));
      for (const item of run.result.evidence || []) detail.append(elem('p', '', (item.passed ? '通过 · ' : '未通过 · ') + item.name + (item.detail ? ' · ' + item.detail : '')));
      const usage = run.result.usage;
      if (run.result.approval_requests !== null && run.result.approval_requests !== undefined) detail.append(elem('p', 'hint', uiText('授权请求次数') + ' · ' + run.result.approval_requests));
      if (usage?.available) detail.append(elem('p', 'hint', (usage.reported > 0 ? 'Token · ' + Number(usage.total || 0).toLocaleString() : uiText('Token 用量未上报')) + ' · ' + usage.reported + '/' + usage.calls));
      for (const cost of usage?.costs || []) detail.append(elem('p', 'hint', uiText('成本估算') + ' · ' + cost.currency + ' ' + Number(cost.amount).toFixed(6)));
      if (usage?.unpriced_calls) detail.append(elem('p', 'hint', uiText('未计价调用') + ' · ' + usage.unpriced_calls));
      if (run.review) detail.append(elem('p', '', run.review));
      if (run.status === 'needs_review') detail.append(actionButton('人工复核通过', () => review(run, 'passed'), 'secondary'), actionButton('人工复核未通过', () => review(run, 'failed'), 'secondary'));
      runs.append(detail);
    }
    if (!selected) edit({...data.templates[0], project_id: selectedProjectId});
  }
  pane.append(head, elem('p', 'hint', '任务在普通对话中执行并沿用当前模型和权限。自动检查与人工质量复核分别记录。'), templates, form, cases, runs);
  drawer.append(pane);
  const tab = actionButton('任务验收', () => openWorkbench('evaluations'), 'secondary');
  tab.dataset.tab = 'evaluations';
  drawerTabs.append(tab);
  buildSelect(project);
  buildSelect(outputs);
  const beforeWorkbench = openWorkbench;
  openWorkbench = function (view = 'files') {
    beforeWorkbench(view);
    pane.hidden = view !== 'evaluations';
    if (!pane.hidden) load().catch(error => {feedback.textContent = error.message;});
  };
  const beforeEvent = handleAgentEvent;
  handleAgentEvent = function (sid, event) {
    beforeEvent(sid, event);
    if (['done', 'error', 'cancelled'].includes(event.type) && !pane.hidden) load().catch(error => {feedback.textContent = error.message;});
  };
})();
