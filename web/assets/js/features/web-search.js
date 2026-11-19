
// Search is available in either mode and independent of local Agent tools.
(() => {
  const endpoint = '/api/web-search/settings';
  const section = elem('section', 'settings-group');
  section.id = 'web-search-settings';
  const title = elem('h3', '', '联网搜索');
  const field = elem('div', 'web-search-field');
  const guidance = elem('div', 'web-search-guidance');
  const label = elem('label', '', 'Brave Search API 密钥');
  const input = elem('input');
  input.id = 'web-search-key';
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 256;
  label.htmlFor = input.id;
  const link = elem('a', '', '获取 API 密钥');
  link.href = 'https://api.search.brave.com/app/keys';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const status = elem('p', 'hint');
  status.setAttribute('role', 'status');
  const note = elem('p', '', '开启后，搜索词会发送给 Brave Search，可能消耗额度。会话读取过附件、网页等外部内容时，每次搜索都需要确认。');
  note.id = 'web-search-note';
  input.setAttribute('aria-describedby', note.id);
  guidance.append(note, link);
  field.append(label, input, guidance);
  const actions = elem('div', 'personalization-actions');
  const save = actionButton('保存密钥', () => changeKey(input.value.trim()));
  const remove = actionButton('移除密钥', () => changeKey(''));
  actions.append(save, remove);
  section.append(title, field, actions, status);
  $('[data-panel="general"]').append(section);

  let enabled = false, configured, saving = false;
  try { enabled = localStorage.getItem('astra-web-search') === 'true'; } catch {}
  const toggle = actionButton('联网搜索', async () => {
    if (configured === undefined) apply(await api(endpoint));
    if (!configured) {
      composerOptions.open = false;
      showSettings();
      selectSettingsTab('general');
      input.focus();
      return;
    }
    enabled = !enabled;
    try { localStorage.setItem('astra-web-search', String(enabled)); } catch {}
    sync();
  }, 'composer-web-search');
  composerOptionsPanel.prepend(toggle);

  function sync() {
    toggle.setAttribute('aria-pressed', String(Boolean(configured && enabled)));
    toggle.textContent = configured === false ? '联网搜索 · 配置密钥' :
      '联网搜索 · ' + (configured && enabled ? '已开启' : '已关闭');
    save.disabled = saving || !input.value.trim();
    remove.disabled = saving || !configured;
  }

  function apply(result) {
    configured = result.configured;
    status.textContent = configured ? '已配置密钥。在输入框的「+」菜单中开启或关闭。' : '尚未配置搜索密钥。';
    sync();
  }

  async function changeKey(key) {
    if (saving) return;
    saving = true;
    sync();
    try {
      const result = await api(endpoint, 'PUT', {api_key: key});
      input.value = '';
      if (!result.configured) {
        enabled = false;
        try { localStorage.removeItem('astra-web-search'); } catch {}
      }
      apply(result);
    } catch (error) { status.textContent = error.message; }
    finally { saving = false; sync(); }
  }

  input.addEventListener('input', sync);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !save.disabled) { event.preventDefault(); save.click(); }
  });
  const restore = () => api(endpoint).then(apply).catch(() => {});
  new MutationObserver(() => { if (!section.parentElement.hidden && configured === undefined) restore(); })
    .observe(section.parentElement, {attributes: true, attributeFilter: ['hidden']});
  sync();
  restore();
  const optionsBeforeSearch = runtimeOptions;
  runtimeOptions = function(...args) {
    return {...optionsBeforeSearch(...args), web_search_enabled: enabled};
  };
})();
