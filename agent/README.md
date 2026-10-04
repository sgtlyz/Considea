# Agent 与 Workflow：并行开发入口

先读 [接口契约 v2.0](contracts.md)，按 [JSON Schema](interfaces/protocol.schema.json) 和 [离线样例](interfaces/fixtures) 接线。主流程见 [workflow_updated.md](../workflow_updated.md)。

## 各自交付什么

| 负责方 | 实现的 operation | 模块位置（交付约定） | 说明 |
| --- | --- | --- | --- |
| Interview | interview.turn、interview.summarize | agent/interview/definition.mjs | [角色说明](interview-agent.md) |
| Negotiator | negotiate.detect | agent/negotiate/definition.mjs | [角色说明](negotiate-agent.md) |
| Idea Generator | idea.generate、idea.revise | agent/idea/definition.mjs | [角色说明](idea-agent.md) |
| Evaluator | evaluator.evaluate | agent/evaluator/definition.mjs | [角色说明](evaluator-agent.md) |
| Workflow | 统一调用、人工事件、状态和权限 | 自选 | [Workflow](workflow.md) |

模块位置是待交付约定，目前没有替队友实现这些 Agent。四个角色的具体人员分配由团队确定。

## 可以马上并行的工作

- Workflow：用 fixture 的 request/response 接通页面和状态；保存 Human 事件，校验版本和引用。
- Agent：按自己 operation 的输入实现 definition、prompt、validator 和只读工具；不依赖 Workflow 数据库。
- 共同边界：Agent 返回结构化建议；人工回答、共享批准、收敛选择和最终审阅由 Workflow 记录。
- 先验证协议：仓库根目录运行 `python agent/interfaces/validate_contracts.py`，再各自检查真实输出。
- 改字段、枚举或 operation 时同时更新契约、schema、样例；不要各自发明字段别名。

## 与现有 Pi Base 的关系

外层 schema_version 仍为 1.0，业务 payload/data 的 contract_version 固定 2.0。沿用 [Pi Base](pi-base/README.md) 的 runAgent、JSONL CLI 或 Python bridge。

新业务 definition 直接导出 plain object，见契约第 10 节。旧 roles.mjs 仍是三角色提示词，旧 example-role.mjs 仍是初访演示；不要误当作 v2 Agent。本次交付的是接口与联调材料，未改业务运行代码。

[框架设计](framework-design.md) 保留为历史背景，其旧三角色流程已由当前 workflow 和 contracts 替代。多人投票汇总、运行预算等仍属于 Workflow 政策，不由 Agent 猜测。
