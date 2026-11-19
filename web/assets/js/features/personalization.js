// Media lives in the local data directory. Only appearance preferences enter skin packs.
let appearanceDraft = null;
let appearancePreviewDraft = null;
function effectiveAppearance() {
  if (!appearanceDraft) return null;
  const value = structuredClone(appearancePreviewDraft || appearanceDraft);
  for (const mod of value.mods || []) {
    if (!mod.enabled) continue;
    for (const [group, patch] of Object.entries(mod.settings)) {
      Object.assign(value[group], patch);
      if (group === 'layout') value.layout.enabled = patch.enabled ?? true;
      else if (Object.keys(patch).length) value.enabled = true;
    }
  }
  return value;
}
let appearanceSequence = Promise.resolve();
let appearanceTimer, appearanceGeneration = 0, wallpaperKey = '', loadedFontKey = '';
let appearanceFont = null;
const wallpaper = elem('div', 'personal-wallpaper');
wallpaper.id = 'personal-wallpaper';
wallpaper.setAttribute('aria-hidden', 'true');
wallpaper.inert = true;
document.body.prepend(wallpaper);
const appearanceSection = elem('section', 'settings-group personalization-settings');
appearanceSection.id = 'personalization-settings';
appearanceSection.append(elem('h3', '', '个性化与动态背景'),
  elem('p', 'hint', '自定义外观叠加于当前皮肤，修改后自动保存在本机。'));
const appearanceControls = elem('fieldset', 'personalization-controls');
appearanceControls.disabled = true;
const appearanceFeedback = elem('p', 'hint');
appearanceFeedback.setAttribute('role', 'status');
const appearanceFields = new Map();

function appearanceField(label, control) {
  const row = elem('label', 'personalization-field');
  row.append(elem('span', '', label), control);
  appearanceControls.append(row);
  control.setAttribute('aria-label', label);
  return control;
}
function appearanceInput(label, group, key, type, options = {}) {
  const input = elem('input');
  input.type = type;
  if (type === 'checkbox') input.setAttribute('role', 'switch');
  Object.assign(input, options);
  appearanceFields.set(group + '.' + key, input);
  input.addEventListener(type === 'range' || type === 'text' ? 'input' : 'change', () => {
    const target = group ? appearanceDraft[group] : appearanceDraft;
    target[key] = type === 'checkbox' ? input.checked : type === 'range' ? Number(input.value) : input.value;
    if (key !== 'enabled') appearanceDraft.enabled = true;
    changeAppearance();
  });
  if (['range', 'text'].includes(type)) input.addEventListener('change', () => flushAppearance().catch(() => {}));
  return appearanceField(label, input);
}
appearanceInput('启用自定义外观', '', 'enabled', 'checkbox');
appearanceInput('皮肤名称', '', 'name', 'text', {maxLength: 100});

