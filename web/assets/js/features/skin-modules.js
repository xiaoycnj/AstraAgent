const skinModuleSection = elem('section', 'settings-group skin-module-manager');
skinModuleSection.id = 'skin-modules';
skinModuleSection.append(elem('h3', '', '皮肤模组'), elem('p', 'hint', '每个模组可单独启停和编辑。按列表顺序叠加，靠后的同名设置优先。'));
layoutPanel.append(skinModuleSection);
const modToolbar = elem('div', 'personalization-actions'), modPicker = elem('input');
modPicker.type = 'file'; modPicker.accept = '.zip'; modPicker.hidden = true;
modToolbar.append(actionButton('安装 ZIP 模组', () => modPicker.click(), 'secondary'),
  actionButton('新建模组', () => editSkinModule(), 'secondary'),
  actionButton('导出完整皮肤包', async () => {await flushAppearance(); downloadSkinModule();}, 'secondary'),
  actionButton('重试保存', () => flushAppearance(), 'secondary'), modPicker);
skinModuleSection.append(modToolbar);
const modList = elem('div', 'skin-mod-list'); skinModuleSection.append(modList);
const presetButtons = new Map();
skinModuleSection.inert = true;
const modPresets = [
  {id: 'focus-home', name: '专注主页', description: '居中输入，保留标题与快捷入口。', settings: {layout: {composer_position: 'center', home_hidden: ['hint', 'starters'], home_width: 720}}},
  {id: 'wide-workspace', name: '宽屏工作台', description: '展开导航标签，使用更宽的主页内容。', settings: {layout: {sidebar_labels: true, home_width: 1100, home_columns: 4}}},
  {id: 'soft-reading', name: '柔和阅读', description: '更大的正文与圆润的对话输入框。', settings: {styles: {font_size: 16, message_radius: 24, composer_radius: 32}}}
];
const discovery = elem('details', 'settings-disclosure'), discoveryList = elem('div', 'skin-mod-presets');
discovery.append(elem('summary', '', '发现内置模组'), discoveryList); skinModuleSection.append(discovery);
for (const preset of modPresets) {
  const card = elem('article', 'skin-mod-preset');
  const install = actionButton('安装', async () => {
    if (appearanceDraft.mods.some(mod => mod.id === preset.id)) {toast('此模组已安装'); return;}
    const candidate = structuredClone(appearanceDraft);
    candidate.mods.push({...structuredClone(preset), version: '1.0.0', author: 'AstraAgent', enabled: true});
    await commitSkinCandidate(candidate);
  }, 'secondary');
  presetButtons.set(preset.id, install);
  card.append(elem('strong', '', preset.name), elem('p', 'hint', preset.description), install);
  discoveryList.append(card);
}
let modListSignature = '';
function downloadSkinModule(id) {
  const link = elem('a'); link.href = '/api/appearance/export' + (id ? '?mod=' + encodeURIComponent(id) : '');
  link.download = id ? id + '.zip' : 'astra-skin.zip'; link.click();
}
async function commitSkinCandidate(candidate) {
  const generation = appearanceGeneration;
  const validated = await api('/api/appearance/validate', 'POST', candidate);
  if (generation !== appearanceGeneration) throw Error(uiText('外观已更新，请重新预览或保存。'));
  appearanceDraft = validated; changeAppearance(); await flushAppearance();
  return validated;
}
function renderSkinModules() {
  if (!appearanceDraft) return;
  skinModuleSection.inert = false;
  for (const [id, button] of presetButtons) {
    const installed = appearanceDraft.mods.some(mod => mod.id === id);
    button.disabled = installed; button.textContent = uiText(installed ? '已安装' : '安装');
  }
  const signature = JSON.stringify(appearanceDraft.mods);
  if (signature === modListSignature) return;
  modListSignature = signature; modList.replaceChildren();
  if (!appearanceDraft.mods.length) modList.append(elem('p', 'hint', '尚未安装模组，可导入 ZIP 或选择内置模组。'));
  for (const mod of appearanceDraft.mods) {
    const card = elem('article', 'skin-mod-card'); card.dataset.modId = mod.id;
    const header = elem('div', 'skin-mod-head'), title = elem('div');
    const name = elem('h4', '', mod.name), meta = elem('small', '', mod.version + (mod.author ? ' · ' + mod.author : ''));
    name.dataset.i18nIgnore = ''; meta.dataset.i18nIgnore = ''; title.append(name, meta);
    header.append(title, layoutToggle('启用', mod.enabled, checked => {mod.enabled = checked; changeAppearance();}));
    const description = elem('p', 'hint', mod.description); description.dataset.i18nIgnore = '';
    const actions = elem('div', 'personalization-actions');
    actions.append(actionButton('设置', () => editSkinModule(mod.id), 'secondary'), actionButton('预览', () => previewSkinModule(mod), 'secondary'));
    const more = elem('details', 'skin-mod-more'); more.append(elem('summary', '', '更多操作'));
    more.append(actionButton('编辑配置', () => editSkinModule(mod.id, true), 'secondary'),
      actionButton('导出模组', async () => {await flushAppearance(); downloadSkinModule(mod.id);}, 'secondary'),
      actionButton('上移', () => moveSkinModule(mod.id, -1), 'secondary'),
      actionButton('下移', () => moveSkinModule(mod.id, 1), 'secondary'),
      actionButton('卸载', () => {appearanceDraft.mods = appearanceDraft.mods.filter(item => item.id !== mod.id); changeAppearance();}, 'secondary'));
    actions.append(more); card.append(header, description, actions); modList.append(card);
  }
}
function moveSkinModule(id, delta) {
  const list = appearanceDraft.mods, index = list.findIndex(item => item.id === id), next = index + delta;
  if (next < 0 || next >= list.length) return;
  [list[index], list[next]] = [list[next], list[index]]; changeAppearance();
}
modPicker.onchange = async () => {
  const file = modPicker.files[0]; if (!file) return;
  try {
    await flushAppearance();
    const generation = appearanceGeneration;
    const imported = await sendAppearanceFile('/api/appearance/import?install=1', file);
    if (generation === appearanceGeneration) appearanceDraft = imported;
    else appearanceDraft.mods = imported.mods;
    changeAppearance(); await flushAppearance(); toast('模组已安装');
  } catch (error) {layoutStatus.textContent = error.message;}
  finally {modPicker.value = '';}
};

