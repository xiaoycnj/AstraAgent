// Built-in styles share the existing light/dark and color preferences.
(() => {
  const styles = [
    {id: 'light-rainbow', name: 'LightRainbow', description: 'AstraAgent 默认主题'},
    {id: 'astra', name: 'AstraAgent', description: '蓝紫玻璃 · 经典主题', theme: '#8582b8', accent: '#77a1ff'},
    {id: 'anthropic', name: 'Anthropic', description: '暖纸与陶土 · 编辑式排版', theme: '#f5f4ed', accent: '#b6583a'},
    {id: 'openai', name: 'OpenAI', description: '黑白灰 · 简洁对话', theme: '#f7f7f8', accent: '#16785f'},
    {id: 'fluent3', name: 'Fluent3', description: 'WinUI 3 · 云母质感与分栏布局'},
    {id: 'zhufeng', name: '朱峰Agent', description: '画布工作台 · 紧凑面板与工具条'},
  ];
  const root = document.documentElement;
  let selected = 'light-rainbow';
  try {
    const saved = localStorage.getItem('astra-ui-style');
    if (styles.some(style => style.id === saved)) selected = saved;
  } catch {}
  root.dataset.uiStyle = selected;

  const savedColors = readAppearanceColors();
  const oldDefault = styles.find(style => style.id === (selected === 'light-rainbow' ? 'astra' : selected));
  // Older builds saved the preset pair on every boot, even if it was never edited.
  if (oldDefault?.theme && !savedColors.custom && savedColors.theme?.toLowerCase() === oldDefault.theme &&
      savedColors.accent?.toLowerCase() === oldDefault?.accent) {
    saveColors(null);
  } else if (savedColors.theme || savedColors.accent) {
    applyColors(savedColors);
  }
  function syncPickers() {
    const tokens = getComputedStyle(root);
    themeColor.value = appearanceColors?.theme || tokens.getPropertyValue('--preset-theme').trim();
    accentColor.value = appearanceColors?.accent || tokens.getPropertyValue('--preset-accent').trim();
    for (const input of [themeColor, accentColor]) {
      const output = input.parentElement.querySelector('output');
      if (output) output.value = input.value.toUpperCase();
    }
  }
  async function prepareAppearanceChange() {
    await marketReady;
    cancelSkinPreview();
    await releaseMarketAppearance();
    applyTheme(themePreference);
  }
  async function editColors(change) {
    try {
      if (skinPreview || marketData?.state.active_skin) await prepareAppearanceChange();
      saveColors(change ? { ...appearanceColors, ...change } : null);
    } catch (error) {
      toast(error.message);
    }
    syncPickers();
  }
  for (const [input, key] of [[themeColor, 'theme'], [accentColor, 'accent']]) {
    input.oninput = () => editColors({ [key]: input.value });
  }
  new MutationObserver(syncPickers).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  syncPickers();

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
      await prepareAppearanceChange();
      selected = style.id;
      root.dataset.uiStyle = selected;
      saveColors(null);
      syncPickers();
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
  resetColors.onclick = () => editColors(null);
  new MutationObserver(updateSelection).observe(document.body, {attributes: true, attributeFilter: ['class']});
  updateSelection();
})();
