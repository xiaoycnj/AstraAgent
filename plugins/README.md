# AstraAgent 插件协议 v1

插件放在 plugins/<目录>/manifest.json。schema_version=1；id 为小写字母、数字、短横线；name、version、description 为字符串；skills 为 {id,name,prompt} 列表。插件默认为关闭，设置页显式启用后参与请求。修改 manifest 后刷新设置即可重新扫描。

当前支持声明式提示词贡献，不导入 Python、JS，不执行任意命令。tools 字段为未来工具适配器保留；非空时标记不支持，不能启用。未来适配器需通过统一工具注册、权限审核、执行事件接口接入。permissions 仅为声明信息，不构成授权；文件访问仍走每次请求的权限控制。

writing-kit 是可启用的示例。插件状态存于 data/extensions.json。单个无效 manifest 会显示错误，不会阻断其他插件。
