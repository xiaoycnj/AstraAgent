# 模型专项适配

在设置的模型服务商卡片中打开详情，配置“模型专项适配”。默认根据官方域名识别厂商。第三方中转需手动指定厂商，并确认其协议支持。

## 协议与特殊能力

| 厂商 | 已实现协议 | 本版专项能力 |
| --- | --- | --- |
| OpenAI | Chat Completions、Responses，保留既有 OAuth | 分系列推理档位、Responses 回答详略、加密推理项回传、稳定缓存键 |
| DeepSeek | Chat Completions | thinking 开关、V4/Flash 档位、工具回合 reasoning_content 回传 |
| Anthropic | 原生 Messages | adaptive / 固定思考预算、签名块回传、原生图片和工具格式、5 分钟 / 1 小时缓存 |
| GLM / 智谱 | Chat Completions | GLM-4.x / 5.2 / 5.3 差异映射、强制思考兼容 |
| 通用兼容 | 原有 Chat，可显式选择 Responses / Messages | 保留兼容入口，专项参数需要手动选择相应厂商 |

DeepSeek 的 Responses / Anthropic 兼容入口、厂商托管的搜索与代码执行工具尚未纳入本版专项适配。工具执行继续通过 AstraAgent 的权限控制器。

## 推理档位

滑块提供默认、关闭、极低、低、中、高、超高、最高。默认由服务商决定。服务商不支持的档位按下表折算。

| 系列 | 关闭 / 极低 | 低 / 中 / 高 | 超高 / 最高 |
| --- | --- | --- | --- |
| GPT-5 | minimal / minimal | low / medium / high | high / high |
| GPT-5.1 | none / none | low / medium / high | high / high |
| GPT-5.2 及后续 GPT-5.x | none / low | low / medium / high | xhigh / xhigh |
| GPT-6 Astra / GPT-6.1 | low / low | low / medium / high | xhigh / max |
| GPT-6 Sol / Luna | none / low | low / medium / high | xhigh / max |
| o1 / o3 / o4 | low / low | low / medium / high | high / high |
| DeepSeek V4 / Flash | disabled / low | low / high / high | high / max |
| GLM-5.2 | disabled / disabled | high / high / high | max / max |
| GLM-5.3 | low / low | low / high / high | max / max |
| Claude adaptive | disabled / low | low / medium / high | high 或 xhigh / max |

GLM-4.5/4.6/4.7 与旧版 DeepSeek 使用思考开关。Claude 4.6 的超高折算 high，4.7/4.8 与 5 系列可使用 xhigh。强制思考的 Claude 系列将关闭折算 low。固定预算模式保持预算小于总输出上限，模型强制 adaptive 时优先遵守模型约束。

本表记录当前实现。新增模型、别名和网关可能具有不同约束，应通过“测试连接”确认配置。

OpenAI 专项适配的 GPT-6 系列带工具请求自动使用 Responses，确保思考与工具调用可以组合。即使服务商配置为 Chat，该规则仍会生效。只实现 Chat 的中转可以选择通用兼容模式。[GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)

## 缓存与历史状态

- OpenAI 缓存键根据服务商、模型和系统前缀稳定生成，用户后续提问不会单独改变此键。Responses 在已适配的新系列使用隐式缓存选项。
- Claude 对稳定系统前缀设置缓存断点，同时启用自动对话缓存，支持默认 5 分钟和可选 1 小时 TTL。更长 TTL 可能增加服务商费用。
- DeepSeek、GLM 使用服务端隐式缓存。“关闭客户端显式缓存”仅移除客户端缓存参数，服务商仍可能自动缓存。
- 工具回合保持原生思考块、签名或加密推理项。最终回复的原生状态在本地使用 Windows DPAPI 加密保存，并绑定服务商、模型和凭证身份。编辑正文后不再回填旧状态。
- 既有对话、分支复制和压缩后的历史可能缺少原生状态。模型与账户切换会重新建立状态，不能保证沿用旧缓存。
- Token 统计使用服务商返回的数据。Claude 输入总数包含普通输入、缓存写入和缓存读取，避免漏算。缓存命中取决于前缀长度、厂商阈值、有效期、模型和实际负载。

## 验证范围

本版使用本地 HTTP / SSE 模拟响应、参数断言和浏览器回归验证，覆盖工具循环、签名回传、取消、流中断及用量字段。尚未用真实账户运行四家付费推理，缓存命中率也未做线上基准测试。

## 官方参考

- [OpenAI 推理模型](https://developers.openai.com/api/docs/guides/reasoning)、[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[GPT-5.1](https://developers.openai.com/api/docs/models/gpt-5.1)、[GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2)、[GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [DeepSeek Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Context caching](https://api-docs.deepseek.com/guides/kv_cache/)
- [Claude Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)、[Effort](https://platform.claude.com/docs/en/build-with-claude/effort)、[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [GLM 深度思考](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)、[上下文缓存](https://docs.bigmodel.cn/cn/guide/capabilities/cache)

文档核对日期为 2026-11-13。
