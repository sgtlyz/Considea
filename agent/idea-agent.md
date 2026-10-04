# Idea Generator：并行开发交付说明

可运行实现位于 [agent/idea](idea/README.md)，包含生成/修订、受限网页检索、mem0 记忆与 SpacetimeDB 持久化接线。保留以下 v2.0 接口；新增研究能力显式使用 [Idea 2.1 扩展](idea/contracts/README.md)。离线演示不是实际模型效果或线上服务验证。

负责人实现 `idea.generate`、`idea.revise`。模块约定为 `agent/idea/definition.mjs`，name 为 `idea`。当前 roles.mjs 不含该角色，直接 default-export definition，参考 [契约](contracts.md) 第 10 节。

## 生成

generate 输入 shared_context、convergence_decision、candidate_slots 及公共字段。必须有 n≥4 和 Workflow 校验后的人工 converge 记录；这些不是由模型自行判定的条件。

输出 candidates，每个槽位一个 `{slot_id, draft}`。数量与槽位完全一致。Workflow 分配候选权威 ID/版本。候选使用获准共享的完整讨论轨迹，输出目标用户、问题、机制、MVP、依赖、来源、取舍与未知项。

## 修订

revise 输入一个当前 candidate、对应 evaluation、有效 minor_revision reviews 和 shared_context。输出 base_candidate_ref 与新 draft，change_summary 解释修改。

不自行增加权威版本、不改人类确认、不合并不同候选。Workflow 保存新版后交 Evaluator，再交 Human Review；Agent 不跳过这两个阶段。意见冲突交回 Workflow，不由模型自作团队决定。

- [生成样例](interfaces/fixtures/idea-generate.json)
- [修订样例](interfaces/fixtures/idea-revise.json)
- [精确字段](contracts.md)：第 6 节
- [JSON Schema](interfaces/protocol.schema.json)：IdeaGenerateInput/Data、IdeaReviseInput/Data、CandidateDraft

验收：槽位完整且唯一；来源在本次目录中；member_input 有真实来源；候选有不同取舍；修订基于精确旧版本且不伪造批准。先使用 schema/fixtures 联调，再检验真实模型质量。
