# Negotiator Agent：并行开发交付说明

负责人只实现 `negotiate.detect`。模块约定为 `agent/negotiate/definition.mjs`，name 固定为 `negotiate`（保留现有 Pi 前缀）。

输入：contract_version、discussion_round、room_context、shared_context。输出：contract_version 和一个 difference。完整字段见 [契约](contracts.md) 第 5 节及 [schema](interfaces/protocol.schema.json) 的 NegotiateDetectInput/Data、Difference。

## 角色行为

从获准共享的画像和历史中选出对最终方向影响最大的一个待讨论问题。比较目标用户、核心问题、产品形态、技术路线、创新与实用性、复杂度、风险与参与条件，不以人数多少直接排序。

输出二元或开放问题、受影响成员、重要性与来源。binary 恰好两个选项，open 没有 options。输出不含候选、动作调度、人工答案或 converge 决定。

没有充分证据认定分歧时，输出 kind=clarification，清楚说明需要人核实什么；仍由 Human 回答，不能自动进入生成。成员否认题意后，Workflow 会把真实反馈作为后续上下文传入。

## 接线

Workflow 保存回包、分配 difference_ref、创建人工任务；答案由 Human 提交。你不负责等待、投票汇总、n 递增或回访执行。

- [分歧样例](interfaces/fixtures/negotiate-difference.json)
- [澄清样例](interfaces/fixtures/negotiate-clarification.json)

验收：不得输出 room 外成员或未知 source_id；没有 An→Ai 跳过 Human 的动作；不能把个人偏好编成共同约束。旧 negotiate.generate/plan/revise/recommend 不属于当前 v2 接口，候选生成与修订归 Idea Generator。
