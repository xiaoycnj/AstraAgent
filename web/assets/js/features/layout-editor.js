const layoutPanel = settingPanel('layout', '布局与模组', '调整主页和导航，组合自己的皮肤模组。');
layoutPanel.id = 'layout-customization';
const layoutStatus = elem('p', 'hint');
layoutStatus.setAttribute('role', 'status');
const layoutOverrideHint = elem('p', 'hint', '已启用的布局模组会覆盖同名手动设置。');
layoutOverrideHint.hidden = true;
layoutPanel.append(layoutStatus, layoutOverrideHint);
new MutationObserver(() => {layoutStatus.textContent = appearanceFeedback.textContent;}).observe(appearanceFeedback, {childList: true, characterData: true, subtree: true});
const layoutControls = elem('fieldset', 'layout-editor');
layoutControls.disabled = true;
layoutPanel.append(layoutControls);
const layoutInputs = new Map();
const homeOrderList = elem('div', 'layout-order-list');
const sidebarOrderList = elem('div', 'layout-order-list');
const layoutNames = {greeting: '欢迎标题', hint: '使用提示', starters: '建议任务', shortcuts: '快捷入口'};
let layoutListSignature = '';
function layoutGroup(title) {
  const fieldset = elem('fieldset', 'appearance-editor-group');
  fieldset.append(elem('legend', '', title)); layoutControls.append(fieldset); return fieldset;
}
function updateUserLayout(change) {
  Object.assign(appearanceDraft.layout, change);
  changeAppearance();
}
function layoutField(parent, title, key, type, options = []) {
  const row = elem('label', 'layout-field'), input = elem(type === 'select' ? 'select' : 'input');
  input.id = 'layout-' + key;
  if (type !== 'select') input.type = type;
  else for (const [value, label] of options) input.append(new Option(uiText(label), value));
  if (type === 'checkbox') input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', title);
  input.addEventListener(['text', 'range'].includes(type) ? 'input' : 'change', () => {
    updateUserLayout({[key]: type === 'checkbox' ? input.checked : type === 'range' || key === 'home_columns' ? Number(input.value) : input.value});
  });
  row.append(elem('span', '', title), input); parent.append(row); layoutInputs.set(key, input); return input;
}
const homeGroup = layoutGroup('主页排版');
layoutField(homeGroup, '启用自定义布局', 'enabled', 'checkbox');
const homeTitleInput = layoutField(homeGroup, '自定义欢迎标题', 'home_title', 'text');
homeTitleInput.maxLength = 200; homeTitleInput.placeholder = uiText('留空使用动态欢迎语');
layoutField(homeGroup, '内容对齐', 'home_align', 'select', [['center', '居中'], ['left', '左对齐']]);
const homeWidthInput = layoutField(homeGroup, '主页内容宽度', 'home_width', 'range');
homeWidthInput.min = 480; homeWidthInput.max = 1200; homeWidthInput.step = 20;
const widthOutput = elem('output'); widthOutput.htmlFor = homeWidthInput.id;
const widthControl = elem('span', 'appearance-range-control'); homeWidthInput.before(widthControl); widthControl.append(homeWidthInput, widthOutput);
layoutField(homeGroup, '建议与快捷入口列数', 'home_columns', 'select', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]);
layoutField(homeGroup, '输入框位置', 'composer_position', 'select', [['bottom', '底部'], ['center', '内容下方']]);
homeGroup.append(elem('h4', '', '主页区块'), elem('p', 'hint', '拖动或使用上下按钮排序，开关控制显示。'), homeOrderList);
const sidebarGroup = layoutGroup('侧栏按钮');
layoutField(sidebarGroup, '侧栏显示文字', 'sidebar_labels', 'checkbox');
sidebarGroup.append(elem('p', 'hint', '未固定的入口收纳到更多菜单，底部入口单独排列。'), sidebarOrderList);
const shortcutGroup = layoutGroup('自定义快捷入口');
shortcutGroup.append(actionButton('添加快捷入口', () => editLayoutShortcut(), 'secondary'));
const shortcutList = elem('div', 'layout-shortcut-list'); shortcutGroup.append(shortcutList);
const layoutActionsBar = elem('div', 'personalization-actions');
layoutActionsBar.append(actionButton('新会话中查看布局', async () => {await flushAppearance(); await newSession();}, 'secondary'),
  actionButton('恢复默认布局', () => updateUserLayout(structuredClone(defaultUserLayout)), 'secondary'));
