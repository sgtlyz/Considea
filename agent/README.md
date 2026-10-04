# Agent 基座与接线

项目流程、状态机和数据对象以 [workflow_updated.md](../workflow_updated.md) 为准。本目录提供 Pi 基座及各模块的接口说明；早期三 Agent 文档保留作迁移参考。

新版流程：Interview → Preference Profile → Negotiator 识别分歧 → Human Decision → 深入讨论（3–5 轮）→ Idea Generator 生成 3–5 个候选 → 成员微调 → Evaluator → final_review。

## 职责

| 模块 | 负责的结果 |
| --- | --- |
| Interview Agent | 独立访谈与画像草稿，仅本人确认后进入共享上下文 |
| Negotiator Agent | 从共享画像与讨论识别分歧，生成供成员亲自作答的决策题 |
| Idea Generator Agent | 讨论收敛后，依据讨论与人工决策轨迹生成多个候选 |
| Evaluator Agent | 成员微调后，查重、可行性、技术条件、来源与未知项 |
| Workflow（应用代码） | 调度以上角色，保存权限、决策、轮次、版本、成员确认与任务状态 |

Idea Generator 与 Negotiator 已在最新版规划中分开。Evaluator 不负责协商、生成候选或决定成员是否支持。

## 当前 Evaluator 接线

[Evaluator 实现与样例](evaluator/README.md) 提供 evaluator.evaluate、evaluator.investigate、Tavily CLI/HTTP、DeepSeek/Gemini 配置，以及 Node/Python 接口。离线 Pi 工具循环和测试可运行；真实 API 尚未验收。

- 接收新版 IdeaCandidate：target_user、problem、solution、mvp、discussion_trace、member_suggestions 和 workflow 固定的 candidate_id/version。
- 接收房间成员、约束及获准共享的技能/资源，不读取全队私人访谈。
- 用户先回答项目有无时间限制；缺失时返回 needs_input，明确无时限可以正常评估。项目时间不采用开发本系统的 18 小时窗口。
- Evaluation 1.2 输出 version、feasibility、similar_projects、technical_checks、risks、unknowns、sources、status，以及两项 tests 与 passed。
- 来源支持与实测分开：supported_by_source、team_claim、needs_test、unknown；本工具不产生 verified。
- Workflow 在 candidate_refinement 后调度 Evaluator，保存结果、阻止旧版结果覆盖新版，然后进入 final_review。

## 阅读入口

[Pi Base](pi-base/README.md) 是共用执行层。[共享契约](contracts.md) 的统一 envelope 保持 1.0，Evaluator 部分已更新；其他旧字段与角色接口按最新版规划迁移。[Evaluator 设计](evaluator-agent.md) 与实现 README 对齐。

Interview、Negotiator、Idea Generator、ASI:One/Agentverse 和 SpacetimeDB 接入由对应负责人实现。开发节奏与联合验收直接参考 workflow_updated.md，不把旧版候选反复迭代流程作为当前要求。