const wallpaperPicker = elem('input');
wallpaperPicker.type = 'file';
wallpaperPicker.accept = '.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.html,.htm,.svg';
wallpaperPicker.hidden = true;
const appearanceUploads = elem('div', 'personalization-actions');
const wallpaperName = elem('span', 'hint', '使用默认背景');
const uploadWallpaper = actionButton('选择背景文件', () => wallpaperPicker.click(), 'secondary');
const removeWallpaper = actionButton('移除背景', () => {
  appearanceDraft.background.asset = null;
  changeAppearance();
}, 'secondary');
appearanceUploads.append(uploadWallpaper, removeWallpaper, wallpaperName, wallpaperPicker);
appearanceControls.append(appearanceUploads, elem('p', 'hint', '支持图片、MP4、WebM 和自包含 HTML。单个文件最大 256 MB，HTML 最大 8 MB。'));
wallpaperPicker.onchange = () => uploadAppearanceFile(wallpaperPicker, asset => {
  appearanceDraft.background.asset = asset.id;
  appearanceDraft.background.paused = false;
});
const wallpaperFitSelect = elem('select');
wallpaperFitSelect.append(new Option('铺满', 'cover'), new Option('完整显示', 'contain'));
appearanceFields.set('background.fit', wallpaperFitSelect);
wallpaperFitSelect.onchange = () => { appearanceDraft.background.fit = wallpaperFitSelect.value; appearanceDraft.enabled = true; changeAppearance(); };
appearanceField('背景填充', wallpaperFitSelect);
appearanceInput('背景不透明度', 'background', 'opacity', 'range', {min: 0, max: 1, step: .05});
appearanceInput('背景模糊', 'background', 'blur', 'range', {min: 0, max: 30, step: 1});
appearanceInput('视频播放速度', 'background', 'speed', 'range', {min: .25, max: 2, step: .25});
appearanceInput('暂停动态背景', 'background', 'paused', 'checkbox');
appearanceInput('界面表面不透明度', 'styles', 'surface_opacity', 'range', {min: .15, max: 1, step: .05});
appearanceInput('对话框圆角', 'styles', 'message_radius', 'range', {min: 0, max: 32, step: 1});
appearanceInput('输入框圆角', 'styles', 'composer_radius', 'range', {min: 0, max: 40, step: 1});
appearanceInput('字体名称', 'styles', 'font_family', 'text', {maxLength: 120, placeholder: 'Segoe UI, Microsoft YaHei'});
appearanceInput('正文大小', 'styles', 'font_size', 'range', {min: 12, max: 24, step: 1});
for (const [key, label] of [['message_color', '对话框颜色'], ['composer_color', '输入框颜色'], ['text_color', '文字颜色'], ['accent_color', '强调颜色']]) {
  const color = appearanceInput(label, 'styles', key, 'text', {maxLength: 9, placeholder: '#RRGGBB 或 #RRGGBBAA'});
  color.pattern = '#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?';
  const swatch = elem('input');
  swatch.type = 'color'; swatch.setAttribute('aria-label', label + ' · 选择颜色');
  swatch.oninput = () => { color.value = swatch.value; color.dispatchEvent(new Event('input', {bubbles: true})); };
  color.appearanceSwatch = swatch;
  const row = elem('div', 'personalization-color');
  color.before(row); row.append(color, swatch);
}
const fontPicker = elem('input');
fontPicker.type = 'file'; fontPicker.accept = '.woff2,.woff,.ttf,.otf'; fontPicker.hidden = true;
const fontActions = elem('div', 'personalization-actions');
fontActions.append(actionButton('导入字体文件', () => fontPicker.click(), 'secondary'),
  actionButton('移除自定义字体', () => { appearanceDraft.styles.font_asset = null; changeAppearance(); }, 'secondary'), fontPicker);
appearanceControls.append(fontActions);
fontPicker.onchange = () => uploadAppearanceFile(fontPicker, asset => { appearanceDraft.styles.font_asset = asset.id; });

const iconTarget = elem('select');
const iconLabels = {home: '主页', images: '生图', schedule: '定时任务', library: '资料库', plugins: '插件管理',
  more: '更多', settings: '设置', profile: '个人资料', send: '发送消息', brand: '应用标志'};
for (const [key, label] of Object.entries(iconLabels)) iconTarget.append(new Option(label, key));
appearanceField('图标位置', iconTarget);
const iconPicker = elem('input');
iconPicker.type = 'file'; iconPicker.accept = '.svg,.png,.jpg,.jpeg,.webp,.gif'; iconPicker.hidden = true;
const iconActions = elem('div', 'personalization-actions');
iconActions.append(actionButton('替换图标', () => iconPicker.click(), 'secondary'),
  actionButton('恢复此图标', () => { delete appearanceDraft.icons[iconTarget.value]; changeAppearance(); }, 'secondary'), iconPicker);
appearanceControls.append(iconActions);
iconPicker.onchange = () => {
  const target = iconTarget.value;
  return uploadAppearanceFile(iconPicker, asset => { appearanceDraft.icons[target] = asset.id; });
};

