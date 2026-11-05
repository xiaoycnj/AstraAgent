// Appearance preferences are local to this desktop/browser profile.
const glassVariants = {
    real: {name: '真实', detail: '清透 · 鲜明边缘', blur: 18, opacity: .48},
    natural: {name: '自然', detail: '透色 · 平衡层次', blur: 26, opacity: .62},
    soft: {name: '柔和', detail: '柔雾 · 安静背景', blur: 38, opacity: .78}
};
function readGlassPreferences() {
    let stored = {};
    try {stored = JSON.parse(localStorage.getItem('astra-glass') || '{}') || {};} catch {}
    return {
        variant: Object.hasOwn(glassVariants, stored.variant) ? stored.variant : 'natural',
        transmission: Number.isFinite(stored.transmission) ? Math.min(100, Math.max(0, stored.transmission)) : 55,
        touchLight: typeof stored.touchLight === 'boolean' ? stored.touchLight : true
    };
}
let glassPreferences = readGlassPreferences();
const glassSettings = elem('section', 'settings-group glass-settings');
glassSettings.id = 'glass-settings';
const glassHeading = elem('div', 'glass-settings-heading');
const glassHeadingText = elem('div');
glassHeadingText.append(elem('h3', '', '透彩玻璃'),
    elem('p', 'hint', '让背景的颜色透进来，用柔雾与边缘光描出界面的厚度。'));
const enableGlass = actionButton('启用透彩玻璃', () => {
    materialGroup.querySelector('[data-material-choice=glass]').click();
}, 'secondary glass-enable');
glassHeading.append(glassHeadingText, enableGlass);
const glassShowcase = elem('div', 'glass-showcase');
glassShowcase.setAttribute('aria-label', '玻璃材质实时预览');
const glassSampleDock = elem('div', 'glass-surface glass-sample-dock');
glassSampleDock.setAttribute('aria-hidden', 'true');
glassSampleDock.append(svgIcon('chat'), svgIcon('note'), svgIcon('tools'));
const glassSampleOrb = elem('div', 'glass-surface glass-sample-orb');
const glassSampleLogo = elem('img');
glassSampleLogo.src = '/assets/icons/brand/astra.svg';
glassSampleLogo.alt = '';
glassSampleOrb.append(glassSampleLogo);
const glassCaption = elem('span', 'glass-sample-caption', 'ASTRA / CHROMATIC GLASS');
glassShowcase.append(glassSampleDock, glassSampleOrb, glassCaption);
const glassControls = elem('fieldset', 'glass-controls');
const glassVariantGroup = elem('div', 'glass-variants');
glassVariantGroup.setAttribute('role', 'group');
glassVariantGroup.setAttribute('aria-label', '玻璃质感');
for (const [id, variant] of Object.entries(glassVariants)) {
    const button = actionButton('', () => saveGlassPreferences({variant: id}), 'glass-variant');
    button.dataset.glassVariant = id;
    button.append(elem('strong', '', variant.name), elem('span', '', variant.detail));
    glassVariantGroup.append(button);
}
function glassControlRow(title, description, control) {
    const row = elem('div', 'glass-control-row');
    const text = elem('div');
    text.append(elem('strong', '', title), elem('p', '', description));
    row.append(text, control);
    return row;
}
const glassTransmission = elem('input');
glassTransmission.id = 'glass-transmission';
glassTransmission.type = 'range';
glassTransmission.min = '0';
glassTransmission.max = '100';
glassTransmission.setAttribute('aria-label', '玻璃透光度');
const glassTransmissionValue = elem('output');
glassTransmissionValue.htmlFor = glassTransmission.id;
const glassRangeWrap = elem('div', 'glass-range-wrap');
glassRangeWrap.append(glassTransmission, glassTransmissionValue);
glassTransmission.oninput = () => saveGlassPreferences({transmission: Number(glassTransmission.value)});
const glassTouch = elem('input');
glassTouch.id = 'glass-touch-light';
glassTouch.type = 'checkbox';
glassTouch.setAttribute('role', 'switch');
glassTouch.setAttribute('aria-label', '点触光感');
glassTouch.onchange = () => saveGlassPreferences({touchLight: glassTouch.checked});
const glassTouchLabel = elem('label', 'switch-pill');
glassTouchLabel.append(glassTouch);
glassControls.append(glassVariantGroup,
    glassControlRow('透光度', '调整背景透色，正文区域保留稳定的阅读底色。', glassRangeWrap),
    glassControlRow('点触光感', '光晕跟随鼠标与触点，减少动效时自动停用。', glassTouchLabel));
