// Layouts target named application slots and reuse the original action handlers.
const defaultUserLayout = {
  enabled: false, home_order: ['greeting', 'hint', 'starters', 'shortcuts'], home_hidden: [],
  home_align: 'center', home_width: 840, home_columns: 3, home_title: '', composer_position: 'bottom',
  sidebar_order: ['home', 'images', 'library', 'more', 'settings', 'profile'],
  sidebar_bottom: ['settings', 'profile'], sidebar_names: {}, sidebar_labels: false, home_shortcuts: [], shortcuts: []
};
const layoutActions = {
  home: ['主页', railHome], images: ['生图', () => navigatePage('images')],
  library: ['资料库', () => navigatePage('library')], schedule: ['定时任务', () => navigatePage('schedule')],
  plugins: ['插件管理', () => {showSettings(); selectSettingsTab('capabilities');}],
  review: ['代码审阅', async () => {await railHome(); openWorkbench('files'); reviewFile.focus();}],
  settings: ['设置', showSettings], profile: ['个人资料', () => {showSettings(); selectSettingsTab('profile');}],
  canvas: ['无限画布', () => switchMode('canvas')], projects: ['项目管理', showProjectManager],
  archives: ['已归档的聊天', () => {showSettings(); selectSettingsTab('archives');}],
  theme: ['切换主题', () => $('#theme-toggle').click()],
  appearance: ['外观', () => {showSettings(); selectSettingsTab('appearance');}],
  performance: ['性能统计', () => {showSettings(); selectSettingsTab('performance');}],
  layout: ['布局与模组', () => {showSettings(); selectSettingsTab('layout');}],
  files: ['项目文件', async () => {await railHome(); openWorkbench('files');}],
  new_chat: ['新建会话', newSession], prompt: ['填入提示词', null]
};
async function runLayoutAction(entry) {
  if (entry.action === 'prompt') {
    await railHome();
    $('#chat-input').value = entry.prompt;
    $('#chat-input').dispatchEvent(new Event('input', {bubbles: true}));
    $('#chat-input').focus();
  } else await layoutActions[entry.action][1]();
}
const originalNavigationNames = new Map([...railButtons].map(([id, button]) => [id, button.getAttribute('aria-label')]));
const customNavigationButtons = new Map();
const layoutHomeSnapshots = new WeakMap();
const layoutNavigationStash = elem('div');
layoutNavigationStash.hidden = true;
document.body.append(layoutNavigationStash);
let userLayout = structuredClone(defaultUserLayout);
let navigationLayoutSignature = '';
function applyUserLayout(value) {
  userLayout = value?.enabled ? value : structuredClone(defaultUserLayout);
  const signature = JSON.stringify(userLayout);
  if (signature !== navigationLayoutSignature) {
    navigationLayoutSignature = signature;
    closeRailMenu();
    document.body.style.setProperty('--layout-home-width', userLayout.home_width + 'px');
    document.body.classList.toggle('layout-navigation-labels', userLayout.sidebar_labels);
    document.body.classList.toggle('layout-navigation-custom', userLayout.enabled);
    const definitions = new Map(userLayout.shortcuts.map(item => [item.id, item]));
    for (const [id, button] of customNavigationButtons) {
      if (!definitions.has(id)) {button.remove(); customNavigationButtons.delete(id); railButtons.delete(id);}
    }
    for (const entry of userLayout.shortcuts) {
      let button = customNavigationButtons.get(entry.id);
      if (!button) {
        button = actionButton('', async () => {await runLayoutAction(button.layoutEntry); selectRail(entry.id);}, 'rail-button');
        button.id = 'nav-' + entry.id;
        customNavigationButtons.set(entry.id, button); railButtons.set(entry.id, button);
      }
      button.layoutEntry = entry;
      button.setAttribute('aria-label', entry.label); button.title = entry.label;
      button.replaceChildren(railIcon(entry.icon), elem('span', 'rail-tooltip', entry.label));
    }
    for (const [id, button] of railButtons) {
      if (!button.dataset.layoutMenuHandler) {
        button.dataset.layoutMenuHandler = 'true';
        button.addEventListener('click', () => {if (button.parentElement === railMenu) closeRailMenu();});
      }
      const name = userLayout.sidebar_names[id] || definitions.get(id)?.label || originalNavigationNames.get(id);
      button.setAttribute('aria-label', name); button.title = name;
      const labelNode = button.querySelector('.rail-tooltip,.rail-label');
      if (labelNode) labelNode.textContent = name;
      const pinned = userLayout.sidebar_order.includes(id);
      button.classList.toggle('rail-button', pinned);
      button.classList.toggle('rail-menu-item', !pinned);
      const label = button.querySelector('.rail-tooltip,.rail-label');
      if (label) label.className = pinned ? 'rail-tooltip' : 'rail-label';
      if (pinned) button.removeAttribute('role');
      else button.setAttribute('role', 'menuitem');
      if (!pinned) (id === 'more' ? layoutNavigationStash : railMenu).append(button);
    }
    for (const id of userLayout.sidebar_order) {
      const button = railButtons.get(id);
      if (button) (userLayout.sidebar_bottom.includes(id) ? railBottom : railTop).append(button);
    }
    const divider = railTop.querySelector('.rail-divider');
    if (divider) railTop.append(divider);
    selectRail(railActive);
    applyPersonalIcons();
  }
  applyHomeLayout();
}
function applyHomeLayout() {
  const welcome = $('#messages .welcome');
  document.body.classList.toggle('layout-home-active', !!welcome && userLayout.enabled);
  document.body.classList.toggle('layout-home-center', !!welcome && userLayout.enabled && userLayout.composer_position === 'center');
  if (!welcome) return;
  let snapshot = layoutHomeSnapshots.get(welcome);
  if (!snapshot) {
    snapshot = {title: welcome.querySelector('h1')?.textContent, signature: ''};
    layoutHomeSnapshots.set(welcome, snapshot);
  }
  const signature = JSON.stringify(userLayout);
  if (snapshot.signature === signature) return;
  snapshot.signature = signature;
  welcome.style.setProperty('--home-width', userLayout.home_width + 'px');
  welcome.style.setProperty('--home-columns', userLayout.home_columns);
  welcome.style.setProperty('--home-mobile-columns', Math.min(userLayout.home_columns, 2));
  welcome.dataset.layoutAlign = userLayout.home_align;
  const title = welcome.querySelector('h1');
  if (title) {
    title.dataset.layoutTitle = String(!!userLayout.home_title);
    if (userLayout.home_title) {title.textContent = userLayout.home_title; title.dataset.i18nIgnore = '';}
    else {title.textContent = snapshot.title; delete title.dataset.i18nIgnore;}
  }
  let shortcuts = welcome.querySelector('.layout-home-shortcuts');
  if (!shortcuts) {shortcuts = elem('div', 'layout-home-shortcuts'); welcome.append(shortcuts);}
  shortcuts.replaceChildren();
  for (const id of userLayout.home_shortcuts) {
    const entry = userLayout.shortcuts.find(item => item.id === id) || (layoutActions[id] && {label: uiText(layoutActions[id][0]), icon: id, action: id});
    if (!entry) continue;
    const button = actionButton('', () => runLayoutAction(entry), 'layout-home-shortcut secondary');
    button.append(railIcon(entry.icon), elem('span', '', entry.label));
    shortcuts.append(button);
  }
  const blocks = {greeting: title, hint: welcome.querySelector(':scope > p'), starters: welcome.querySelector('.starter-grid'), shortcuts};
  for (const id of userLayout.home_order) {
    const node = blocks[id];
    if (!node) continue;
    node.hidden = userLayout.home_hidden.includes(id) || (id === 'shortcuts' && !shortcuts.children.length);
    welcome.append(node);
  }
  let edit = welcome.querySelector('.layout-home-edit');
  if (!edit) edit = actionButton('编辑主页布局', () => {showSettings(); selectSettingsTab('layout');}, 'layout-home-edit secondary');
  welcome.append(edit);
}
const beforeLayoutRender = renderMessages;
renderMessages = function(...args) {const result = beforeLayoutRender(...args); applyHomeLayout(); return result;};
appearanceReady.then(() => {if (appearanceDraft) applyUserLayout(effectiveAppearance().layout);});