const appearancePackPicker = elem('input');
appearancePackPicker.type = 'file'; appearancePackPicker.accept = '.zip'; appearancePackPicker.hidden = true;
const packActions = elem('div', 'personalization-actions');
const appearanceGuide = elem('a', 'secondary', '皮肤包制作说明');
appearanceGuide.href = '/assets/skins/README.md';
appearanceGuide.download = 'AstraAgent-皮肤包制作说明.md';
packActions.append(actionButton('导入 ZIP 皮肤包', () => appearancePackPicker.click(), 'secondary'),
  actionButton('导出 ZIP 皮肤包', async () => {
    await flushAppearance();
    const link = elem('a'); link.href = '/api/appearance/export'; link.download = 'astra-skin.zip'; link.click();
  }, 'secondary'),
  actionButton('恢复默认外观', async () => {
    clearTimeout(appearanceTimer);
    await appearanceSequence.catch(() => {});
    appearanceDraft = await api('/api/appearance', 'PUT', {schema_version: 1, enabled: false, mods: (appearanceDraft.mods || []).map(mod => ({...mod, enabled: false}))});
    appearanceGeneration++;
    applyPersonalAppearance(); syncAppearanceControls();
    appearanceFeedback.textContent = uiText('已恢复默认外观');
  }, 'secondary'), appearanceGuide, appearancePackPicker);
appearanceControls.append(packActions);
const retryAppearance = actionButton('重试保存', () => flushAppearance(), 'secondary');
retryAppearance.hidden = true;
appearanceSection.append(appearanceControls, appearanceFeedback, retryAppearance);
$('[data-panel=appearance]').append(appearanceSection);

async function sendAppearanceFile(path, file) {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'X-App-Token': state.token}, body: file});
  const value = await response.json();
  if (!response.ok) throw Error(value.error || uiText('外观文件导入失败'));
  return value;
}
async function uploadAppearanceFile(picker, accept) {
  const file = picker.files[0];
  if (!file) return;
  appearanceControls.disabled = true;
  appearanceFeedback.textContent = uiText('正在导入外观文件…');
  try {
    const asset = await sendAppearanceFile('/api/appearance/upload?name=' + encodeURIComponent(file.name), file);
    accept(asset);
    appearanceDraft.enabled = true;
    changeAppearance();
    await flushAppearance();
  } catch (error) { appearanceFeedback.textContent = error.message; }
  finally { picker.value = ''; appearanceControls.disabled = false; }
}
async function importAppearancePack(file) {
  if (!file) return;
  appearanceControls.disabled = true;
  try {
    await flushAppearance();
    appearanceDraft = await sendAppearanceFile('/api/appearance/import', file);
    appearanceGeneration++;
    applyPersonalAppearance(); syncAppearanceControls();
    appearanceFeedback.textContent = uiText('皮肤包已应用');
  } catch (error) { appearanceFeedback.textContent = error.message; throw error; }
  finally { appearancePackPicker.value = ''; appearanceControls.disabled = false; }
}
appearancePackPicker.onchange = () => importAppearancePack(appearancePackPicker.files[0]).catch(error => toast(error.message));
function syncAppearanceControls() {
  for (const [path, input] of appearanceFields) {
    const [group, key] = path.split('.');
    const value = (group ? appearanceDraft[group] : appearanceDraft)[key];
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
    if (input.appearanceSwatch) input.appearanceSwatch.value = /^#[a-f0-9]{6}/i.test(value) ? value.slice(0, 7) : '#808080';
    input._refresh?.();
  }
  const asset = appearanceDraft.background.asset;
  wallpaperName.textContent = asset ? asset.split('.').pop().toUpperCase() + ' · ' + uiText('已保存在本机') : uiText('使用默认背景');
}
function changeAppearance() {
  appearanceGeneration++;
  applyPersonalAppearance(); syncAppearanceControls();
  appearanceFeedback.textContent = uiText('等待保存…');
  clearTimeout(appearanceTimer);
  appearanceTimer = setTimeout(() => flushAppearance().catch(() => {}), 400);
}
function flushAppearance() {
  clearTimeout(appearanceTimer);
  if (!appearanceDraft) return Promise.resolve();
  const snapshot = structuredClone(appearanceDraft), generation = appearanceGeneration;
  appearanceSequence = appearanceSequence.catch(() => {}).then(async () => {
    try {
      await api('/api/appearance', 'PUT', snapshot);
      if (generation === appearanceGeneration) { appearanceFeedback.textContent = uiText('个性化外观已保存'); retryAppearance.hidden = true; }
    } catch (error) {
      appearanceFeedback.textContent = error.message;
      retryAppearance.hidden = false;
      throw error;
    }
  });
  return appearanceSequence;
}