let skinPreviewBar;
function cancelLayoutPreview(repaint = true) {
  appearancePreviewDraft = null; skinPreviewBar?.remove(); skinPreviewBar = null;
  if (repaint) applyPersonalAppearance();
}
function moduleCandidate(mod, previousId = mod.id) {
  const candidate = structuredClone(appearanceDraft), index = candidate.mods.findIndex(item => item.id === previousId);
  if (index < 0) candidate.mods.push(mod); else candidate.mods[index] = mod;
  return candidate;
}
async function previewSkinModule(mod, previousId = mod.id) {
  await flushAppearance();
  const generation = appearanceGeneration;
  const candidate = await api('/api/appearance/validate', 'POST', moduleCandidate({...mod, enabled: true}, previousId));
  if (generation !== appearanceGeneration) throw Error(uiText('外观已更新，请重新预览或保存。'));
  cancelLayoutPreview(false); appearancePreviewDraft = candidate; applyPersonalAppearance();
  skinPreviewBar = elem('aside', 'layout-preview-bar'); skinPreviewBar.setAttribute('aria-label', '模组预览');
  skinPreviewBar.append(elem('strong', '', uiText('正在预览') + ' · ' + mod.name),
    actionButton('应用预览', async () => {appearanceDraft = candidate; cancelLayoutPreview(false); changeAppearance(); await flushAppearance();}, 'primary'),
    actionButton('取消预览', () => cancelLayoutPreview(), 'secondary'));
  document.body.append(skinPreviewBar);
}
const changeBeforeModulePreview = changeAppearance;
changeAppearance = function() {if (appearancePreviewDraft) cancelLayoutPreview(false); changeBeforeModulePreview();};
document.addEventListener('keydown', event => {if (event.key === 'Escape' && appearancePreviewDraft) cancelLayoutPreview();});

