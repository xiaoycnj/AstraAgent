let preferredConversationMode = localStorage.getItem('astra-conversation-mode') === 'agent' ? 'agent' : 'chat';
let conversationModeSaving = false;

function getConversationMode() {
  return state.session ? state.session.conversation_mode || 'agent' : preferredConversationMode;
}

const conversationModeControl = elem('div', 'conversation-mode-control');
const conversationModePicker = elem('details', 'conversation-mode-picker');
const conversationModeSummary = elem('summary');
conversationModeSummary.setAttribute('aria-label', uiText('对话模式'));
conversationModePicker.append(conversationModeSummary, conversationModeControl);
conversationModeControl.setAttribute('role', 'group');
conversationModeControl.setAttribute('aria-label', uiText('对话模式'));
const conversationModeButtons = new Map();
for (const mode of ['chat', 'agent']) {
  const button = actionButton(mode === 'chat' ? 'Chat' : 'Agent', () => changeConversationMode(mode), 'conversation-mode-button');
  button.type = 'button'; button.dataset.conversationMode = mode;
  button.dataset.i18nIgnore = ''; button.textContent = mode === 'chat' ? 'Chat' : 'Agent';
  button.title = uiText(mode === 'chat' ? '对话、IUI 和生图' : '智能体工具与本地工作空间');
  conversationModeButtons.set(mode, button); conversationModeControl.append(button);
}
$('.composer-tools .spacer').before(conversationModePicker);
const conversationModeHint = elem('p', 'conversation-mode-hint');
conversationModeHint.setAttribute('role', 'status');
composerOptionsPanel.append(conversationModeHint);
composerOptionsPanel.append(unifiedPolicyButton);
conversationModeSummary.onclick = event => {
  if (conversationModeSaving || submitting || state.pending.has(state.session?.id)) event.preventDefault();
};
document.addEventListener('pointerdown', event => { if (!conversationModePicker.contains(event.target)) conversationModePicker.open = false; });
conversationModePicker.addEventListener('keydown', event => { if (event.key === 'Escape') { conversationModePicker.open = false; conversationModeSummary.focus(); } });

async function changeConversationMode(mode) {
  if (conversationModeSaving || submitting || state.pending.has(state.session?.id)) return;
  const session = state.session;
  conversationModeSaving = true; syncConversationMode();
  try {
    if (session) await api('/api/sessions/' + session.id, 'PATCH', {conversation_mode: mode});
    if (session) session.conversation_mode = mode;
    conversationModePicker.open = false;
    preferredConversationMode = mode;
    localStorage.setItem('astra-conversation-mode', mode);
    if (state.session === session) { syncConversationMode(); conversationModeSummary.focus(); }
  } catch (error) { toast(error.message); }
  finally { conversationModeSaving = false; syncConversationMode(); }
}

function syncConversationMode() {
  const mode = getConversationMode(), chat = mode === 'chat';
  document.body.dataset.conversationMode = mode;
  if (conversationModeSummary.dataset.mode !== mode) {
    conversationModeSummary.dataset.mode = mode;
    const label = elem('span', '', mode === 'chat' ? 'Chat' : 'Agent'); label.dataset.i18nIgnore = '';
    conversationModeSummary.replaceChildren(label, chevron());
  }
  conversationModeSummary.setAttribute('aria-disabled', String(conversationModeSaving || submitting || state.pending.has(state.session?.id)));
  for (const [value, button] of conversationModeButtons) {
    button.setAttribute('aria-pressed', String(value === mode));
    button.disabled = conversationModeSaving || submitting || state.pending.has(state.session?.id);
  }
  conversationModeHint.textContent = uiText(chat ? 'Chat 可使用 IUI、生图、计算器和时间工具。' : 'Agent 根据当前权限使用文件、命令与扩展工具。');
  for (const control of [shelfProject, device, compatibilityPermissions, pluginChips, unifiedPolicyButton]) if (control) control.hidden = chat;
}

const runtimeOptionsBeforeConversationMode = runtimeOptions;
runtimeOptions = function(requestedMode) {
  const options = {...runtimeOptionsBeforeConversationMode(), conversation_mode: requestedMode === 'agent' ? 'agent' : getConversationMode()};
  if (options.conversation_mode === 'chat') {
    Object.assign(options, {tools: [], plugins: [], file_permission: 'none', command_permission: 'none',
      memory_policy: 'off', auto_memory: false, skill: 'general', project_id: '', story_id: ''});
  }
  return options;
};
const renderBeforeConversationMode = renderMessages;
renderMessages = function() { renderBeforeConversationMode(); syncConversationMode(); };
let conversationModeOpenRequest = 0;
const openBeforeConversationMode = openSession;
openSession = async function(session) {
  const request = ++conversationModeOpenRequest;
  let selected = session;
  if (!['chat', 'agent'].includes(session.conversation_mode)) {
    const saved = state.sessions.find(item => item.id === session.id) || (await api('/api/sessions')).find(item => item.id === session.id);
    selected = {...saved, ...session, conversation_mode: saved?.conversation_mode || 'agent'};
  }
  if (request !== conversationModeOpenRequest) return;
  await openBeforeConversationMode(selected);
  syncConversationMode();
};
const commandsBeforeConversationMode = getCommandEntries;
getCommandEntries = function(type) { return getConversationMode() === 'chat' ? [] : commandsBeforeConversationMode(type); };
syncConversationMode();
