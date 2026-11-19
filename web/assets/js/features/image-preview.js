function imagePreviewAsset(item) {
  return {src: '/api/attachments/' + item.id + '/content', alt: item.name};
}

const openImagePreview = (() => {
  const viewer = elem('dialog', 'image-preview');
  viewer.setAttribute('aria-label', '图像工作台');
  const header = elem('header', 'image-preview-header');
  const glyphs = {
    gallery: 'M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm-2 10 4-4 4 4 2-2 4 4m-4-8h.01',
    chevron: 'm7 10 5 5 5-5', dock: 'M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7',
    drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    brush: 'M3 17C9 10 14 3 17 5c4 3-10 14-6 14 2 0 5-6 8-5 3 1-3 5-1 6 1 0 2-1 3-2',
    cursor: 'm5 3 14 8-6 2-2 6-6-16Z', comment: 'M20 11a7 7 0 1 0-3 6l3 3v-5m-8-7v6m-3-3h6',
    background: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 9 9-9M5 19 19 5m-8 15 9-9',
    erase: 'm9 20-5-5a2 2 0 0 1 0-3l7-7a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-7 7H9Zm-2-11 8 8m-3 3h9',
    resize: 'M3 14V6h18v12h-8M3 12h9v8H3Zm13-2h2v2', text: 'M5 7V5h14v2m-7-2v14m-3 0h6',
    undo: 'M9 5 4 10l5 5m-5-5h10a5 5 0 0 1 0 10', redo: 'm15 5 5 5-5 5m5-5H10a5 5 0 0 0 0 10',
    wave: 'M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4',
    progress: 'M12 3a9 9 0 1 1-9 9',
  };
  const glyph = name => glyphs[name] ? makeGlyph(glyphs[name], name === 'drag' ? '2.4' : '1.65') : svgIcon(name);
  const identity = elem('div', 'image-preview-identity');
  const headerTools = elem('div', 'image-preview-header-tools');
  const zoom = elem('select', 'image-preview-zoom');
  zoom.setAttribute('aria-label', '预览缩放');
  const zoomChoices = [['fit', '适应窗口'], ['.25', '25%'], ['.5', '50%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%'], ['4', '400%']];
  for (const [value, label] of zoomChoices) {
    zoom.append(new Option(label, value));
  }
  const thumbs = elem('nav', 'image-preview-thumbs');
  thumbs.setAttribute('aria-label', '图像缩略图');
  const stage = elem('div', 'image-preview-stage');
  stage.setAttribute('aria-label', '图像画布');
  stage.tabIndex = 0;
  const frame = elem('div', 'image-preview-frame');
  const extent = elem('div', 'image-preview-extent');
  const plane = elem('div', 'image-preview-plane');
  const image = elem('img');
  image.draggable = false;
  const overlay = elem('canvas');
  overlay.setAttribute('aria-hidden', 'true');
  plane.append(image, overlay);
  extent.append(plane);
  frame.append(extent);
  stage.append(frame);

  const footer = elem('footer', 'image-preview-footer');
  const toolbar = elem('div', 'image-preview-edit-tools');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', '图像编辑工具');
  const mainTools = elem('div', 'image-preview-tool-row');
  const annotateTools = elem('div', 'image-preview-tool-row image-preview-annotation-tools');
  annotateTools.hidden = true;
  toolbar.append(mainTools, annotateTools);
  const brushOptions = elem('div', 'image-preview-brush');
  const brushSize = elem('input');
  Object.assign(brushSize, {type: 'range', min: '2', max: '48', value: '8'});
  brushSize.setAttribute('aria-label', '画笔大小');
  const ink = elem('input');
  Object.assign(ink, {type: 'color', value: '#72d6ff'});
  ink.setAttribute('aria-label', '标注颜色');
  const text = elem('input');
  Object.assign(text, {type: 'text', placeholder: '输入文字，再点图像放置', maxLength: 100});
  text.setAttribute('aria-label', '标注文字');
  brushOptions.append(brushSize, text);
  const edit = elem('form', 'image-preview-prompt');
  const prompt = elem('textarea');
  Object.assign(prompt, {placeholder: '描述修改内容', rows: 1, maxLength: 4000});
  prompt.setAttribute('aria-label', '图像修改说明');
  const mask = elem('input');
  mask.type = 'checkbox';
  mask.setAttribute('data-native-checkbox', '');
  const maskLabel = elem('label', 'image-preview-mask');
  maskLabel.append(mask, elem('span', '', '限定重绘区域'));
  maskLabel.title = '画笔和矩形可作为蒙版，需选择支持蒙版的图片模型';
  const submit = elem('button', 'image-preview-submit');
  submit.type = 'submit';
  const primaryActions = {
    voice: [glyph('wave'), '语音输入修改说明'],
    permission: [glyph('close'), '取消麦克风请求'],
    recording: [glyph('stop'), '结束录音'],
    transcribing: [glyph('progress'), '正在转写'],
    send: [glyph('send'), '发送修改'],
  };
  const status = elem('p', 'image-preview-status');
  status.setAttribute('role', 'status');
  const editActions = elem('div', 'image-preview-prompt-actions');
  const effort = elem('button', 'image-preview-effort');
  effort.type = 'button';
  effort.dataset.reasoningTrigger = '';
  effort.setAttribute('aria-controls', 'reasoning-popover');
  effort.setAttribute('aria-expanded', 'false');
  effort.setAttribute('aria-label', '思考强度');
  const effortLabel = elem('span', '', '默认');
  effort.append(effortLabel, glyph('chevron'));
  effort.onclick = () => {dismissPanel();toggleReasoningControl(effort);};
  const beforePreviewComposerSync = syncComposerControls;
  syncComposerControls = function () {
    beforePreviewComposerSync();
    const label = slider.getAttribute('aria-valuetext') || '默认';
    const description = uiText(label);
    if (effortLabel.textContent !== description) effortLabel.textContent = description;
    effort.setAttribute('aria-label', slider.getAttribute('aria-label') || '思考强度');
    effort.title = description;
  };
  editActions.append(effort);
  footer.append(toolbar, brushOptions, edit, status);
  const scrim = elem('div', 'image-preview-scrim');
  scrim.setAttribute('aria-hidden', 'true');
  const flights = elem('div', 'image-preview-flight-layer');
  flights.setAttribute('aria-hidden', 'true');
  viewer.append(scrim, header, thumbs, stage, footer, flights);
  document.body.append(viewer);

  let gallery = [], current, rotation = 0, ready = false, busy = false, revision = 0;
  let tool = 'view', editing = false, gesture = null, paintFrame = 0, voice = null;
  let openPanel = null;
  const documents = new Map();
  const cacheLimit = 12;
  const isEditable = src => src.origin === location.origin && /^\/api\/(attachments|project-files)\//.test(src.pathname) ||
    /^data:image\/(png|jpeg|webp);base64,/i.test(src.href);
  const message = value => {status.textContent = uiText(value);};
  const report = error => message(error.message || String(error));

  function button(label, icon, action) {
    const control = actionButton('', event => {
      Promise.resolve().then(() => action(event)).catch(report);
    }, 'image-preview-button');
    control.title = label;
    control.setAttribute('aria-label', label);
    if (icon) control.append(glyph(icon));
    control.append(elem('span', '', label));
    return control;
  }
  function save(url, name) {
    const link = elem('a');
    link.href = url;
    link.download = name;
    viewer.append(link);
    link.click();
    link.remove();
  }
  const rotate = button('旋转预览', 'refresh', () => {rotation = (rotation + 1) % 4; layoutImage(true);});
  const original = button('下载原图', 'download', () => save(current.src, current.alt || 'image.png'));
  original.classList.add('image-preview-icon-only');
  const dock = button('在侧面板中打开', 'dock', () => {
    const id = attachmentDownloadId(current.src);
    if (!id || !viewer.open || busy) return;
    const source = origin?.closest('button,[tabindex],a') || returnFocus;
    const item = {id, name: current.alt, kind: 'image'};
    settleMotion();
    viewer.close();
    return previewResource(item, source);
  });
  dock.classList.add('image-preview-dock');
  // Keep the download bridge for locally generated PNGs without enabling WebView downloads.
  async function savePNG(url, name) {
    if (typeof window.pywebview?.api?.save_attachment !== 'function') return save(url, name);
    const item = await upload(name, url);
    save(imagePreviewAsset(item).src, name);
  }
  const exportImage = button('导出标注', 'share', () => savePNG(makeImage('marked'), 'astra-annotated.png'));
  const close = button('关闭预览', 'close', () => requestClose());
  close.classList.add('image-preview-icon-only');
  close.autofocus = true;
  const galleryToggle = button('图像', 'gallery', () => {
    const show = thumbs.hidden;
    thumbs.hidden = !show;
    galleryToggle.setAttribute('aria-expanded', String(show));
    if (show) reveal(thumbs, -1);
  });
  galleryToggle.append(glyph('chevron'));
  galleryToggle.setAttribute('aria-controls', thumbs.id = 'image-preview-thumbs');
  const zoomWrap = elem('div', 'image-preview-zoom-wrap');
  const zoomLabel = elem('span', '', '100%');
  zoomLabel.setAttribute('aria-hidden', 'true');
  zoomWrap.append(zoomLabel, glyph('chevron'), zoom);
  identity.append(galleryToggle);
  headerTools.append(zoomWrap, original, dock, close);
  header.append(identity, headerTools);

  const options = elem('div', 'image-preview-popover');
  const sizing = elem('div', 'image-preview-popover image-preview-sizing');
  options.hidden = sizing.hidden = true;
  footer.prepend(options, sizing);
  const appendVoice = button('追加语音输入', 'mic', () => {
    dismissPanel();
    submit.focus();
    togglePreviewVoice();
  });
  options.append(rotate, exportImage, appendVoice, maskLabel);
  const more = button('更多图像选项', 'plus', () => togglePanel(options, more));
  const size = button('调整大小', 'resize', () => togglePanel(sizing, size));
  for (const [control, panel, id] of [[more, options, 'image-edit-options'], [size, sizing, 'image-edit-sizing']]) {
    panel.id = id;
    control.setAttribute('aria-controls', id);
    control.setAttribute('aria-expanded', 'false');
  }
  const resizeWidth = elem('input'), resizeHeight = elem('input');
  for (const [input, label] of [[resizeWidth, '宽度'], [resizeHeight, '高度']]) {
    Object.assign(input, {type:'number', min:'1', max:'8192', step:'1'});
    input.setAttribute('aria-label', label);
    const field = elem('label', '', label);
    field.append(input);
    sizing.append(field);
  }
  sizing.append(button('下载调整后的图像', 'download', () => {
    const w = resizeWidth.valueAsNumber, h = resizeHeight.valueAsNumber;
    if (![w,h].every(n => Number.isInteger(n) && n >= 1 && n <= 8192) || w * h > 16_777_216) {
      throw Error('请输入有效尺寸：边长最多 8192 像素，总像素不超过 1600 万。');
    }
    return savePNG(makeImage('marked', w, h), 'astra-resized.png');
  }));
  const grip = () => {
    const handle = button('拖动工具条', 'drag', () => {});
    handle.classList.add('image-preview-icon-only', 'image-preview-grip');
    let drag;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || matchMedia('(max-width: 720px)').matches) return;
      const box = toolbar.getBoundingClientRect();
      const bounds = viewer.getBoundingClientRect();
      const start = Number(toolbar.dataset.offset || 0);
      drag = {id:event.pointerId,x:event.clientX,start,min:start+bounds.left+12-box.left,max:start+bounds.right-12-box.right};
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (event.pointerId !== drag?.id) return;
      const offset = Math.min(drag.max, Math.max(drag.min, drag.start + event.clientX - drag.x));
      toolbar.dataset.offset = offset;
      toolbar.style.translate = offset + 'px';
    });
    handle.addEventListener('lostpointercapture', () => {drag = null;});
    handle.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      resetToolbar();
    });
    handle.ondblclick = resetToolbar;
    return handle;
  };
  function resetToolbar() {toolbar.style.translate = '';delete toolbar.dataset.offset;}
  window.addEventListener('resize', resetToolbar);
  const annotate = button('标注', 'brush', () => setEditing(true, 'brush'));
  const comment = button('添加评论', 'comment', () => {setEditing(true, 'text');text.focus();});
  const background = button('移除背景', 'background', () => {
    const instruction = '移除背景并保留主体，输出透明背景。';
    prompt.value = [prompt.value.trim(), instruction].filter(Boolean).join('\n').slice(0, prompt.maxLength);
    prompt.dispatchEvent(new Event('input', {bubbles:true}));
    prompt.focus();
  });
  const erase = button('擦除', 'erase', () => setEditing(true, 'erase'));
  mainTools.append(grip(), annotate, comment, background, erase, size);

  const toolButtons = new Map();
  for (const [id, label, icon] of [
    ['view', '浏览', 'cursor'], ['brush', '画笔', 'brush'], ['text', '文字', 'text'],
    ['rectangle', '矩形', 'copy'], ['erase', '擦除', 'erase'],
  ]) {
    const control = button(label, icon, () => {
      setTool(id);
      if (id === 'text') text.focus();
    });
    toolButtons.set(id, control);
  }
  const undo = button('撤销标注', 'undo', () => moveHistory('marks', 'redo'));
  const redo = button('重做标注', 'redo', () => moveHistory('redo', 'marks'));
  const finishEditing = button('退出标注', 'close', () => {setEditing(false);annotate.focus();});
  annotateTools.append(grip(), ...[...toolButtons.values()].slice(0, 4), ink, toolButtons.get('erase'), undo, redo, finishEditing);
  more.classList.add('image-preview-icon-only');
  editActions.append(submit);
  edit.append(more, prompt, editActions);
  submit.addEventListener('click', event => {
    if (!prompt.value.trim() || voice) {
      event.preventDefault();
      togglePreviewVoice();
    }
  });

  function stopPreviewTracks(run) {
    clearTimeout(run.timer);
    run.stream?.getTracks().forEach(track => track.stop());
    run.stream = null;
  }
  function cancelPreviewVoice() {
    const run = voice;
    if (!run) return;
    voice = null;
    run.controller.abort();
    if (run.recorder?.state === 'recording') run.recorder.stop();
    stopPreviewTracks(run);
    message('');
    controls();
  }
  async function togglePreviewVoice() {
    if (!viewer.open || busy || !ready || !current.editable) return;
    if (voice) {
      if (voice.phase === 'permission') return cancelPreviewVoice();
      if (voice.phase === 'recording') {
        voice.phase = 'transcribing';
        controls();
        voice.recorder.stop();
      }
      return;
    }
    if (!sttSettings.base_url || !sttSettings.model) {message('请先配置 STT 接口');return;}
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {message('当前环境不支持录音');return;}
    const run = {controller:new AbortController(), chunks:[], bytes:0, phase:'permission'};
    voice = run;
    controls();
    message('正在请求麦克风权限…');
    try {
      run.stream = await navigator.mediaDevices.getUserMedia({audio:true});
      if (voice !== run) {stopPreviewTracks(run);return;}
      const mime = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      if (!mime) throw Error('当前录音格式不受 STT 支持');
      const recorder = run.recorder = new MediaRecorder(run.stream,{mimeType:mime,audioBitsPerSecond:64000});
      recorder.ondataavailable = ({data}) => {
        if (voice !== run) return;
        run.bytes += data.size;
        if (run.bytes > 5 * 1024 * 1024) {cancelPreviewVoice();message('录音超过 5 MB，请缩短后重试');}
        else if (data.size) run.chunks.push(data);
      };
      recorder.onerror = () => {if (voice === run) {cancelPreviewVoice();message('录音失败，请检查麦克风');}};
      recorder.onstop = async () => {
        stopPreviewTracks(run);
        if (voice !== run) return;
        run.phase = 'transcribing';
        controls();
        message('正在转写…');
        try {
          if (!run.bytes) throw Error('录音为空');
          const encoded = await new Promise((resolve,reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(new Blob(run.chunks,{type:recorder.mimeType}));
          });
          if (voice !== run) return;
          const response = await fetch('/api/stt',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.token},
            body:JSON.stringify({data:encoded,mime:recorder.mimeType}),signal:run.controller.signal});
          const result = await response.json();
          if (!response.ok || typeof result.text !== 'string' || !result.text.trim()) throw Error(result.error || '语音转写失败');
          if (voice !== run) return;
          prompt.value = [prompt.value.trimEnd(), result.text.trim()].filter(Boolean).join('\n').slice(0,prompt.maxLength);
          prompt.dispatchEvent(new Event('input',{bubbles:true}));
          prompt.focus();
          message('');
        } catch (error) {if (voice === run) report(error);}
        finally {if (voice === run) {voice = null;controls();}}
      };
      recorder.start(250);
      run.phase = 'recording';
      controls();
      run.timer = setTimeout(() => {if (voice === run && recorder.state === 'recording') togglePreviewVoice();}, 120000);
      message('正在录音，再点一次结束 · Esc 取消');
    } catch (error) {
      if (voice === run) {cancelPreviewVoice();report(error);}
    }
  }
  document.addEventListener('visibilitychange', () => {if (document.hidden) cancelPreviewVoice();});
  window.addEventListener('pagehide', cancelPreviewVoice);

  function togglePanel(panel, trigger) {
    const show = panel.hidden;
    dismissPanel();
    if (!show) return;
    if (panel === sizing) {
      resizeWidth.value = image.naturalWidth;
      resizeHeight.value = image.naturalHeight;
    }
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openPanel = {panel, trigger};
    reveal(panel, 1);
    panel.querySelector('button:not([disabled]),input:not([disabled])')?.focus();
  }
  function dismissPanel(focus = false) {
    if (!openPanel) return;
    const {panel, trigger} = openPanel;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    openPanel = null;
    if (focus) trigger.focus();
  }

  function controls() {
    const editable = ready && current.editable && !busy;
    const marks = current?.doc.marks || [];
    for (const [id, control] of toolButtons) {
      control.setAttribute('aria-pressed', String(tool === id));
      control.disabled = id !== 'view' && !editable;
    }
    viewer.dataset.tool = tool;
    brushOptions.hidden = !editable || !editing || !['brush', 'erase', 'text'].includes(tool);
    text.hidden = tool !== 'text';
    brushSize.hidden = tool === 'text' || tool === 'rectangle';
    ink.hidden = tool === 'erase';
    undo.disabled = !editable || !marks.length;
    redo.disabled = !editable || !current?.doc.redo.length;
    mask.disabled = !editable || !marks.some(mark => ['brush', 'rectangle'].includes(mark.type));
    if (mask.disabled && !busy) mask.checked = false;
    exportImage.disabled = !editable || !marks.some(mark => mark.type !== 'erase');
    exportImage.hidden = !marks.length;
    rotate.disabled = !ready || busy;
    for (const control of [annotate, comment, background, erase, size, effort]) control.disabled = !editable;
    more.disabled = !ready || busy;
    original.disabled = !ready || busy;
    dock.hidden = !current || !attachmentDownloadId(current.src);
    dock.disabled = busy;
    prompt.disabled = !editable;
    const hasDraft = !!prompt.value.trim();
    appendVoice.hidden = !hasDraft || !!voice;
    appendVoice.disabled = !editable;
    const action = voice?.phase ?? (hasDraft ? 'send' : 'voice');
    if (submit.dataset.action !== action) {
      const [icon, label] = primaryActions[action];
      submit.dataset.action = action;
      submit.replaceChildren(icon);
      submit.setAttribute('aria-label', uiText(label));
      submit.title = uiText(label);
      if (action === 'transcribing') submit.setAttribute('aria-disabled', 'true');
      else submit.removeAttribute('aria-disabled');
    }
    submit.disabled = !editable;
    close.disabled = busy;
  }

  function setEditing(enabled, next = 'view') {
    dismissPanel();
    resetToolbar();
    editing = enabled;
    mainTools.hidden = enabled;
    annotateTools.hidden = !enabled;
    setTool(next);
    reveal(enabled ? annotateTools : mainTools, 1);
    if (enabled) toolButtons.get(next)?.focus({preventScroll:true});
  }

  function setTool(value) {
    gesture = null;
    tool = value;
    controls();
    if (!brushOptions.hidden) reveal(brushOptions, 1);
    drawSoon();
  }
  function moveHistory(from, to) {
    if (busy || !current?.doc[from].length) return;
    const doc = current.doc;
    doc[to].push(doc[from].pop());
    controls();
    drawSoon();
  }
  function commit(mark) {
    if (current.doc.marks.length >= 300) {
      message('标注已达上限，请先撤销部分标注。');
      return;
    }
    current.doc.marks.push(mark);
    current.doc.redo.length = 0;
    controls();
    drawSoon();
  }

  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const transparencyPreference = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
  const canMove = () => !motionPreference.matches && !transparencyPreference.matches &&
    document.documentElement.dataset.motion !== 'reduced' && typeof viewer.animate === 'function';
  const chrome = [header, thumbs, footer];
  const galleryEase = 'cubic-bezier(.22,.78,.20,1)';
  function galleryTime(duration) {
    const panel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-panel'));
    return Math.round(duration * (panel > 0 ? panel / 320 : 1));
  }

  let origin = null, returnFocus = null, openingUntil = 0, motion = null;
  const localMotion = new WeakMap();
  const localAnimations = new Set();
  function animateLocal(node, frames, duration = 245) {
    localMotion.get(node)?.cancel();
    if (!canMove() || !viewer.open) return;
    const animation = node.animate(frames, {duration: galleryTime(duration), easing: galleryEase});
    localMotion.set(node, animation);
    localAnimations.add(animation);
    animation.finished.then(() => localAnimations.delete(animation), () => localAnimations.delete(animation));
  }
  function reveal(node, direction) {
    animateLocal(node, [{opacity:0, transform:`translateY(${direction * 8}px) scale(.96,.92)`},
      {opacity:1, transform:'translateY(-1px) scale(1.015,1)', offset:.72}, {opacity:1, transform:'none'}]);
  }

  // Express the thumbnail crop in full-image coordinates, so scaling never stretches the photo.
  function thumbnailGeometry(source, src) {
    if (!(source instanceof HTMLImageElement) || !source.isConnected || !source.naturalWidth ||
        (source.currentSrc || source.src) !== src) return null;
    const style = getComputedStyle(source), box = source.getBoundingClientRect();
    if (style.visibility !== 'visible' || style.opacity === '0' || box.width < 4 || box.height < 4) return null;
    const scale = (style.objectFit === 'cover' ? Math.max : Math.min)(box.width / source.naturalWidth, box.height / source.naturalHeight);
    const w = style.objectFit === 'fill' ? box.width : source.naturalWidth * scale;
    const h = style.objectFit === 'fill' ? box.height : source.naturalHeight * scale;
    const x = box.left + (box.width - w) / 2, y = box.top + (box.height - h) / 2;
    let l = Math.max(0, box.left, x), t = Math.max(0, box.top, y);
    let r = Math.min(innerWidth, box.right, x + w), b = Math.min(innerHeight, box.bottom, y + h);
    for (let parent = source.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const styles = getComputedStyle(parent);
      if (styles.overflowX === 'visible' && styles.overflowY === 'visible') continue;
      const bounds = parent.getBoundingClientRect();
      if (styles.overflowX !== 'visible') {l = Math.max(l, bounds.left); r = Math.min(r, bounds.right);}
      if (styles.overflowY !== 'visible') {t = Math.max(t, bounds.top); b = Math.min(b, bounds.bottom);}
      if (r - l < 4 || b - t < 4) return null;
    }
    if (r - l < 4 || b - t < 4) return null;
    const radius = parseFloat(style.borderTopLeftRadius) || parseFloat(getComputedStyle(source.parentElement).borderTopLeftRadius) || 0;
    return {x, y, w, h, crop: [t - y, x + w - r, y + h - b, l - x], radius};
  }

  function playMotion(phase) {
    motion = {phase, animations: []};
    return motion;
  }
  function animatePart(run, node, frames, options, id) {
    const animation = node.animate(frames, options);
    animation.id = 'astra-gallery-' + id;
    run.animations.push(animation);
    return animation;
  }
  function settleMotion() {
    openingUntil = 0;
    const run = motion;
    if (!run) return;
    motion = null;
    if (run.phase === 'close' && viewer.open) viewer.close();
    run.animations.forEach(animation => animation.cancel());
    run.flight?.remove();
    run.source?.classList.remove('image-preview-origin');
    delete viewer.dataset.galleryFlight;
  }
  function finishWith(run, animation) {
    animation.finished.then(() => {if (motion === run) settleMotion();}, () => {});
  }
  function animateChrome(run, shown, old = null) {
    const duration = galleryTime(shown ? 220 : 150);
    const background = animatePart(run, scrim, [{opacity: old?.[0] ?? Number(!shown)}, {opacity: Number(shown)}],
      {duration, easing: 'ease-out', fill: 'both'}, 'scrim');
    chrome.forEach((node, i) => {
      const offset = i === 0 ? -6 : i === 1 ? 0 : 8;
      animatePart(run, node, [old?.[i + 1] ?? {opacity: Number(!shown), translate: `0 ${shown ? offset : 0}px`},
        {opacity: Number(shown), translate: `0 ${shown ? 0 : offset / 2}px`}],
      {duration: galleryTime(shown ? 185 : 115), delay: galleryTime(shown ? 35 : 0), easing: 'ease-out', fill: 'both'}, 'chrome');
    });
    return background;
  }
  function animateFlight(run, source, target, thumbnail, interrupted = null) {
    if (target.width < 4 || target.height < 4) return null;
    const flight = elem('img', 'image-preview-flight');
    flight.alt = '';
    flight.setAttribute('aria-hidden', 'true');
    flight.src = image.currentSrc || image.src;
    const bounds = flights.getBoundingClientRect();
    Object.assign(flight.style, {left: `${target.left - bounds.left}px`, top: `${target.top - bounds.top}px`,
      width: `${target.width}px`, height: `${target.height}px`});
    const sx = thumbnail.w / target.width, sy = thumbnail.h / target.height;
    const crop = thumbnail.crop.map((value, index) => `${Math.max(0, value / (index % 2 ? sx : sy))}px`).join(' ');
    const radius = `${thumbnail.radius / sx}px / ${thumbnail.radius / sy}px`;
    const tile = {transform: `translate(${thumbnail.x - target.left}px, ${thumbnail.y - target.top}px) scale(${sx}, ${sy})`,
      clipPath: `inset(${crop} round ${radius})`};
    const full = {transform: 'translate(0px, 0px) scale(1, 1)', clipPath: 'inset(0px round 0px)'};
    run.flight = flight;
    run.source = source;
    flights.append(flight);
    viewer.dataset.galleryFlight = run.phase;
    source.classList.add('image-preview-origin');
    const opening = run.phase === 'open';
    const spring = {transform: `translate(${-target.width * .006}px, ${-target.height * .006}px) scale(1.012)`, clipPath: full.clipPath,
      offset:.82, easing:'ease-out'};
    return animatePart(run, flight, opening ? [{...tile,easing:galleryEase}, spring, full] : [interrupted || full, tile],
      {duration: galleryTime(opening ? 380 : interrupted ? 200 : 265), easing: opening ? 'linear' : 'cubic-bezier(.36,0,.24,1)', fill: 'both'}, 'photo');
  }
  function requestClose() {
    if (busy || !viewer.open || motion?.phase === 'close') return;
    if (reasoningPopover.parentElement === viewer) closeComposerControls();
    cancelPreviewVoice();
    const flight = motion?.flight && getComputedStyle(motion.flight);
    const interrupted = flight && {transform: flight.transform, clipPath: flight.clipPath};
    const old = motion && [getComputedStyle(scrim).opacity, ...chrome.map(node => {
      const {opacity, translate} = getComputedStyle(node);
      return {opacity, translate};
    })];
    settleMotion();
    if (!canMove()) {viewer.close(); return;}
    const run = playMotion('close');
    const background = animateChrome(run, false, old);
    const thumbnail = ready && rotation === 0 && zoom.value === 'fit' && !current.doc.marks.length &&
      thumbnailGeometry(origin, current.src);
    const photo = thumbnail && animateFlight(run, origin, plane.getBoundingClientRect(), thumbnail, interrupted);
    if (!photo && ready) animatePart(run, plane, [{opacity: 1}, {opacity: 0}],
      {duration: galleryTime(140), easing: 'ease-out', fill: 'both'}, 'fallback');
    finishWith(run, photo || background);
  }
  function settleForInteraction() {if (motion?.phase !== 'close') settleMotion();}
  function syncMotionPreference() {if (!canMove()) {settleMotion();localAnimations.forEach(animation=>animation.cancel());}}
  motionPreference.addEventListener('change', syncMotionPreference);
  transparencyPreference.addEventListener('change', syncMotionPreference);
  new MutationObserver(syncMotionPreference).observe(document.documentElement, {attributes: true, attributeFilter: ['data-motion']});
  window.addEventListener('resize', () => {if (motion) settleMotion();});
  viewer.addEventListener('close', () => {
    if (!viewer.open) {
      if (reasoningPopover.parentElement === viewer) closeComposerControls();
      settleMotion();
      cancelPreviewVoice();
      dismissPanel();
      localAnimations.forEach(animation=>animation.cancel());
      origin = returnFocus = null;
    }
  });

  function layoutImage(center = false) {
    if (!ready || !stage.clientHeight) return;
    const swap = rotation % 2;
    const width = image.naturalWidth, height = image.naturalHeight;
    const w = swap ? height : width, h = swap ? width : height;
    const styles = getComputedStyle(frame);
    const fit = Math.min(1, Math.max(1, stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)) / w,
      Math.max(1, stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom)) / h);
    const scale = zoom.value === 'fit' ? fit : Number(zoom.value);
    zoomLabel.textContent = Math.max(1, Math.round(scale * 100)) + '%';
    extent.style.width = w * scale + 'px';
    extent.style.height = h * scale + 'px';
    plane.style.width = width * scale + 'px';
    plane.style.height = height * scale + 'px';
    plane.style.rotate = rotation * 90 + 'deg';
    if (center) {
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    }
  }
  new ResizeObserver(() => layoutImage()).observe(stage);
  zoom.onchange = () => {
    settleForInteraction();
    const before = plane.offsetWidth;
    layoutImage(true);
    const after = plane.offsetWidth;
    if (before && after && before !== after) animateLocal(plane, [{scale:String(before/after)}, {scale:'1'}], 190);
  };
  viewer.addEventListener('pointerdown', event => {
    if (!close.contains(event.target)) settleForInteraction();
    if (stage.contains(event.target)) localMotion.get(plane)?.cancel();
    if (openPanel && !openPanel.panel.contains(event.target) && !openPanel.trigger.contains(event.target)) dismissPanel();
  }, true);
  stage.addEventListener('wheel', settleForInteraction, {passive: true});

  function paint(canvas, marks, region = false) {
    const ctx = canvas.getContext('2d');
    const {width, height} = canvas;
    ctx.clearRect(0, 0, width, height);
    for (const mark of marks) {
      const {type, points, color, size, label} = mark;
      if (region && type === 'text') continue;
      const [start] = points, end = points.at(-1);
      const x = start.x * width, y = start.y * height;
      const thickness = size * width;
      ctx.globalCompositeOperation = type === 'erase' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = region ? '#000' : color;
      ctx.lineWidth = thickness;
      ctx.lineCap = ctx.lineJoin = 'round';
      if (type === 'rectangle') {
        const w = end.x * width - x, h = end.y * height - y;
        if (region) ctx.fillRect(x, y, w, h);
        else ctx.strokeRect(x, y, w, h);
      } else if (type === 'text') {
        ctx.font = '600 ' + thickness + 'px sans-serif';
        ctx.textBaseline = 'top';
        ctx.strokeStyle = '#10141d';
        ctx.lineWidth = Math.max(1, thickness / 10);
        ctx.strokeText(label, x, y, Math.max(1, width - x));
        ctx.fillText(label, x, y, Math.max(1, width - x));
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, thickness / 2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawSoon() {
    if (paintFrame) return;
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      if (ready) paint(overlay, gesture ? [...current.doc.marks, gesture.mark] : current.doc.marks);
    });
  }
  function point(event) {
    const rect = extent.getBoundingClientRect();
    const clamp = value => Math.min(1, Math.max(0, value));
    const u = clamp((event.clientX - rect.left) / rect.width), v = clamp((event.clientY - rect.top) / rect.height);
    const [x, y] = [[u, v], [v, 1 - u], [1 - u, 1 - v], [1 - v, u]][rotation];
    return {x, y};
  }
  overlay.onpointerdown = event => {
    if (!ready || !current.editable || busy || tool === 'view' || gesture || event.button !== 0) return;
    const width = plane.getBoundingClientRect()[rotation % 2 ? 'height' : 'width'];
    const mark = {type: tool, color: ink.value, size: (tool === 'text' ? 22 : tool === 'rectangle' ? 3 : Number(brushSize.value)) / width,
      points: [point(event)], label: text.value.trim()};
    if (tool === 'text') {
      if (mark.label) commit(mark);
      else {message('先输入要添加的文字。'); text.focus();}
      return;
    }
    gesture = {id: event.pointerId, mark};
    overlay.setPointerCapture(event.pointerId);
    drawSoon();
  };
  overlay.onpointermove = event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const points = gesture.mark.points;
    if (gesture.mark.type === 'rectangle') points[1] = point(event);
    else if (points.length < 2500) points.push(point(event));
    drawSoon();
  };
  overlay.onpointerup = event => {
    if (gesture?.id !== event.pointerId) return;
    overlay.onpointermove(event);
    const {mark} = gesture;
    gesture = null;
    commit(mark);
  };
  overlay.onlostpointercapture = () => {gesture = null; drawSoon();};

  function makeImage(kind, targetWidth, targetHeight) {
    if (!ready || !current.editable) throw Error('这张图片无法进行本地编辑。');
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width * height > 16_777_216 || Math.max(width, height) > 8192) {
      throw Error('请使用边长不超过 8192 且不超过 1600 万像素的图像。');
    }
    const result = elem('canvas');
    result.width = targetWidth ?? width;
    result.height = targetHeight ?? height;
    const ctx = result.getContext('2d');
    if (kind !== 'source') {
      paint(result, current.doc.marks, kind === 'mask');
      if (kind === 'mask') {
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let channel = 3;
        while (channel < pixels.length && !pixels[channel]) channel += 4;
        if (channel >= pixels.length) throw Error('请先涂抹或框选需要修改的区域。');
        ctx.globalCompositeOperation = 'xor';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
      }
    }
    if (kind !== 'mask') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(image, 0, 0, result.width, result.height);
    }
    const url = result.toDataURL('image/png');
    if (url === 'data:,') throw Error('无法导出这张图。');
    return url;
  }
  function upload(name, url) {
    const data = url.split(',')[1];
    if (data.length > Math.floor(5 * 1024 * 1024 * 4 / 3)) throw Error(name + ' 超过 5 MB，请缩小原图后重试。');
    return api('/api/attachments', 'POST', {name, data});
  }
  async function sendEdit(event) {
    event.preventDefault();
    if (busy || voice || submit.disabled || !prompt.value.trim()) return;
    if (submitting || uploadBusy || state.pending.has(state.session?.id)) {
      message('请等待当前会话完成，再发送图像修改。');
      return;
    }
    if (!hasModelConnection()) {message('请先在设置中连接聊天模型。'); return;}
    if (getConversationMode() === 'agent' && !runtimeOptions().allow_tools) {
      message('请在对话里允许 Tools，再发送图像修改。');
      return;
    }
    const selected = current, ticket = revision, session = state.session?.id;
    const instruction = prompt.value.trim(), region = mask.checked;
    busy = true;
    controls();
    let closedForSend = false;
    try {
      message('正在准备图像和标注…');
      const key = new URL(selected.src).pathname.match(/^\/api\/attachments\/([a-f0-9]{32})\/content$/)?.[1];
      let source = key ? await api('/api/attachments/' + key) : null;
      if (!source || (region && source.mime !== 'image/png')) {
        source = selected.doc.sourcePng ||= await upload('edit-source.png', makeImage('source'));
      }
      const extras = [];
      let guidance = '';
      if (region) {
        const area = await upload('edit-mask.png', makeImage('mask'));
        extras.push(area);
        guidance = '。使用蒙版 mask=' + area.id + ' 限定重绘范围。透明区域允许修改，保留其他部分。';
      } else if (selected.doc.marks.some(mark => mark.type !== 'erase')) {
        const annotated = await upload('edit-annotations.png', makeImage('marked'));
        extras.push(annotated);
        guidance = '。标注图 ' + annotated.id + ' 仅用于定位，编辑原图，不要把标注画进结果。';
      }
      const attachments = [source, ...extras];
      if (attachments.reduce((sum, item) => sum + item.size, 0) > 10 * 1024 * 1024) throw Error('参考图和标注总计最多 10 MB。');
      if (ticket !== revision || session !== state.session?.id || submitting) throw Error('当前会话已改变，请重新发送。');
      const mode = getConversationMode();
      const prefix = mode === 'agent' ? '[@image-generation] ' : '';
      const request = prefix + '请使用 image_gen 继续编辑原图 file=' + source.id + guidance + '\n\n修改要求：' + instruction;
      if (!await navigatePage('home')) throw Error('未切换到对话，修改说明仍保留在预览中。');
      if (state.mode !== 'chat') await switchMode('chat');
      if (state.mode !== 'chat') throw Error('请等待画布任务完成，再发送图像修改。');
      if (ticket !== revision || session !== state.session?.id || submitting) throw Error('当前会话已改变，请重新发送。');
      closedForSend = true;
      viewer.close();
      const sent = await sendMessage({preventDefault() {}}, request, attachments);
      if (!sent) throw Error('修改请求未完成。请查看对话中的错误后重试。');
      selected.doc.prompt = '';
    } catch (error) {
      if (closedForSend && ticket === revision && !viewer.open &&
          (state.session?.id === session || !session)) viewer.showModal();
      if (ticket === revision) report(error);
    } finally {
      busy = false;
      if (ticket === revision) controls();
    }
  }
  edit.onsubmit = sendEdit;
  prompt.oninput = () => {current.doc.prompt = prompt.value; controls();};
  prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      edit.requestSubmit();
    }
  });

  async function select(index, opening = false) {
    if (busy || !gallery[index] || motion?.phase === 'close') return;
    if (!opening) settleForInteraction();
    localMotion.get(plane)?.cancel();
    cancelPreviewVoice();
    const ticket = ++revision;
    ready = false;
    current = gallery[index];
    if (!documents.has(current.src)) {
      if (documents.size >= cacheLimit) documents.delete(documents.keys().next().value);
      documents.set(current.src, {marks: [], redo: [], prompt: ''});
    }
    current.doc = documents.get(current.src);
    const url = new URL(current.src);
    current.editable = isEditable(url);
    galleryToggle.title = current.alt || '图像 ' + (index + 1);
    for (const [number, control] of [...thumbs.children].entries()) {
      control.setAttribute('aria-current', number === index ? 'true' : 'false');
    }
    rotation = 0;
    zoom.value = 'fit';
    prompt.value = current.doc.prompt;
    mask.checked = false;
    setEditing(false);
    message('正在加载图片…');
    image.alt = current.alt || '预览图像';
    image.src = current.src;
    plane.hidden = true;
    try {
      await image.decode();
      if (revision !== ticket) return;
      ready = true;
      plane.hidden = false;
      const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      overlay.width = Math.max(1, Math.round(image.naturalWidth * scale));
      overlay.height = Math.max(1, Math.round(image.naturalHeight * scale));
      layoutImage(true);
      drawSoon();
      if (viewer.open && openingUntil > performance.now() && motion?.phase === 'open' && canMove()) {
        const thumbnail = thumbnailGeometry(origin, current.src);
        const photo = thumbnail && animateFlight(motion, origin, plane.getBoundingClientRect(), thumbnail);
        if (photo) finishWith(motion, photo);
        else reveal(plane, 1);
      } else reveal(plane, 1);
      message(current.editable ? '' : '这张图可预览和下载，本地图片附件可继续编辑。');
    } catch {
      if (revision === ticket) message('图片加载失败。');
    }
    if (revision === ticket) controls();
  }
  function dismissPreviewLayer() {
    if (voice) cancelPreviewVoice();
    else if (openPanel) dismissPanel(true);
    else if (editing) {setEditing(false);annotate.focus();}
    else requestClose();
  }
  viewer.addEventListener('cancel', event => {
    event.preventDefault();
    dismissPreviewLayer();
  });
  viewer.addEventListener('click', event => {
    if (motion?.phase === 'close') {event.preventDefault(); event.stopImmediatePropagation();}
    else if (!close.contains(event.target)) settleForInteraction();
  }, true);
  viewer.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) dismissPreviewLayer();
      return;
    }
    if (event.target.closest('input,textarea,select') || !current || busy || motion?.phase === 'close') return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.shiftKey || event.key.toLowerCase() === 'y') moveHistory('redo', 'marks');
      else moveHistory('marks', 'redo');
    } else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const index = gallery.indexOf(current) + (event.key === 'ArrowLeft' ? -1 : 1);
      if (gallery[index]) {event.preventDefault(); select(index);}
    }
  });

  return (items, active = items[0]?.src, source = null) => {
    if (busy || !items.length) return;
    const unique = new Map();
    for (const item of items) {
      try {
        const src = new URL(item.src, location.href);
        if (['http:', 'https:', 'data:'].includes(src.protocol) && !unique.has(src.href)) {
          unique.set(src.href, {src: src.href, alt: item.alt});
        }
      } catch {}
    }
    if (!unique.size) return;
    settleMotion();
    const entering = !viewer.open;
    gallery = [...unique.values()];
    thumbs.hidden = gallery.length < 2;
    galleryToggle.setAttribute('aria-expanded', String(!thumbs.hidden));
    let activeSrc;
    try {activeSrc = new URL(active, location.href).href;} catch {}
    const index = Math.max(0, gallery.findIndex(item => item.src === activeSrc));
    origin = thumbnailGeometry(source, gallery[index].src) ? source : null;
    thumbs.replaceChildren(...gallery.map((item, index) => {
      const control = elem('button', 'image-preview-thumb');
      control.type = 'button';
      control.setAttribute('aria-label', '预览 ' + (item.alt || '图像 ' + (index + 1)));
      const thumbnail = elem('img');
      Object.assign(thumbnail, {src: item.src, alt: '', loading: 'lazy'});
      control.append(thumbnail);
      control.onclick = () => select(index);
      return control;
    }));
    if (entering) {
      closeComposerControls();
      syncComposerControls();
      returnFocus = document.activeElement;
      viewer.showModal();
      if (canMove()) {
        openingUntil = performance.now() + 110;
        const run = playMotion('open');
        const background = animateChrome(run, true);
        background.finished.then(() => {if (motion === run && !run.flight) settleMotion();}, () => {});
      }
    }
    select(index, entering);
  };
})();

document.addEventListener('click', event => {
  const selector = '.attachment-card img,.markdown img,.file-preview img';
  const target = event.target.closest(selector);
  if (!target || target.closest('.asset-preview,.image-preview,.attachment-side-preview')) return;
  event.preventDefault();
  const gallery = [...document.querySelectorAll(selector)]
    .filter(image => image.getClientRects().length)
    .map(image => ({src: image.currentSrc || image.src, alt: image.alt}));
  openImagePreview(gallery, target.currentSrc || target.src, target);
});
