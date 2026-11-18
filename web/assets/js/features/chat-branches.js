(() => {
  const navigatorBar = elem('div', 'chat-branch-nav');
  navigatorBar.setAttribute('role', 'group');
  navigatorBar.setAttribute('aria-label', '会话分支');
  const count = elem('span', 'chat-branch-count');
  count.setAttribute('aria-live', 'polite');
  count.dataset.i18nIgnore = '';
  let branches = [], branchIndex = 0, branching = false, switching = false;

  function iconButton(label, icon, action, className = '') {
    const button = actionButton('', action, className);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(svgIcon(icon));
    return button;
  }
  const previous = iconButton('上一会话分支', 'back', () => switchBranch(-1));
  const next = iconButton('下一会话分支', 'forward', () => switchBranch(1));
  navigatorBar.append(previous, count, next);
  headerActions.prepend(navigatorBar);

  function branchFamily(session) {
    if (!session) return [];
    const rows = new Map(state.sessions.map(row => [row.id, row]));
    rows.set(session.id, session);
    const parents = new Set([session.id]);
    let root = session.id;
    while (rows.get(root)?.parent_id && !parents.has(rows.get(root).parent_id)) {
      root = rows.get(root).parent_id;
      parents.add(root);
    }
    const children = new Map();
    for (const row of [...rows.values()].reverse()) {
      if (!row.parent_id) continue;
      if (!children.has(row.parent_id)) children.set(row.parent_id, []);
      children.get(row.parent_id).push(row.id);
    }
    const family = [], visited = new Set(), remaining = [root];
    for (let index = 0; index < remaining.length; index++) {
      const id = remaining[index];
      if (visited.has(id)) continue;
      visited.add(id);
      const row = rows.get(id);
      if (row && (!row.archived || id === session.id)) family.push(row);
      for (const child of children.get(id) || []) remaining.push(child);
    }
    return family;
  }

  function syncNavigation() {
    branches = state.mode === 'chat' ? branchFamily(state.session) : [];
    navigatorBar.hidden = branches.length < 2;
    if (navigatorBar.hidden) return;
    branchIndex = branches.findIndex(item => item.id === state.session.id);
    const label = (branchIndex + 1) + ' / ' + branches.length;
    if (count.textContent !== label) count.textContent = label;
    count.title = branches[branchIndex]?.title || '';
    previous.disabled = switching || branching || branchIndex <= 0;
    next.disabled = switching || branching || branchIndex >= branches.length - 1;
  }
  async function switchBranch(offset) {
    const target = branches[branchIndex + offset];
    if (!target || switching || branching) return;
    switching = true;
    syncNavigation();
    try { await openSession(target); }
    finally { switching = false; syncNavigation(); }
  }

  const renderPreviousList = renderList;
  renderList = function () {
    renderPreviousList();
    syncNavigation();
  };

  async function replyInBranch(message, content) {
    const source = state.session?.id;
    if (!source || branching || switching || submitting || uploadBusy || state.pending.has(source)) {
      throw Error('请等待当前任务完成。');
    }
    if (!state.messages.some(item => item.id === message.id && item.role === 'user')) {
      throw Error('当前会话已切换，请从正在查看的提问创建分支。');
    }
    if (!hasModelConnection()) throw Error('请先在设置中连接模型。');
    const ids = Array.isArray(message.attachments) ? message.attachments : JSON.parse(message.attachments || '[]');
    branching = true;
    syncNavigation();
    try {
      const items = await Promise.all(ids.map(id => api('/api/attachments/' + id)));
      if (state.session?.id !== source || submitting || state.pending.has(source)) return;
      const session = await api('/api/sessions/' + source + '/branch', 'POST', {before_id: message.id});
      await refreshList();
      if (state.session?.id !== source) { toast('分支已创建，可在会话列表中打开。'); return; }
      await openSession(session);
      if (state.session?.id !== session.id) return;
      const countBefore = state.messages.length;
      branching = false;
      syncNavigation();
      const sent = await sendMessage({preventDefault() {}}, content, items);
      if (!sent && state.session?.id === session.id &&
          !state.messages.slice(countBefore).some(item => item.role === 'user' && item.id)) {
        const input = $('#chat-input');
        if (!input.value) {
          input.value = content;
          input.dispatchEvent(new Event('input', {bubbles: true}));
        }
        if (!pendingAttachments.length && items.length) {
          pendingAttachments = items.slice();
          attachmentDrafts.set(session.id, items.slice());
          renderAttachmentTray();
        }
      }
    } finally {
      branching = false;
      syncNavigation();
    }
  }

  function editMessage(article, message, trigger) {
    const existing = article.querySelector('.chat-message-edit');
    if (existing) { existing.querySelector('textarea').focus(); return; }
    const editor = elem('form', 'chat-message-edit');
    editor.setAttribute('aria-label', '编辑提问');
    const input = elem('textarea');
    input.setAttribute('aria-label', '修改提问');
    input.value = message.content;
    input.maxLength = 32000;
    input.rows = 4;
    const controls = elem('div', 'chat-message-edit-actions');
    const status = elem('span', 'chat-message-edit-status');
    status.setAttribute('role', 'status');
    const dismiss = () => {editor.remove(); trigger.focus({preventScroll: true});};
    const cancel = actionButton('取消编辑', dismiss, 'secondary');
    const submit = elem('button', 'primary', '发送到新分支');
    submit.type = 'submit';
    const hasFiles = Array.isArray(message.attachments) ? !!message.attachments.length :
      !!message.attachments && message.attachments !== '[]';
    const update = () => {submit.disabled = !input.value.trim() && !hasFiles;};
    input.oninput = update;
    editor.onkeydown = event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && !cancel.disabled) {event.stopPropagation(); dismiss();}
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !submit.disabled) {
        event.preventDefault(); editor.requestSubmit();
      }
    };
    editor.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      input.readOnly = submit.disabled = cancel.disabled = true;
      status.textContent = '正在创建分支…';
      try { await replyInBranch(message, input.value.trim() || '请分析附件内容。'); }
      catch (error) { status.textContent = error.message; }
      finally {
        input.readOnly = cancel.disabled = false;
        update();
      }
    };
    controls.append(status, cancel, submit);
    editor.append(input, controls);
    article.querySelector(':scope > .markdown').before(editor);
    update();
    input.focus({preventScroll: true});
    input.setSelectionRange(input.value.length, input.value.length);
  }

  const addPreviousActions = appendMessageActions;
  appendMessageActions = function () {
    addPreviousActions();
    let lastUser = null;
    for (const article of $$('#messages > .message')) {
      const message = messageViews.get(article)?.message;
      if (!message?.id || message.streaming) continue;
      if (message.role === 'user') lastUser = message;
      const bar = article.querySelector('.message-actions');
      if (!bar || bar.querySelector('.chat-branch-action') || !lastUser) continue;
      if (message.role === 'user') {
        const edit = iconButton('编辑提问', 'edit', () => editMessage(article, messageViews.get(article).message, edit), 'chat-branch-action');
        bar.append(edit);
      } else if (message.role === 'assistant') {
        const origin = lastUser;
        bar.append(iconButton('重新生成到新分支', 'refresh', () => replyInBranch(origin, origin.content), 'chat-branch-action'));
      }
    }
  };
  syncNavigation();
  appendMessageActions();
})();
