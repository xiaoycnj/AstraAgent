# 应用行为插件

设置 → 插件与技能 → 创建应用插件，填写 ID、名称、说明和应用行为。制作器可预览、导出 JSON 清单，安装后通过插件列表的开关启用。第三方清单使用“导入应用插件”，核对来源与行为后安装。同名 ID 会被拒绝，避免覆盖已有插件。

v1 的 Skill、工具和 MCP 集成继续可用。v2 提供应用事件与界面贡献。

| 事件 | 动作 | 参数 |
| --- | --- | --- |
| before_send | limit_length | 1–100000 的整数 |
| before_send | prefix | 文本前缀 |
| after_response | save_output | 空字符串，回复自动进入会话输出 |
| after_response | notify | 完成提醒文字 |
| startup | reading_layout | compact 或 comfortable，启停后立即生效 |

发送前检查、前缀和流式回复归档同时在后端生效。阅读布局和提醒由应用界面执行。归档使用消息 ID 去重，恢复任务不会重复保存同一输出。插件动作失败会记录事件，保留模型回复。

```json
{
  "schema_version": 2,
  "id": "my-reading-layout",
  "name": "我的阅读布局",
  "version": "1.0.0",
  "description": "切换为舒适阅读布局",
  "hooks": [{"event": "startup", "action": "reading_layout", "value": "comfortable"}],
  "panels": [{"title": "阅读设置说明", "text": "在插件列表停用后恢复原布局。"}]
}
```

`panels` 为插件设置入口，每个入口提供标题和正文。事件和动作由应用校验执行，清单可以改变上述应用行为。扩展外部服务和执行能力可配合 MCP 使用。当前包格式为 JSON 清单，未提供 dsh 可执行插件的直接兼容层。

## 更新发布

发布 ZIP 后，通过 GitHub Releases 元数据生成 `release-catalog.json` 并上传到同一发行版。`scripts/build_release_catalog.py <元数据 JSON> <输出 JSON>` 提取 ZIP 的官方地址、大小和 SHA-256。更新器与 DLC 管理器遇到 REST 网络错误时改读这个官方资产清单。每次发布均应附带清单，以覆盖匿名 API 限流场景。