layoutControls.append(layoutActionsBar, elem('p', 'hint', '快捷键 Ctrl+Alt+L 可随时打开布局设置。'));

function moveLayoutItem(items, id, delta) {
  const index = items.indexOf(id), target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
  changeAppearance();
}
function orderActions(row, items, id) {
  const actions = elem('div', 'layout-row-actions');
  const up = actionButton('上移', () => moveLayoutItem(items, id, -1), 'secondary');
  const down = actionButton('下移', () => moveLayoutItem(items, id, 1), 'secondary');
  up.disabled = items.indexOf(id) <= 0; down.disabled = items.indexOf(id) === items.length - 1;
  actions.append(up, down); row.append(actions);
  row.draggable = true;
  row.ondragstart = event => event.dataTransfer.setData('text/plain', id);
  row.ondragover = event => event.preventDefault();
  row.ondrop = event => {
    event.preventDefault(); const source = event.dataTransfer.getData('text/plain');
    if (!items.includes(source) || source === id) return;
    items.splice(items.indexOf(source), 1); items.splice(items.indexOf(id), 0, source); changeAppearance();
  };
}
function layoutToggle(label, checked, callback) {
  const row = elem('label', 'layout-inline-toggle'), input = elem('input');
  input.type = 'checkbox'; input.checked = checked; input.setAttribute('role', 'switch'); input.setAttribute('aria-label', label);
  input.onchange = () => callback(input.checked); row.append(elem('span', '', label), input); return row;
}
function setMembership(items, id, included) {
  const index = items.indexOf(id);
  if (included && index < 0) items.push(id);
  if (!included && index >= 0) items.splice(index, 1);
}
function syncLayoutEditor() {
  if (!appearanceDraft) return;
  layoutControls.disabled = false;
  layoutOverrideHint.hidden = !appearanceDraft.mods.some(mod => mod.enabled && mod.settings.layout);
  const value = appearanceDraft.layout;
  for (const [key, input] of layoutInputs) {
    if (input.type === 'checkbox') input.checked = value[key];
    else if (input !== document.activeElement) input.value = value[key];
  }
  widthOutput.value = value.home_width + ' px'; homeWidthInput.setAttribute('aria-valuetext', widthOutput.value);
  const signature = JSON.stringify([value.home_order, value.home_hidden, value.sidebar_order, value.sidebar_bottom, value.sidebar_names, value.home_shortcuts, value.shortcuts]);
  if (signature === layoutListSignature) return;
  layoutListSignature = signature; homeOrderList.replaceChildren(); sidebarOrderList.replaceChildren(); shortcutList.replaceChildren();
  for (const id of value.home_order) {
    const row = elem('div', 'layout-order-row'); row.dataset.layoutBlock = id;
    row.append(elem('strong', '', layoutNames[id]), layoutToggle('显示', !value.home_hidden.includes(id), checked => {setMembership(value.home_hidden, id, !checked); changeAppearance();}));
    orderActions(row, value.home_order, id); homeOrderList.append(row);
  }
  const known = [...originalNavigationNames.keys(), ...value.shortcuts.map(item => item.id)];
  const order = [...value.sidebar_order, ...known.filter(id => !value.sidebar_order.includes(id))];
  for (const id of order) {
    const name = value.sidebar_names[id] || value.shortcuts.find(item => item.id === id)?.label || originalNavigationNames.get(id);
    const row = elem('div', 'layout-order-row'); row.dataset.layoutNav = id;
    const title = elem('strong', '', name);
    if (value.sidebar_names[id] || value.shortcuts.some(item => item.id === id)) title.dataset.i18nIgnore = '';
    row.append(title, layoutToggle('固定', value.sidebar_order.includes(id), checked => {setMembership(value.sidebar_order, id, checked); changeAppearance();}),
      layoutToggle('底部', value.sidebar_bottom.includes(id), checked => {setMembership(value.sidebar_bottom, id, checked); changeAppearance();}));
    if (id !== 'more') row.append(layoutToggle('主页', value.home_shortcuts.includes(id), checked => {setMembership(value.home_shortcuts, id, checked); changeAppearance();}));
    if (value.sidebar_order.includes(id)) orderActions(row, value.sidebar_order, id);
    row.append(actionButton('重命名', async () => {const label = await appPrompt('按钮名称', name); if (label?.trim()) {appearanceDraft.layout.sidebar_names[id] = label.trim().slice(0, 60); changeAppearance();}}, 'secondary'));
    sidebarOrderList.append(row);
  }
  for (const entry of value.shortcuts) {
    const row = elem('div', 'layout-order-row'), name = elem('strong', '', entry.label); name.dataset.i18nIgnore = '';
    row.append(name, actionButton('编辑', () => editLayoutShortcut(entry.id), 'secondary'), actionButton('删除', () => {
      value.shortcuts = value.shortcuts.filter(item => item.id !== entry.id);
      for (const list of [value.sidebar_order, value.sidebar_bottom, value.home_shortcuts]) setMembership(list, entry.id, false);
      delete value.sidebar_names[entry.id]; changeAppearance();
    }, 'secondary')); shortcutList.append(row);
  }
}
const shortcutDialog = elem('dialog', 'layout-shortcut-dialog');
document.body.append(shortcutDialog);
function editLayoutShortcut(id) {
  const entry = appearanceDraft.layout.shortcuts.find(item => item.id === id) || {label: '', icon: 'home', action: 'home', prompt: ''};
  shortcutDialog.replaceChildren();
  const form = elem('form'), title = elem('h2', '', id ? '编辑快捷入口' : '添加快捷入口');
  const name = field('按钮名称', 'shortcut-name'); name.input.required = true; name.input.maxLength = 60; name.input.value = entry.label;
  const action = elem('select'), actionLabel = elem('label', '', '入口动作');
  for (const [key, [label]] of Object.entries(layoutActions)) action.append(new Option(uiText(label), key));
  action.value = entry.action; action.setAttribute('aria-label', '入口动作'); actionLabel.append(action);
  const icon = elem('select'), iconLabel = elem('label', '', '入口图标');
  for (const key of ['home', 'images', 'schedule', 'library', 'plugins', 'review', 'settings', 'profile', 'canvas', 'search', 'theme']) icon.append(new Option(uiText(originalNavigationNames.get(key) || layoutActions[key]?.[0] || '搜索与筛选'), key));
  icon.value = entry.icon; icon.setAttribute('aria-label', '入口图标'); iconLabel.append(icon);
  const prompt = field('提示词内容', 'shortcut-prompt', 'text', 4); prompt.input.value = entry.prompt || ''; prompt.input.maxLength = 4000;
  const syncPrompt = () => {prompt.label.hidden = action.value !== 'prompt'; prompt.input.required = action.value === 'prompt';};
  action.onchange = syncPrompt; syncPrompt();
  const home = layoutToggle('显示在主页', id ? appearanceDraft.layout.home_shortcuts.includes(id) : true, () => {});
  const rail = layoutToggle('固定到侧栏', id ? appearanceDraft.layout.sidebar_order.includes(id) : true, () => {});
  const feedback = elem('p', 'inline-error'); feedback.setAttribute('role', 'status');
  const buttons = elem('div', 'dialog-footer'), save = elem('button', 'primary', '保存'); save.type = 'submit';
  buttons.append(actionButton('取消', () => shortcutDialog.close(), 'secondary'), save);
  form.append(title, name.label, actionLabel, iconLabel, prompt.label, home, rail, feedback, buttons); shortcutDialog.append(form);
  form.onsubmit = async event => {
    event.preventDefault(); save.disabled = true;
    try {
      const candidate = structuredClone(appearanceDraft), value = candidate.layout;
      const key = id || 'custom-' + crypto.randomUUID();
      const item = {id: key, label: name.input.value.trim(), icon: icon.value, action: action.value, prompt: prompt.input.value};
      const index = value.shortcuts.findIndex(old => old.id === key);
      if (index < 0) value.shortcuts.push(item); else value.shortcuts[index] = item;
      setMembership(value.home_shortcuts, key, home.querySelector('input').checked); setMembership(value.sidebar_order, key, rail.querySelector('input').checked);
      value.enabled = true;
      const generation = appearanceGeneration;
      const validated = await api('/api/appearance/validate', 'POST', candidate);
      if (generation !== appearanceGeneration) throw Error(uiText('外观已更新，请重新预览或保存。'));
      appearanceDraft = validated; changeAppearance(); await flushAppearance(); shortcutDialog.close();
    } catch (error) {feedback.textContent = error.message;}
    finally {save.disabled = false;}
  };
  shortcutDialog.showModal(); name.input.focus();
}
const syncBeforeLayoutEditor = syncAppearanceControls;
syncAppearanceControls = function() {syncBeforeLayoutEditor(); syncLayoutEditor();};
appearanceReady.then(syncLayoutEditor);
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.altKey && event.code === 'KeyL') {event.preventDefault(); showSettings(); selectSettingsTab('layout');}
});
