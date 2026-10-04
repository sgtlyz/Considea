# Workflow 入口

当前流程的完整说明统一维护在 [workflow_updated.md](../workflow_updated.md)。产品概览见 [README](../README.md)。

> 本页保留原有流程入口。可运行的状态机、HTTP 接口和本地工作台见 [Workflow 开发说明](../workflow/README.md)。

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

状态机已实现，并使用 [接口契约 v2.0](contracts.md)、[Schema](interfaces/protocol.schema.json) 和 [完整样例](interfaces/fixtures) 进行校验。讨论从 n=1 开始，每次回访递增；n≥4 时所需回答收齐后，全员 converge 才生成，任何人 diverge 返回 Interview。预算耗尽只暂停，管理员可增加额度或结束房间。

默认 mock 模式可完整联调；队友的业务 Agent 通过 `--mode pi` 接入。真实模型输出质量和检索效果需另行验收。