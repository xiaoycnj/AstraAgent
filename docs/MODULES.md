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

图片接口使用兼容 OpenAI 的 `/images/generations`。返回 base64 时直接验证并存储，URL 响应经 DNS、协议和重定向限制下载，不向图片下载站点转发服务商 Bearer。图片受附件体积和格式限制，成功后链接到当前会话输出。取消不能保证服务商撤销已经发生的计费。

测试使用本地合成图片 API，覆盖工具获批、拒绝不出网、取消不保存、加密密钥、持久化会话输出、模块关闭和类型隔离。尚未使用真实付费服务商执行生图验收。

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

## 启动器

`native/Launcher.cs` 编译为两个程序，GUI 版本使用 Windows 图形子系统并启动 `pythonw.exe`，CLI 使用控制台子系统并启动 `python.exe`。可以用 `scripts/build_launcher.ps1` 在 Windows .NET Framework 环境下重建。两版都保持参数引用规则和相同的 Python 应用入口。

标准版使用包内运行时，Lite 查找 CPython 3.14 或 Python Launcher。无需 PyInstaller 或额外常驻服务。GUI 异常写入本机启动日志，CLI 交互输出采用 UTF-8。启动器当前未进行 Authenticode 签名。
