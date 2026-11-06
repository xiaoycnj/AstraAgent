# AstraAgent — Personal Agent Workspace

个人智能体工作空间，提供 Windows 原生桌面、CLI 和浏览器界面。使用 Python、SQLite 与 WebView2，接入用户自行配置的 OpenAI 兼容模型服务。

[下载标准版 / Lite 版](https://github.com/xiaoycnj/AstraAgent/releases/latest) · [MIT License](LICENSE) · [更新日志](CHANGELOG.md)

标准版内置完整运行环境，Lite 使用本机 CPython 3.14 x64 和系统 WebView2。Node.js/npm 仅在相关工具或 MCP 服务需要时由 Lite 用户安装。两版使用相同应用功能。

克隆源码后运行 `start.bat` 打开桌面或 `CLI.bat` 使用终端助手。源码中已包含必要的小型依赖，运行环境要求与 Lite 一致。测试命令为 `python.bat -m unittest discover -s tests -q`。标准版打包需从标准发行包取得 `runtimes` 环境，并保留源码中的 `runtimes/python` 配置文件。


## 创作者

- **cnxiaoy** — 项目发起、产品设计与维护。
- **Codex（OpenAI）** — AI 编程协作，参与代码实现、调试、测试与文档整理。


## 开始使用

1. 将压缩包完整解压到可写的文件夹，不要直接在压缩包内运行。
2. 面向 Windows 10/11 x64。标准版内置 Python、Node.js/npm 与固定版 WebView2，Lite 复用本机环境。桌面宿主使用 Windows 系统的 .NET Framework 组件。
3. 双击 **启动.bat** 或 **start.bat**。显示原生启动画面，守护服务就绪后进入内嵌工作空间。
4. 点击左下角「接口与模型设置」，填写接口地址、API Key、模型名称，点击「测试连接」后保存。
5. 在「对话」中发送消息，或切换到「无限画布」。

默认本地通信地址为 http://127.0.0.1:8787。主窗口退出时会关闭它管理的后台服务。应用内“新窗口”可打开共享服务的独立工作窗口。

如果默认端口被其他程序占用，可运行：

```powershell
py -3 server.py --port 8788 --open
```


## API 接入

支持 OpenAI 兼容的 **Chat Completions** 接口：`POST {Base URL}/chat/completions`。

- Base URL 填服务商给出的基础地址，例如 `https://api.example.com/v1`。
- 也支持粘贴完整的 `/chat/completions` 地址，保存时会规范化。
- 模型名填写服务商提供的真实模型 ID；「获取列表」会请求 `/models`，不支持列表的服务商可以手动填写。
- API Key 由使用者自己提供。支持不需要密钥的本地服务。
- 「测试连接」会向选中的模型发一条简短请求，可能计入服务商用量。
- 普通对话支持流式返回与断线续读，接口超时可设置 10–180 秒。
- 不支持仅提供 Anthropic Messages 或 OpenAI Responses 格式而不兼容 Chat Completions 的端点。

首次启动也可以通过 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY` 环境变量预填。保存 GUI 设置后以本机配置文件为准。


## 已实现

### 多人格审查

在输入框上方打开「多人格审查」，选择 2–4 个并行视角：架构师、挑错者、用户视角、安全审查。模型并行给出各自意见，再由主持人格综合证据、分歧和建议。每条意见以独立角色消息保存，最终汇总单独标出。全流程使用当前配置的同一个模型；每次审查会发起所选人格数加一次汇总，共 3–5 次模型调用，服务商可能按调用计费。任一步失败时不保存半成品，原输入保留供重试。

### 外观

左下角可切换浅色和深色模式。偏好保存在当前浏览器中；对话、画布两种页面同步切换。

### 对话

新建、切换、重命名、删除会话；连续对话；复制回答；代码块显示；导出 Markdown。每次请求携带最近 40 条历史消息与系统提示词。请求失败时显示错误并保留输入。绑定项目的流式任务中断时，会保存已接收内容与中断原因，供检查和继续。消息长度上限 32000 字符，服务商仍有自己的上下文限制。

### 无限画布

- 多画布创建、切换、重命名、删除。
- 便签、文档、智能体三类节点；右侧编辑内容。
- 拖动节点、拖动空白处平移、滚轮缩放、适应视图。
- 点击「连线」，依次点击来源节点、目标节点；右侧可删除连线。
- 节点复制、删除、撤销、重做。
- 自动保存到本地 SQLite；Ctrl+S 可以手动重试保存。
- 导出和导入 JSON。
- 选中智能体后点击「执行任务」，会把当前任务及所有直接连入节点的文字发送给用户配置的模型；完成后新增文档节点，并保存对应对话。
- 多页面版本检查：冲突时拒绝覆盖。可先导出未保存内容，再刷新。

画布执行由用户触发。智能体工具、命令与文件访问由常规设置中的统一权限控制器管理。


## 数据与密钥

所有持久数据保存在项目的 `data/` 目录：

- `workspace.sqlite3`：会话、消息、画布。
- `settings.json`：模型配置与 API Key。密钥以本机文件形式保存，不加密；网页读取配置时只返回是否存在密钥，不回传密钥值。浅色/深色偏好保存在浏览器 localStorage。

分发程序时只分享干净的压缩包，**不要把自己的 data 目录打包**。备份数据前先停止应用，再复制整个 data 目录。程序只监听 127.0.0.1，面向本机单用户；不用于公网部署。


## 项目结构

```text
启动.bat / start.bat   一键启动与系统浏览器
server.py              启动入口
backend.py             API、SQLite、模型适配、静态页面服务
web/index.html         GUI
web/assets/css/style.css          样式
web/assets/js/app.js             对话与画布交互
 tests/test_app.py     离线集成测试
```


## 接口概要

先 `GET /api/bootstrap` 取得本次服务的 token，写请求携带 `X-App-Token` 与 `Content-Type: application/json`。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/health | 健康状态与应用标识 |
| GET / PUT | /api/settings | 读取脱敏配置 / 保存配置 |
| POST | /api/settings/models | 获取模型列表，可传入未保存的配置 |
| POST | /api/settings/test | 测试模型调用，可传入未保存的配置 |
| GET / POST | /api/sessions | 会话列表 / 创建（title） |
| PATCH / DELETE | /api/sessions/{id} | 重命名（title）/ 删除 |
| GET | /api/sessions/{id}/messages | 消息历史 |
| POST | /api/sessions/{id}/chat | 对话（content） |
| POST | /api/sessions/{id}/review | 多人格审查（content、personas: 2–4 个人格 ID） |
| GET | /api/canvases | 画布列表 |
| GET / PUT / DELETE | /api/canvases/{id} | 读写删除；PUT 传 title、data、revision |

新建画布 revision 为 0；保存后使用响应中的新 revision。


## 验证

```powershell
py -3 -m unittest discover -s tests -v
```

测试使用临时目录和本机模拟模型服务，不需要真实密钥，不调用商业模型。覆盖配置、上游 HTTP 转发、聊天历史与级联删除、错误处理、并发请求、画布版本冲突、静态页面与跨来源限制。

已另外通过 Edge 的桌面及移动视口端到端检查：接口配置/读取模型/连接测试、聊天与代码块、画布新增/编辑/拖动/连线/刷新恢复、智能体生成文档、撤销重做、导入导出、重命名和删除。真实服务商的密钥、额度、模型可用性需使用者自行通过「测试连接」确认。



## 前端资源目录

```
web/
  index.html
  assets/
    js/                  应用脚本
    css/                 应用样式
    icons/brand/         AstraAgent Logo
    icons/models/        模型厂商 SVG、来源与许可证
    fonts/katex/         数学字体
    vendor/              第三方渲染器、编辑器及许可证
```

后端统一通过 /assets/ 提供前端资源，保留旧资源 URL 的兼容映射；不在旧目录保存重复副本。vendor_python 为后端 Python 依赖，继续与前端静态资源隔离。



## 开源许可

AstraAgent 原创代码采用 MIT License，Copyright (c) 2026 cnxiaoy。完整条款见 [LICENSE](LICENSE)。随项目分发的第三方库、字体、品牌图标与运行时按各自许可提供，原始版权声明保留在对应目录以及 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Git 仓库托管源代码和必要应用依赖。标准与 Lite 二进制发行包及 SHA-256 校验文件通过 GitHub Releases 分发。data、个人记忆、密钥、运行时二进制与本地缓存由 .gitignore 排除。

## 上下文缓存与用量

缓存由模型服务商管理。应用通过稳定的提示词、插件和工具定义顺序，以及保持未变化记忆的历史注入位置，提高请求前缀的复用机会。记忆、世界树内容、用户指令和权限变化会在后续请求生效。上下文压缩或能力变更可能重新建立缓存，实际命中受服务商、模型、上下文长度和缓存保留时间影响。

设置 → 个人资料提供每天、每周、累计 Token 活动及缓存命中率。命中率为同时上报输入与缓存计数的请求中，缓存 Token 总数除以输入 Token 总数，不对单次百分比取平均。支持标准 cached_tokens 与 DeepSeek prompt_cache_hit_tokens。缺失数据不估算，也不回填历史对话。

兼容服务可在模型服务商设置开启“请求流式 Token 用量”。只在接口支持 stream_options.include_usage 时启用。数据保存在 data/usage.sqlite3，记录计数和模型元信息。日期采用设备当前固定 UTC 偏移，历史夏令时边界可能存在差异。

上下文组织参考 [ZCode ContextBuilder](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/core/src/context/builder.ts) 与 [动态上下文设计](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/design/v2/loop/meta-user-context.md)。本次采用独立实现，未引入其代码或依赖。
