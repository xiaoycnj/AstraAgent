# 应用内 DLC

设置 → 关于 AstraAgent → 可选 DLC，输入 `latest` 或正式发行标签（例如 `v3.4.1`），点击“获取 DLC”，再选择需要的包。语音设置也提供“下载本地语音 DLC”入口。

下载留在主面板内，显示传输进度；下载和校验期间可取消。取消响应可能需要等待当前网络读取超时（最多 25 秒）。开始提交安装后不能取消，请保持应用运行。刷新界面后可继续查看后台任务。

仅接受 `xiaoycnj/AstraAgent` 官方正式发行版中的 DLC ZIP 资产，需要 GitHub 提供 SHA-256。可以选择任何正式发行版本，安装包还必须兼容当前应用版本。GitHub 限流会显示可重试的错误，不绕过校验；不支持任意第三方 URL、仓库或安装脚本。

目前可安装本地 CPU 语音包：`.local-stt`。完成后运行 `AstraAgent.CLI.exe stt` 启动独立服务，在语音设置中选择本地预设并保存。安装不会自动启动服务或修改原有 API 配置。已有服务正在运行时请先停止，否则 Windows 可能拒绝替换运行时文件。

重装或更换版本时，整个旧目录保留在 `dlcs/.backups/<DLC-ID>-<唯一标识>`，包括额外模型或原来的虚拟环境。确认新版本工作后可手动清理备份；它不会被新版本自动加载。提交失败会尝试恢复原目录。断电、强制结束进程时不保证自动恢复，可将备份手动放回原安装位置。大文件需要压缩包和解压内容的额外空间；应用本体仍无额外推理依赖。

## 后续 DLC 包格式

- 资产名称：`AstraAgent-<名称>-DLC-<版本>-win-x64.zip`，发布到本仓库正式 GitHub Release。
- 普通包根：`dlcs/<id>/`。`id` 为小写字母、数字和连字符，最长 64 字符。
- 包内包含 `dlcs/<id>/dlc.json`，字段为 `id`、语义版本 `version`、`minimum_app_version` 和 `platform: "windows-x64"`。
- `dlcs/<id>/file-integrity.json` 为“压缩包内完整相对路径 → SHA-256”映射，覆盖除清单自身以外的全部文件。
- 其余文件必须属于同一个 DLC 根。仅旧式 `astra-local-stt-base` 允许 `.local-stt/` 和顶层 `INSTALL-STT-DLC.txt`，与已发布语音包兼容。
- 不能包含链接、重名路径、Windows 设备路径或上级目录。下载最多 2 GB，解压总量最多 6 GB、最多 50,000 个文件。
- 不运行 post-install 脚本。DLC 的功能入口由应用集成，下载通用包本身不会让插件自动启用。

API 使用原有本机身份校验：`GET /api/dlc?release=latest`、`GET /api/dlc/status`、`POST /api/dlc/install`（`release` 和 `asset_id`）、`POST /api/dlc/cancel`。同一应用目录同时仅允许一个安装任务。


## 文档理解 DLC

AstraAgent 3.5.0 起支持 `document-understanding` 包。在附件卡片或资料库点击“识别文字”，处理完成后点击“识别结果”查看分页文本、文字四边形坐标与置信度。后续发送附件时会携带已识别文本。

图片支持 PNG、JPEG、WebP，扫描 PDF 最多 20 页，沿用附件 5 MB 上限。识别进程最多 2 GB 内存、160 秒 CPU 时间，180 秒后终止。每次处理一份文档。识别失败保留原附件与已有结果。页面坐标以识别时渲染图的像素为单位。

第一版提供逐行 OCR 与位置数据。表格单元格合并、复杂阅读顺序和手写内容需要人工核对。模型和依赖随 DLC 离线提供，安装后通过附件入口直接调用。

源码构建依赖见 `requirements-document.txt`。将依赖安装到独立目录后执行 `scripts/build_document_dlc.py --site <目录> --output <输出目录>`，生成符合 DLC 管理器格式的 ZIP 与 SHA-256 文件。完整依赖版本和许可证也包含在包中。
