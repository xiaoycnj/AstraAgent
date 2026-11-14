# 功能模块与执行约定

模块采用显式注册表，当前已拆分基础计算、项目文件与图片生成。现有执行引擎、MCP、项目检查点、记忆、语音和任务存储继续使用各自的独立 Python 域模块。

`modules/catalog.py` 汇总工具定义、所属适配器和模块状态。每个适配器接收 `args`、`config`、由宿主提供的 `context` 和工具名，返回可序列化的结果。宿主负责模型循环、能力选择、审批、持久化审计和流式事件，适配器负责具体操作。第三方插件内容不会自动作为 Python 导入。

## 调用流程

1. 从启用的插件、Skills、模块和已信任的 MCP 发现能力。
2. 对照当前策略及文件、命令等子权限决定是否申请批准。
3. 在真正执行前写入审计记录，拒绝或关闭模块时停止调用。
4. 执行受预算限制的操作，并监听任务取消。
5. 回传真实结果和错误，保存会话产物及执行记录。
6. 项目任务使用现有差异、检查点和验证命令给出验收状态。

工具运行结果与最终回答分开呈现。工作栏的会话执行、工作空间任务、子智能体和产物分别来自已有 API，空列表显示暂无记录。

## 图片模块

服务商使用 `type: image_api`，聊天使用 `chat_api`，缺少类型的旧记录按聊天接口读取。图片配置保存在原有加密服务商存储中，密钥不会放入模型上下文。工具名为 `generate_image`，接受提示词、可选服务商 ID 和尺寸，单次一张。

图片参数由 `modules/image_requests.py` 按已选模型及服务商地址构造。GPT Image 文生图使用 `/images/generations`，参考图编辑使用 `/images/edits` 的 JSON `images`。GPT Image 与 `chatgpt-image-latest` 不发送 `response_format`。Seedream 参考图通过 JSON `image` 字符串或数组发送到 `/images/generations`，固定单张模式，省略 OpenAI 的 `n`，尺寸按版本校验档位、像素总量与宽高比。未知模型别名沿用 OpenAI 兼容接口，参考图通过 multipart `/images/edits` 发送。

`list_image_models` 向聊天模型披露配置中的模型及参数提示，包括尺寸、质量档位和协议。工具接受 `output_format`、透明背景、压缩、参考图保真度以及 Seedream 的种子、水印，按接口和版本校验。不适用的组合返回可纠正错误。旧版 DALL·E 兼容服务保留文生图参数映射，模型可用性由服务商决定。

网关自定义型号如 `image2.5` 默认采用兼容协议。调用方可依据网关说明，通过 `image_protocol` 显式选择 `gpt-image`、`dall-e`、`seedream` 或 `compatible`。协议选择只影响已配置服务商上的固定图片端点和参数，不能指定新地址或访问其他会话的文件。

返回 base64 时直接验证并存储，URL 响应经 DNS、协议和重定向限制下载，不向图片下载站点转发服务商 Bearer。单张图片沿用 5 MB 附件限制，每次最多四张参考图、合计 10 MB。成功后链接到当前会话输出。取消不能保证服务商撤销已经发生的计费。

在一轮所有工具结果返回后，宿主将生成图片的实际像素作为下一轮多模态消息发给已配置视觉能力的聊天模型。模型可检查结果，并使用输出附件 ID 再次调用编辑。未知或明确不支持视觉的聊天模型会收到尚未视觉检查的提示。执行记录只保存附件元信息，像素从本地附件读取。图片作为不可信参考资料处理，继续遵守原有工具审批策略。

用户要求直接交付 HTML、SVG、Markdown、代码或数据文件时，模型可调用 `write_file` 并设置 `deliver: true`。文件成功写入后，以相同内容建立会话输出附件并返回下载链接。写入失败、拒绝或越界时不交付附件。交付失败会单独报告，已完成写入可在工作区找到。最终回复自动补上尚未包含的真实交付链接，附件栏和资料库同步刷新。下载响应携带 UTF-8 文件名，HTML 和 SVG 沿用下载处置。

测试使用本地合成图片 API，覆盖协议参数、参考图请求、实际像素回读、多工具消息顺序、文件交付、获批、拒绝不出网、取消不保存、加密密钥、会话输出、模块关闭和类型隔离。真实付费服务商的出图质量与兼容网关差异仍需部署者验收。