let activeModCodeEditor = null;
const modDialog = elem('dialog', 'skin-mod-dialog'); document.body.append(modDialog);
function editSkinModule(id, startWithSource = false) {
  const existing = appearanceDraft.mods.find(item => item.id === id);
  let draft = structuredClone(existing || {id: 'mod-' + crypto.randomUUID(), name: uiText('新建模组'), version: '1.0.0', author: '', description: '', enabled: true, settings: {styles: {font_size: 16}}});
  activeModCodeEditor?.toTextArea(); activeModCodeEditor = null;
  modDialog.replaceChildren();
  const header = elem('div', 'dialog-head'); header.append(elem('h2', '', existing ? '编辑模组' : '新建模组'), actionButton('关闭', () => modDialog.close(), 'secondary'));
  const tabs = elem('div', 'skin-mod-tabs'); tabs.setAttribute('role', 'tablist');
  const fields = elem('div', 'skin-mod-fields'), source = elem('textarea'); source.setAttribute('aria-label', '模组 JSON 配置');
  const sourcePane = elem('div', 'skin-mod-source'); sourcePane.append(source);
  const feedback = elem('p', 'inline-error'); feedback.setAttribute('role', 'status');
  const footer = elem('div', 'dialog-footer');
  modDialog.append(header, tabs, fields, sourcePane, feedback, footer);
  const editor = CodeMirror.fromTextArea(source, {mode: {name: 'javascript', json: true}, lineNumbers: true, lineWrapping: true, viewportMargin: Infinity});
  activeModCodeEditor = editor;
  editor.getInputField().setAttribute('aria-label', '模组 JSON 配置'); editor.setValue(JSON.stringify(draft, null, 2));
  let sourceActive = false; const editors = [];
  function drawSettings() {
    fields.replaceChildren(); editors.length = 0;
    for (const [key, title] of [['name', '模组名称'], ['version', '版本'], ['author', '作者'], ['description', '说明']]) {
      const control = field(title, 'skin-mod-' + key); control.input.value = draft[key];
      control.input.maxLength = {name:100, version:40, author:80, description:1000}[key];
      editors.push(() => {draft[key] = control.input.value;}); fields.append(control.label);
    }
    for (const [group, settings] of Object.entries(draft.settings)) {
      const groupTitle = elem('h3', '', ({styles:'样式', layout:'布局', background:'背景', icons:'图标'})[group] || group); fields.append(groupTitle);
      for (const [key, value] of Object.entries(settings)) {
        const structured = typeof value === 'object' && value !== null;
        const title = group === 'layout' ? layoutInputs.get(key)?.getAttribute('aria-label') || ({home_order:'主页区块顺序', home_hidden:'隐藏的主页区块', sidebar_order:'侧栏顺序', sidebar_bottom:'底部按钮', sidebar_names:'按钮名称', home_shortcuts:'主页快捷入口', shortcuts:'自定义快捷入口'})[key] || key : group === 'icons' ? iconLabels[key] || key : appearanceFields.get(group + '.' + key)?.getAttribute('aria-label') || key;
        const control = field(title, 'skin-setting-' + group + '-' + key, typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'checkbox' : 'text', structured ? 3 : 0);
        if (typeof value === 'boolean') control.input.checked = value;
        else control.input.value = structured ? JSON.stringify(value, null, 2) : value ?? '';
        if (typeof value === 'number') control.input.step = 'any';
        editors.push(() => {draft.settings[group][key] = structured ? JSON.parse(control.input.value) : typeof value === 'number' ? Number(control.input.value) : typeof value === 'boolean' ? control.input.checked : control.input.value || (value === null ? null : '');});
        fields.append(control.label);
      }
    }
  }
  function collect() {
    if (sourceActive) return JSON.parse(editor.getValue());
    editors.forEach(read => read()); return structuredClone(draft);
  }
  for (const [isSource, label] of [[false, '设置'], [true, '配置']]) {
    const button = actionButton(label, async () => {
      try {
        const proposed = collect();
        const validated = await api('/api/appearance/validate', 'POST', moduleCandidate(proposed, existing?.id));
        draft = validated.mods.find(mod => mod.id === proposed.id); sourceActive = isSource;
        if (isSource) editor.setValue(JSON.stringify(draft, null, 2)); else drawSettings();
        syncTabs();
      } catch (error) {feedback.textContent = error.message;}
    }, 'secondary');
    button.setAttribute('role', 'tab'); button.dataset.source = String(isSource); tabs.append(button);
  }
  function syncTabs() {
    fields.hidden = sourceActive; sourcePane.hidden = !sourceActive;
    for (const button of tabs.children) button.setAttribute('aria-selected', String(button.dataset.source === String(sourceActive)));
    if (sourceActive) requestAnimationFrame(() => editor.refresh());
  }
  footer.append(actionButton('预览', async () => {try {await previewSkinModule(collect(), existing?.id); modDialog.close();} catch (error) {feedback.textContent = error.message;}}, 'secondary'),
    actionButton('保存模组', async () => {try {const mod = collect(); await commitSkinCandidate(moduleCandidate(mod, existing?.id)); modDialog.close();} catch (error) {feedback.textContent = error.message;}}, 'primary'));
  drawSettings(); sourceActive = startWithSource; syncTabs(); modDialog.showModal();
  requestAnimationFrame(() => {editor.refresh(); (sourceActive ? editor.getInputField() : fields.querySelector('input'))?.focus();});
}
const syncBeforeModules = syncAppearanceControls;
syncAppearanceControls = function() {syncBeforeModules(); renderSkinModules();};
appearanceReady.then(renderSkinModules);