function appearanceAssetUrl(id) { return '/appearance-assets/' + id; }
function applyPersonalAppearance() {
  const value = effectiveAppearance();
  if (!value) return;
  const body = document.body, styles = value.styles, background = value.background;
  body.classList.toggle('appearance-custom', value.enabled);
  const settings = {'--appearance-font-size': styles.font_size + 'px', '--appearance-message-radius': styles.message_radius + 'px',
    '--appearance-composer-radius': styles.composer_radius + 'px', '--appearance-opacity': styles.surface_opacity,
    '--appearance-message-color': styles.message_color || 'transparent', '--appearance-composer-color': styles.composer_color || 'var(--ui-panel-surface)',
    '--appearance-ink': styles.text_color || 'var(--ink)', '--appearance-accent': styles.accent_color || 'var(--blue)',
    '--appearance-font': styles.font_family || 'var(--ui-font)'};
  for (const [key, setting] of Object.entries(settings)) body.style.setProperty(key, setting);
  body.dataset.appearanceText = String(!!styles.text_color);
  body.dataset.appearanceAccent = String(!!styles.accent_color);
  body.dataset.appearanceMessage = String(!!styles.message_color);
  body.dataset.appearanceComposer = String(!!styles.composer_color);
  applyAppearanceFont(value.enabled ? styles.font_asset : null);
  const asset = value.enabled ? background.asset : null;
  body.classList.toggle('appearance-wallpaper', !!asset);
  wallpaper.style.opacity = background.opacity;
  wallpaper.style.filter = 'blur(' + background.blur + 'px)';
  wallpaper.style.inset = '-' + (background.blur + 2) + 'px';
  wallpaper.style.setProperty('--wallpaper-fit', background.fit);
  if (asset !== wallpaperKey) {
    wallpaper.querySelector('video')?.pause();
    wallpaper.replaceChildren(); wallpaperKey = asset;
    if (asset) {
      const extension = asset.split('.').pop();
      const tag = ['html', 'htm'].includes(extension) ? 'iframe' : ['mp4', 'webm'].includes(extension) ? 'video' : 'img';
      const media = elem(tag);
      if (tag === 'iframe') { media.title = uiText('HTML 动态背景'); media.setAttribute('sandbox', 'allow-scripts'); media.referrerPolicy = 'no-referrer'; }
      if (tag === 'video') { media.muted = true; media.loop = true; media.playsInline = true; media.preload = 'metadata'; }
      if (tag === 'img') media.alt = '';
      media.src = appearanceAssetUrl(asset);
      media.addEventListener('error', () => { appearanceFeedback.textContent = uiText('背景无法播放，请检查文件编码或更换文件。'); });
      wallpaper.append(media);
    }
  }
  syncWallpaperPlayback(); applyPersonalIcons();
  if (typeof applyUserLayout === 'function') applyUserLayout(value.layout);
}
async function applyAppearanceFont(id) {
  if (id === loadedFontKey) return;
  loadedFontKey = id;
  if (appearanceFont) { document.fonts.delete(appearanceFont); appearanceFont = null; }
  document.body.style.removeProperty('--appearance-loaded-font');
  if (!id) return;
  try {
    const font = await new FontFace('AstraPersonalFont', 'url("' + appearanceAssetUrl(id) + '")').load();
    if (loadedFontKey !== id) return;
    document.fonts.add(font); appearanceFont = font;
    document.body.style.setProperty('--appearance-loaded-font', 'AstraPersonalFont');
  } catch { appearanceFeedback.textContent = uiText('字体加载失败，请更换字体文件。'); }
}
const wallpaperMotion = matchMedia('(prefers-reduced-motion: reduce)');
function syncWallpaperPlayback() {
  const value = effectiveAppearance();
  if (!value) return;
  const paused = value.background.paused || document.hidden || wallpaperMotion.matches || value.background.opacity === 0;
  const media = wallpaper.firstElementChild;
  if (media?.tagName === 'VIDEO') {
    media.playbackRate = value.background.speed;
    if (paused) media.pause(); else media.play().catch(error => {
      if (media.isConnected && error.name !== 'AbortError') appearanceFeedback.textContent = uiText('背景无法播放，请检查文件编码或更换文件。');
    });
  }
  if (media?.tagName === 'IFRAME') {
    const source = paused ? 'about:blank' : appearanceAssetUrl(wallpaperKey);
    if (media.getAttribute('src') !== source) media.src = source;
  }
}
document.addEventListener('visibilitychange', syncWallpaperPlayback);
wallpaperMotion.addEventListener('change', syncWallpaperPlayback);
let wallpaperPointerFrame = 0, wallpaperPointer;
document.addEventListener('pointermove', event => {
  if (wallpaper.firstElementChild?.tagName !== 'IFRAME') return;
  wallpaperPointer = {type: 'astra-wallpaper-pointer', x: event.clientX, y: event.clientY, width: innerWidth, height: innerHeight};
  if (!wallpaperPointerFrame) wallpaperPointerFrame = requestAnimationFrame(() => {
    wallpaperPointerFrame = 0;
    wallpaper.firstElementChild?.contentWindow?.postMessage(wallpaperPointer, '*');
  });
}, {passive: true});