接口核对依据为 [OpenAI 生成图片参考](https://developers.openai.com/api/reference/resources/images/methods/generate)、[OpenAI 编辑图片参考](https://developers.openai.com/api/reference/resources/images/methods/edit)、[OpenAI 生图工具多轮流程](https://developers.openai.com/api/docs/guides/tools-image-generation)、[DALL·E 历史 SDK 参数](https://github.com/openai/openai-python/blob/v1.66.3/src/openai/types/image_generate_params.py) 与 [Seedream 官方接口](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)。核对日期为 2026-11-14。

## 其他智能体模块

截图中提及的小说世界模拟 Agent 尚未提供实现和接口。本版提供两种可接入路径，由开发者按实际能力选择。

- 作为独立智能体服务，提供 OpenAI 兼容聊天端点，在服务商中添加，并通过 Skill 约束角色和工作流程。
- 作为世界状态工具，提供 MCP 服务，例如人物查询、世界状态读取和事件推进。使用现有 MCP 管理与完整命令信任流程连接，插件提供描述性 Skills。

新增本机可执行适配器需要代码审阅并显式加入注册表。当前不展示尚未实现的世界模拟能力。

## 参考资料

Qoder 的公开工具文档覆盖文件、搜索、修改与执行能力，ZCode 文档将工作区、任务、模型与执行模式组织在同一任务中。这里采用的是能力入口与工作区状态的组织思路。[Qoder 工具](https://docs.qoder.com/user-guide/chat/tools) · [ZCode Agent](https://zcode.z.ai/cn/docs/agents)

Codex 的公开 harness 资料描述会话、流式事件、中断、工具和批准处理。本项目保留自己的后端，将这套职责分离用于审查已有执行链路。[Codex 官方资料](https://developers.openai.com/blog/codex-as-a-platform) · [Codex 开源工具审批实现](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/approvals.rs)

DeepSeek Harness 官方仓库强调插件组织。这里借鉴按能力组织模块的原则，采用显式适配器与描述性插件的接入方式。[DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)

以上是依据公开资料作出的工程设计判断，未复制这些产品的私有实现或界面素材。

## 创作与定时执行

更多菜单中的“作品工作台”和“写作项目”拥有独立页面。作品版本由 `creation_store.py` 存储，文件交付和生图自动登记，源文件编辑与恢复采用版本头校验。关联同会话的同目录 CSS、PNG、JPEG、WebP 可进入静态预览，原文件及关联附件可导出 ZIP。

`browser_checks.py` 调用安装在本机的 Edge 或 Chrome，使用已有 Node 22+ 运行 `scripts/static_browser.cjs`。浏览器使用临时配置、禁用作品脚本、阻止网络和文件请求，检查横向溢出并导出实际 PNG/PDF。应用内预览使用无权限 sandbox iframe。检查范围为静态布局，交互、脚本运行和复杂嵌套资源仍需项目自身的验证流程。Lite 需自行提供 Node 22+ 和 Chromium 浏览器。

图片版本可并排对比，并在画布上涂抹局部重绘范围。准备请求将源图转换为 PNG，保存转换版本，并把透明区域蒙版与源图加入所属会话。发送前可继续修改提示词。蒙版只接受当前会话附件，须与首张 PNG 同尺寸。GPT Image 使用 JSON mask 引用，兼容网关使用 multipart mask 文件，未接入蒙版的协议会返回错误。

`story_projects.py` 保存章节、人物、地点、时间线、大纲和笔记。写作工作室插件可读取绑定项目、按修订号保存条目。默认上下文包含已确认设定与最近章节，正文有明确截断标记，可用工具补充全文。草稿和假设保留独立状态。导出支持 Markdown、EPUB 3 和基础 DOCX，Office 与电子书格式以段落输出正文，保留原有 Markdown 字符。

`task_scheduler.py` 在主后端启动后每五秒轮询。先在“任务验收”保存任务，再到“定时任务”选择任务、触发方式和错过策略。启用会调用模型，使用当前服务商凭证和当前权限上限。每次派发创建普通持久化会话，批准请求、停止及恢复沿用原执行系统。调度配置不保存 API Key，任务定义变化会暂停计划。应用重启后不确定的派发需要人工核对，避免自动重复副作用。电脑休眠或应用退出时无法执行，错过触发可跳过或补执行一次。同一时刻最多执行一个定时派发。

协议与隔离依据可查阅 [OpenAI 图片编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)、[Chrome Headless](https://developer.chrome.com/docs/automation-and-testing/headless) 和 [Chromium 禁用脚本接口](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setScriptExecutionDisabled)。

## 启动器

`native/Launcher.cs` 编译为两个程序，GUI 版本使用 Windows 图形子系统并启动 `pythonw.exe`，CLI 使用控制台子系统并启动 `python.exe`。可以用 `scripts/build_launcher.ps1` 在 Windows .NET Framework 环境下重建。两版都保持参数引用规则和相同的 Python 应用入口。

标准版使用包内运行时，Lite 查找 CPython 3.14 或 Python Launcher。无需 PyInstaller 或额外常驻服务。GUI 异常写入本机启动日志，CLI 交互输出采用 UTF-8。启动器当前未进行 Authenticode 签名。
