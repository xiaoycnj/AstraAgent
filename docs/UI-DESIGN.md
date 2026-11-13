# 对话界面设计依据

桌面组件、设计令牌与交互规则现统一记录在 [设计系统](DESIGN-SYSTEM.md)、[交互规范](INTERACTION-SPEC.md) 和 [UI/UX 验收记录](UI-UX-ACCEPTANCE.md)。下文保留项目早期的产品结构参考。

本次调研访问官方仓库、文档与 GUI 源码，采用交互原则自行实现。现有模型服务、工具审批、任务记录和高级材质继续作为界面状态来源。

| 项目 | 从官方资料观察到的结构 | AstraAgent 的设计选择 |
| --- | --- | --- |
| Microsoft AutoGen Studio | Playground 可查看产物、执行动作、工具与代码结果，以及任务指标 | 保留可展开的执行记录，让最终回答占据阅读区，详细动作按需查看 |
| Google ADK Web | 官方将其定位为 Agent 开发与调试 UI | 日常对话优先，工作台承担项目和调试信息，避免将调试控件铺满正文 |
| Alibaba Qwen-Agent | GUI 源码使用 Chatbot、MultimodalInput 与函数调用内容转换 | 附件、文字与发送入口保持同一输入区，复用真实输入事件和既有上传链路 |
| ByteDance UI-TARS Desktop / Agent TARS | 官方提供桌面 Agent 与 CLI/Web UI，面向实际任务执行 | 保留任务状态与停止入口，文件、终端和工作台通过现有入口查看 |

以上“设计选择”是本项目基于资料作出的设计判断。参考来源如下。

- [AutoGen Studio 官方 Playground 说明](https://microsoft.github.io/autogen/stable/user-guide/autogenstudio-user-guide/usage.html#interactively-running-teams)
- [Google ADK Web 官方仓库](https://github.com/google/adk-web)
- [Qwen-Agent GUI 源码](https://github.com/QwenLM/Qwen-Agent/blob/main/qwen_agent/gui/web_ui.py)
- [ByteDance UI-TARS Desktop 官方仓库](https://github.com/bytedance/UI-TARS-desktop)

## 材质与阅读

侧栏、输入区和浮层使用现有玻璃变量，保留用户选择的材质档位、透色与主题色。正文独立使用阅读面，避免多层透明内容叠加。收敛圆角、间距、字阶与控件尺寸，代码和表格拥有独立滚动边界。尊重系统减少动态效果的偏好。

输入区保留项目托盘、附件、当前权限、模型和语音。文件子权限与多人格审查归入可展开的对话选项，继续操作原控件。欢迎卡片只预填草稿，由用户编辑和发送。

## 反面案例的使用范围

用户提供的《朱峰智能体无限5.8.0-安全分析报告》采用纯静态分析，本次没有运行、逆向或复测对方安装包。不能据此将推测的攻击链、崩溃原因或恶意性当作已复现事实。

从报告提取的交互约束为权限开关应有实际效果，危险能力应有明确授权入口，任务应可停止，错误应可见，更新应由用户主动确认。它们对应本项目已有的权限、停止、错误、审计和更新功能。本次 UI 重构复用这些入口。

## 验证

Playwright 回归覆盖欢迎卡片预填、对话选项、Markdown/LaTeX/代码显示、认证刷新、审计窗口、明暗主题与 390px 移动布局。移动布局检查发送按钮实际位于视口内。测试使用临时工作区与合成消息。
