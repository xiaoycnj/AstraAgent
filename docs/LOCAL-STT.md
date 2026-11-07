# 本地 CPU 语音识别

可选的独立服务，基于 faster-whisper / CTranslate2 的 CPU INT8 推理。模型加载完成后，识别不依赖远程 API。默认只监听 `127.0.0.1:8790`，不会随桌面或 watchdog 自动启动。

## 安装一次

需要标准 Python 3.10+（带 venv 与 pip），Windows 可从 python.org 安装并启用 Python launcher。AstraAgent 默认发行包中的环境不安装语音依赖；模型和独立环境也不会放进 Standard/Lite 压缩包。

在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install_local_stt.ps1
```

脚本创建 `.local-stt/venv`，安装 `requirements-stt.txt`，下载多语言 `base` 模型，并导出实际安装版本的许可声明和 requirements-lock。首次安装需要联网与额外磁盘空间；base 模型约 150 MB，Python 推理依赖另占空间，不是几十 KB 的无依赖服务。模型缓存位于 `.local-stt/models`，下载失败可重跑。

语音服务固定使用 CPU，无需 CUDA。默认四线程；低功耗机器可设两线程。更重的模型需要更多内存与时间，`small` 可作为中文准确度与速度的另一个选择；不能承诺特定录音必定更准确。

## 启动与接入

```powershell
.\AstraAgent.CLI.exe stt
# 或
powershell -File scripts/start_local_stt.ps1
```

源码环境可用 `py -3 cli.py stt`。服务成功启动会显示地址；启动默认只读取本地模型缓存，不自动联网下载。Ctrl+C 停止这个独立服务，关闭 AstraAgent 主界面不会停止它。

在 AstraAgent → 设置 → 语音，点击“使用本地 CPU 语音服务”，保存：

| 设置 | 值 |
| --- | --- |
| Base URL | `http://127.0.0.1:8790/v1` |
| 模型 | `base` |
| 语言 | `zh`，也可留空自动识别 |
| API Key | 默认留空；已有远程密钥需明确勾选清除后保存 |

保持原有交互：空白输入框按住麦克风、松开后转写，内容填入草稿，编辑后再发送。`base` 会有错字、标点及简繁差异，不进行强制简繁转换；重要内容请校对。浏览器仍须授予麦克风权限。

更换模型需先下载对应缓存，再启动同名模型：

```powershell
.\AstraAgent.CLI.exe stt --model small --download-model
.\AstraAgent.CLI.exe stt --model small --threads 4 --language zh
```

自备离线 CTranslate2 Whisper 模型目录可通过 `--model "D:\models\my-whisper"` 使用，同时在 STT 设置中使用服务 `/v1/models` 返回的 ID。不能直接加载原始 PyTorch 权重文件。常规启动不联网，只有明确安装/下载步骤访问 PyPI 和模型源。

## API

- `GET /health`：模型是否加载、CPU/INT8 状态。
- `GET /v1/models`：当前服务实际托管的模型 ID。
- `POST /v1/audio/transcriptions`：multipart/form-data，必填 `file` 和 `model`，可选 `language`、`prompt`、`temperature`、`response_format`。
- 输出支持 `json`（`{"text":"..."}`）、`text`、`verbose_json`（含语言、时长与分段）。模型 ID 还接受兼容别名 `whisper-1`，实际仍使用服务端加载的模型，不会换成远程服务。

可设置环境变量 `ASTRA_STT_API_KEY`，再启动服务，客户端填写同一密钥。默认无密钥但仅本机可访问，不等同于抵御同用户恶意程序。服务拒绝来自浏览器页面的 Origin 请求；AstraAgent 后端转发不受影响。

## 边界与数据

- 单次文件最多 5 MB、解码后最多 120 秒，支持 WAV、WebM/Opus、Ogg、MP3、MP4/M4A 与 FLAC。解码禁止文件/HTTP 协议引用，并拒绝播放列表容器。
- 默认单路推理，忙时返回 429；HTTP 连接数量有界，上传有读取超时。健康检查可在推理时使用。
- 单个原生解码/推理调用不是可随时强制取消的隔离进程。客户端断开后，正在进行的 CPU 推理可能继续到本次结束；长录音在慢 CPU 上可能超过 AstraAgent 的 90 秒请求超时，建议分段。
- 上传、音频样本与转写结果只在内存中处理，不按上传文件名写盘，不记录转写正文。程序只持久化依赖、模型缓存与许可证；应用中主动发送的转写文字仍按普通聊天保存。
- 模型由启动参数固定；客户端不能提供 URL 或本地路径来下载/加载另一模型。
- `.local-stt` 被 Git 与发行包排除。安装后，依赖声明统一显示在设置 → 关于 → 点击查看开源声明；上游包未附带的主要许可证由 `licenses/optional-stt` 补充。

实现依据：[faster-whisper 官方项目](https://github.com/SYSTRAN/faster-whisper)，[CTranslate2](https://github.com/OpenNMT/CTranslate2)，[Whisper 模型许可](https://github.com/openai/whisper/blob/main/LICENSE)。没有引入 LangChain、PyTorch 或独立 FFmpeg 命令行程序；音频解码使用 PyAV 自带库。

验证包括协议、安全边界、AstraAgent 原客户端接入、真实 CPU 模型识别中英文 WAV 和 WebM/Opus，以及超时长与播放列表外部访问拒绝。合成 TTS 样本只用于功能验证，不代表真实环境准确率评测。
