# Agent 与 Workflow：并行开发入口

先读 [接口契约 v2.0](contracts.md)，按 [JSON Schema](interfaces/protocol.schema.json) 和 [离线样例](interfaces/fixtures) 接线。主流程见 [workflow_updated.md](../workflow_updated.md)。

## 各自交付什么

| 负责方 | 实现的 operation | 模块位置（交付约定） | 说明 |
| --- | --- | --- | --- |
| Interview | interview.turn、interview.summarize | agent/interview/definition.mjs | [角色说明](interview-agent.md) |
| Negotiator | negotiate.detect | agent/negotiate/definition.py | [角色说明](negotiate-agent.md) |
| Idea Generator | idea.generate、idea.revise | agent/idea/definition.mjs | [角色说明](idea-agent.md) |
| Evaluator | evaluator.evaluate | agent/evaluator/definition.mjs | [角色说明](evaluator-agent.md) |
| Workflow | 统一调用、人工事件、状态和权限 | workflow/ | [运行与 HTTP 接口](../workflow/README.md) |

Idea Generator 已有 [可运行实现](idea/README.md)，支持原始 v2.0 及独立的 [Idea v2.1 检索扩展](idea/contracts/README.md)。Interview 和 Python Negotiator 已整合，Evaluator 等待交付。详见 [整合入口](../workflow/INTEGRATION.md)。

## 可以马上并行的工作

- Workflow：状态机、持久化、页面和六个 operation 已接通；`python -m workflow` 用 mock 联调，`python -m workflow --mode integrated --model offline` 联调真实队友代码，`--model live` 调用模型。
- Agent：按自己 operation 的输入实现 definition、prompt、validator 和只读工具；不依赖 Workflow 数据库。
- 共同边界：Agent 返回结构化建议；人工回答、共享批准、收敛选择和最终审阅由 Workflow 记录。
- 先验证协议：仓库根目录运行 `python agent/interfaces/validate_contracts.py`，再各自检查真实输出。
- 改字段、枚举或 operation 时同时更新契约、schema、样例；不要各自发明字段别名。

## 与现有 Pi Base 的关系

外层 schema_version 仍为 1.0；Interview 在整合流程使用专用 v2.1，其他角色及人工事件为 v2.0。Idea 可以显式选择其独立的 2.1 检索契约；它不会自动升级其他角色。沿用 [Pi Base](pi-base/README.md) 的 runAgent、JSONL CLI 或 Python bridge。

新业务 definition 直接导出 plain object，见契约第 10 节。旧 roles.mjs 仍是三角色提示词，旧 example-role.mjs 仍是初访演示；不要误当作 v2 Agent。Workflow 已在独立的 workflow/ 目录实现；已交付角色通过各自 service / Python 入口调用。

[框架设计](framework-design.md) 保留为历史背景，其旧三角色流程已由当前 workflow 和 contracts 替代。全员收敛、轮次和预算由 [Workflow](../workflow/README.md) 管理，不由 Agent 猜测。

Idea uses its validated service entry point: [implementation](idea/README.md).
