# AstraAgent 安全审计 · 2026-11-13

## 审计范围

本轮审计自有应用代码，覆盖 HTTP 鉴权与来源检查、工具权限、长期记忆、文件和项目路径、附件解析、MCP 信任与进程、OAuth、本地语音、网页读取、生图下载、市场安装、更新与 DLC、发布白名单及浏览器渲染。测试使用临时数据目录、合成凭证和本机假模型服务。未重启用户主窗口。

审计基于修复前 main 3f2782a，交付版本为 3.8.0。源码检查、受控动态测试和外部漏洞数据库查询分别记录，结论仅对应本报告覆盖条件。

## 本轮发现及处置

| 项目 | 风险与条件 | 修复与验证 |
| --- | --- | --- |
| S-01 运行中权限撤销滞后 | 高风险。任务配置保存权限快照，运行中从完全访问降级为拒绝后，后续调用可能继续使用旧权限。待审批调用同样需要重新检查。 | backend.py 的 refresh_live_permissions 在工具批准前后收紧权限，更新信任命令，拒绝时关闭自动记忆。项目验证的每个命令也重新检查。模型返回前撤销及审批中撤销两种动态回归均阻止命令派发。已开始的宿主进程需要停止任务或关闭终端。 |
| S-02 生图跨站回环下载 | 中风险。服务商返回其他 origin 的 HTTPS 图片地址，原下载传输允许回环，可能触达本机 TLS 服务。没有携带服务商 Authorization。 | modules/image_generation.py 跨 origin 下载关闭回环访问，security_net.py 在建立 socket 前拒绝 IPv4、IPv6 和 IPv4-mapped IPv6 回环。显式配置的同源本地生图服务继续工作。 |
| S-03 更新下载边界不一致 | 加固项。更新 worker 原来使用默认 urllib 重定向，未复用发行清单的官方地址名单。摘要核验仍能阻止不同内容安装。 | updater.py 下载使用 release_feed.Redirect，只允许官方 HTTPS 主机、443 端口及无用户信息地址。按声明体积提前停止超量传输，最终摘要和大小校验继续保留。 |
| S-05 手动项目验证绕过拒绝 | 高风险权限缺陷。手动验证跳过工具审批，并将命令权限设置为 all，导致拒绝档位仍能从该入口启动验证命令。 | 验证命令启动前检查拒绝档位和命令权限，手动入口也遵守硬性禁止。专项测试确认未调用命令执行器。 |
| S-04 curl 隐式配置 | 加固项。Windows TLS 回退调用系统 curl 时，隐式 curl 配置可能改变默认行为，例如重定向或 TLS 选项。 | agent_hub.py 将 --disable 置为第一个参数，保留 --resolve、--noproxy、TLS 校验和体积限制。受控 subprocess 测试确认命令参数。 |

此前 main 已修复并在本版随包交付的项目包括 MCP 相对脚本指纹与启动目录一致性、更新和插件安装的目录联接检查、市场高成本调用限流、无效权限档位拒绝和开关回滚原子写入。

## 接口权限与进程边界

- 从 backend.py 的 AST 提取 65 个私有 /api/ 路由字符串，使用 GET、POST、PUT、DELETE 发出 260 次未认证请求，全部返回 403。该测试覆盖静态路由字符串及前缀，不代表全部已认证业务组合均已枚举。
- 合法 token 配合恶意 Origin、Sec-Fetch-Site 或 Host 被拒绝，正常同源 bootstrap 成功。启动 cookie 保持 HttpOnly、SameSite=Strict 和端口相关签名。
- 工具来源默认 external，未知工具也触发来源保护。原有浏览网页/项目指令 → 宿主命令审批测试继续保留。
- 宿主 Shell、已信任 MCP 和项目验证程序以当前用户身份执行。信任指纹覆盖可执行文件及显式文件参数，运行时导入依赖和网络下载仍需信任插件作者。
- 文档解析有 CPU、内存、并发与时限约束。有限命令 worker 和解析进程均未获得操作系统级文件/网络隔离。

## 外发与隐私检查

动态测试包裹 socket.connect，观测初始化以及 health、bootstrap、profile、settings、runtime、capabilities 读取。已测路径只建立本机连接。浏览器回归收集 HTTP(S) 请求目的地，未观察到非本机请求。静态检索未发现 sendBeacon 或后台聊天同步通道。

模型、语音、OAuth、用户请求的网页、生图及用户触发的市场/更新/DLC 请求会按配置访问网络。上述观测不是系统级抓包，未覆盖所有第三方二进制或用户自行启动的宿主程序。没有把“有限测试中没有外发”扩展为“所有条件下绝无外发”。

## Git 历史检查

扫描本地全部可达 refs，包含 34 个提交、1248 个唯一 blob、19600767 字节，无大文件跳过。对数据目录、浏览器凭证数据库、.env、DPAPI、SQLite 文件等路径进行匹配，候选数为 0。

凭证模式及私钥标记扫描命中 1 处，位于 tests/test_security.py 的合成私钥头测试字符串，未发现真实私钥正文。扫描结果只保留对象、路径、行号及匹配摘要，不记录秘密正文。该方法不能识别所有自定义凭证格式，不包含不可达对象、未拉取的远程 refs 或 GitHub 外部附件。

## 依赖与发布

对清单映射的 160 个包版本执行 OSV 在线查询，返回 findings 为空。六类组件需独立公告复核，包含字体、CPython、Node.js、pip 及其内嵌依赖、WebView2 SDK 和固定 Runtime。本机运行时为 CPython 3.14.8、Node.js v24.22.2。本轮不宣称这些二进制已完成 CVE 全覆盖审查。

Standard/Lite 继续使用显式发布白名单、私有文件排除断言、逐文件 SHA-256 和 SBOM。发布资产摘要只证明完整性。当前发布物没有 Authenticode 签名，同一账户下的恶意进程仍可读文件、调用 DPAPI 或改动本地代码，现有应用边界不能抵御该威胁。

GitHub API 当前返回两个 issue，#1 Rust 重写请求开放，#2 旧版本来源保护问题关闭，本轮未发现新增 issue。

## 验证入口

```powershell
python -m unittest discover -s tests -q
python -m unittest tests.test_comprehensive_security -v
python scripts/check_dependencies.py --online
node tests/browser_security.cjs
python scripts/build_release.py --edition all
```

专项回归位于 tests/test_comprehensive_security.py。最终完整套件 184 项测试通过，耗时 61.937 秒。浏览器回归通过，无脚本错误、CSP 违规或非本机 HTTP(S) 请求。日志另有既存的 unclosed BufferedReader ResourceWarning，未导致测试失败。汇总数据见 security/audit-2026-11-13.json。浏览器验证覆盖 CSP、Markdown/LaTeX、安全对话框、安装卸载、皮肤预览及窄屏布局。

## 结论与剩余风险

本轮完成上述自有应用边界的审计、修复和回归，未将第三方原生运行时、恶意宿主程序或全部浏览器引擎作为已验证对象。提示注入、用户批准的不可信命令、供应链、同用户进程攻击及无签名发布仍是明确边界。高权限执行前的用户判断仍然必要。
