// Conversation content uses the existing offline Markdown sanitizer and highlighter.
const renderRichMarkdown = markdown;
const richStreamBlocks = new WeakMap();

function richAction(label, action) {
  const button = actionButton(uiText(label), action, 'code-action');
  button.dataset.richLabel = label;
  button.setAttribute('aria-label', uiText(label));
  return button;
}

function codeFilename(language) {
  const extensions = {javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh', markdown: 'md', text: 'txt'};
  return 'snippet.' + (extensions[language] || (/^[a-z0-9]{1,12}$/i.test(language) ? language : 'txt'));
}

function tableDelimited(table, separator) {
  return [...table.rows].map(row => [...row.cells].map(cell => {
    let text = cell.innerText.trim();
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(separator)).join('\r\n');
}

markdown = function(text) {
  const block = renderRichMarkdown(text);
  for (const toolbar of block.querySelectorAll('.code-toolbar')) {
    const code = toolbar.nextElementSibling?.querySelector('code');
    if (!code) continue;
    const language = toolbar.querySelector('span').textContent.toLowerCase();
    const raw = code.textContent;
    for (const button of toolbar.querySelectorAll('button')) {
      button.dataset.richLabel = canonicalUiText(button.textContent);
      button.textContent = uiText(button.dataset.richLabel);
      button.setAttribute('aria-label', button.textContent);
    }
    toolbar.append(richAction('下载代码', () => download(codeFilename(language), raw, 'text/plain;charset=utf-8')));
    if (['html', 'htm', 'svg'].includes(language))
      toolbar.append(richAction('交互预览', () => openInteractivePreview(raw, language)));
    const wrap = richAction('自动换行', () => {
      const active = code.parentElement.classList.toggle('code-wrap');
      wrap.setAttribute('aria-pressed', String(active));
    });
    wrap.setAttribute('aria-pressed', 'false');
    toolbar.append(wrap);
    code.parentElement.tabIndex = 0;
    code.parentElement.setAttribute('aria-label', language + ' ' + uiText('代码'));
  }
  for (const wrapper of block.querySelectorAll('.table-scroll')) {
    const table = wrapper.querySelector('table');
    const tools = elem('div', 'table-actions');
    tools.append(
      richAction('复制表格', async () => {
        await navigator.clipboard.writeText(tableDelimited(table, '\t'));
        toast(uiText('表格已复制'));
      }),
      richAction('下载 CSV', () => download('table.csv', '\uFEFF' + tableDelimited(table, ','), 'text/csv;charset=utf-8'))
    );
    wrapper.before(tools);
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', uiText('表格'));
  }
  return block;
};

function updateRichStream(body, text) {
  if (body.dataset.streamText === text) return;
  const tokens = marked.lexer(text).filter(token => token.type !== 'space');
  const previous = richStreamBlocks.get(body) || [];
  const next = [];
  tokens.forEach((token, index) => {
    const old = previous[index];
    if (old?.raw === token.raw) { next.push(old); return; }
    const node = markdown(token.raw);
    node.className = 'stream-block';
    if (old) old.node.replaceWith(node);
    else body.append(node);
    next.push({raw: token.raw, node});
  });
  if (!richStreamBlocks.has(body)) {
    const nodes = new Set(next.map(item => item.node));
    for (const child of [...body.childNodes]) if (!nodes.has(child)) child.remove();
  }
  for (const old of previous.slice(next.length)) old.node.remove();
  richStreamBlocks.set(body, next);
  body.classList.remove('streaming-text');
  body.classList.add('rich-stream');
  body.dataset.streamText = text;
}

const interactivePreview = elem('dialog', 'interactive-preview');
interactivePreview.setAttribute('aria-label', uiText('交互预览'));
const previewHeader = elem('header', 'interactive-preview-header');
const previewTitle = elem('strong', '', uiText('交互预览'));
const previewClose = richAction('关闭', () => interactivePreview.close());
previewHeader.append(previewTitle, previewClose);
const previewNotice = elem('p', 'hint', uiText('在隔离沙箱中运行，外部资源和网络接口受限。'));
const previewFrame = elem('iframe', 'interactive-preview-frame');
previewFrame.title = uiText('交互预览');
previewFrame.setAttribute('sandbox', 'allow-scripts');
previewFrame.referrerPolicy = 'no-referrer';
interactivePreview.append(previewHeader, previewNotice, previewFrame);
document.body.append(interactivePreview);
let previewSource = '', previewReturnFocus;
function openInteractivePreview(source, language) {
  previewReturnFocus = document.activeElement;
  previewSource = language === 'svg' ? '<!doctype html><html><body>' + source + '</body></html>' : source;
  previewFrame.src = '/interactive-preview';
  interactivePreview.showModal();
  previewClose.focus();
}
window.addEventListener('message', event => {
  if (event.source !== previewFrame.contentWindow || event.origin !== 'null' ||
      event.data?.type !== 'astra-preview-ready' || !interactivePreview.open) return;
  previewFrame.contentWindow.postMessage({type: 'astra-preview-source', source: previewSource}, '*');
});
interactivePreview.addEventListener('close', () => {
  previewSource = '';
  previewFrame.src = 'about:blank';
  previewReturnFocus?.isConnected && previewReturnFocus.focus();
});

function quoteIntoComposer(content) {
  const input = $('#chat-input');
  const quote = content.split('\n').map(line => '> ' + line).join('\n');
  input.value = (input.value ? input.value + '\n\n' : '') + quote + '\n\n';
  input.dispatchEvent(new Event('input', {bubbles: true}));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
const appendRichMessageActions = appendMessageActions;
appendMessageActions = function() {
  appendRichMessageActions();
  const articles = $$('#messages > .message');
  state.messages.forEach((message, index) => {
    const bar = articles[index]?.querySelector('.message-actions');
    if (!bar || bar.querySelector('.quote-message') || message.streaming) return;
    const button = richAction('引用', () => {
      const selection = window.getSelection();
      const selected = selection && articles[index].contains(selection.anchorNode) ? selection.toString() : '';
      quoteIntoComposer(selected || (messageViews.get(articles[index])?.message || message).content);
    });
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.classList.add('quote-message');
    bar.append(button);
  });
};
const showRichMessageMore = showMessageMore;
showMessageMore = function(message) {
  showRichMessageMore(message);
  // Keep existing drafts when quoting through the legacy menu, too.
  const quote = [...moreActions.querySelectorAll('button')].find(button => canonicalUiText(button.textContent) === '引用到输入框');
  if (quote) quote.onclick = safely(() => {
    messageMore.close();
    quoteIntoComposer(message.content);
  });
};

const applyRichUiLanguage = applyUiLanguage;
applyUiLanguage = function() {
  applyRichUiLanguage();
  for (const button of document.querySelectorAll('[data-rich-label]')) {
    const label = uiText(button.dataset.richLabel);
    if (button.textContent !== label) button.textContent = label;
    button.setAttribute('aria-label', label);
  }
};
