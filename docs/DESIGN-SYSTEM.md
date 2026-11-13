# AstraAgent 桌面设计系统

本规范面向 AstraAgent 的桌面对话、设置和任务执行界面。设计目标是简洁、精致、清晰可控，同时保留透彩玻璃与自定义皮肤。实现入口为 `web/assets/css/design-system.css` 与 `web/assets/js/features/design-system.js`。

## 布局与内容密度

- 主导航固定在窗口左侧，会话栏独立折叠，资料库、生图、任务页使用独立页面。
- 对话正文承担主要阅读空间。空输入框保持单行起步，随内容增高，既有桌面输入框高度上限继续生效。
- 任务状态默认是一行，可展开原因、用量与操作。执行记录保留在原有任务面板和消息记录中。
- 设置使用分类导航。服务商基础接入、协议与缓存、开发参数逐层展开。
- 内容容器使用 `min-width: 0`，长标识符允许换行或省略。窄窗口中的表单与操作栏换行排列。

## 令牌

| 类别 | 令牌或约定 | 用途 |
| --- | --- | --- |
| 间距 | `--space-1/2/3/4/6/8`，4/8/12/16/24/32 px | 控件、分组与页面间距 |
| 圆角 | `--radius-control` 8 px、`--radius-panel` 16 px | 表单控件与面板 |
| 字体 | 继承现有 Segoe UI / 中文系统字体栈 | 与当前桌面应用排版一致 |
| 正文 | 桌面对话沿用现有字号设置，行高至少 1.55 | 连续阅读 |
| 主要文字 | `--text-primary` | 正文和标题 |
| 次要文字 | `--text-secondary` | 说明、用量和辅助信息 |
| 阅读表面 | `--surface-reading` | 正文、编辑表单、任务详情 |
| 控件表面 | `--surface-input`、`--control-border` | 输入与可交互边界 |
| 焦点 | `--focus-color`，2 px 轮廓与 3 px 间隔 | 键盘位置 |
| 状态 | `--status-error`、`--status-success` | 同时配合明确的状态文字 |
| 动效 | `--motion-enter` 180 ms、`--motion-ease` | 局部状态过渡 |

新增界面优先引用这些令牌。既有组件按修改范围逐步迁移。装饰性分隔线与可操作控件边界使用不同的对比度要求。

## 材质

导航、窗口框架和临时浮层可呈现模糊、透色和边缘光。连续阅读区域使用更稳定的表面，避免背景图改变文字可读性。默认开启“增强阅读对比度”，使用者可以在外观设置中关闭，继续使用自定义皮肤表面。

这里采用 CSS 光学材质。Windows 原生 Mica / Acrylic 的系统合成行为需要原生窗口层另行实现与验证。微软材料指南为本项目提供了基础材质、临时浮层和遮罩层的分工参考。[Microsoft Windows Materials](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials)

模糊尽量在容器层复用。流式增量不会重建任务状态区或历史消息。活动任务的计时每秒刷新一次，完成后停止计时刷新。减少动效、减少透明度与强制颜色模式各自有对应降级样式。

## 颜色与可访问性

默认增强阅读表面的实测配色如下。测量针对列出的令牌与不透明阅读表面，透明导航、自定义皮肤和内容图片需要单独检查。

| 主题 | 主要文字 | 次要文字 | 控件边界 | 焦点 |
| --- | --- | --- | --- | --- |
| 浅色 | 15.00∶1 | 6.24∶1 | 3.36∶1 | 5.70∶1 |
| 深色 | 15.47∶1 | 9.66∶1 | 3.71∶1 | 8.77∶1 |

常规文字目标为 4.5∶1，交互边界与焦点目标为 3∶1。强调色按钮根据背景亮度选择黑色或白色前景。桌面新控件通常至少 32 px，紧凑输入区采用至少 24 px 的次要按钮，粗指针模式提升至至少 40 px。危险状态、选中状态和执行阶段同时提供文字、轮廓或图标。[WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## 参考依据与使用范围

| 官方资料 | 本项目采用的原则 |
| --- | --- |
| [Fluent 2 Windows](https://fluent2.microsoft.design/components/windows)、[Layout](https://fluent2.microsoft.design/layout)、[Motion](https://fluent2.microsoft.design/motion) | 桌面布局关系、语义化控件、通过动效解释状态变化 |
| [Apple HIG for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos) | 内容优先的桌面空间、清楚的侧栏与工具入口 |
| [Nielsen 10 Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | 状态可见、用户控制、一致性与错误恢复 |
| [Microsoft Human-AI Interaction](https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/) | 呈现能力与限制、任务中反馈、纠正与全局控制 |
| [Google PAIR Guidebook](https://pair.withgoogle.com/guidebook-v2/) | 自动化与控制、解释与出错时的用户体验 |
| [ISO 9241-110 官方页面](https://www.iso.org/standard/75258.html) | 参考公开介绍中的交互原则与适用范围 |

实现为项目自行编写的 CSS 与 JavaScript。ISO 引用范围限于公开页面，未购买或逐条审查付费标准正文。当前验证覆盖本次改动及部分关键流程，完整可访问性与原生窗口验收进度见 [验收记录](UI-UX-ACCEPTANCE.md)。