function applyPersonalIcons() {
  const value = effectiveAppearance();
  if (!value) return;
  const icons = value.enabled ? value.icons : {};
  for (const key of Object.keys(iconLabels)) {
    const selector = key === 'brand' ? '.brand img.logo' : key === 'send' ? '#send' : '#nav-' + key;
    const target = $(selector);
    if (!target) continue;
    const custom = key === 'send' && target.dataset.voiceMode !== 'send' ? null : icons[key];
    if (key === 'brand') {
      target.dataset.appearanceOriginal ||= target.getAttribute('src');
      target.dataset.personalBrand = String(!!custom);
      const source = custom ? appearanceAssetUrl(custom) : target.dataset.appearanceOriginal;
      if (target.getAttribute('src') !== source) target.src = source;
    } else {
      let image = target.querySelector(':scope > .personal-icon');
      target.classList.toggle('has-personal-icon', !!custom);
      if (!custom) { image?.remove(); continue; }
      if (!image) { image = elem('img', 'personal-icon'); image.alt = ''; target.prepend(image); }
      const source = appearanceAssetUrl(custom);
      if (image.getAttribute('src') !== source) image.src = source;
    }
  }
}
new MutationObserver(() => applyPersonalIcons()).observe($('#send'), {childList: true});
const appearanceReady = workspaceBoot.then(() => api('/api/appearance')).then(value => {
  appearanceDraft = value;
  applyPersonalAppearance(); syncAppearanceControls(); appearanceControls.disabled = false;
  const image = wallpaper.firstElementChild;
  if (window.workspaceLoading.active && image?.tagName === 'IMG') return image.decode().catch(() => {});
}).catch(error => {
  appearanceFeedback.textContent = error.message;
  retryAppearance.hidden = false;
  retryAppearance.textContent = uiText('恢复默认外观');
  retryAppearance.onclick = safely(async () => {
    appearanceDraft = await api('/api/appearance', 'PUT', {schema_version: 1, enabled: false});
    applyPersonalAppearance(); syncAppearanceControls(); appearanceControls.disabled = false;
    appearanceFeedback.textContent = uiText('已恢复默认外观');
    retryAppearance.hidden = true;
    retryAppearance.textContent = uiText('重试保存');
    retryAppearance.onclick = safely(() => flushAppearance());
  });
});

window.workspaceLoading?.track(appearanceReady);
