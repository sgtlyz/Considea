# 接口包 v2.0

- [contracts.md](../contracts.md)：语义、角色分工、人工事件和 Pi 接线说明。
- [protocol.schema.json](protocol.schema.json)：JSON Schema Draft 2020-12，包含 Request、Response、ClientEvent、EventResult 及所有业务对象。所有定义在同一文件中，验证不需要网络。
- [fixtures](fixtures)：11 组完整 request/response、5 种人工输入事件、2 种事件回执；均为离线假数据。
- [validate_contracts.py](validate_contracts.py)：结构与部分跨字段约束校验，以及 14 个反例。不是 Workflow 实现，也不是生产权限校验器。

仓库根目录运行：

```sh
python agent/interfaces/validate_contracts.py
python agent/interfaces/validate_contracts.py path/to/my-request-response-pair.json
```

需要 Python 的 jsonschema 包。本项目当前开发环境已具备；团队环境如缺少可自行安装。工具只读 JSON，不调用模型、搜索、数据库或付费接口。

配对文件格式为 `{"description":"可选说明","request":{...},"response":{...}}`。JSON Schema 可被其他语言的 Draft 2020-12 校验器复用；validator 还演示了引用、版本、数量和预算的关系检查。应用仍须验证真实身份、实际工具证据、成员授权与事务版本。

fixture 内的示例 URL、时间戳、人工批准和评估记录仅用于联调，禁止作为真实来源或真实共识展示。
