# AstraAgent 桌面设计系统

本规范面向 AstraAgent 的桌面对话、设置和任务执行界面。设计目标是简洁、精致、清晰可控，同时保留透彩玻璃与自定义皮肤。全站样式入口为 `web/assets/css/application.css`。共享控件和页面几何由 `web/assets/css/ui/` 管理，组件注册与设置布局由 `web/assets/js/features/ui-components.js` 管理。任务状态与命令面板继续使用 `features/design-system.js`。

## V3.18 动效与对话稳定性

共享动效由 `ui/motion.css` 和 `features/motion.js` 管理，采用独立的 motion 层。控件反馈为 100–140 ms，浮层和弹窗为 180 ms，页面切换为 220 ms，缓动统一使用 `cubic-bezier(.2,.8,.2,1)`。时长由本项目确定，参考 Fluent 2 对功能性、一致性与快速反馈的原则。[Fluent 2 Motion](https://fluent2.microsoft.design/motion)

| 元素 | 动效与反馈 |
| --- | --- |
| 按钮、链接、标签、图标按钮、卡片操作 | 背景、文字、边界、焦点、阴影与按压缩放过渡 |
| 输入、选择器、开关、滑杆 | 边界、颜色与状态过渡，开关滑块沿用共享组件位移 |
| 菜单、提示、浮层、抽屉、设置子页、功能页面 | 由可见性变化触发一次淡入，面板最多位移 4 px |
| 原生 dialog 与遮罩 | 透明度和 6 px 位移过渡，支持浏览器离散显示过渡 |
| 折叠内容 | 展开时淡入，保留原有焦点与键盘行为 |
| 新增对话消息 | 小批新增消息淡入，历史消息保留 DOM 与阅读几何 |
| 工具状态、流式正文、IUI 与异步媒体 | 更新实际内容并保持阅读锚点，执行记录和卡片交互状态随节点保留 |

按压使用独立的 `scale` 属性，保留居中按钮的既有 `transform`。共享过渡显式列出属性，内容尺寸与滚动位置由布局和对话滚动控制器管理。可见性观察仅处理新增子树和目标状态变化。面板的文本更新会保留当前动效生命周期。

历史消息按会话和消息标识复用。流式草稿转为已保存消息时继续使用原节点，异步加载渲染模块时按渲染器版本刷新内容。自动跟随、用户上滑暂停、回到最新与异步尺寸变化使用同一个滚动控制器。系统与应用内减少动效设置覆盖 CSS、伪元素、dialog 遮罩和运行中的 Web Animations 动效。

原生弹窗使用 `@starting-style`、`display` 和 `overlay` 的离散过渡。支持范围以发行版 WebView2 与工程回归使用的 Edge 为准。[MDN starting-style](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@starting-style)

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
| 圆角 | 控件 8 px、分组卡片 12 px、主内容框 16 px、模态窗口 20 px | 表单控件与面板 |
| 字体 | 继承现有 Segoe UI / 中文系统字体栈 | 与当前桌面应用排版一致 |
| 正文 | 桌面对话沿用现有字号设置，行高至少 1.55 | 连续阅读 |
| 主要文字 | `--text-primary` | 正文和标题 |
| 次要文字 | `--text-secondary` | 说明、用量和辅助信息 |
| 阅读表面 | `--surface-reading` | 正文、编辑表单、任务详情 |
| 控件表面 | `--surface-input`、`--control-border` | 输入与可交互边界 |
| 焦点 | `--focus-color`，2 px 轮廓与 3 px 间隔 | 键盘位置 |
| 状态 | `--status-error`、`--status-success` | 同时配合明确的状态文字 |
| 动效 | `--motion-enter` 180 ms、`--motion-ease` | 局部状态过渡 |

共享控件使用 `--ui-*` 语义令牌和 `.ui-button`、`.ui-field`、`.ui-switch`、`.ui-section`、`.ui-dialog` 组件类。装饰性分隔线与可操作控件边界使用不同的对比度要求。

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

## 样式与组件分层

36 个独立样式链接收敛到一个样式入口。入口通过 CSS cascade layers 管理既有功能样式、令牌、共享控件、应用布局和皮肤。既有功能样式仍保留在原文件中，便于逐步迁移与定位回归。

| 层 | 责任 |
| --- | --- |
| accessibility | 隐藏语义、焦点、减少动效、强制颜色与透明度降级 |
| vendor | KaTeX、CodeMirror 的第三方样式 |
| legacy | 既有功能模块和内容渲染布局 |
| tokens | 字体、控件尺寸、圆角、材质、层级和动效令牌 |
| components | 按钮、输入、开关、分组、行、选择器、弹窗 |
| layout | 窗口框架、导航、设置、对话和独立页面的几何关系 |
| skins | 声明式皮肤的圆角、背景、图标包、布局和快捷控件 |

普通声明由后面的层覆盖。重要声明的层优先级相反，因此隐藏和可访问性规则集中在最前层。迁移过的输入框圆角、高度、阴影和设置导航背景已移除旧的重要声明。功能性的隐藏、流式更新与用户布局规则继续按原流程工作。

原生 DOM 创建函数接入共享注册器，静态页面和异步增加的控件使用同一套类。注册器只处理新增元素，流式文本增量不会触发全页重扫。富文本内容和代码编辑器保留各自的内容呈现规则。Token 热力图和图片预览保留本身的尺寸约束。

## 官方规范到界面的对应

| 资料 | 实施选择 |
| --- | --- |
| Microsoft Fluent 2 Layout | 4 px 基础间距，分组 16/20 px，页面留白随窗口变化 |
| Microsoft Fluent 2 Buttons | 每个编辑弹窗一个主要保存操作，危险删除采用次要操作，设置即时开关与提交表单分工明确 |
| Apple HIG Sidebars | 主导航常驻，会话栏折叠，设置分类支持键盘和窄窗口抽屉 |
| Apple HIG Toolbars | 常用入口稳定分组，窄窗口将四组菜单完整放入应用菜单，低频上下文压缩移入对话选项 |
| Apple HIG Settings | 分类标题固定、内容独立滚动，服务商按用途分组，OAuth 和高级参数按需展开 |
| Windows Materials | 框架和导航使用透彩玻璃，阅读与表单使用稳定表面，模态操作使用遮罩 |

本轮按 Windows 平台习惯确定字体与窗口控制，采用 Apple HIG 中的内容层级、分组和可控性原则。任务与产物栏仅在没有保存偏好时默认收起，已有偏好继续保留。

上述选择基于官方资料阅读。[Fluent 2 Layout](https://fluent2.microsoft.design/layout)、[Fluent 2 Buttons](https://fluent2.microsoft.design/components/web/react/core/button/usage)、[Apple Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)、[Apple Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)、[Apple Settings](https://developer.apple.com/design/human-interface-guidelines/settings)

## V3.14 信息架构

本轮研究了 Cherry Studio 官方主仓库，以及官方 V2 原型的 Sidebar、ChatPage、ChatSettingsPanel、ModelServicePage 和 SettingsPage。采用的交互组织包括独立的功能导航与内容、极简输入模式、当前操作与全局设置分工、基础配置与模型细节的逐层展开。

主导航保留对话、生图、资料库和更多四个入口。定时任务、插件和代码审阅使用更多菜单中的原有按钮。会话栏集中展示新建、搜索和会话列表。项目管理与画布从更多菜单进入。

输入区默认提供添加、权限、模型与发送。附件、项目选择、压缩和审查等动作位于添加菜单，权限状态仍常驻可见。欢迎页仅保留动态问候、技能与插件触发提示、三个紧凑的建议入口。

设置一级导航统一为六组。

| 一级导航 | 组内页面 |
| --- | --- |
| 模型与语音 | 模型服务、语音 |
| 常规 | 语言、权限、高级执行与安全 |
| 外观 | 主题与材质、图标库 |
| 扩展能力 | 插件、Skills、MCP、Tools |
| 个人与记忆 | 个人资料、自定义指令、本地记忆 |
| 数据与应用 | 存储空间、已归档的聊天、关于 |

服务商采用可搜索列表和单一添加入口，用途在编辑表单内选择。权限选择调用原有策略动作和确认。语言包、执行预算、材质细节、使用统计和创建扩展等低频操作使用分组展开。

这些布局与交互由项目自己的 DOM、CSS 和现有事件处理实现。研究来源用于设计参考。[Cherry Studio 官方仓库](https://github.com/CherryHQ/cherry-studio)、[Sidebar 原型](https://github.com/CherryHQ/cherry-studio-ui-design/blob/main/src/app/components/layout/Sidebar.tsx)、[输入设置原型](https://github.com/CherryHQ/cherry-studio-ui-design/blob/main/src/features/assistant/ChatSettingsPanel.tsx)、[模型服务原型](https://github.com/CherryHQ/cherry-studio-ui-design/blob/main/src/app/components/settings/ModelServicePage.tsx)


## 作品与写作导航改进 · 2026-11-15

- 采用 Fluent 2 的 4px 间距体系，将详情间距统一为 16px，操作组统一为 8px，通过接近关系表达分组。
- 作品与写作采用列表加详情结构，列表选中项同时使用底色、侧线与 aria-current 标记。窄窗口下列表回到内容上方，保留玻璃导航表面。
- 列表支持搜索、无结果反馈、Escape 清空搜索，以及方向键、Home、End 移动焦点。Enter 和 Space 沿用按钮激活行为，移动焦点与加载项目分别响应。
- 导航控件提供 2px 焦点轮廓和 44px 最小条目高度。焦点颜色复用深浅色主题令牌。

专业资料与应用依据

[Microsoft Fluent 2 Layout](https://fluent2.microsoft.design/layout) 说明空间接近关系、4px 间距和自适应布局。[Apple HIG Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) 讨论列表详情分层及有限空间下的侧栏适配。[W3C Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) 给出 AAA 级焦点面积与对比度判定。本轮使用这些资料指导局部改进，整站符合性需要逐项独立评估。


## 外观编辑与字体层级 · 2026-11-17

高级外观按配色、材质与密度、玻璃细节组织。桌面采用标签与控件两列，控件列最多 320px，列间距 24px。在 650px 以下改为上下排列。控件组的键盘方向键、Home 和 End 调用原有选择动作。玻璃预览采用 132px 高度，保留材质比较所需的内容。

自定义外观按背景与播放、对话与输入、字体与阅读、颜色、图标、皮肤文件包分组。滑杆旁提供百分比、像素或播放倍率的当前值，并同步到可访问的值描述。移动控件保留原有保存和导入导出事件，父级 fieldset 继续统一管理加载与上传时的禁用状态。

排版采用 14px / 20px 的界面正文、12px / 18px 的说明、24px / 32px 的页标题，常规字重 400，强调 600。Windows 优先 Segoe UI Variable Text 和 Segoe UI，再回退到中文系统字体。其他平台通过系统字体栈回退。数字读数使用等宽数字。标题恢复正常字距，正文与代码分别使用阅读字族和等宽字族。用户选择的消息字号和导入字体继续参与内容排版。

依据与适用范围

- Fluent 2 提供系统字体、14px 正文、12px 说明和 4px 基础间距。本项目用统一令牌落实到控件、分组和排版。[Typography](https://fluent2.microsoft.design/typography)、[Layout](https://fluent2.microsoft.design/layout)
- Apple HIG 强调可读字号、稳定层级、克制使用字族，以及按相关性组织设置。此处采用这些排版与设置组织原则。[Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Settings](https://developer.apple.com/design/human-interface-guidelines/settings)
- OpenAI 的 UI 文档面向 ChatGPT 内嵌界面。本项目参考其中的系统字体、有限字号变化和一致控件间距，保留 AstraAgent 的独立设置与主题系统。[UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)
- Anthropic 官方品牌资料提供 Poppins 标题、Lora 正文及 Arial / Georgia 回退。本项目在 Anthropic 风格的内容区采用相应字族回退，结构界面使用平台字体。具体字形取决于本机已安装字体或用户导入字体。[Brand styling](https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md)
