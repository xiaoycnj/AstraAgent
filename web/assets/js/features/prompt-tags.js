// Mirror only the paint of the textarea. Editing, IME, selection and undo stay native.
const promptTagPattern = /(?<!\\)\[[@/][^\[\]\r\n]{1,160}\](?!\()/g;

function promptTagFragment(text) {
  const fragments = document.createDocumentFragment();
  let cursor = 0;
  for (const match of text.matchAll(promptTagPattern)) {
    fragments.append(text.slice(cursor, match.index), elem('span', 'prompt-tag', match[0]));
    cursor = match.index + match[0].length;
  }
  if (!cursor) return null;
  fragments.append(text.slice(cursor));
  return fragments;
}

function decoratePromptTags(body) {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const replacements = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('pre,code,a,.prompt-tag')) continue;
    const fragment = promptTagFragment(node.data);
    if (fragment) replacements.push([node, fragment]);
  }
  for (const [node, fragment] of replacements) node.replaceWith(fragment);
}

const promptTagField = elem('div', 'prompt-tag-field');
const promptTagMirror = elem('div', 'prompt-tag-mirror');
promptTagMirror.setAttribute('aria-hidden', 'true');
commandInput.before(promptTagField);
promptTagField.append(promptTagMirror, commandInput);

let promptTagFrame = 0;
function syncPromptTagScroll() {
  promptTagMirror.scrollTop = commandInput.scrollTop;
  promptTagMirror.scrollLeft = commandInput.scrollLeft;
}
function schedulePromptTagPaint() {
  if (promptTagFrame) return;
  promptTagFrame = requestAnimationFrame(() => {
    promptTagFrame = 0;
    const text = commandInput.value;
    const contents = promptTagFragment(text);
    promptTagField.classList.toggle('has-prompt-tags', !!contents);
    promptTagMirror.replaceChildren();
    if (!contents) return;
    const style = getComputedStyle(commandInput);
    for (const name of ['font', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize',
      'whiteSpace', 'overflowWrap', 'wordBreak', 'textAlign', 'direction', 'padding']) {
      promptTagMirror.style[name] = style[name];
    }
    promptTagMirror.style.insetInlineStart = style.borderLeftWidth;
    promptTagMirror.style.insetBlockStart = style.borderTopWidth;
    promptTagMirror.style.width = commandInput.clientWidth + 'px';
    promptTagMirror.style.height = commandInput.clientHeight + 'px';
    promptTagMirror.style.color = style.color;
    promptTagMirror.append(contents, text.endsWith('\n') ? '\u200b' : '');
    syncPromptTagScroll();
  });
}

// Existing draft and attachment workflows assign .value directly.
const promptTagValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
Object.defineProperty(commandInput, 'value', {
  configurable: true,
  get() { return promptTagValue.get.call(this); },
  set(value) { promptTagValue.set.call(this, value); schedulePromptTagPaint(); },
});
commandInput.addEventListener('input', schedulePromptTagPaint);
commandInput.addEventListener('focus', schedulePromptTagPaint);
commandInput.addEventListener('scroll', syncPromptTagScroll, {passive: true});
new ResizeObserver(schedulePromptTagPaint).observe(commandInput);
new MutationObserver(schedulePromptTagPaint).observe(document.documentElement, {attributes: true});
new MutationObserver(schedulePromptTagPaint).observe(document.body, {attributes: true});
document.fonts.addEventListener('loadingdone', schedulePromptTagPaint);
schedulePromptTagPaint();
