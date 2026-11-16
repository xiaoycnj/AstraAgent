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
