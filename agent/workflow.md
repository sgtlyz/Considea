# Workflow 入口

当前流程的完整说明统一维护在 [workflow_updated.md](../workflow_updated.md)。产品概览见 [README](../README.md)。

> 本页保留原有链接入口，流程以白板及后续问答确认结果为准。本次仅更新说明与系统图，暂不实现 workflow。

![Conclave 系统图](../docs/assets/conclave-workflow.png)

## 已确认的调度顺序

1. Interview → 本人批准共享的 Preference Profiles。
2. Negotiator 找最大 difference → Human 真实回答。
3. `n ≤ 3`：把人工回答交给 Interview，继续深挖。
4. `n ≥ 4`：Human 判断 diverge/converge；diverge 回 Interview，converge 进入 Idea Generator。
5. Idea Generator → Evaluator → Human Review。
6. Human Review：接受则输出；小改回 Idea Generator 并重新评估；加一轮回 Interview 并重新经过分歧识别和人工节点。

任何一轮都不能跳过 Human 对 difference 的回答，Agent 不自行决定收敛。本架构未设置第 5 轮自动生成或第 4 轮自动停止。

Workflow 是应用代码，负责身份、共享权限、轮次、任务、版本和人工事件。四个业务角色为 Interview、Negotiator、Idea Generator 和 Evaluator。

状态机和验收仍待实现。六个 Agent operation、数据字段和人工事件已写入 [接口契约 v2.0](contracts.md)，并提供 [Schema](interfaces/protocol.schema.json) 与 [完整样例](interfaces/fixtures)。Workflow 可直接基于这些样例并行开发；多人决策汇总、具体轮次计数事件和运行预算仍由应用层另行确定。