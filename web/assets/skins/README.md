# AstraAgent 个性化皮肤包

在“设置 → 外观 → 个性化与动态背景”选择背景、字体和图标，修改会自动保存。
选择“导出 ZIP 皮肤包”可以打包当前配置及引用的资源。
解压后编辑 `astra-skin.json`，再将清单和资源一起压缩为 ZIP，即可重新导入。
ZIP 也可以从扩展市场的“导入作品包”入口导入。已有市场 JSON 皮肤继续使用原有格式。

## 文件结构

```text
my-skin.zip
├── astra-skin.json
└── assets/
    ├── background.html
    ├── font.woff2
    └── home.svg
```

`astra-skin.json` 必须直接位于 ZIP 根目录。文件路径区分大小写，使用 `/` 分隔。
清单中的背景、字体和图标路径指向 ZIP 内的文件。所有资源保存在本机，原始文件移动后仍可使用。

## 清单示例

```json
{
  "schema_version": 1,
  "name": "My animated skin",
  "enabled": true,
  "background": {
    "asset": "assets/background.html",
    "fit": "cover",
    "opacity": 1,
    "blur": 0,
    "paused": false,
    "speed": 1
  },
  "styles": {
    "font_family": "Segoe UI, Microsoft YaHei",
    "font_asset": "assets/font.woff2",
    "font_size": 15,
    "message_radius": 20,
    "composer_radius": 28,
    "surface_opacity": 0.75,
    "message_color": "#142033b3",
    "composer_color": "#142033e6",
    "text_color": "#ffffff",
    "accent_color": "#a8c7ff"
  },
  "icons": {
    "home": "assets/home.svg"
  }
}
```

可省略不需要调整的字段。颜色留空字符串使用当前基础皮肤的颜色。
`background.asset` 和 `styles.font_asset` 可设为 `null`。
关闭 `enabled` 会恢复基础皮肤，并保留自定义配置，便于再次开启。

## 支持的资源与范围

- 背景支持 PNG、JPEG、WebP、GIF、SVG、MP4、WebM、UTF-8 HTML。
- 字体支持 WOFF2、WOFF、TTF、OTF。`font_asset` 优先于系统字体名称。
- 图标支持静态 SVG 和上述图像格式，每个图标最大 2 MB。
- 图标位置支持 `home`、`images`、`schedule`、`library`、`plugins`、`more`、`settings`、`profile`、`send`、`brand`。
- `fit` 为 `cover` 或 `contain`，对图片和视频生效。`opacity` 为 0–1，`blur` 为 0–30 像素。
- `speed` 为 0.25–2，仅影响视频。视频静音循环播放。
- `font_size` 为 12–24 像素，`message_radius` 为 0–32，`composer_radius` 为 0–40。
- `surface_opacity` 为 0.15–1，降低数值可以增加背景透出程度。
- 单个资源最大 256 MB，HTML 最大 8 MB，ZIP 解压后的资源总量最大 512 MB，最多 128 个条目。

## HTML 动态背景

HTML 在隔离 iframe 中运行，可以使用内联 CSS、JavaScript 和 Canvas 创建动画。
请将 CSS 和 JavaScript 放在 HTML 内，图片、字体等依赖使用 data URL。
外部资源、网络接口、主应用页面和主应用存储受到隔离限制。
背景层不会拦截聊天操作。需要随鼠标变化的效果，可以监听应用提供的坐标消息。

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
body { background: radial-gradient(circle at 30% 30%, #4d70a8, #141c36); }
#glow { position: absolute; width: 320px; height: 320px; border-radius: 50%;
  background: #b3a4ee66; filter: blur(80px); transform: translate(-50%, -50%); }
</style></head>
<body><div id="glow"></div><script>
addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'astra-wallpaper-pointer') return;
  document.querySelector('#glow').style.left = event.data.x + 'px';
  document.querySelector('#glow').style.top = event.data.y + 'px';
});
</script></body></html>
```

窗口不可见、系统启用减少动态效果或手动暂停时，视频会暂停，HTML 背景会卸载。
重新显示时 HTML 从初始状态运行。GIF 由图像解码器播放。
这里使用应用内 HTML 与视频背景，不读取 Wallpaper Engine 的专有场景格式。


## 布局与皮肤模组

在「设置 → 外观 → 布局与模组」编辑主页区块、欢迎标题、内容宽度与对齐、建议列数、输入框位置，以及侧栏固定、排序、底部位置和自定义名称。区块和已固定的按钮支持拖动与上下按钮排序。快捷入口可以打开已有页面，也可以把提示词填入输入框。Ctrl+Alt+L 随时打开布局设置。

皮肤包仍使用 `schema_version: 1`，新增可选 `layout` 和 `mods`。旧包继续兼容。普通导入恢复完整外观，「安装 ZIP 模组」合并已安装模组，同 ID 更新配置并保留原有叠加位置。导出完整皮肤包包含手动外观、布局、模组和引用资源，单个模组也可独立导出。

每个模组提供 ID、名称、版本、作者、说明、开关和设置，支持图形设置、JSON 配置、预览、应用、取消、排序和卸载。模组按列表顺序叠加，后面的同名字段优先。关闭模组会恢复此前配置的效果。恢复默认外观会停用已安装模组并保留其配置。

下面是可直接放入 ZIP 根目录的 `astra-skin.json` 示例。

```json
{
  "schema_version": 1,
  "name": "专注工作空间",
  "mods": [
    {
      "id": "my-focus-layout",
      "name": "我的专注布局",
      "version": "1.0.0",
      "author": "Your name",
      "description": "集中显示输入与快捷入口",
      "enabled": true,
      "settings": {
        "layout": {
          "home_width": 720,
          "home_align": "left",
          "composer_position": "center",
          "home_hidden": ["hint", "starters"],
          "sidebar_labels": true
        },
        "styles": {"font_size": 16, "composer_radius": 24}
      }
    }
  ]
}
```

模组的 `settings` 可包含 `background`、`styles`、`icons` 和 `layout` 的部分字段。背景、字体、图标资源使用包内路径，与普通皮肤包相同。配置限定为声明式字段，HTML 动态背景继续通过隔离框架播放。

`layout` 支持 `enabled`、`home_order`、`home_hidden`、`home_align`、`home_width`（480–1200）、`home_columns`（1–4）、`home_title`、`composer_position`（bottom / center）、`sidebar_order`、`sidebar_bottom`、`sidebar_names`、`sidebar_labels`、`home_shortcuts` 和 `shortcuts`。主页区块 ID 为 greeting / hint / starters / shortcuts，`home_order` 需完整包含四个 ID。

内置按钮 ID 为 home / images / schedule / library / plugins / more / review / settings / profile。自定义快捷入口格式为 `{ "id": "custom-plan", "label": "列计划", "icon": "home", "action": "prompt", "prompt": "帮我列一份计划" }`。动作支持上述内置入口（除 more），以及 canvas / projects / archives / theme / appearance / performance / layout / files / new_chat / prompt。将入口 ID 放入 `sidebar_order` 或 `home_shortcuts` 即可显示。

最多安装 32 个模组、定义 20 个自定义快捷入口。清单最大 2 MB，资源仍受文件类型、路径与包大小校验。

交互组织参考 [Windhawk 模组文档](https://github.com/ramensoftware/windhawk/wiki/Creating-a-new-mod) 中的元数据与可配置设置，运行效果由 AstraAgent 自身的布局和外观系统实现。
