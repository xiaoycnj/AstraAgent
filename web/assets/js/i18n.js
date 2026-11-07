// Resource strings are plain text. Conversation and workspace content stay owned by the user.
const languagePacks = new Map();
let selectedLanguage = 'system';
let resolvedLanguage = 'zh-CN';
let languagePatterns = [];
const localizedNodes = new WeakMap();
const localizedAttributes = new WeakMap();
const reverseUiStrings = new Map();
const excludedUiContent = [
    'script', 'style', 'pre', 'code', '.markdown', '.CodeMirror',
    '.terminal-output', '.file-preview', '.project-diff', '.file-entry',
    '#current-title', '.list-item', '.session-group-title', '.profile-hero',
    '.node-title', '.node-content', '.memory-card .hint', '.memory-card button:first-child',
    '.provider-card strong', '.model-row-name', '.model-display-name', '.provider-model-alias', '.provider-model-id', '.notices-license',
    '#provider-select option:not([value=""])', '#provider-edit option:not([value=""])', '#project-selector option:not([value=""])',
    '#skill-description',
    '.hub-record-body', '.hub-record-title', '.hub-card h3', '.hub-card h4', '.hub-card p',
    '.hub-reader-text', '.reader-content', '#browser-content',
    '[data-i18n-ignore]'
].join(',');

function ownsUiText(element) {
    if (!element || element.closest(excludedUiContent)) return false;
    if (element.closest('.model-name') && typeof chosenModel === 'function' && chosenModel()) return false;
    const select = element.closest('.custom-select')?.previousElementSibling;
    if (select?.value && ['provider-select', 'provider-edit', 'project-selector'].includes(select.id)) return false;
    if (element.closest('.message') && !element.closest('.message-actions,.message-header,.run-summary>summary')) return false;
    return true;
}
function resolveUiLanguage() {
    if (selectedLanguage !== 'system' && languagePacks.has(selectedLanguage)) return selectedLanguage;
    for (const locale of navigator.languages || [navigator.language]) {
        const exact = [...languagePacks.keys()].find(code => code.toLowerCase() === locale.toLowerCase());
        if (exact) return exact;
        const base = [...languagePacks.keys()].find(code => code.split('-')[0].toLowerCase() === locale.split('-')[0].toLowerCase());
        if (base) return base;
    }
    return languagePacks.has('en') ? 'en' : 'zh-CN';
}
function uiText(source) {
    const messages = languagePacks.get(resolvedLanguage)?.messages || {};
    if (Object.hasOwn(messages, source)) return messages[source];
    const trimmed = source.trim();
    if (Object.hasOwn(messages, trimmed)) return source.replace(trimmed, messages[trimmed]);
    for (const pattern of languagePatterns) {
        const match = trimmed.match(pattern.regex);
        if (match) return source.replace(trimmed, pattern.text.replace(/\{(\d+)\}/g, (_, index) => match[pattern.parameters.indexOf(Number(index)) + 1] || '{' + index + '}'));
    }
    const chunks = source.split(/( · |\n)/);
    if (chunks.length > 1) return chunks.map(chunk => chunk === ' · ' || chunk === '\n' ? chunk : uiText(chunk)).join('');
    return source;
}
function canonicalUiText(value) {
    return reverseUiStrings.get(value) || value;
}
function translateUiElement(element) {
    if (!ownsUiText(element)) return;
    let attributes = localizedAttributes.get(element);
    if (!attributes) {attributes = new Map(); localizedAttributes.set(element, attributes);}
    for (const name of ['title', 'placeholder', 'aria-label']) {
        const value = element.getAttribute(name);
        if (!value) continue;
        const previous = attributes.get(name);
        const source = previous?.rendered === value ? previous.source : canonicalUiText(value);
        const translated = uiText(source);
        if (translated !== value) element.setAttribute(name, translated);
        attributes.set(name, {source, rendered: translated});
    }
    if (element.matches('textarea')) return;
    for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.data.trim()) continue;
        const previous = localizedNodes.get(node);
        const source = previous?.rendered === node.data ? previous.source : canonicalUiText(node.data);
        const translated = uiText(source);
        localizedNodes.set(node, {source, rendered: translated});
        if (node.data !== translated) node.data = translated;
    }
}
function translateUiTree(root) {
    if (!(root instanceof Element)) return;
    translateUiElement(root);
    for (const element of root.querySelectorAll('*')) translateUiElement(element);
}
function applyUiLanguage() {
    resolvedLanguage = resolveUiLanguage();
    const pack = languagePacks.get(resolvedLanguage);
    document.documentElement.lang = pack?.locale || resolvedLanguage;
    document.documentElement.dir = pack?.direction || 'ltr';
    const messages = pack?.messages || {};
    languagePatterns = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key) && key.replace(/\{\d+\}/g, '').trim()).map(([key, text]) => {
        const parameters = [];
        const numeric = /^\{0\}(?:\s*[个条次项行秒])/.test(key);
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\d+)\\\}/g, (_, index) => {
            const number = Number(index);
            const previous = parameters.indexOf(number);
            if (previous >= 0) return '\\' + (previous + 1);
            parameters.push(number);
            return numeric ? '([\\d,.]+)' : '(.+?)';
        });
        return {regex: new RegExp('^' + escaped + '$'), text, parameters};
    });
    translateUiTree(document.body);
    languageSelect._refresh?.();
    languageStatus.textContent = uiText('当前语言') + ' · ' + (pack?.name || resolvedLanguage);
}
async function loadLanguagePacks() {
    const result = await api('/api/i18n');
    languagePacks.clear();
    reverseUiStrings.clear();
    for (const pack of Object.values(result.languages)) {
        languagePacks.set(pack.code, pack);
        for (const [source, text] of Object.entries(pack.messages)) {
            if (source !== text && !reverseUiStrings.has(text)) reverseUiStrings.set(text, source);
        }
    }
    selectedLanguage = result.language || 'system';
    languageSelect.replaceChildren(new Option('跟随系统', 'system'),
        ...[...languagePacks.values()].map(pack => new Option(pack.name, pack.code)));
    languageSelect.value = languagePacks.has(selectedLanguage) ? selectedLanguage : 'system';
    languageSelect._refresh?.();
    languageErrors.textContent = result.errors.map(error => error.file + ' · ' + error.error).join('\n');
    applyUiLanguage();
}
const languageSection = elem('section', 'settings-group');
languageSection.id = 'language-settings';
languageSection.append(elem('h3', '', '语言'), elem('p', 'hint', '选择界面语言。语言包可放入 i18n 文件夹，或在此导入 JSON。'));
const languageSelect = elem('select');
languageSelect.id = 'ui-language';
languageSelect.setAttribute('aria-label', '界面语言');
const languageActions = elem('div', 'personal-actions');
const languageImport = elem('input');
languageImport.type = 'file';
languageImport.accept = '.json,application/json';
languageImport.hidden = true;
languageActions.append(languageSelect,
    actionButton('导入语言包', () => languageImport.click(), 'secondary'),
    actionButton('重新扫描语言包', loadLanguagePacks, 'secondary'));
