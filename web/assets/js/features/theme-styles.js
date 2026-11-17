// Built-in styles share the existing light/dark and color preferences.
(() => {
  const styles = [
    {id: 'astra', name: 'AstraAgent', description: '蓝紫玻璃 · 轻盈层次', theme: '#8582b8', accent: '#77a1ff'},
    {id: 'anthropic', name: 'Anthropic', description: '暖纸色 · 衬线正文', theme: '#f5f2ec', accent: '#b45335'},
    {id: 'openai', name: 'OpenAI', description: '黑白灰 · 简洁对话', theme: '#f7f7f8', accent: '#16785f'},
  ];
  const root = document.documentElement;
  let selected = 'astra';
  try {
    const saved = localStorage.getItem('astra-ui-style');
    if (styles.some(style => style.id === saved)) selected = saved;
  } catch {}
  root.dataset.uiStyle = selected;

  const section = elem('section', 'settings-group builtin-styles');
  section.id = 'builtin-theme-styles';
  const heading = elem('h3', '', '主题风格');
  heading.id = 'builtin-theme-styles-title';
  const choices = elem('div', 'builtin-style-choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-labelledby', heading.id);
  const buttons = [];

  function updateSelection() {
    for (const button of buttons) {
      const active = button.dataset.builtinStyle === selected && !document.body.classList.contains('market-skin');
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  async function chooseStyle(style) {
    buttons.forEach(button => {button.disabled = true;});
    try {
      await marketReady;
      if (!marketData) throw new Error(uiText('无法读取外观状态，请刷新后重试。'));
      cancelSkinPreview();
      await releaseMarketAppearance();
      applyTheme(themePreference);
      selected = style.id;
      root.dataset.uiStyle = selected;
      themeColor.value = style.theme;
      accentColor.value = style.accent;
      applyColors();
      try {
        localStorage.setItem('astra-ui-style', selected);
      } catch {
        toast('外观偏好暂时无法保存');
      }
      updateSelection();
    } finally {
      buttons.forEach(button => {button.disabled = false;});
    }
  }

  for (const style of styles) {
    const button = actionButton('', () => chooseStyle(style), 'builtin-style-choice');
    button.dataset.builtinStyle = style.id;
    button.setAttribute('aria-label', style.name);
    const preview = elem('span', 'builtin-style-preview');
    preview.setAttribute('aria-hidden', 'true');
    const sidebar = elem('span', 'builtin-style-sidebar');
    sidebar.append(elem('i'), elem('i'), elem('i'));
    const chat = elem('span', 'builtin-style-chat');
    chat.append(elem('span', 'builtin-style-user'), elem('span', 'builtin-style-answer', 'Aa'), elem('span', 'builtin-style-line'), elem('span', 'builtin-style-composer'));
    preview.append(sidebar, chat);
    const label = elem('strong', '', style.name);
    label.dataset.i18nIgnore = '';
    button.append(preview, label, elem('small', '', style.description));
    buttons.push(button);
    choices.append(button);
  }
  section.append(heading, choices);
  $('[data-panel=appearance] .theme-options').previousElementSibling.before(section);
  // Keep the existing color editor's reset action consistent with the style.
  resetColors.onclick = () => {
    const style = styles.find(item => item.id === selected);
    themeColor.value = style.theme;
    accentColor.value = style.accent;
    applyColors();
  };
  new MutationObserver(updateSelection).observe(document.body, {attributes: true, attributeFilter: ['class']});
  updateSelection();
})();
