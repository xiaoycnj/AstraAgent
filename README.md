<div align="center">
<img src="web/assets/icons/brand/astra.svg" width="80" alt="AstraAgent logo">

# AstraAgent

### 从一个想法，到一份可以交付的成果。

Windows 桌面 · 本地工作空间 · OpenAI 兼容 API · CLI

[下载发行版](https://github.com/xiaoycnj/AstraAgent/releases/latest) · [使用与安全](SECURITY.md) · [更新日志](CHANGELOG.md) · [MIT License](LICENSE)

</div>

---

AstraAgent 是一个由你配置模型服务的个人智能体工作空间。对话、项目文件、终端、工具执行与任务记录放在同一个界面中，数据保存在本机，模型请求发往你选择的服务商。

## 选择你的版本

| | Standard 标准版 | Lite 轻量版 |
| --- | --- | --- |
| 应用功能 | 完整 | 完整 |
| Python、Node.js/npm | 内置 | 使用本机环境 |
| WebView2 | 内置固定运行时 | 使用系统运行时 |
| 适合 | 希望解压即用 | 已有开发环境、希望减小下载体积 |

两版面向 **Windows 10/11 x64**。Lite 需要标准 CPython **3.14 x64**、Python launcher 或 PATH 配置，以及系统 WebView2。Node.js/npm 仅在相关工具和 MCP 服务需要时安装。桌面宿主使用 Windows 的 .NET Framework。

## 三步开始

1. 从 Releases 下载并**完整解压**到可写目录。
2. 双击 `AstraAgent.exe`，等待启动画面进入工作空间。
3. 在设置中添加服务商，填写 Base URL、API Key 和模型 ID，测试后保存。

远程接口使用 HTTPS，例如 `https://api.example.com/v1`。本机服务支持 `http://127.0.0.1:端口/v1`。兼容 Chat Completions，模型列表通过 `/models` 获取，也可手动维护名称和 ID。测试连接会发起真实请求，可能产生服务商费用。

API Key 由使用者提供。应用支持可配置的 OpenAI OAuth 接入，使用前需要自己的 OAuth client ID 与回调配置。

## 工作空间里有什么

| 能力 | 用法 |
| --- | --- |
| 对话 | 流式输出、停止生成、断线续读、分支、归档、会话附件与输出聚合 |
| 内容展示 | Markdown、LaTeX、代码高亮、图片预览和文件侧栏 |
| 项目 | 绑定真实目录，读取与编辑文件，查看差异、验证结果和检查点回滚 |
| 执行 | Shell、工具审批、持久化步骤、重启后手动继续与不确定结果保护 |
| 扩展市场 | 插件与玻璃皮肤精选，支持搜索、预览、安装、导入导出及社区投稿 |
| 能力扩展 | Skills、插件与多个 stdio MCP 服务，支持对话中按需发现与加载 |
| 任务协作 | 目标、任务、子智能体依赖调度、跨会话调度和多人格审查 |
| 长期背景 | 本地资料、自定义指令、记忆与世界树 |
| 性能统计 | 自动记录历史 Token 速度、首段延迟、各模型对比与上游模型标识，支持筛选与调用明细 |
| 无限画布 | 连接卡片组织思路，关联上下文继续执行 |
| 语音 | 可配置 TTS 朗读、按住录音的 STT 转写，转写内容可编辑后发送 |
| 外观 | 明暗主题、主题色、强调色、玻璃材质与语言资源包 |

要让智能体直接新建本地文本文件，切换到 Agent 模式，启用 Tools 和文件访问，然后可以说：“在项目里新建 `docs/notes.md`，写入今天的会议要点。”新文件保存在绑定的项目目录；未绑定项目时保存在本机工作区 `data/files`。创建操作不会覆盖同名文件，写入按当前文件权限执行。

多人格审查使用当前配置的模型并行生成多个视角，再进行汇总，会产生多次模型调用。MCP 和宿主命令以当前用户身份运行，具体边界见安全说明。

## 让 Agent 制作扩展

在 Agent 模式打开 Tools 和文件访问后，可以说：“做一个阅读 mod：启动时使用紧凑布局，并添加名为‘阅读说明’的面板，先导出不要安装。”也可以说：“制作并安装一个深色青绿色皮肤，等我预览后再应用。”插件和行为 mod 使用声明式事件与面板，皮肤使用颜色、布局、图标和快捷操作；不执行自定义 Python 或 JavaScript。默认产出可从扩展市场导入的作品包，安装不会自动启用或应用，也不会覆盖同名作品。

启动时会检查本地插件清单、市场安装记录和皮肤包。发现损坏后会进入扩展安全模式：使用基础外观，停载全部插件，保留已安装文件和选择。打开 **扩展市场** 查看故障位置，修复文件或卸载有问题的作品后，选择 **重新检查并恢复**。仅重启不会解除安全模式。

## 可选本地语音输入

提供 CPU INT8 的本地 STT 服务。可从 Releases 选下离线语音 DLC，解压后免安装运行；也可自行安装独立语音环境并下载模型。运行 `AstraAgent.CLI.exe stt`，在语音设置使用本地服务预设即可。模型和推理依赖不增加默认发行包体积，详见[本地 STT 安装与使用](docs/LOCAL-STT.md)。

## 中断后继续工作

重新启动后打开原会话，在输入框上方展开任务恢复记录并选择“继续任务”。已完成步骤复用保存结果，待批准步骤重新询问；结果不确定的命令需先人工核对后选择跳过或明确重试。不想继续时可选择“放弃任务”，执行记录仍会保留。详见[执行恢复说明](docs/EXECUTION-RECOVERY.md)。

## 图片生成与功能模块

在服务商管理中选择 **图片生成 · image_api**，填写兼容 OpenAI 的 Base URL、图片模型与密钥。聊天接口使用 `chat_api`，图片接口不会出现在聊天模型选择表中。

启用 Tools 与内置「图片生成」插件后，可以在对话里让智能体调用 `generate_image`。调用遵守当前权限策略，可能产生服务商费用。支持 `/images/generations` 的 base64 图片或合规图片 URL 响应，单次生成一张，图片通过现有附件限制校验，保存为当前会话产物，可以在右侧预览和下载。异步作业轮询等厂商专有协议需要另行适配。

设置的「功能模块」可以独立控制基础计算、项目文件与生图适配器，关闭后会阻止对应的新工具调用。模块结构和接入约定见 [模块开发说明](docs/MODULES.md)。任务、MCP、记忆与终端继续由已有独立域模块负责。

右侧工作栏显示当前会话的执行记录、工作空间任务、子智能体与交付物。状态来自本地执行事件和存储记录，窄窗口下可以按需打开。

## 联网搜索

1. 在「设置 → 通用 → 联网搜索」保存 [Brave Search API 密钥](https://api.search.brave.com/app/keys)。
2. 在输入框的「+」菜单开启「联网搜索」，然后提出例如「查找最新的 Python 发布公告并附来源链接」的问题。Chat 和 Agent 都支持，所选模型需支持工具调用。
3. 搜索成功后，回复末尾会列出本轮取得的来源链接。搜索读取结果摘要，不会自动打开网页。

搜索默认关闭。开启后，模型生成的关键词会发往 Brave Search，可能消耗服务商额度。密钥在本地由 Windows DPAPI 加密保存。应用的全局工具权限设为「禁止」时不会发起搜索。

## 权限由你决定

提供全部拒绝、每次询问、信任命令自动批准与完全访问。新安装默认每次询问，文件和命令的子权限也会生效。外部资料触发的后续高风险操作需要批准。服务端保存的策略是权限上限；本机终端需要在「常规」中单独开启。新安装不默认发起额外记忆提炼，可在记忆设置中选择启用。

API 密钥以当前 Windows 用户的 DPAPI 加密。会话、资料和执行记录保存在本地 `data`，长期记忆位于 `memory`。复制配置到其他电脑或账户后，需要重新填写密钥。

**完全访问能够执行宿主命令。有限命令工作区和文档解析资源限制不提供完整的操作系统沙箱。** 程序当前未进行代码签名，发行包提供 SHA-256 和文件完整性清单。详细修复记录位于 SECURITY.md。

## 桌面与终端

Windows 桌面版直接打开主窗口，并在窗口内显示加载进度。关闭主窗口时会隐藏到系统托盘，后台任务会继续运行。双击托盘图标可恢复主窗口，右键可打开、隐藏或退出 AstraAgent。需要彻底停止应用及其启动的后台服务时，请选「退出 AstraAgent」。

```powershell
# 桌面，无附带控制台窗口
AstraAgent.exe

# 交互式命令行
AstraAgent.CLI.exe

# 同一启动器进入 CLI
AstraAgent.exe --cli

# 绑定项目并逐次确认宿主命令
AstraAgent.CLI.exe chat --project C:\Projects\example --files ask --commands ask --command-mode host

# 终端入口及帮助
CLI.bat --help

# 浅色终端的代码配色
AstraAgent.CLI.exe chat --theme light

# 强制彩色渲染，或输出原始 Markdown
AstraAgent.CLI.exe chat "解释这段代码" --color always
AstraAgent.CLI.exe chat "解释这段代码" --plain

# 供脚本读取的 JSON 事件
AstraAgent.CLI.exe chat "你好" --json

# 浏览器模式，自行指定端口
python.bat server.py --port 8788 --open
```

GUI 启动器使用 Windows 图形子系统，CLI 启动器使用控制台子系统。标准版优先使用内置 Python，Lite 使用本机 CPython 3.14。启动异常写入 `data/logs/launcher.log`。启动器当前未签名。

CLI 支持 Markdown 标题、粗体、引用、列表、表格和代码高亮，按终端宽度换行。彩色终端使用流式预览，生成结束后输出完整回答。工具进度、错误与权限确认使用独立的状态提示，交互式会话可用 `/help` 查看帮助。原生 IUI 卡片在终端展开为可读内容，提问与确认可在下一条消息中用文字回答。

`--color auto|always|never` 控制颜色，默认自动检测终端并遵循 `NO_COLOR` 和 `FORCE_COLOR`，两者同时设置时优先 `NO_COLOR`。`--theme dark|light` 选择代码配色，默认深色。`--plain` 输出原始 Markdown。管道和文件重定向默认输出纯文本，`--json` 输出逐行 JSON 事件。Standard 和 Lite 都随包提供渲染依赖。

默认本地端口为 `8787`。桌面启动器管理后台与 watchdog，主面板退出后关闭它所管理的服务。通过应用菜单可以新建会话、打开项目、进入设置和检查更新。

## 应用内更新

在帮助菜单或关于页检查版本。发行版发现新版后，可启动独立的无框更新窗口，主面板与后台先退出，再进行下载、SHA-256 校验、逐文件验证与安装，完成后重启。安装出错会尝试恢复备份，失败窗口会显示原因。

源码工作区通过 Git 更新。更新不清理用户目录或未知自定义文件，若恢复被文件锁阻止，安装目录旁的 `.astra-update-*` 备份会保留用于恢复。更新器需要访问 GitHub，当前仍依赖 HTTPS 与官方 Release 摘要验证来源。

## 开发与验证

源码运行环境与 Lite 一致，小型桌面及内容渲染依赖随源码提供。

```powershell
python.bat -m unittest discover -s tests -q
python.bat scripts/check_dependencies.py --online
python.bat scripts/build_release.py --edition all
```

标准版打包需要完整 `runtimes` 环境，保留源码中的 Python 路径配置。内置 npm 安全覆盖可通过 `scripts/harden_node_runtime.py` 和提交的锁文件重建。更新历史统一维护在 CHANGELOG.md。

语言资源位于 `i18n`，提供简体中文、English 与跟随系统选项，可以安装自定义语言包。

## 创作者与鸣谢

- **cnxiaoy** · 项目发起、产品设计与维护。
- **Codex（OpenAI-GPT-6.1 Sol 及 GPT-6 Astra）** · AI 编程协作，参与实现、调试、测试与文档整理。
- **群友** · 星环引力执政官、notBot、猪骨社区、与兼、晨曦Aurora、何意豬。

项目原创代码以 MIT 协议开源。第三方组件保留各自版权与许可，完整声明统一收录在设置的「关于 → 点击查看开源声明」中，发行包同时提供许可证文本和 SBOM。

作品开发与投稿见 [扩展市场说明](docs/MARKETPLACE.md)。

智能交互界面支持模型按需生成图表、选择题、清单和计算表单，交互状态随会话保存。详见 [IUI 使用与实现说明](docs/INTELLIGENT-UI.md)。主页布局与皮肤模组可在设置的“布局与模组”中编辑。