glassSettings.append(glassHeading, glassShowcase, glassControls,
    elem('p', 'glass-settings-note', '实时预览并保存在此设备。静谧与高对比模式可随时切换，系统减少透明度时会使用实色底。'));
materialGroup.after(glassSettings);

function saveGlassPreferences(change) {
    glassPreferences = {...glassPreferences, ...change};
    try {localStorage.setItem('astra-glass', JSON.stringify(glassPreferences));} catch {toast('外观偏好暂时无法保存');}
    applyGlassPreferences();
}
function applyGlassPreferences() {
    const root = document.documentElement;
    const variant = glassVariants[glassPreferences.variant];
    const opacity = Math.min(.92, Math.max(.35, variant.opacity + (55 - glassPreferences.transmission) * .003));
    root.style.setProperty('--glass-blur', variant.blur + 'px');
    root.style.setProperty('--glass-light-opacity', opacity.toFixed(3));
    root.style.setProperty('--glass-dark-opacity', Math.min(.94, opacity + .06).toFixed(3));
    root.dataset.glassVariant = glassPreferences.variant;
    root.dataset.glassLight = glassPreferences.touchLight ? 'on' : 'off';
    glassTransmission.value = glassPreferences.transmission;
    glassTransmissionValue.value = glassPreferences.transmission + '%';
    glassTouch.checked = glassPreferences.touchLight;
    for (const button of glassVariantGroup.children) {
        button.setAttribute('aria-pressed', String(button.dataset.glassVariant === glassPreferences.variant));
    }
    const enabled = root.dataset.material === 'glass';
    glassControls.disabled = !enabled;
    enableGlass.hidden = enabled;
    if (!enabled || !glassPreferences.touchLight) clearGlassLight();
}

const glassSurfaceSelector = [
    '.sidebar', '.topbar', '.composer', '.floating-control', '.command-menu',
    '.session-context-menu', 'dialog', '.settings-group', '.provider-card',
    '.mcp-card', '.storage-manage-row'
].join(',');
function markGlassSurfaces(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(glassSurfaceSelector)) node.classList.add('glass-surface');
    for (const surface of node.querySelectorAll(glassSurfaceSelector)) surface.classList.add('glass-surface');
}
markGlassSurfaces(document.body);
new MutationObserver(records => {
    for (const record of records) {
        for (const node of record.addedNodes) markGlassSurfaces(node);
    }
}).observe(document.body, {childList: true, subtree: true});
const glassMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const glassTransparencyQuery = matchMedia('(prefers-reduced-transparency: reduce)');
let litGlassSurface = null;
let glassPointerFrame = 0;
let glassTouchTimer = 0;
function clearGlassLight() {
    litGlassSurface?.classList.remove('glass-lit');
    litGlassSurface = null;
}
function canLightGlass() {
    return document.documentElement.dataset.material === 'glass' &&
        document.documentElement.dataset.motion !== 'reduced' &&
        glassPreferences.touchLight && !glassMotionQuery.matches && !glassTransparencyQuery.matches;
}
function lightGlassAt(event) {
    if (!canLightGlass()) {clearGlassLight(); return;}
    const surface = event.target.closest?.('.glass-surface');
    if (litGlassSurface !== surface) clearGlassLight();
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    surface.style.setProperty('--glass-x', (event.clientX - bounds.left) + 'px');
    surface.style.setProperty('--glass-y', (event.clientY - bounds.top) + 'px');
    surface.classList.add('glass-lit');
    litGlassSurface = surface;
}
document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || glassPointerFrame || !canLightGlass()) return;
    glassPointerFrame = requestAnimationFrame(() => {
        glassPointerFrame = 0;
        lightGlassAt(event);
    });
}, {passive: true});
document.addEventListener('pointerdown', event => {
    lightGlassAt(event);
    clearTimeout(glassTouchTimer);
    if (event.pointerType !== 'mouse') glassTouchTimer = setTimeout(clearGlassLight, 600);
}, {passive: true});
document.addEventListener('pointercancel', clearGlassLight, {passive: true});
document.addEventListener('pointerleave', clearGlassLight);
window.addEventListener('blur', clearGlassLight);
glassMotionQuery.addEventListener('change', clearGlassLight);
glassTransparencyQuery.addEventListener('change', clearGlassLight);
new MutationObserver(applyGlassPreferences).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-material', 'data-motion']
});
applyGlassPreferences();