const languageStatus = elem('p', 'hint');
languageStatus.setAttribute('role', 'status');
const languageErrors = elem('pre', 'inline-error');
languageErrors.style.whiteSpace = 'pre-wrap';
languageSection.append(languageActions, languageStatus, languageImport, languageErrors);
generalPanel.querySelector('.dialog-intro').after(languageSection);
buildSelect(languageSelect);
languageSelect.onchange = async () => {
    const previous = selectedLanguage;
    try {
        await api('/api/ui/language', 'PUT', {language: languageSelect.value});
        selectedLanguage = languageSelect.value;
        localStorage.setItem('astra-ui-language', selectedLanguage);
        applyUiLanguage();
    } catch (error) {
        languageSelect.value = previous;
        languageSelect._refresh();
        toast(error.message);
    }
};
languageImport.onchange = async () => {
    const file = languageImport.files[0];
    if (!file) return;
    try {
        if (file.size > 1500000) throw new Error(uiText('语言包不能超过 1.5 MB'));
        await api('/api/i18n', 'POST', JSON.parse(await file.text()));
        await loadLanguagePacks();
        toast(uiText('语言包已导入'));
    } catch (error) {toast(error.message);} finally {languageImport.value = '';}
};
const uiChanges = new Set();
let uiLanguageFrame = 0;
new MutationObserver(records => {
    if (!languagePacks.size) return;
    for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        if (element && ownsUiText(element)) uiChanges.add(element);
        for (const node of record.addedNodes) if (node instanceof Element) uiChanges.add(node);
    }
    if (!uiChanges.size || uiLanguageFrame) return;
    uiLanguageFrame = requestAnimationFrame(() => {
        uiLanguageFrame = 0;
        for (const element of uiChanges) translateUiTree(element);
        uiChanges.clear();
    });
}).observe(document.body, {subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label']});
window.addEventListener('languagechange', () => {if (selectedLanguage === 'system') applyUiLanguage();});
window.addEventListener('storage', event => {if (event.key === 'astra-ui-language') loadLanguagePacks().catch(() => {});});
const languageReady = loadLanguagePacks().catch(error => toast(error.message));

// Original license text is displayed verbatim and never localized.
const noticesGroup = elem('section', 'settings-group');
noticesGroup.id = 'open-source-notices';
noticesGroup.append(elem('h3', '', '开源与第三方许可'),
    elem('p', 'hint', 'AstraAgent 使用下列第三方组件。原始版权与许可文本随程序一同提供。'));
const noticesList = elem('div');
noticesGroup.append(noticesList);
$('[data-panel=about]').append(noticesGroup);
async function loadNotices() {
    const result = await api('/api/notices');
    noticesList.replaceChildren();
    const editionNames = {standard: '标准版 · 完整运行环境', lite: 'Lite 版 · 使用本机环境', development: '开发工作区'};
    noticesList.append(elem('p', 'hint', editionNames[result.release?.edition] || '开发工作区'));
    if (result.project?.text) {
        const project = elem('details', 'license-entry');
        const title = elem('summary', '', result.project.name + ' · ' + result.project.license);
        title.dataset.i18nIgnore = '';
        project.append(title, elem('pre', 'notices-license', result.project.text));
        noticesList.append(project);
    }
    for (const component of result.components) {
        const details = elem('details', 'license-entry');
        const summary = elem('summary', '', component.name + ' ' + component.version + ' · ' + component.license + (component.optional?' · Local STT':''));
        summary.dataset.i18nIgnore = '';
        const text = elem('pre', 'notices-license', component.text);
        const link = elem('a', '', '项目主页');
        const hasProjectUrl=/^https?:\/\//i.test(component.url||'');
        if(hasProjectUrl)link.href = component.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        details.append(summary);if(hasProjectUrl)details.append(link);details.append(text);
        noticesList.append(details);
    }
}
loadNotices().catch(error => noticesList.textContent = error.message);
