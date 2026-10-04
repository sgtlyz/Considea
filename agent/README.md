# Agent 与 Workflow：并行开发入口

先读 [接口契约 v2.0](contracts.md)，按 [JSON Schema](interfaces/protocol.schema.json) 和 [离线样例](interfaces/fixtures) 接线。主流程见 [workflow_updated.md](../workflow_updated.md)。共享协议以这份 v2.0 契约为准；现有 Evaluator 内部接口的差异见下文。

当前主流程为 Interview → 本人批准共享 Profile → Negotiator 提出 difference → Human 回答 → 按轮次继续讨论或人工 converge → Idea Generator → Evaluator → Human Review。小改经 Idea Generator 修订后重新评估；加一轮回到讨论。没有“生成后先人工微调再首次评估”的独立阶段。

## 各自交付什么

| 负责方 | 实现的 operation | 模块位置（交付约定） | 说明 |
| --- | --- | --- | --- |
| Interview | interview.turn、interview.summarize | agent/interview/definition.mjs | [角色说明](interview-agent.md) |
| Negotiator | negotiate.detect | agent/negotiate/definition.mjs | [角色说明](negotiate-agent.md) |
| Idea Generator | idea.generate、idea.revise | agent/idea/definition.mjs | [角色说明](idea-agent.md) |
| Evaluator | evaluator.evaluate | agent/evaluator/definition.mjs | [角色说明](evaluator-agent.md) |
| Workflow | 统一调用、人工事件、状态和权限 | workflow/ | [运行与 HTTP 接口](../workflow/README.md) |

模块位置是 v2.0 交付约定，四个角色的具体人员分配由团队确定。Evaluator 已有独立实现，但尚未适配该共享协议；其他角色的业务实现由对应负责人交付。Evaluator 不生成候选、不协商、不决定成员支持，也不写人工批准或数据库状态。

## 可以马上并行的工作

- Workflow：状态机、持久化、页面和六个 operation 的调度已接通；`python -m workflow` 用 mock 联调，`python -m workflow --mode pi` 加载各负责人交付的兼容模块。
- Agent：按自己 operation 的输入实现 definition、prompt、validator 和只读工具；不依赖 Workflow 数据库。
- 共同边界：Agent 返回结构化建议；人工回答、共享批准、收敛选择和最终审阅由 Workflow 记录。
- 先验证协议：仓库根目录运行 `python agent/interfaces/validate_contracts.py`，再各自检查真实输出。
- 改字段、枚举或 operation 时同时更新契约、schema、样例；不要各自发明字段别名。

## 与现有 Pi Base 的关系

外层 `schema_version` 仍为 `1.0`，共享业务 payload/data 的 `contract_version` 固定 `2.0`。沿用 [Pi Base](pi-base/README.md) 的 runAgent、JSONL CLI 或 Python bridge。

新业务 definition 直接 default-export plain object，见契约第 10 节。旧 roles.mjs 仍是三角色提示词，旧 example-role.mjs 仍是初访演示；不要误当作 v2 Agent。Workflow 已在独立的 workflow/ 目录实现；业务 Agent 的 v2 definition 仍由各负责人交付。

## 当前 Evaluator 实现与适配边界

[Evaluator 实现与样例](evaluator/README.md) 已提供独立的 `evaluator.evaluate`、内部专题 `evaluator.investigate`、Tavily CLI/HTTP、DeepSeek/Gemini 配置和 Node/Python 接口。DeepSeek + Tavily CLI 已实际调用；测试过程与限制见 [真实 API 报告](evaluator/LIVE_TEST_REPORT.md)。这些测试没有证明共享 v2.0 Workflow 已能直接调用它。

- 当前内部请求使用 `room_config`、`shared_resources`、`tool_budget` 等字段；内部报告为 EvaluationReport `1.2`，不等于共享业务契约 `2.0`。现有 `definition.mjs` 导出 `createDefinition(request, session)`，不是 Workflow 要加载的默认 plain object。
- 需要适配 v2 的 `candidate_ref/content`、`room_context`、`shared_sources`、`search_policy` 和 `provided_evidence`，以及 `{contract_version:"2.0", evaluation}` 输出。适配必须保留身份、来源、权限和预算，不只是重命名字段。
- 当前查重至少分别检索 GitHub 仓库和 Devpost hackathon 项目；未成功完成两个范围时不能查重通过。适配后仍须服从 v2 的 `search_policy`：关闭搜索或预算为零时不发起检索，覆盖不足如实返回 partial。
- 当前实现先确认用户是否有项目时间限制，缺失时返回内部 `needs_input`；开发本系统的时间窗口不用于评估 idea。v2 尚无该时间问答和 Evaluator `needs_input` 的完整表示，需要与 Workflow 协调后再接入，不能把空 deadline 自动当成用户明确无时限。
- 当前报告保留查重/可行性两项判定、`passed`、`novelty_coverage` 和详细来源账本；这些附加字段不能直接塞进 v2 schema。普通公开页面不能自动升级为项目自述，文档支持和成员自述也不能升级为实测。
- 共享 v2.0 仅有 `evaluator.evaluate`；内部 `evaluator.investigate` 保留为独立接口，不加入 Workflow 的六个 operation。

详细字段映射与迁移边界见 [共享契约](contracts.md) 第 12 节；查重规则和交付验收见 [Evaluator 角色说明](evaluator-agent.md)。Workflow 负责精确版本检查和结果保存，旧报告不能覆盖新候选；Evaluator 通过不等于 Human 接受。

Interview、Negotiator、Idea Generator、ASI:One/Agentverse 和 SpacetimeDB 接入由对应负责人实现。[框架设计](framework-design.md) 保留为历史背景，其旧三角色流程已由当前 workflow 和 contracts 替代。全员收敛、轮次和预算由 [Workflow](../workflow/README.md) 管理，不由 Agent 猜测。
