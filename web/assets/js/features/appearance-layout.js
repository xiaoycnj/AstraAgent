// Reuse the existing appearance controls and their persistence handlers.
(() => {
  const panel = $('[data-panel=appearance]');
  const advanced = colorSection.closest('.workspace-disclosure');
  advanced.id = 'advanced-appearance';
  advanced.classList.add('appearance-advanced');
  panel.querySelector('.section-number')?.remove();
  panel.querySelector(':scope > .dialog-intro')?.remove();
  colorSection.classList.add('appearance-subsection');
  materialGroup.classList.add('appearance-subsection');
  glassSettings.classList.add('appearance-subsection');
  glassCaption.remove();
  glassSettings.querySelector('.glass-settings-note')?.remove();

  // Color pickers retain native keyboard interaction and show the exact value.
  const colorOutputs = [];
  for (const input of [themeColor, accentColor]) {
    const label = input.closest('label');
    const title = elem('span', 'appearance-setting-label', input.getAttribute('aria-label'));
    const controls = elem('span', 'appearance-color-control');
    const value = elem('output');
    value.htmlFor = input.id;
    controls.append(value, input);
    label.classList.add('appearance-setting-row');
    label.replaceChildren(title, controls);
    colorOutputs.push(() => {value.value = input.value.toUpperCase();});
  }
  const previousColors = applyColors;
  applyColors = function(colors) {
    previousColors(colors);
    colorOutputs.forEach(update => update());
  };
  colorOutputs.forEach(update => update());

  function keyboardChoices(group) {
    group.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...group.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      let next = event.key === 'ArrowLeft' ? index - 1 : index + 1;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      event.preventDefault();
      const button = buttons[(next + buttons.length) % buttons.length];
      button.click();
      button.focus();
    });
  }
  const materialRows = [...materialGroup.querySelectorAll('.material-options')];
  for (const [index, title] of ['界面材质', '布局密度'].entries()) {
    const group = materialRows[index];
    group.classList.add('appearance-segmented');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', title);
    const row = elem('div', 'appearance-setting-row');
    const label = elem('span', 'appearance-setting-label', title);
    group.before(row);
    row.append(label, group);
    keyboardChoices(group);
  }
  // Independent of the skin: changing theme or layout does not reset these preferences.
  const experience = elem('section', 'settings-group appearance-experience');
  const experienceHeading = elem('h3', '', '动效与智能界面');
  experienceHeading.id = 'appearance-experience-title';
  experience.setAttribute('aria-labelledby', experienceHeading.id);
  experience.append(experienceHeading);
  advanced.before(experience);
  function preferenceChoices(title, key, datasetKey, initial, choices) {
    const row = elem('div', 'appearance-setting-row');
    const group = elem('div', 'appearance-segmented');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', title);
    let selected;
    try { selected = localStorage.getItem(key); } catch {}
    if (!choices.some(([id]) => id === selected)) selected = initial;
    const buttons = new Map(choices.map(([id, label]) => [id, elem('button', '', label)]));
    function apply(id, persist) {
      document.documentElement.dataset[datasetKey] = id;
      for (const [value, button] of buttons) button.setAttribute('aria-pressed', String(id === value));
      if (persist) try { localStorage.setItem(key, id); } catch {}
    }
    for (const [id, button] of buttons) {
      button.type = 'button';
      button.onclick = () => apply(id, true);
      group.append(button);
    }
    apply(selected, false);
    keyboardChoices(group);
    row.append(elem('span', 'appearance-setting-label', title), group);
    experience.append(row);
  }
  preferenceChoices('动效风格', 'astra-motion-style', 'motionStyle', 'spring',
    [['quick', '轻快'], ['standard', '平滑'], ['spring', '弹性']]);
  preferenceChoices('IUI 控件密度', 'astra-iui-density', 'iuiDensity', 'balanced',
    [['compact', '紧凑'], ['balanced', '适中'], ['comfortable', '宽松']]);
  const motionNote = elem('p', 'appearance-experience-note');
  const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function updateMotionNote() {
    motionNote.textContent = systemMotion.matches ? '系统已开启减少动态效果，动画样式会在恢复动效后生效。' :
      document.documentElement.dataset.motion === 'reduced' ? '应用已开启减少动效，动画样式会在恢复动效后生效。' :
      '动效风格会应用到菜单、弹窗和交互反馈。IUI 密度仅调整智能卡片。';
  }
  systemMotion.addEventListener('change', updateMotionNote);
  new MutationObserver(updateMotionNote).observe(document.documentElement, {attributes: true, attributeFilter: ['data-motion']});
  updateMotionNote();
  experience.append(motionNote);

  keyboardChoices(glassVariantGroup);
  glassVariantGroup.setAttribute('aria-label', '玻璃质感');

  // The parent fieldset keeps the original loading/upload disabled state.
  const field = path => appearanceFields.get(path).closest('.personalization-field');
  function group(title, ...children) {
    const section = elem('fieldset', 'appearance-editor-group');
    section.append(elem('legend', '', title), ...children);
    appearanceControls.append(section);
    return section;
  }
  group('自定义外观', field('.enabled'), field('.name'));
  const uploadHint = appearanceUploads.nextElementSibling;
  group('背景与播放', appearanceUploads, uploadHint, field('background.fit'),
    field('background.opacity'), field('background.blur'), field('background.speed'), field('background.paused'));
  group('对话与输入', field('styles.surface_opacity'), field('styles.message_radius'), field('styles.composer_radius'));
  const sample = elem('div', 'appearance-font-sample');
  sample.setAttribute('aria-label', '字体预览');
  sample.append(elem('p', '', '清晰地表达每一个想法。'), elem('p', '', 'A space for ideas. 0123456789'));
  group('字体与阅读', field('styles.font_family'), field('styles.font_size'), fontActions, sample);
  group('自定义颜色', ...['message_color', 'composer_color', 'text_color', 'accent_color'].map(key => field('styles.' + key)));
  group('导航图标', iconTarget.closest('.personalization-field'), iconActions);
  group('皮肤文件包', packActions);

  const rangeUpdates = [];
  for (const [path, input] of appearanceFields) {
    if (input.type !== 'range') continue;
    input.id ||= 'appearance-' + path.replace('.', '-');
    const control = elem('span', 'appearance-range-control');
    const value = elem('output');
    value.htmlFor = input.id;
    input.before(control);
    control.append(input, value);
    const update = () => {
      const number = Number(input.value);
      let text = number + ' px';
      if (path.endsWith('opacity')) text = Math.round(number * 100) + '%';
      if (path === 'background.speed') text = number + '×';
      value.value = text;
      input.setAttribute('aria-valuetext', text);
    };
    input.addEventListener('input', update);
    rangeUpdates.push(update);
  }
  const syncControls = syncAppearanceControls;
  syncAppearanceControls = function() {
    syncControls();
    rangeUpdates.forEach(update => update());
  };
  rangeUpdates.forEach(update => update());
})();
